import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@common/database/prisma.service';
import { Prisma } from '@prisma/client';
import { prettyBytesUtil } from '@common/utils/bytes';
import { BulkUpdateUserUsedTrafficBuilder } from '@modules/users/builders/bulk-update-user-used-traffic';

type Quota = { user_uuid: string; node_uuid: string; limit_bytes: bigint | null; used_bytes: bigint; blocked: boolean; period_days: number | null; reset_at: Date | null };

@Injectable()
export class SquadQuotasService {
    constructor(private readonly db: PrismaService) {}

    async list(userUuid: string) {
        return this.db.$queryRaw<Quota[]>`SELECT * FROM user_node_quotas WHERE user_uuid=${userUuid}::uuid ORDER BY node_uuid`;
    }

    async blockedUsers(nodeUuid: string) {
        const rows=await this.db.$queryRaw<{t_id:bigint}[]>`SELECT u.t_id FROM user_node_quotas q JOIN users u ON u.uuid=q.user_uuid WHERE q.node_uuid=${nodeUuid}::uuid AND q.blocked`;
        return new Set(rows.map(r=>r.t_id.toString()));
    }
    async blockedNodes(userUuid: string) {
        return new Set((await this.list(userUuid)).filter(q=>q.blocked).map(q=>q.node_uuid));
    }
    async legacyNeedsReview(userUuid: string) {
        return this.db.$queryRaw`SELECT q.squad_uuid,s.name,q.limit_bytes::text,q.used_bytes::text FROM user_squad_quotas q JOIN internal_squads s ON s.uuid=q.squad_uuid WHERE q.user_uuid=${userUuid}::uuid AND q.migrated_to_node_uuid IS NULL`;
    }
    async hostContexts(userUuid:string,hosts:{uuid:string;configProfileInboundUuid:string|null;nodes?:{nodeUuid:string}[]}[]) {
        const [quotas,nodes,links]=await Promise.all([this.list(userUuid),this.db.nodes.findMany({select:{uuid:true,name:true}}),this.db.configProfileInboundsToNodes.findMany()]);
        const result=new Map<string,{blocked:boolean;values:Record<string,()=>string>}>();
        for(const host of hosts){
            const ids=[...new Set(host.nodes?.length ? host.nodes.map(n=>n.nodeUuid) : links.filter(n=>n.configProfileInboundUuid===host.configProfileInboundUuid).map(n=>n.nodeUuid))];
            const q=ids.length===1?quotas.find(q=>q.node_uuid===ids[0]):undefined;
            const used=q?.used_bytes??0n, limit=q?.limit_bytes??null;
            const left=limit===null?null:limit>used?limit-used:0n;
            const values:Record<string,()=>string>={
                NODE_NAME:()=>ids.length===1?nodes.find(n=>n.uuid===ids[0])?.name??'—':'—',
                NODE_TRAFFIC_USED:()=>ids.length===1?prettyBytesUtil(used,true,3):'—',
                NODE_TRAFFIC_LEFT:()=>ids.length!==1?'—':left===null?'Безлимит':prettyBytesUtil(left,true,3),
                NODE_TRAFFIC_LIMIT:()=>ids.length!==1?'—':limit===null?'Безлимит':prettyBytesUtil(limit,true,3),
                NODE_TRAFFIC_PERCENT:()=>ids.length!==1?'—':limit===null?'0':limit===0n?'100':(Number(used*10000n/limit)/100).toString(),
            };
            for(const key of Object.keys(values))values[key.replace('NODE_','LOCATION_')]=values[key];
            result.set(host.uuid,{blocked:quotas.some(q=>q.blocked&&ids.includes(q.node_uuid)),values});
        }
        return result;
    }

    async configure(userUuid: string, nodeUuid: string, limit: string | null, periodDays: number | null, thresholdPercent = 80) {
        if (!Number.isInteger(thresholdPercent) || thresholdPercent < 1 || thresholdPercent > 99) throw new BadRequestException('Invalid thresholdPercent');
        if (limit !== null && (typeof limit !== 'string' || !/^\d+$/.test(limit) || BigInt(limit) > 9223372036854775807n)) throw new BadRequestException('Invalid limitBytes');
        if (periodDays !== null && (!Number.isInteger(periodDays) || periodDays < 1 || periodDays > 366)) throw new BadRequestException('Invalid periodDays');
        return this.db.$transaction(async tx => {
            const user = await tx.users.findUnique({ where: { uuid: userUuid } });
            if (!user) throw new NotFoundException('User not found');
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${user.tId})`;
            if (!await tx.nodes.findUnique({where:{uuid:nodeUuid}})) throw new NotFoundException('Node not found');
            await tx.$executeRaw`
                INSERT INTO user_node_quotas(user_uuid,node_uuid,limit_bytes,period_days,reset_at)
                VALUES (${userUuid}::uuid,${nodeUuid}::uuid,${limit === null ? null : BigInt(limit)},${periodDays},CASE WHEN ${periodDays}::int IS NULL THEN NULL ELSE now()+${periodDays}::int*interval '1 day' END)
                ON CONFLICT(user_uuid,node_uuid) DO UPDATE SET limit_bytes=excluded.limit_bytes,period_days=excluded.period_days,
                reset_at=CASE WHEN user_node_quotas.period_days IS DISTINCT FROM excluded.period_days THEN excluded.reset_at ELSE user_node_quotas.reset_at END,updated_at=now()`;
            await tx.$executeRaw`UPDATE user_node_quotas SET threshold_percent=${thresholdPercent} WHERE user_uuid=${userUuid}::uuid AND node_uuid=${nodeUuid}::uuid`;
            await this.reconcile(tx, userUuid, nodeUuid, user.tId);
            return { success: true };
        });
    }

    async reset(userUuid: string, nodeUuid: string, onlyIfDue = false) {
        return this.db.$transaction(async tx => {
            const user = await tx.users.findUnique({ where: { uuid: userUuid } });
            if (!user) throw new NotFoundException();
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${user.tId})`;
            if (onlyIfDue) {
                const due = await tx.$queryRaw<Quota[]>`SELECT * FROM user_node_quotas WHERE user_uuid=${userUuid}::uuid AND node_uuid=${nodeUuid}::uuid AND reset_at<=now() FOR UPDATE`;
                if (!due.length) return { success: true };
            }
            const changed = await tx.$executeRaw`UPDATE user_node_quotas SET used_bytes=0,threshold_sent=false,reset_at=CASE WHEN period_days IS NULL THEN NULL ELSE now()+period_days*interval '1 day' END,updated_at=now() WHERE user_uuid=${userUuid}::uuid AND node_uuid=${nodeUuid}::uuid`;
            if (!changed) throw new NotFoundException('Quota not found');
            await this.reconcile(tx, userUuid, nodeUuid, user.tId);
            await tx.$executeRaw`INSERT INTO node_quota_events(user_uuid,node_uuid,event,used_bytes,limit_bytes) SELECT user_uuid,node_uuid,'LOCATION_TRAFFIC_RESET',used_bytes,limit_bytes FROM user_node_quotas WHERE user_uuid=${userUuid}::uuid AND node_uuid=${nodeUuid}::uuid`;
            return { success: true };
        });
    }

    async record(eventId: string, usage: { u: string; b: string; n: string }[], includeGlobal = false) {
        return this.db.$transaction(async tx => {
            const inserted = await tx.$executeRaw`INSERT INTO quota_usage_receipts(event_id) VALUES (${eventId}) ON CONFLICT DO NOTHING`;
            if (!inserted) return [] as { tId: bigint }[];
            // Stable lock order for batches arriving concurrently from different nodes.
            for (const row of [...usage].sort((a,b) => BigInt(a.u) < BigInt(b.u) ? -1 : BigInt(a.u) > BigInt(b.u) ? 1 : 0)) {
                if (BigInt(row.b) < 0n) throw new Error('Negative usage');
                const user = await tx.users.findUnique({ where: { tId: BigInt(row.u) } });
                if (!user) continue;
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(${user.tId})`;
                await tx.$executeRaw`INSERT INTO user_node_quotas(user_uuid,node_uuid) SELECT ${user.uuid}::uuid,uuid FROM nodes WHERE uuid=${row.n}::uuid ON CONFLICT DO NOTHING`;
                const quotas=await tx.$queryRaw<Quota[]>`SELECT * FROM user_node_quotas WHERE user_uuid=${user.uuid}::uuid AND node_uuid=${row.n}::uuid`;
                for (const q of quotas) {
                    await tx.$executeRaw`UPDATE user_node_quotas SET used_bytes=used_bytes+${BigInt(row.b)},updated_at=now() WHERE user_uuid=${user.uuid}::uuid AND node_uuid=${q.node_uuid}::uuid`;
                    await this.reconcile(tx, user.uuid, q.node_uuid, user.tId);
                }
            }
            if (includeGlobal && usage.length) {
                const totals=new Map<string,{u:string;b:string;n:string}>();
                for (const row of usage) totals.set(row.u,{...row,b:(BigInt(totals.get(row.u)?.b ?? '0')+BigInt(row.b)).toString()});
                const {query} = new BulkUpdateUserUsedTrafficBuilder([...totals.values()]);
                return tx.$queryRaw<{tId:bigint}[]>(query);
            }
            return [] as {tId:bigint}[];
        }, { timeout: 60000 });
    }

    private async reconcile(tx: Prisma.TransactionClient, userUuid: string, nodeUuid: string, userId: bigint) {
        const rows: Quota[] = await tx.$queryRaw`SELECT * FROM user_node_quotas WHERE user_uuid=${userUuid}::uuid AND node_uuid=${nodeUuid}::uuid FOR UPDATE`;
        const q = rows[0];
        await tx.$executeRaw`WITH reached AS (
            UPDATE user_node_quotas SET threshold_sent=true WHERE user_uuid=${userUuid}::uuid AND node_uuid=${nodeUuid}::uuid
            AND NOT threshold_sent AND limit_bytes>0 AND used_bytes::numeric*100>=limit_bytes::numeric*threshold_percent RETURNING *
        ) INSERT INTO node_quota_events(user_uuid,node_uuid,event,used_bytes,limit_bytes)
          SELECT user_uuid,node_uuid,'LOCATION_TRAFFIC_THRESHOLD',used_bytes,limit_bytes FROM reached`;
        const blocked = q.limit_bytes !== null && q.used_bytes >= q.limit_bytes;
        await tx.$executeRaw`UPDATE user_node_quotas SET blocked=${blocked} WHERE user_uuid=${userUuid}::uuid AND node_uuid=${nodeUuid}::uuid`;
        if (blocked !== q.blocked) {
            await tx.$executeRaw`UPDATE user_node_quotas SET blocked=${blocked} WHERE user_uuid=${userUuid}::uuid AND node_uuid=${nodeUuid}::uuid`;
            await tx.$executeRaw`INSERT INTO quota_sync(user_uuid) VALUES (${userUuid}::uuid) ON CONFLICT(user_uuid) DO UPDATE SET revision=quota_sync.revision+1,updated_at=now()`;
            if (blocked) await tx.$executeRaw`INSERT INTO node_quota_events(user_uuid,node_uuid,event,used_bytes,limit_bytes) VALUES (${userUuid}::uuid,${nodeUuid}::uuid,'LOCATION_TRAFFIC_EXHAUSTED',${q.used_bytes},${q.limit_bytes})`;
        }
    }
}
