import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@common/database/prisma.service';
import { Prisma } from '@prisma/client';
import { prettyBytesUtil } from '@common/utils/bytes';
import { BulkUpdateUserUsedTrafficBuilder } from '@modules/users/builders/bulk-update-user-used-traffic';

type Quota = { user_uuid: string; node_uuid: string; group_uuid: string | null; limit_bytes: bigint | null; used_bytes: bigint; blocked: boolean; period_days: number | null; reset_at: Date | null; threshold_percent:number; sent_threshold_percents:number[] };
type GroupQuota = { id:string; user_uuid:string; name:string; limit_bytes:bigint; used_bytes:bigint; blocked:boolean; threshold_percent:number; threshold_sent:boolean; sent_threshold_percents:number[]; period_days:number|null; reset_at:Date|null; node_uuids:string[] };
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class SquadQuotasService {
    constructor(private readonly db: PrismaService) {}

    async getGlobalPolicy() {
        const rows=await this.db.$queryRaw<{period_days:number|null;threshold_percent:number;threshold_percents:number[]}[]>`SELECT period_days,threshold_percent,threshold_percents FROM node_quota_global_settings WHERE id=1`;
        return {periodDays:rows[0]?.period_days??null,thresholdPercent:rows[0]?.threshold_percent??80,thresholdPercents:rows[0]?.threshold_percents??[80],configured:!!rows.length};
    }
    async setGlobalPolicy(periodDays:number|null,thresholdInput:number|number[]|undefined) {
        if(periodDays!==null&&(!Number.isInteger(periodDays)||periodDays<1||periodDays>366)) throw new BadRequestException('periodDays must be null or 1–366');
        const thresholds:number[]=Array.isArray(thresholdInput)?thresholdInput:[thresholdInput as number];
        if(thresholds.length<1||thresholds.length>10||thresholds.some(value=>!Number.isInteger(value)||value<1||value>99)||new Set(thresholds).size!==thresholds.length)
            throw new BadRequestException('thresholdPercents must contain 1–10 unique values from 1 to 99');
        thresholds.sort((a,b)=>a-b);
        const thresholdPercent=thresholds[0];
        const old=await this.getGlobalPolicy();
        const changed=thresholds.join(',')!==old.thresholdPercents.join(',');
        await this.db.$transaction(async tx=>{
            await tx.$executeRaw`INSERT INTO node_quota_global_settings(id,period_days,threshold_percent,threshold_percents) VALUES(1,${periodDays},${thresholdPercent},${thresholds}::int[]) ON CONFLICT(id) DO UPDATE SET period_days=EXCLUDED.period_days,threshold_percent=EXCLUDED.threshold_percent,threshold_percents=EXCLUDED.threshold_percents,updated_at=now()`;
            await tx.$executeRaw`INSERT INTO user_node_quota_preferences(user_uuid,period_days,reset_at,threshold_percent,threshold_percents)
                SELECT u.uuid,${periodDays},CASE WHEN ${periodDays}::int IS NULL THEN NULL ELSE now()+${periodDays}::int*interval '1 day' END,${thresholdPercent},${thresholds}::int[] FROM users u WHERE true
                ON CONFLICT(user_uuid) DO UPDATE SET period_days=EXCLUDED.period_days,
                    reset_at=CASE WHEN user_node_quota_preferences.period_days IS DISTINCT FROM EXCLUDED.period_days THEN EXCLUDED.reset_at ELSE user_node_quota_preferences.reset_at END,
                    threshold_percent=EXCLUDED.threshold_percent,threshold_percents=EXCLUDED.threshold_percents,updated_at=now()`;
            await tx.$executeRaw`UPDATE user_node_quotas SET period_days=NULL,reset_at=NULL,threshold_percent=${thresholdPercent},
                threshold_sent=CASE WHEN ${changed} THEN false ELSE threshold_sent END,
                sent_threshold_percents=CASE WHEN ${changed} THEN '{}'::int[] ELSE sent_threshold_percents END,updated_at=now()`;
            await tx.$executeRaw`UPDATE user_node_quota_groups SET threshold_percent=${thresholdPercent},
                threshold_sent=CASE WHEN ${changed} THEN false ELSE threshold_sent END,
                sent_threshold_percents=CASE WHEN ${changed} THEN '{}'::int[] ELSE sent_threshold_percents END,updated_at=now()`;
        });
        return this.getGlobalPolicy();
    }

    async list(userUuid: string) {
        return this.db.$queryRaw<Quota[]>`SELECT * FROM user_node_quotas WHERE user_uuid=${userUuid}::uuid ORDER BY node_uuid`;
    }

    async listGroups(userUuid:string) {
        const rows=await this.db.$queryRaw<GroupQuota[]>`
            SELECT g.*,COALESCE(array_agg(q.node_uuid ORDER BY q.node_uuid) FILTER (WHERE q.node_uuid IS NOT NULL),'{}') AS node_uuids
            FROM user_node_quota_groups g LEFT JOIN user_node_quotas q ON q.group_uuid=g.id
            WHERE g.user_uuid=${userUuid}::uuid GROUP BY g.id ORDER BY g.name`;
        return rows.map(g=>({id:g.id,name:g.name,node_uuids:g.node_uuids,limit_bytes:g.limit_bytes.toString(),used_bytes:g.used_bytes.toString(),blocked:g.blocked,threshold_percent:g.threshold_percent,period_days:g.period_days,reset_at:g.reset_at}));
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
            const before=await tx.$queryRaw<{threshold_percents:number[]}[]>`SELECT threshold_percents FROM user_node_quota_preferences WHERE user_uuid=${userUuid}::uuid FOR UPDATE`;
            const thresholdChanged=!before.length||before[0].threshold_percents.join(',')!==String(thresholdPercent);
            await tx.$executeRaw`
                INSERT INTO user_node_quota_preferences(user_uuid,period_days,reset_at,threshold_percent,threshold_percents)
                VALUES (${userUuid}::uuid,${periodDays},CASE WHEN ${periodDays}::int IS NULL THEN NULL ELSE now()+${periodDays}::int*interval '1 day' END,${thresholdPercent},ARRAY[${thresholdPercent}]::int[])
                ON CONFLICT(user_uuid) DO UPDATE SET
                  reset_at=CASE WHEN user_node_quota_preferences.period_days IS DISTINCT FROM excluded.period_days
                      THEN excluded.reset_at ELSE user_node_quota_preferences.reset_at END,
                  period_days=excluded.period_days,threshold_percent=excluded.threshold_percent,threshold_percents=excluded.threshold_percents,updated_at=now()`;
            // Preserve accumulated usage. Do not silently reset already used traffic.
            // Per-node scheduled resets are replaced by this user-wide policy.
            await tx.$executeRaw`
                UPDATE user_node_quotas SET
                    period_days=NULL, reset_at=NULL,threshold_percent=${thresholdPercent},
                    threshold_sent=CASE WHEN threshold_percent IS DISTINCT FROM ${thresholdPercent} THEN false ELSE threshold_sent END,
                    sent_threshold_percents=CASE WHEN ${thresholdChanged} THEN '{}'::int[] ELSE sent_threshold_percents END,
                    updated_at=now()
                WHERE user_uuid=${userUuid}::uuid`;
            await tx.$executeRaw`UPDATE user_node_quota_groups SET threshold_percent=${thresholdPercent},reset_at=NULL,
                threshold_sent=CASE WHEN threshold_percent IS DISTINCT FROM ${thresholdPercent} THEN false ELSE threshold_sent END,
                sent_threshold_percents=CASE WHEN ${thresholdChanged} THEN '{}'::int[] ELSE sent_threshold_percents END,
                updated_at=now() WHERE user_uuid=${userUuid}::uuid`;
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
            const previous=await tx.$queryRaw<{node_uuid:string;group_uuid:string|null;used_bytes:bigint;limit_bytes:bigint|null;blocked:boolean}[]>`
                SELECT node_uuid,group_uuid,used_bytes,limit_bytes,blocked FROM user_node_quotas
                WHERE user_uuid=${userUuid}::uuid FOR UPDATE`;
            const groups=await tx.$queryRaw<{id:string;node_uuid:string|null}[]>`
                SELECT g.id,(SELECT q.node_uuid FROM user_node_quotas q WHERE q.group_uuid=g.id ORDER BY q.node_uuid LIMIT 1) AS node_uuid
                FROM user_node_quota_groups g WHERE g.user_uuid=${userUuid}::uuid FOR UPDATE`;
            await tx.$executeRaw`
                UPDATE user_node_quotas SET used_bytes=0,blocked=CASE WHEN group_uuid IS NULL THEN limit_bytes=0
                    ELSE EXISTS(SELECT 1 FROM user_node_quota_groups g WHERE g.id=group_uuid AND g.limit_bytes=0) END,threshold_sent=false,sent_threshold_percents='{}'::int[],
                    reset_at=CASE WHEN ${policy.length>0}::boolean THEN NULL
                        ELSE CASE WHEN period_days IS NULL THEN NULL ELSE now()+period_days*interval '1 day' END END,
                    updated_at=now()
                WHERE user_uuid=${userUuid}::uuid`;
            await tx.$executeRaw`UPDATE user_node_quota_groups SET used_bytes=0,blocked=(limit_bytes=0),threshold_sent=false,sent_threshold_percents='{}'::int[],
                reset_at=CASE WHEN ${policy.length>0}::boolean THEN NULL ELSE CASE WHEN period_days IS NULL THEN NULL ELSE now()+period_days*interval '1 day' END END,
                updated_at=now() WHERE user_uuid=${userUuid}::uuid`;
            for(const row of previous.filter(q=>!q.group_uuid)) {
                await tx.$executeRaw`
                    INSERT INTO node_quota_events(user_uuid,node_uuid,event,used_bytes,limit_bytes)
                    VALUES (${userUuid}::uuid,${row.node_uuid}::uuid,'LOCATION_TRAFFIC_RESET',0,${row.limit_bytes})`;
            }
            for(const group of groups)if(group.node_uuid)await this.emitGroupEvent(tx,group.id,group.node_uuid,'LOCATION_TRAFFIC_RESET');
            if(previous.length) await tx.$executeRaw`
                INSERT INTO quota_sync(user_uuid) VALUES (${userUuid}::uuid)
                ON CONFLICT(user_uuid) DO UPDATE SET revision=quota_sync.revision+1,updated_at=now()`;
            return {success:true,resetCount:previous.length};
        });
    }

    async status(userUuid:string) {
        const [rows,pending,groups]=await Promise.all([
            this.list(userUuid),
            this.db.$queryRaw<{revision:bigint}[]>`SELECT revision FROM quota_sync WHERE user_uuid=${userUuid}::uuid`,
            this.listGroups(userUuid)
        ]);
        const byGroup=new Map(groups.map(g=>[g.id,g]));
        return {pendingSync:pending.length>0,groups,items:rows.map(q=>{
            const group=q.group_uuid?byGroup.get(q.group_uuid):undefined;
            const used=group?BigInt(group.used_bytes):q.used_bytes;
            const limit=group?BigInt(group.limit_bytes):q.limit_bytes;
            return {
                nodeUuid:q.node_uuid,usedBytes:q.used_bytes.toString(),
                limitBytes:limit?.toString()??null,
                remainingBytes:limit===null?null:(limit>used?limit-used:0n).toString(),
                blocked:q.blocked,groupUuid:q.group_uuid
            };
        })};
    }

    async blockedUsers(nodeUuid: string) {
        const rows=await this.db.$queryRaw<{t_id:bigint}[]>`SELECT u.t_id FROM user_node_quotas q JOIN users u ON u.uuid=q.user_uuid WHERE q.node_uuid=${nodeUuid}::uuid AND q.blocked`;
        return new Set(rows.map(r=>r.t_id.toString()));
    }
    async blockedNodes(userUuid: string) {
        return new Set((await this.list(userUuid)).filter(q=>q.blocked).map(q=>q.node_uuid));
    }
    async validateNodeUuids(nodeUuids:string[]) {
        const ids=[...new Set(nodeUuids)]
        if(!ids.length)return
        const existing=await this.db.nodes.findMany({where:{uuid:{in:ids}},select:{uuid:true}})
        if(existing.length!==ids.length)throw new BadRequestException('One or more nodes do not exist')
    }
    async legacyNeedsReview(userUuid: string) {
        return this.db.$queryRaw`SELECT q.squad_uuid,s.name,q.limit_bytes::text,q.used_bytes::text FROM user_squad_quotas q JOIN internal_squads s ON s.uuid=q.squad_uuid WHERE q.user_uuid=${userUuid}::uuid AND q.migrated_to_node_uuid IS NULL`;
    }
    async hostContexts(userUuid:string,hosts:{uuid:string;configProfileInboundUuid:string|null;nodes?:{nodeUuid:string}[]}[]) {
        const [quotas,groups,nodes,links]=await Promise.all([this.list(userUuid),this.db.$queryRaw<GroupQuota[]>`SELECT * FROM user_node_quota_groups WHERE user_uuid=${userUuid}::uuid`,this.db.nodes.findMany({select:{uuid:true,name:true}}),this.db.configProfileInboundsToNodes.findMany()]);
        const result=new Map<string,{blocked:boolean;values:Record<string,()=>string>}>();
        for(const host of hosts){
            const ids=[...new Set(host.nodes?.length ? host.nodes.map(n=>n.nodeUuid) : links.filter(n=>n.configProfileInboundUuid===host.configProfileInboundUuid).map(n=>n.nodeUuid))];
            const q=ids.length===1?quotas.find(q=>q.node_uuid===ids[0]):undefined;
            const groupIds=[...new Set(ids.map(id=>quotas.find(q=>q.node_uuid===id)?.group_uuid).filter(Boolean))];
            const group=groupIds.length===1&&ids.every(id=>quotas.find(q=>q.node_uuid===id)?.group_uuid===groupIds[0])?groups.find(g=>g.id===groupIds[0]):undefined;
            const used=group?.used_bytes??q?.used_bytes??0n, limit=group?.limit_bytes??q?.limit_bytes??null;
            const left=limit===null?null:limit>used?limit-used:0n;
            const values:Record<string,()=>string>={
                NODE_NAME:()=>ids.length===1?nodes.find(n=>n.uuid===ids[0])?.name??'—':'—',
                NODE_TRAFFIC_USED:()=>limit===null?'':prettyBytesUtil(used),
                NODE_TRAFFIC_LEFT:()=>left===null?'':prettyBytesUtil(left),
                NODE_TRAFFIC_LIMIT:()=>limit===null?'':prettyBytesUtil(limit),
                NODE_TRAFFIC_PERCENT:()=>limit===null?'':limit===0n?'100':(Number(used*10000n/limit)/100).toString(),
            };
            for(const key of Object.keys(values))values[key.replace('NODE_','LOCATION_')]=values[key];
            for(const [shortKey,longKey] of Object.entries({N_NAME:'NODE_NAME',N_USED:'NODE_TRAFFIC_USED',N_LEFT:'NODE_TRAFFIC_LEFT',N_LIMIT:'NODE_TRAFFIC_LIMIT',N_PCT:'NODE_TRAFFIC_PERCENT'}))values[shortKey]=values[longKey];
            values.N_LIMIT=()=>limit===null?'':prettyBytesUtil(limit).replace(/^(\d+(?:\.\d+)?)(\s+.*)$/,(_,amount:string,unit:string)=>`${Math.round(Number(amount))}${unit}`);
            result.set(host.uuid,{blocked:quotas.some(q=>q.blocked&&ids.includes(q.node_uuid)),values});
        }
        return result;
    }

    async configureGroup(userUuid:string, groupUuid:string|null, name:string, nodeUuids:string[], limitBytes:string, periodDays?:number|null, thresholdPercent?:number) {
        const cleanName=typeof name==='string'?name.trim():'';
        const ids=Array.isArray(nodeUuids)?[...new Set(nodeUuids)]:[];
        if(!cleanName||cleanName.length>80)throw new BadRequestException('Group name must be 1–80 characters');
        if(!Array.isArray(nodeUuids)||ids.length<1||ids.length>20||ids.some(id=>typeof id!=='string'||!uuidPattern.test(id))||ids.length!==nodeUuids.length)throw new BadRequestException('Select 1–20 unique nodes');
        if(typeof limitBytes!=='string'||!/^\d+$/.test(limitBytes)||BigInt(limitBytes)>9223372036854775807n)throw new BadRequestException('Invalid limitBytes');
        if(periodDays!==undefined&&periodDays!==null&&(!Number.isInteger(periodDays)||periodDays<1||periodDays>366))throw new BadRequestException('Invalid periodDays');
        if(thresholdPercent!==undefined&&(!Number.isInteger(thresholdPercent)||thresholdPercent<1||thresholdPercent>99))throw new BadRequestException('Invalid thresholdPercent');
        const limit=BigInt(limitBytes);
        const response=await this.db.$transaction(async tx=>{
            const user=await tx.users.findUnique({where:{uuid:userUuid}});
            if(!user)throw new NotFoundException('User not found');
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${user.tId})`;
            const previous=groupUuid?await tx.$queryRaw<GroupQuota[]>`SELECT * FROM user_node_quota_groups WHERE id=${groupUuid}::uuid AND user_uuid=${userUuid}::uuid FOR UPDATE`:[];
            if(groupUuid&&!previous.length)throw new NotFoundException('Group not found');
            const selected=await tx.$queryRaw<{uuid:string}[]>(Prisma.sql`SELECT uuid FROM nodes WHERE uuid IN (${Prisma.join(ids.map(id=>Prisma.sql`${id}::uuid`))})`);
            if(selected.length!==ids.length)throw new BadRequestException('One or more nodes do not exist');
            const duplicates=await tx.$queryRaw<{id:string}[]>`SELECT id FROM user_node_quota_groups WHERE user_uuid=${userUuid}::uuid AND name=${cleanName} AND id IS DISTINCT FROM ${groupUuid}::uuid`;
            if(duplicates.length)throw new BadRequestException('Group name already exists');
            const selectedQuotas=await tx.$queryRaw<{node_uuid:string;group_uuid:string|null}[]>(Prisma.sql`SELECT node_uuid,group_uuid FROM user_node_quotas WHERE user_uuid=${userUuid}::uuid AND node_uuid IN (${Prisma.join(ids.map(id=>Prisma.sql`${id}::uuid`))})`);
            if(selectedQuotas.some(q=>q.group_uuid&&q.group_uuid!==groupUuid))throw new BadRequestException('A node already belongs to another group');
            const oldIds=groupUuid?(await tx.$queryRaw<{node_uuid:string}[]>`SELECT node_uuid FROM user_node_quotas WHERE group_uuid=${groupUuid}::uuid ORDER BY node_uuid`).map(row=>row.node_uuid):[];
            const changed=!groupUuid||previous[0].limit_bytes!==limit||oldIds.length!==ids.length||oldIds.some(id=>!ids.includes(id));
            const policy=await tx.$queryRaw<{threshold_percent:number}[]>`SELECT threshold_percent FROM user_node_quota_preferences WHERE user_uuid=${userUuid}::uuid`;
            const threshold=policy[0]?.threshold_percent??thresholdPercent??previous[0]?.threshold_percent??80;
            const id=groupUuid??(await tx.$queryRaw<{id:string}[]>`INSERT INTO user_node_quota_groups(user_uuid,name,limit_bytes,threshold_percent,period_days,reset_at)
                VALUES (${userUuid}::uuid,${cleanName},${limit},${threshold},${periodDays??null},CASE WHEN ${periodDays??null}::int IS NULL THEN NULL ELSE now()+${periodDays??null}::int*interval '1 day' END) RETURNING id`)[0].id;
            if(groupUuid)await tx.$executeRaw`UPDATE user_node_quota_groups SET name=${cleanName},limit_bytes=${limit},threshold_percent=${threshold},
                threshold_sent=CASE WHEN ${changed} OR threshold_percent IS DISTINCT FROM ${threshold} THEN false ELSE threshold_sent END,
                sent_threshold_percents=CASE WHEN ${changed} OR threshold_percent IS DISTINCT FROM ${threshold} THEN '{}'::int[] ELSE sent_threshold_percents END,
                period_days=CASE WHEN ${periodDays!==undefined}::boolean THEN ${periodDays??null}::int ELSE period_days END,
                reset_at=CASE WHEN ${periodDays!==undefined}::boolean AND period_days IS DISTINCT FROM ${periodDays??null}::int
                    THEN CASE WHEN ${periodDays??null}::int IS NULL THEN NULL ELSE now()+${periodDays??null}::int*interval '1 day' END ELSE reset_at END,
                updated_at=now() WHERE id=${id}::uuid`;
            await tx.$executeRaw(Prisma.sql`INSERT INTO user_node_quotas(user_uuid,node_uuid) SELECT ${userUuid}::uuid,uuid FROM nodes WHERE uuid IN (${Prisma.join(ids.map(nodeId=>Prisma.sql`${nodeId}::uuid`))}) ON CONFLICT DO NOTHING`);
            // A newly limited node starts at zero even if usage was recorded before
            // the group existed. Existing members keep their current group usage.
            const addedIds=ids.filter(nodeId=>!oldIds.includes(nodeId));
            if(addedIds.length)await tx.$executeRaw(Prisma.sql`UPDATE user_node_quotas SET used_bytes=0,threshold_sent=false,sent_threshold_percents='{}'::int[],updated_at=now() WHERE user_uuid=${userUuid}::uuid AND node_uuid IN (${Prisma.join(addedIds.map(nodeId=>Prisma.sql`${nodeId}::uuid`))})`);
            if(groupUuid)await tx.$executeRaw(Prisma.sql`UPDATE user_node_quotas SET group_uuid=NULL,blocked=false,updated_at=now() WHERE group_uuid=${id}::uuid AND node_uuid NOT IN (${Prisma.join(ids.map(nodeId=>Prisma.sql`${nodeId}::uuid`))})`);
            await tx.$executeRaw(Prisma.sql`UPDATE user_node_quotas SET group_uuid=${id}::uuid,limit_bytes=NULL,period_days=NULL,reset_at=NULL,threshold_sent=false,updated_at=now() WHERE user_uuid=${userUuid}::uuid AND node_uuid IN (${Prisma.join(ids.map(nodeId=>Prisma.sql`${nodeId}::uuid`))})`);
            const total=await tx.$queryRaw<{used_bytes:bigint}[]>`SELECT COALESCE(sum(used_bytes),0)::bigint AS used_bytes FROM user_node_quotas WHERE group_uuid=${id}::uuid`;
            await tx.$executeRaw`UPDATE user_node_quota_groups SET used_bytes=${total[0].used_bytes},updated_at=now() WHERE id=${id}::uuid`;
            await this.reconcileGroup(tx,id,userUuid,ids[0]);
            await this.queueSync(tx,userUuid);
            return {id};
        },{timeout:60000});
        return response;
    }

    async removeGroup(userUuid:string,groupUuid:string) {
        return this.db.$transaction(async tx=>{
            const user=await tx.users.findUnique({where:{uuid:userUuid}});
            if(!user)throw new NotFoundException('User not found');
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${user.tId})`;
            const existing=await tx.$queryRaw<{id:string}[]>`SELECT id FROM user_node_quota_groups WHERE id=${groupUuid}::uuid AND user_uuid=${userUuid}::uuid FOR UPDATE`;
            if(!existing.length)throw new NotFoundException('Group not found');
            await tx.$executeRaw`UPDATE user_node_quotas SET group_uuid=NULL,blocked=false,updated_at=now() WHERE user_uuid=${userUuid}::uuid AND group_uuid=${groupUuid}::uuid`;
            await tx.$executeRaw`DELETE FROM user_node_quota_groups WHERE id=${groupUuid}::uuid`;
            await this.queueSync(tx,userUuid);
            return {success:true};
        });
    }

    async resetGroup(userUuid:string,groupUuid:string,onlyIfDue=false) {
        return this.db.$transaction(async tx=>{
            const user=await tx.users.findUnique({where:{uuid:userUuid}});
            if(!user)throw new NotFoundException('User not found');
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${user.tId})`;
            const rows=await tx.$queryRaw<GroupQuota[]>`SELECT * FROM user_node_quota_groups WHERE id=${groupUuid}::uuid AND user_uuid=${userUuid}::uuid FOR UPDATE`;
            if(!rows.length)throw new NotFoundException('Group not found');
            if(onlyIfDue&&(!rows[0].reset_at||rows[0].reset_at>new Date()))return {success:true};
            const members=await tx.$queryRaw<{node_uuid:string}[]>`SELECT node_uuid FROM user_node_quotas WHERE group_uuid=${groupUuid}::uuid ORDER BY node_uuid`;
            if(!members.length){
                if(!onlyIfDue)throw new BadRequestException('The group has no nodes');
                await tx.$executeRaw`DELETE FROM user_node_quota_groups WHERE id=${groupUuid}::uuid`;
                return {success:true};
            }
            await tx.$executeRaw`UPDATE user_node_quota_groups SET used_bytes=0,blocked=(limit_bytes=0),threshold_sent=false,sent_threshold_percents='{}'::int[],
                reset_at=CASE WHEN period_days IS NULL THEN NULL ELSE now()+period_days*interval '1 day' END,updated_at=now() WHERE id=${groupUuid}::uuid`;
            await tx.$executeRaw`UPDATE user_node_quotas SET used_bytes=0,blocked=${rows[0].limit_bytes===0n},updated_at=now() WHERE group_uuid=${groupUuid}::uuid`;
            await this.emitGroupEvent(tx,groupUuid,members[0].node_uuid,'LOCATION_TRAFFIC_RESET');
            await this.queueSync(tx,userUuid);
            return {success:true};
        });
    }

    async configure(userUuid: string, nodeUuid: string, limit: string | null, periodDays: number | null, thresholdPercent = 80) {
        const node=await this.db.nodes.findUnique({where:{uuid:nodeUuid},select:{name:true}});
        if(!node)throw new NotFoundException('Node not found');
        const groups=await this.listGroups(userUuid);
        const group=groups.find(candidate=>candidate.node_uuids.includes(nodeUuid));
        if(group&&group.node_uuids.length!==1)throw new BadRequestException('Use the group API to change a shared limit');
        if(limit===null){
            if(group)return this.removeGroup(userUuid,group.id);
            await this.db.$executeRaw`UPDATE user_node_quotas SET limit_bytes=NULL,blocked=false,period_days=NULL,reset_at=NULL,updated_at=now() WHERE user_uuid=${userUuid}::uuid AND node_uuid=${nodeUuid}::uuid`;
            await this.db.$executeRaw`INSERT INTO quota_sync(user_uuid) VALUES (${userUuid}::uuid) ON CONFLICT(user_uuid) DO UPDATE SET revision=quota_sync.revision+1,updated_at=now()`;
            return {success:true};
        }
        const name=group?.name??`${node.name.slice(0,32)} · ${nodeUuid}`;
        const saved=await this.configureGroup(userUuid,group?.id??null,name,[nodeUuid],limit,periodDays,thresholdPercent);
        return {success:true,groupUuid:saved.id};
    }

    async reset(userUuid: string, nodeUuid: string, onlyIfDue = false) {
        const group=(await this.listGroups(userUuid)).find(candidate=>candidate.node_uuids.includes(nodeUuid));
        if(group){
            if(group.node_uuids.length!==1)throw new BadRequestException('Use the group API to reset a shared limit');
            return this.resetGroup(userUuid,group.id,onlyIfDue);
        }
        // A manual reset of one node must not reset other nodes or shift the common schedule.
        return this.db.$transaction(async tx => {
            const user = await tx.users.findUnique({ where: { uuid: userUuid } });
            if (!user) throw new NotFoundException();
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${user.tId})`;
            if (onlyIfDue) {
                const due = await tx.$queryRaw<Quota[]>`SELECT * FROM user_node_quotas WHERE user_uuid=${userUuid}::uuid AND node_uuid=${nodeUuid}::uuid AND reset_at<=now() FOR UPDATE`;
                if (!due.length) return { success: true };
            }
            const grouped=await tx.$queryRaw<{group_uuid:string}[]>`SELECT group_uuid FROM user_node_quotas WHERE user_uuid=${userUuid}::uuid AND node_uuid=${nodeUuid}::uuid AND group_uuid IS NOT NULL`;
            if(grouped.length)throw new BadRequestException('Reset the shared quota group instead');
            const changed = await tx.$executeRaw`UPDATE user_node_quotas SET used_bytes=0,threshold_sent=false,sent_threshold_percents='{}'::int[],reset_at=CASE WHEN period_days IS NULL THEN NULL ELSE now()+period_days*interval '1 day' END,updated_at=now() WHERE user_uuid=${userUuid}::uuid AND node_uuid=${nodeUuid}::uuid`;
            if (!changed) throw new NotFoundException('Quota not found');
            await this.reconcile(tx, userUuid, nodeUuid, user.tId);
            await tx.$executeRaw`INSERT INTO node_quota_events(user_uuid,node_uuid,event,used_bytes,limit_bytes) SELECT user_uuid,node_uuid,'LOCATION_TRAFFIC_RESET',used_bytes,limit_bytes FROM user_node_quotas WHERE user_uuid=${userUuid}::uuid AND node_uuid=${nodeUuid}::uuid`;
            return { success: true };
        });
    }

    /** Delete only this user's explicit node cap. Usage history remains untouched. */
    async remove(userUuid:string,nodeUuid:string) {
        const group=(await this.listGroups(userUuid)).find(candidate=>candidate.node_uuids.includes(nodeUuid));
        if(group){
            if(group.node_uuids.length!==1)throw new BadRequestException('Use the group API to remove a shared limit');
            return this.removeGroup(userUuid,group.id);
        }
        return this.db.$transaction(async tx=>{
            const user=await tx.users.findUnique({where:{uuid:userUuid}});
            if(!user)throw new NotFoundException('User not found');
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${user.tId})`;
            const grouped=await tx.$queryRaw<{group_uuid:string}[]>`SELECT group_uuid FROM user_node_quotas WHERE user_uuid=${userUuid}::uuid AND node_uuid=${nodeUuid}::uuid AND group_uuid IS NOT NULL`;
            if(grouped.length)throw new BadRequestException('Remove the node from its shared quota group first');
            const removed=await tx.$queryRaw<{node_uuid:string;used_bytes:bigint}[]>`
                DELETE FROM user_node_quotas WHERE user_uuid=${userUuid}::uuid AND node_uuid=${nodeUuid}::uuid
                RETURNING node_uuid,used_bytes`;
            if(!removed.length)throw new NotFoundException('Node limit not found');
            // The user must immediately regain ordinary access to this node.
            await tx.$executeRaw`
                INSERT INTO quota_sync(user_uuid) VALUES (${userUuid}::uuid)
                ON CONFLICT(user_uuid) DO UPDATE SET revision=quota_sync.revision+1,updated_at=now()`;
            return {success:true,removed:true,accessSyncQueued:true};
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
                    if(q.group_uuid){
                        await tx.$executeRaw`UPDATE user_node_quota_groups SET used_bytes=used_bytes+${BigInt(row.b)},updated_at=now() WHERE id=${q.group_uuid}::uuid`;
                        await this.reconcileGroup(tx,q.group_uuid,user.uuid,q.node_uuid);
                    }else await this.reconcile(tx, user.uuid, q.node_uuid, user.tId);
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

    private async queueSync(tx:Prisma.TransactionClient,userUuid:string) {
        await tx.$executeRaw`INSERT INTO quota_sync(user_uuid) VALUES (${userUuid}::uuid)
            ON CONFLICT(user_uuid) DO UPDATE SET revision=quota_sync.revision+1,updated_at=now()`;
    }

    private async warningLevels(tx:Prisma.TransactionClient,userUuid:string,fallback:number) {
        const rows=await tx.$queryRaw<{threshold_percents:number[]}[]>`SELECT threshold_percents FROM user_node_quota_preferences WHERE user_uuid=${userUuid}::uuid`;
        return rows[0]?.threshold_percents?.length?rows[0].threshold_percents:[fallback];
    }
    private async emitGroupEvent(tx:Prisma.TransactionClient,groupUuid:string,nodeUuid:string,event:string,thresholdPercent:number|null=null) {
        await tx.$executeRaw`
            INSERT INTO node_quota_events(user_uuid,node_uuid,group_uuid,group_name,node_uuids,event,used_bytes,limit_bytes,threshold_percent)
            SELECT g.user_uuid,${nodeUuid}::uuid,g.id,g.name,
                ARRAY(SELECT q.node_uuid FROM user_node_quotas q WHERE q.group_uuid=g.id ORDER BY q.node_uuid),
                ${event},g.used_bytes,g.limit_bytes,${thresholdPercent}
            FROM user_node_quota_groups g WHERE g.id=${groupUuid}::uuid`;
    }

    private async reconcileGroup(tx:Prisma.TransactionClient,groupUuid:string,userUuid:string,nodeUuid:string) {
        const rows=await tx.$queryRaw<GroupQuota[]>`SELECT * FROM user_node_quota_groups WHERE id=${groupUuid}::uuid AND user_uuid=${userUuid}::uuid FOR UPDATE`;
        const group=rows[0];
        if(!group)throw new NotFoundException('Group not found');
        const levels=await this.warningLevels(tx,userUuid,group.threshold_percent);
        const crossed=levels.filter(level=>!group.sent_threshold_percents.includes(level)&&group.limit_bytes>0n&&group.used_bytes*100n>=group.limit_bytes*BigInt(level));
        if(crossed.length){
            await tx.$executeRaw`UPDATE user_node_quota_groups SET sent_threshold_percents=sent_threshold_percents||${crossed}::int[],threshold_sent=true WHERE id=${groupUuid}::uuid`;
            for(const level of crossed)await this.emitGroupEvent(tx,groupUuid,nodeUuid,'LOCATION_TRAFFIC_THRESHOLD',level);
        }
        const blocked=group.used_bytes>=group.limit_bytes;
        await tx.$executeRaw`UPDATE user_node_quota_groups SET blocked=${blocked},updated_at=now() WHERE id=${groupUuid}::uuid`;
        await tx.$executeRaw`UPDATE user_node_quotas SET blocked=${blocked},updated_at=now() WHERE group_uuid=${groupUuid}::uuid`;
        if(blocked!==group.blocked){
            await this.queueSync(tx,userUuid);
            if(blocked)await this.emitGroupEvent(tx,groupUuid,nodeUuid,'LOCATION_TRAFFIC_EXHAUSTED');
        }
    }

    private async reconcile(tx: Prisma.TransactionClient, userUuid: string, nodeUuid: string, userId: bigint) {
        const rows: Quota[] = await tx.$queryRaw`SELECT * FROM user_node_quotas WHERE user_uuid=${userUuid}::uuid AND node_uuid=${nodeUuid}::uuid FOR UPDATE`;
        const q = rows[0];
        const levels=await this.warningLevels(tx,userUuid,q.threshold_percent);
        const crossed=levels.filter(level=>!q.sent_threshold_percents.includes(level)&&q.limit_bytes!==null&&q.limit_bytes>0n&&q.used_bytes*100n>=q.limit_bytes*BigInt(level));
        if(crossed.length){
            await tx.$executeRaw`UPDATE user_node_quotas SET sent_threshold_percents=sent_threshold_percents||${crossed}::int[],threshold_sent=true WHERE user_uuid=${userUuid}::uuid AND node_uuid=${nodeUuid}::uuid`;
            for(const level of crossed)await tx.$executeRaw`INSERT INTO node_quota_events(user_uuid,node_uuid,event,used_bytes,limit_bytes,threshold_percent) VALUES (${userUuid}::uuid,${nodeUuid}::uuid,'LOCATION_TRAFFIC_THRESHOLD',${q.used_bytes},${q.limit_bytes},${level})`;
        }
        const blocked = q.limit_bytes !== null && q.used_bytes >= q.limit_bytes;
        await tx.$executeRaw`UPDATE user_node_quotas SET blocked=${blocked} WHERE user_uuid=${userUuid}::uuid AND node_uuid=${nodeUuid}::uuid`;
        if (blocked !== q.blocked) {
            await tx.$executeRaw`UPDATE user_node_quotas SET blocked=${blocked} WHERE user_uuid=${userUuid}::uuid AND node_uuid=${nodeUuid}::uuid`;
            await tx.$executeRaw`INSERT INTO quota_sync(user_uuid) VALUES (${userUuid}::uuid) ON CONFLICT(user_uuid) DO UPDATE SET revision=quota_sync.revision+1,updated_at=now()`;
            if (blocked) await tx.$executeRaw`INSERT INTO node_quota_events(user_uuid,node_uuid,event,used_bytes,limit_bytes) VALUES (${userUuid}::uuid,${nodeUuid}::uuid,'LOCATION_TRAFFIC_EXHAUSTED',${q.used_bytes},${q.limit_bytes})`;
        }
    }
}
