import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { PrismaService } from '@common/database/prisma.service';
import { GetHostsForUserQuery } from '@modules/hosts/queries/get-hosts-for-user';
import { GetCachedSubscriptionSettingsQuery } from '@modules/subscription-settings/queries/get-cached-subscrtipion-settings';
import { ResolveProxyConfigService } from '@modules/subscription-template/resolve-proxy/resolve-proxy-config.service';
import { XrayGeneratorService } from '@modules/subscription-template/generators/xray.generator.service';
import { UsersService } from '@modules/users/users.service';
import { CreateUserRequestDto } from '@modules/users/dtos/create-user.dto';
import { randomUUID } from 'node:crypto';
import { DpiCredentialsService } from './dpi-credentials.service';
import { safeDpiResponse } from './dpi-response-sanitizer';

export type DpiLocation = 'russia'|'russia_mobile'|'china'|'iran'|'turkmenistan';
const LOCATIONS = ['russia','russia_mobile','china','iran','turkmenistan'];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Job = {id:string;remote_id:number|null;user_uuid:string|null;host_uuids:string[];location:string;pop_ids:number[];status:string;estimated_cost:number|null;created_at:Date};

@Injectable()
export class DpiCheckerService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private readonly logger = new Logger(DpiCheckerService.name);
  constructor(private readonly db:PrismaService, private readonly users:UsersService, private readonly queries:QueryBus,
    private readonly resolve:ResolveProxyConfigService, private readonly generator:XrayGeneratorService,private readonly credentials:DpiCredentialsService) {}
  onModuleInit() { if(process.env.INSTANCE_TYPE==='scheduler') {this.timer=setInterval(()=>void this.tick(),20000);void this.tick();} }
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
  async apiWithKey(path:string,key:string,init:RequestInit={}):Promise<any> {
    const headers:Record<string,string>={'Content-Type':'application/json',...(key?{'X-API-Key':key}:{})};
    let response:Response;
    try {response=await fetch(`https://dpichecker.st/api/v1${path}`,{...init,headers:{...headers,...init.headers},signal:AbortSignal.timeout(15000),redirect:'error'});}
    catch {throw new ServiceUnavailableException('DPI Checker is unreachable');}
    const body:unknown=await response.json().catch(()=>null);
    if(!response.ok) {const err=body as {code?:string}|null;throw new BadRequestException(`DPI Checker: ${err?.code??response.status}`);}
    return body;
  }
  async api(path:string,init:RequestInit={},authenticated=true):Promise<any>{
    return this.apiWithKey(path,authenticated?await this.credentials.getKey():'',init);
  }
  async billingSettings(){
    const rows=await this.db.$queryRaw<{enabled:boolean}[]>`SELECT enabled FROM dpi_checker_billing_settings WHERE id=1`;
    return {response:{enabled:rows[0]?.enabled===true}};
  }
  async setBillingSettings(input:{enabled:boolean}){
    if(!input || typeof input.enabled!=='boolean') throw new BadRequestException('Укажите состояние записи трат');
    const enabled=input.enabled;
    // Setting the option and registering the provider is one DB transaction.
    await this.db.$executeRaw`
      WITH config AS (
        UPDATE dpi_checker_billing_settings
        SET enabled=${enabled},updated_at=CASE WHEN enabled IS DISTINCT FROM ${enabled} THEN now() ELSE updated_at END
        WHERE id=1 RETURNING enabled
      )
      INSERT INTO infra_providers(name,favicon_link,login_url)
      SELECT 'DPI//CHECKER','https://i.ibb.co/5WcD8CyW/2026-11-23-021501444.png',
        'https://t.me/dpi_checker_robot?start=p453722'
      FROM config WHERE enabled
      ON CONFLICT(name) DO UPDATE SET favicon_link=EXCLUDED.favicon_link,login_url=EXCLUDED.login_url`;
    return this.billingSettings();
  }
  private async recordExpenses(){
    // The opt-in timestamp excludes checks that were completed before enabling.
    // Each job is charged at most once, even when two schedulers tick concurrently.
    await this.db.$executeRaw`
      WITH eligible AS MATERIALIZED (
        SELECT j.id,j.actual_cost::float8 AS amount FROM dpi_check_jobs j
        CROSS JOIN dpi_checker_billing_settings s
        WHERE s.enabled AND j.status='completed' AND j.actual_cost>0
          AND j.created_at>=s.updated_at
          AND NOT EXISTS (SELECT 1 FROM dpi_checker_billing_receipts r WHERE r.job_id=j.id)
        ORDER BY j.created_at LIMIT 100
      ), provider AS (
        INSERT INTO infra_providers(name,favicon_link,login_url)
        SELECT 'DPI//CHECKER','https://i.ibb.co/5WcD8CyW/2026-11-23-021501444.png',
          'https://t.me/dpi_checker_robot?start=p453722'
        WHERE EXISTS (SELECT 1 FROM eligible)
        ON CONFLICT(name) DO UPDATE SET favicon_link=EXCLUDED.favicon_link,login_url=EXCLUDED.login_url
        RETURNING uuid
      ), receipts AS (
        INSERT INTO dpi_checker_billing_receipts(job_id,record_uuid,amount_usd)
        SELECT id,gen_random_uuid(),amount FROM eligible
        ON CONFLICT(job_id) DO NOTHING
        RETURNING record_uuid,amount_usd
      )
      INSERT INTO infra_billing_history(uuid,provider_uuid,amount,billed_at)
      SELECT r.record_uuid,p.uuid,r.amount_usd,now() FROM receipts r CROSS JOIN provider p`;
  }
  async profile() {
    const result=await this.api('/profile');
    const balance=result?.balance??result?.usd_balance??(await this.api('/quota'))?.balance;
    return {response:{balance:balance==null?null:Number(balance),currency:'USD'}};
  }
  async pops(location:DpiLocation,optimal=false){this.validateLocation(location);return this.api(`/pops${optimal?'/optimal':''}?location=${encodeURIComponent(location)}`,{},false);}
  private validateLocation(location:string){if(!LOCATIONS.includes(location))throw new BadRequestException('Invalid location');}
  /** Expose host-to-node membership and visible diagnostics without VPN credentials. */
  async hostOptions(){
    const [nodes,hosts]=await Promise.all([
      this.db.$queryRaw`SELECT uuid,name,address,country_code AS "countryCode" FROM nodes ORDER BY name`,
      this.db.$queryRaw`SELECT h.uuid,h.remark,h.address,h.is_disabled AS "isDisabled",
        h.is_hidden AS "isHidden",h.config_profile_inbound_uuid AS "inboundUuid",
        COALESCE(array_agg(hn.node_uuid) FILTER (WHERE hn.node_uuid IS NOT NULL),'{}'::uuid[]) AS "nodeUuids"
        FROM hosts h LEFT JOIN hosts_to_nodes hn ON hn.host_uuid=h.uuid GROUP BY h.uuid ORDER BY h.remark`,
    ]);
    return {response:{nodes,hosts}};
  }
  async list(){return {response:await this.db.$queryRaw`SELECT id,remote_id,host_uuids,node_uuid,location,pop_ids,status,progress_done,progress_total,estimated_cost::float8,actual_cost::float8,error,created_at,updated_at FROM dpi_check_jobs ORDER BY created_at DESC LIMIT 100`};}
  async one(id:string){const rows=await this.db.$queryRaw<any[]>`SELECT id,remote_id,host_uuids,node_uuid,location,pop_ids,status,progress_done,progress_total,estimated_cost::float8,actual_cost::float8,error,results,remote_response,created_at,updated_at FROM dpi_check_jobs WHERE id=${id}::uuid`;
    if(!rows.length)throw new NotFoundException();return {response:rows[0]};}
  private async job(id:string){const rows=await this.db.$queryRaw<Job[]>`SELECT * FROM dpi_check_jobs WHERE id=${id}::uuid`;if(!rows.length)throw new NotFoundException();return rows[0];}
  private async keys(job:Job){
    if(!job.user_uuid)throw new BadRequestException('Temporary account expired');
    const rows=await this.db.users.findUnique({where:{uuid:job.user_uuid}});
    if(!rows)throw new BadRequestException('Temporary account missing');
    const user=await this.users.getUserByUniqueFields({uuid:job.user_uuid});
    if(!user.isOk)throw new BadRequestException('Unable to load temporary user');
    const hosts=await this.queries.execute(new GetHostsForUserQuery(user.response.tId,false,true));
    if(!hosts.isOk)throw new BadRequestException('Temporary account has no accessible hosts');
    const selected=hosts.response.filter(h=>job.host_uuids.includes(h.uuid));
    if(selected.length!==job.host_uuids.length)throw new BadRequestException('Selected hosts not accessible to temporary user');
    const settings=await this.queries.execute(new GetCachedSubscriptionSettingsQuery());
    if(!settings)throw new BadRequestException('Subscription configuration is unavailable');
    const resolved=await this.resolve.resolveProxyConfig({user:user.response,hosts:selected,subscriptionSettings:settings});
    const links=this.generator.generateLinks(resolved,false).filter(link=>link.startsWith('vless://'));
    if(links.length!==selected.length)throw new BadRequestException('Every selected host must produce exactly one VLESS link');
    return links;
  }
  async prepare(input:{hosts:string[];location:DpiLocation;pop_ids?:number[];node_uuid?:string|null}){
    await this.credentials.getKey();this.validateLocation(input.location);
    if(!Array.isArray(input.hosts)||!input.hosts.length||input.hosts.length>100||input.hosts.some(x=>!uuidPattern.test(x)))throw new BadRequestException('Select 1–100 hosts');
    const selected=[...new Set(input.hosts)];
    if(input.node_uuid && !uuidPattern.test(input.node_uuid))throw new BadRequestException('Некорректная нода для DPI');
    if(input.node_uuid){
      const links=await this.db.$queryRaw<{host_uuid:string}[]>`SELECT host_uuid FROM hosts_to_nodes
        WHERE node_uuid=${input.node_uuid}::uuid AND host_uuid=ANY(${selected}::uuid[])`;
      if(new Set(links.map(link=>link.host_uuid)).size!==selected.length)
        throw new BadRequestException('Некоторые хосты не связаны с выбранной нодой');
    }
    const hosts=await this.db.hosts.findMany({where:{uuid:{in:selected},isDisabled:false},select:{uuid:true,configProfileInboundUuid:true}});
    if(hosts.length!==selected.length||hosts.some(h=>!h.configProfileInboundUuid))throw new BadRequestException('Some hosts are disabled, missing, or do not have an inbound');
    // Keep this as a definite array: optional input must never leak into Job or SQL.
    let pops: number[] = input.pop_ids ?? [];
    if(input.pop_ids!==undefined && (!Array.isArray(input.pop_ids) || !input.pop_ids.length || input.pop_ids.length>100 || input.pop_ids.some(x=>!Number.isInteger(x)||x<=0)))throw new BadRequestException('Invalid PoP selection');
    if(input.pop_ids===undefined){
      const optimal=await this.pops(input.location,true);
      const raw=Array.isArray(optimal)?optimal:Array.isArray(optimal?.pop_ids)?optimal.pop_ids:Array.isArray(optimal?.ids)?optimal.ids:[];
      pops=raw.map((p:number|{id:number})=>typeof p==='number'?p:p?.id);
    }
    if(!pops.length || pops.length>100 || pops.some(p=>!Number.isInteger(p)||p<=0))throw new BadRequestException('No valid measurement points available');
    // Each DPI check gets its own short-lived squad containing exactly the
    // selected inbound IDs. It does not depend on the admin having manually
    // exposed those inbounds through an existing squad.
    const id=randomUUID();
    const inboundUuids=[...new Set(hosts.map(h=>h.configProfileInboundUuid!))];
    const squad=await this.db.internalSquads.create({
      data:{
        name:'__dpi_'+id,
        internalSquadInbounds:{create:inboundUuids.map(inboundUuid=>({inbound:{connect:{uuid:inboundUuid}}}))},
      },
      select:{uuid:true}
    });
    let temporaryUserUuid:string|null=null;
    try{
      const created=await this.users.createUser({
        username:`dpi_${id.replace(/-/g,'').slice(0,20)}`,
        status:'ACTIVE',expireAt:new Date(Date.now()+45*60000),
        trafficLimitBytes:1073741824,activeInternalSquads:[squad.uuid],
        description:'Temporary DPI Checker test account'
      } as CreateUserRequestDto);
      if(!created.isOk)throw new ServiceUnavailableException('Unable to create temporary test account');
      temporaryUserUuid=created.response.uuid;
      const job={id,user_uuid:temporaryUserUuid,host_uuids:selected,location:input.location,pop_ids:pops,status:'prepared',remote_id:null,estimated_cost:null,created_at:new Date()};
      const keys=await this.keys(job);
      const estimate=await this.api('/checks/estimate',{method:'POST',body:JSON.stringify({check_type:'vpn',location:input.location,pop_ids:pops,keys})});
      await this.db.$executeRaw`INSERT INTO dpi_check_jobs(id,user_uuid,host_uuids,node_uuid,location,pop_ids,status,estimated_cost,progress_total) VALUES (${id}::uuid,${temporaryUserUuid}::uuid,${selected}::uuid[],${input.node_uuid??null}::uuid,${input.location},${pops}::int[],'prepared',${Number(estimate.estimated_cost ?? 0)},${pops.length*keys.length})`;
      return {response:{id,hosts:selected.length,keys:keys.length,points:pops.length,estimate}};
    }catch(error){
      if(temporaryUserUuid)await this.users.deleteUser(temporaryUserUuid);
      await this.db.internalSquads.deleteMany({where:{uuid:squad.uuid}});
      throw error;
    }
  }
  async start(id:string,maxUsd?:number){
    const job=await this.job(id);
    if(job.status!=='prepared')throw new BadRequestException('Check already started');
    if(Date.now()-new Date(job.created_at).getTime()>30*60000)throw new BadRequestException('Prepared check expired');
    const keys=await this.keys(job);
    // Repeat estimate to protect against balance/tariff changes before billing.
    const estimate=await this.api('/checks/estimate',{method:'POST',body:JSON.stringify({check_type:'vpn',location:job.location,pop_ids:job.pop_ids,keys})});
    if(estimate.affordable===false)throw new BadRequestException('Insufficient DPI Checker balance');
    if(maxUsd!==undefined && Number(estimate.estimated_cost)>maxUsd)throw new BadRequestException('Automated check cost exceeds configured cap');
    const remote=await this.api('/checks/vpn',{method:'POST',headers:{'Idempotency-Key':job.id},body:JSON.stringify({location:job.location,pop_ids:job.pop_ids,keys})});
    await this.db.$executeRaw`UPDATE dpi_check_jobs SET remote_id=${Number(remote.check_id)},status='pending',updated_at=now() WHERE id=${id}::uuid AND status='prepared'`;
    return {response:{id,remote_id:remote.check_id,status:'pending',estimated_cost:remote.estimated_cost}};
  }
  async refresh(id:string,remoteId:number){
    const response=await this.api(`/checks/${remoteId}`);
    const status=response.status==='completed'?'completed':response.status==='failed'?'failed':response.status==='cancelled'?'cancelled':response.status==='running'?'running':'pending';
    const done=Number(response.progress?.done??0),total=Number(response.progress?.total??0);
    // The returned URIs are credentials: discard these from persisted results.
    const snapshot=safeDpiResponse(response);
    const results=Array.isArray(snapshot.results)?snapshot.results:[];
    const summary=JSON.stringify(snapshot);
    // Avoid unbounded DB growth and malicious response amplification.
    const safeSnapshot=summary.length<=8*1024*1024 ? snapshot : {status,progress:snapshot.progress??null,error:'Provider response exceeded 8 MiB; detailed JSON truncated',results:results.slice(0,500)};
    await this.db.$executeRaw`UPDATE dpi_check_jobs SET status=${status},progress_done=${done},progress_total=${total},actual_cost=${response.usd_cost??null},results=${JSON.stringify(results)}::jsonb,remote_response=${JSON.stringify(safeSnapshot)}::jsonb,error=${typeof snapshot.error==='string'?snapshot.error:null},updated_at=now() WHERE id=${id}::uuid`;
    return status;
  }
  async cancel(id:string){const job=await this.job(id);if(job.status==='prepared'){await this.db.$executeRaw`UPDATE dpi_check_jobs SET status='cancelled' WHERE id=${id}::uuid`;await this.cleanup(job);return {response:{success:true}};}
    if(!job.remote_id||job.status!=='pending')throw new BadRequestException('Only queued checks can be cancelled');
    await this.api(`/checks/${job.remote_id}`,{method:'DELETE'});
    await this.db.$executeRaw`UPDATE dpi_check_jobs SET status='cancelled',updated_at=now() WHERE id=${id}::uuid`;await this.cleanup(job);
    return {response:{success:true}};
  }
  private async cleanup(job:Job){
    if(!job.user_uuid)return;
    const result=await this.users.deleteUser(job.user_uuid);
    if(!result.isOk)throw new Error('Temporary DPI user cleanup failed');
    // Only the squad created for this job is deleted; existing customer squads
    // are never changed or removed.
    await this.db.internalSquads.deleteMany({where:{name:'__dpi_'+job.id}});
    await this.db.$executeRaw`UPDATE dpi_check_jobs SET user_uuid=NULL WHERE id=${job.id}::uuid`;
  }
  async tick(){if(this.busy)return;this.busy=true;try{
    const jobs=await this.db.$queryRaw<Job[]>`SELECT * FROM dpi_check_jobs WHERE (remote_id IS NOT NULL AND status IN ('pending','running')) OR (user_uuid IS NOT NULL AND created_at<now()-interval '45 minutes') ORDER BY created_at LIMIT 30`;
    for(const job of jobs){try{if(job.remote_id&&['pending','running'].includes(job.status)){const status=await this.refresh(job.id,job.remote_id);if(['completed','failed','cancelled'].includes(status))await this.cleanup(job);}if(job.user_uuid&&Date.now()-new Date(job.created_at).getTime()>45*60000){await this.cleanup(job);await this.db.$executeRaw`UPDATE dpi_check_jobs SET status='failed',error='Temporary account expired' WHERE id=${job.id}::uuid AND status IN ('prepared','pending','running')`;}}
    catch(err){this.logger.warn(`DPI check ${job.id}: ${String(err)}`);}}
    await this.recordExpenses().catch(err=>this.logger.warn('DPI billing: '+String(err)));
  }catch(err){this.logger.warn(`DPI poll: ${String(err)}`);}finally{this.busy=false;}}
}
