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


    /** One reset schedule and warning threshold for the whole subscription.
     * Legacy per-node schedules remain in place until an admin saves a policy. */
    async getPolicy(userUuid:string) {
        const rows=await this.db.$queryRaw<{period_days:number|null;reset_at:Date|null;threshold_percent:number}[]>`
            SELECT period_days,reset_at,threshold_percent
            FROM user_node_quota_preferences WHERE user_uuid=${userUuid}::uuid`;
        const policy=rows[0];
        return policy
            ? {mode:'shared' as const,periodDays:policy.period_days,resetAt:policy.reset_at,thresholdPercent:policy.threshold_percent}
            : {mode:'legacy' as const,periodDays:null,resetAt:null,thresholdPercent:80};
    }

    async setPolicy(userUuid:string,periodDays:number|null,thresholdPercent:number) {
        if(periodDays!==null&&(!Number.isInteger(periodDays)||periodDays<1||periodDays>366))
            throw new BadRequestException('periodDays must be null or 1–366');
        if(!Number.isInteger(thresholdPercent)||thresholdPercent<1||thresholdPercent>99)
            throw new BadRequestException('thresholdPercent must be 1–99');
        await this.db.$transaction(async tx=>{
            const user=await tx.users.findUnique({where:{uuid:userUuid}});
            if(!user)throw new NotFoundException('User not found');
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${user.tId})`;
            await tx.$executeRaw`
                INSERT INTO user_node_quota_preferences(user_uuid,period_days,reset_at,threshold_percent)
                VALUES (${userUuid}::uuid,${periodDays},CASE WHEN ${periodDays}::int IS NULL THEN NULL ELSE now()+${periodDays}::int*interval '1 day' END,${thresholdPercent})
                ON CONFLICT(user_uuid) DO UPDATE SET
                  reset_at=CASE WHEN user_node_quota_preferences.period_days IS DISTINCT FROM excluded.period_days
                      THEN excluded.reset_at ELSE user_node_quota_preferences.reset_at END,
                  period_days=excluded.period_days,threshold_percent=excluded.threshold_percent,updated_at=now()`;
            // Preserve accumulated usage. Do not silently reset already used traffic.
            // Per-node scheduled resets are replaced by this user-wide policy.
            await tx.$executeRaw`
                UPDATE user_node_quotas SET
                    period_days=NULL, reset_at=NULL,threshold_percent=${thresholdPercent},
                    threshold_sent=CASE WHEN threshold_percent IS DISTINCT FROM ${thresholdPercent} THEN false ELSE threshold_sent END,
                    updated_at=now()
                WHERE user_uuid=${userUuid}::uuid`;
        });
        return this.getPolicy(userUuid);
    }

    /** Reset every node at once; emit per-node events and schedule node sync. */
    async resetAll(userUuid:string,onlyIfDue=false) {
        return this.db.$transaction(async tx=>{
            const user=await tx.users.findUnique({where:{uuid:userUuid}});
            if(!user)throw new NotFoundException('User not found');
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${user.tId})`;
            const policy=await tx.$queryRaw<{period_days:number|null;reset_at:Date|null}[]>`
                SELECT period_days,reset_at FROM user_node_quota_preferences
                WHERE user_uuid=${userUuid}::uuid FOR UPDATE`;
            if(onlyIfDue&&(!policy.length||!policy[0].reset_at||policy[0].reset_at>new Date()))
                return {success:true,resetCount:0};
            // Ensure one reset time for all nodes and no reprocessing of a due period.
            if(policy.length)await tx.$executeRaw`
                UPDATE user_node_quota_preferences SET
                    reset_at=CASE WHEN period_days IS NULL THEN NULL ELSE now()+period_days*interval '1 day' END,
                    updated_at=now() WHERE user_uuid=${userUuid}::uuid`;
            const previous=await tx.$queryRaw<{node_uuid:string;used_bytes:bigint;limit_bytes:bigint|null;blocked:boolean}[]>`
                SELECT node_uuid,used_bytes,limit_bytes,blocked FROM user_node_quotas
                WHERE user_uuid=${userUuid}::uuid FOR UPDATE`;
            await tx.$executeRaw`
                UPDATE user_node_quotas SET used_bytes=0,blocked=(limit_bytes=0),threshold_sent=false,
                    reset_at=CASE WHEN ${policy.length>0}::boolean THEN NULL
                        ELSE CASE WHEN period_days IS NULL THEN NULL ELSE now()+period_days*interval '1 day' END END,
                    updated_at=now()
                WHERE user_uuid=${userUuid}::uuid`;
            for(const row of previous) {
                await tx.$executeRaw`
                    INSERT INTO node_quota_events(user_uuid,node_uuid,event,used_bytes,limit_bytes)
                    VALUES (${userUuid}::uuid,${row.node_uuid}::uuid,'LOCATION_TRAFFIC_RESET',0,${row.limit_bytes})`;
            }
            if(previous.length) await tx.$executeRaw`
                INSERT INTO quota_sync(user_uuid) VALUES (${userUuid}::uuid)
                ON CONFLICT(user_uuid) DO UPDATE SET revision=quota_sync.revision+1,updated_at=now()`;
            return {success:true,resetCount:previous.length};
        });
    }

    async status(userUuid:string) {
        const [rows,pending]=await Promise.all([
            this.list(userUuid),
            this.db.$queryRaw<{revision:bigint}[]>`SELECT revision FROM quota_sync WHERE user_uuid=${userUuid}::uuid`
        ]);
        return {pendingSync:pending.length>0,items:rows.map(q=>({
            nodeUuid:q.node_uuid,usedBytes:q.used_bytes.toString(),
            limitBytes:q.limit_bytes?.toString()??null,
            remainingBytes:q.limit_bytes===null?null:(q.limit_bytes>q.used_bytes?q.limit_bytes-q.used_bytes:0n).toString(),
            blocked:q.blocked
        }))};
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
            const preferences=await tx.$queryRaw<{threshold_percent:number}[]>`
                SELECT threshold_percent FROM user_node_quota_preferences WHERE user_uuid=${userUuid}::uuid`;
            const shared=preferences.length>0;
            if(shared)thresholdPercent=preferences[0].threshold_percent;
            if (!await tx.nodes.findUnique({where:{uuid:nodeUuid}})) throw new NotFoundException('Node not found');
            await tx.$executeRaw`
                INSERT INTO user_node_quotas(user_uuid,node_uuid,limit_bytes,period_days,reset_at)
                VALUES (${userUuid}::uuid,${nodeUuid}::uuid,${limit === null ? null : BigInt(limit)},${shared?null:periodDays},CASE WHEN ${shared?null:periodDays}::int IS NULL THEN NULL ELSE now()+${periodDays}::int*interval '1 day' END)
                ON CONFLICT(user_uuid,node_uuid) DO UPDATE SET limit_bytes=excluded.limit_bytes,period_days=excluded.period_days,
                reset_at=CASE WHEN user_node_quotas.period_days IS DISTINCT FROM excluded.period_days THEN excluded.reset_at ELSE user_node_quotas.reset_at END,updated_at=now()`;
            await tx.$executeRaw`UPDATE user_node_quotas SET threshold_percent=${thresholdPercent} WHERE user_uuid=${userUuid}::uuid AND node_uuid=${nodeUuid}::uuid`;
            await this.reconcile(tx, userUuid, nodeUuid, user.tId);
            return { success: true };
        });
    }

    async reset(userUuid: string, nodeUuid: string, onlyIfDue = false) {
        if((await this.getPolicy(userUuid)).mode==='shared') return this.resetAll(userUuid,onlyIfDue);
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
