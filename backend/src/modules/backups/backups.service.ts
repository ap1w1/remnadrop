import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@common/database/prisma.service';

type BackupProvider = 'local' | 's3' | 'ftp' | 'gdrive';
type BackupInput = {
  name?: string; provider?: BackupProvider; remoteName?: string; remotePath?: string;
  intervalMinutes?: number; retentionDays?: number; maxBytes?: number;
  autoDelete?: boolean; webhookEnabled?: boolean; enabled?: boolean;
};

const safeName = /^[\p{L}\p{N}_.() \-]{1,70}$/u;
const safeRemote = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/;
const safePath = /^[a-zA-Z0-9_./-]{1,160}$/;
const validUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class BackupsService {
  constructor(private readonly db: PrismaService) {}
  private validate(body: BackupInput, patch = false) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Invalid backup target');
    const b = body as Record<string, unknown>;
    const allowed = new Set(['name','provider','remoteName','remotePath','intervalMinutes','retentionDays','maxBytes','autoDelete','webhookEnabled','enabled']);
    if (Object.keys(b).some(k => !allowed.has(k))) throw new BadRequestException('Unknown backup field');
    if ((!patch || b.name !== undefined) && (typeof b.name !== 'string' || !safeName.test(b.name))) throw new BadRequestException('Name must be 1–70 characters');
    if ((!patch || b.provider !== undefined) && !['local','s3','ftp','gdrive'].includes(String(b.provider))) throw new BadRequestException('Unknown storage provider');
    if (b.remoteName !== undefined && (typeof b.remoteName !== 'string' || (b.remoteName !== '' && !safeRemote.test(b.remoteName)))) throw new BadRequestException('Invalid rclone remote name');
    if (b.remotePath !== undefined && (typeof b.remotePath !== 'string' || !safePath.test(b.remotePath) || b.remotePath.startsWith('/') || b.remotePath.split('/').some(s => s === '..' || s === '.'))) throw new BadRequestException('Invalid relative path');
    for (const [key,min,max] of [['intervalMinutes',15,525600],['retentionDays',1,3650],['maxBytes',1048576,9007199254740991]] as const) {
      if (b[key] !== undefined && (!Number.isSafeInteger(b[key]) || (b[key] as number)<min || (b[key] as number)>max)) throw new BadRequestException(`Invalid ${key}`);
    }
    for (const key of ['autoDelete','webhookEnabled','enabled']) if (b[key] !== undefined && typeof b[key] !== 'boolean') throw new BadRequestException(`Invalid ${key}`);
  }
  async list() {
    const targets = await this.db.$queryRaw`SELECT id,name,provider,remote_name AS "remoteName",remote_path AS "remotePath",interval_minutes AS "intervalMinutes",retention_days AS "retentionDays",max_bytes::text AS "maxBytes",auto_delete AS "autoDelete",webhook_enabled AS "webhookEnabled",enabled,next_run_at AS "nextRunAt",last_run_at AS "lastRunAt",last_status AS "lastStatus",last_usage_bytes::text AS "lastUsageBytes",last_usage_at AS "lastUsageAt",created_at AS "createdAt" FROM backup_targets WHERE archived_at IS NULL ORDER BY created_at DESC`;
    const runs = await this.db.$queryRaw`SELECT id,target_id AS "targetId",status,file_name AS "fileName",size_bytes::text AS "sizeBytes",sha256,started_at AS "startedAt",finished_at AS "finishedAt",error,deleted_at AS "deletedAt" FROM backup_runs ORDER BY started_at DESC LIMIT 150`;
    const agentRows = await this.db.$queryRaw<{lastSeen:Date|null;lastError:string|null}[]>`SELECT last_seen AS "lastSeen",last_error AS "lastError" FROM backup_agent_status WHERE singleton=1`;
    const agent = agentRows[0] ?? {lastSeen:null,lastError:null};
    return {response:{targets,runs,agent:{...agent,online:!!agent.lastSeen && Date.now()-new Date(agent.lastSeen).getTime()<180000}}};
  }
  async create(body:BackupInput) {
    this.validate(body);
    const name=body.name!; const provider=body.provider!; const remoteName=body.remoteName??''; const remotePath=body.remotePath??'remnadrop';
    if (provider!=='local' && !remoteName) throw new BadRequestException('Configure an rclone remote for this storage');
    const interval=body.intervalMinutes??1440, days=body.retentionDays??30, max=body.maxBytes??10737418240;
    const auto=body.autoDelete??true, webhook=body.webhookEnabled??false, enabled=body.enabled??true;
    const rows=await this.db.$queryRaw<{id:string}[]>`INSERT INTO backup_targets(name,provider,remote_name,remote_path,interval_minutes,retention_days,max_bytes,auto_delete,webhook_enabled,enabled,next_run_at) VALUES(${name},${provider},${remoteName},${remotePath},${interval},${days},${BigInt(max)},${auto},${webhook},${enabled},now()+(${interval}*interval '1 minute')) RETURNING id`;
    return {response:{id:rows[0].id}};
  }
  async update(id:string,body:BackupInput) {
    this.validate(body,true);this.checkId(id);
    const current=await this.db.$queryRaw<{id:string; name:string; provider:BackupProvider;remote_name:string;remote_path:string;interval_minutes:number;retention_days:number;max_bytes:bigint;auto_delete:boolean;webhook_enabled:boolean;enabled:boolean}[]>`SELECT * FROM backup_targets WHERE id=${id}::uuid`;
    if(!current.length)throw new NotFoundException('Backup storage not found');
    const c=current[0];const name=body.name??c.name, provider=body.provider??c.provider,remoteName=body.remoteName??c.remote_name,remotePath=body.remotePath??c.remote_path;
    if(provider!=='local'&&!remoteName)throw new BadRequestException('rclone remote required');
    const interval=body.intervalMinutes??c.interval_minutes,days=body.retentionDays??c.retention_days,max=BigInt(body.maxBytes??Number(c.max_bytes)),auto=body.autoDelete??c.auto_delete,webhook=body.webhookEnabled??c.webhook_enabled,enabled=body.enabled??c.enabled;
    await this.db.$executeRaw`UPDATE backup_targets SET name=${name},provider=${provider},remote_name=${remoteName},remote_path=${remotePath},interval_minutes=${interval},retention_days=${days},max_bytes=${max},auto_delete=${auto},webhook_enabled=${webhook},enabled=${enabled},next_run_at=CASE WHEN ${interval}::int<>interval_minutes THEN now()+(${interval}*interval '1 minute') ELSE next_run_at END,updated_at=now() WHERE id=${id}::uuid`;
    return {response:{id,success:true}};
  }
  async trigger(id:string) {
    this.checkId(id);
    const rows=await this.db.$queryRaw<{id:string}[]>`UPDATE backup_targets SET next_run_at=now(),enabled=true WHERE id=${id}::uuid RETURNING id`;
    if(!rows.length)throw new NotFoundException('Backup storage not found');
    return {response:{queued:true,note:'Агент заберёт задание при следующем опросе (обычно до минуты).'}};
  }
  /** Archive a destination without deleting its actual PostgreSQL dumps.
   * A backup destination can contain the only surviving copy of a database. */
  async remove(id:string) {
    this.checkId(id);
    const rows=await this.db.$queryRaw<{id:string}[]>`UPDATE backup_targets
      SET enabled=false,archived_at=now(),updated_at=now()
      WHERE id=${id}::uuid AND archived_at IS NULL RETURNING id`;
    if(!rows.length)throw new NotFoundException('Backup storage not found');
    return {response:{deleted:true,filesPreserved:true,note:'Хранилище удалено из списка. Архивы на диске и в облаке сохранены.'}};
  }
  private checkId(id:string){if(!validUUID.test(id))throw new BadRequestException('Invalid UUID');}
}
