import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@common/database/prisma.service';
import { GetNodesSystemStatsQuery } from '@modules/nodes/queries/get-nodes-system-stats';
import { NodeMetricAlertsService } from './node-metric-alerts.service';

const metrics = ['online', 'rx', 'tx', 'memory', 'memoryUsed', 'memoryTotal', 'cpu', 'load1', 'load5', 'load15', 'available', 'rxTotal', 'txTotal'] as const;
@Injectable()
export class NodeHistoryService implements OnModuleInit, OnModuleDestroy {
    private timer?: ReturnType<typeof setInterval>;
    private busy = false;
    private readonly logger = new Logger(NodeHistoryService.name);
    constructor(private readonly db: PrismaService, private readonly queries: QueryBus, private readonly alerts: NodeMetricAlertsService) {}
    onModuleInit() {
        if (process.env.INSTANCE_TYPE !== 'scheduler') return;
        this.timer = setInterval(() => void this.collect(), 60000);
        void this.collect();
    }
    onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
    async collect() {
        if (this.busy) return;
        this.busy = true;
        try {
            const nodes = await this.db.nodes.findMany({ select: { uuid: true, isConnected: true, isDisabled: true } });
            const result = await this.queries.execute(new GetNodesSystemStatsQuery(nodes));
            if (!result.isOk) throw new Error('Node metrics cache unavailable');
            const at = new Date(Math.floor(Date.now() / 60000) * 60000);
            const cpuRows = await this.db.$queryRaw<{node_uuid:string;cpu:number}[]>`SELECT node_uuid,cpu FROM node_metric_agent_snapshots WHERE received_at>now()-interval '2 minutes'`;
            const cpu = new Map(cpuRows.map(row=>[row.node_uuid,row.cpu]));
            for (const node of nodes) {
                const cached = result.response.get(node.uuid);
                const system = node.isConnected && !node.isDisabled ? cached?.system : null;
                const values = {
                    available: node.isConnected && !node.isDisabled ? 100 : 0,
                    online: system ? cached?.onlineUsers ?? null : null,
                    memory: system && system.info.memoryTotal > 0 ? 100 * system.stats.memoryUsed / system.info.memoryTotal : null,
                    memoryUsed: system?.stats.memoryUsed ?? null,
                    memoryTotal: system?.info.memoryTotal ?? null,
                    cpu: cpu.get(node.uuid) ?? (system && system.info.cpus > 0
                        ? Math.max(0,100 * system.stats.loadAvg[0] / system.info.cpus) : null),
                    load1: system?.stats.loadAvg[0] ?? null,
                    load5: system?.stats.loadAvg[1] ?? null,
                    load15: system?.stats.loadAvg[2] ?? null,
                    rx: system?.stats.interface?.rxBytesPerSec ?? null,
                    tx: system?.stats.interface?.txBytesPerSec ?? null,
                    rxTotal: system?.stats.interface?.rxTotal ?? null,
                    txTotal: system?.stats.interface?.txTotal ?? null,
                };
                const inserted=await this.db.$executeRaw`INSERT INTO node_metric_samples(node_uuid,sampled_at,metrics) VALUES (${node.uuid}::uuid,${at},${JSON.stringify(values)}::jsonb) ON CONFLICT DO NOTHING`;
                if(inserted) await this.alerts.observe(node.uuid,values);
            }
            const retention=await this.retentionDays();
            await this.db.$executeRaw`DELETE FROM node_metric_samples WHERE sampled_at < now()-${retention}::int*interval '1 day'`;
            await this.db.$executeRaw`DELETE FROM node_metric_alert_events WHERE created_at < now()-${retention}::int*interval '1 day'`;

            await this.alerts.deliver();
        } catch (error) { this.logger.error(String(error)); }
        finally { this.busy = false; }
    }
    async retentionDays():Promise<number>{
        const rows=await this.db.$queryRaw<{retention_days:number}[]>`SELECT retention_days FROM monitoring_preferences WHERE id=1`;
        return rows[0]?.retention_days??90;
    }
    async history(ids: string, from: string, to: string) {
        const nodes = [...new Set((ids || '').split(','))];
        const start = new Date(from), end = new Date(to);
        const retention=await this.retentionDays();
        if (!nodes.length || nodes.length > 200 || nodes.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end.getTime()-start.getTime() > retention*86400000 || start.getTime() < Date.now()-(retention+1)*86400000 || end.getTime() > Date.now()+60000) {
            throw new BadRequestException(`Select 1–200 nodes and a period within the last ${retention} days`);
        }
        const bucket = Math.max(60, Math.ceil((end.getTime()-start.getTime())/1000/600/60)*60);
        const columns = metrics.map(key => key === 'online'
            ? Prisma.sql`(array_agg((metrics->>${key})::double precision ORDER BY sampled_at DESC) FILTER (WHERE metrics->>${key} IS NOT NULL))[1] AS "online"`
            : Prisma.sql`avg((metrics->>${key})::double precision) AS ${Prisma.raw('"'+key+'"')}`);
        const rows = await this.db.$queryRaw(Prisma.sql`SELECT node_uuid, to_timestamp(floor(extract(epoch from sampled_at)/${bucket})*${bucket}) AS time, ${Prisma.join(columns)} FROM node_metric_samples WHERE node_uuid IN (${Prisma.join(nodes.map(id=>Prisma.sql`${id}::uuid`))}) AND sampled_at >= ${start} AND sampled_at <= ${end} GROUP BY node_uuid, time ORDER BY time,node_uuid`);
        const where=Prisma.sql`node_uuid IN (${Prisma.join(nodes.map(id=>Prisma.sql`${id}::uuid`))})`;
        const alerts=await this.db.$queryRaw<{id:string;node_uuid:string;time:Date;metric:string;active:boolean}[]>(Prisma.sql`
            SELECT id,node_uuid,created_at AS time,metric,active
            FROM node_metric_alert_events WHERE ${where} AND created_at>=${start} AND created_at<=${end}
            ORDER BY created_at LIMIT 1000`);
        // Detect actual availability changes even when the threshold detector is disabled.
        // The previous sample before the period is included to classify the first transition.
        const transitions=await this.db.$queryRaw<{node_uuid:string;time:Date;active:boolean}[]>(Prisma.sql`
            WITH readings AS (
                SELECT node_uuid,sampled_at AS time, (metrics->>'available')::float8 > 0 AS active
                FROM node_metric_samples WHERE ${where} AND sampled_at >= ${new Date(start.getTime()-600000)} AND sampled_at<=${end}
            ), changes AS (
                SELECT node_uuid,time,active,LAG(active) OVER(PARTITION BY node_uuid ORDER BY time) AS prior
                FROM readings
            ) SELECT node_uuid,time,active FROM changes WHERE prior IS NOT NULL AND prior<>active AND time>=${start}
            ORDER BY time LIMIT 1000`);
        const events=[
            ...alerts.map(a=>({id:a.id,node_uuid:a.node_uuid,time:a.time,kind:a.active?'threshold':'recovered',metric:a.metric})),
            ...transitions.map((a,i)=>({id:`connection-${a.node_uuid}-${i}`,node_uuid:a.node_uuid,time:a.time,kind:a.active?'connected':'disconnected',metric:'available'}))
        ].sort((a,b)=>new Date(a.time).getTime()-new Date(b.time).getTime());
        return { bucketSeconds: bucket, rows, events, retentionDays:retention };
    }
}
