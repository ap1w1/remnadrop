import { defaultMonitoringRule, dropPercent, MonitoringRule } from './monitoring-rules';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/database/prisma.service';
import { postSignedWebhook } from './quota-webhooks.service';

@Injectable()
export class NodeMetricAlertsService {
    constructor(private readonly db: PrismaService) {}
    async observe(node: string, values: Record<string, number|null>) {
        const configured=await this.db.$queryRaw<{settings:MonitoringRule}[]>`SELECT settings FROM monitoring_rules WHERE scope IN ('global',${node}) ORDER BY (scope=${node}) DESC LIMIT 1`;
        const rule=configured[0]?.settings??defaultMonitoringRule;
        if(!rule.enabled)return;
        const baseline=await this.db.$queryRaw<{online:number|null;traffic:number|null;online_samples:number;traffic_samples:number}[]>`SELECT avg((metrics->>'online')::float8) AS online,avg((metrics->>'rx')::float8+(metrics->>'tx')::float8) AS traffic,count(metrics->>'online')::int AS online_samples,count((metrics->>'rx')::float8+(metrics->>'tx')::float8)::int AS traffic_samples FROM node_metric_samples WHERE node_uuid=${node}::uuid AND sampled_at>=date_trunc('minute',now())-${rule.baselineMinutes}::int*interval '1 minute' AND sampled_at<date_trunc('minute',now())`;
        const history=baseline[0];
        const observed:Record<string,number|null>={cpu:values.cpu,memory:values.memory,
            online_drop:history.online_samples>=3?dropPercent(values.online,history.online,rule.minOnline):null,
            traffic_drop:history.traffic_samples>=3?dropPercent(values.rx===null||values.tx===null?null:values.rx+values.tx,history.traffic,rule.minTraffic):null};
        const thresholds={cpu:rule.cpuPercent,memory:rule.memoryPercent,online_drop:rule.onlineDropPercent,traffic_drop:rule.trafficDropPercent};
        for (const [metric,threshold] of Object.entries(thresholds)) {
            const value=observed[metric];
            if(threshold===null||value===null||value===undefined){
                await this.db.$executeRaw`UPDATE node_metric_alert_states SET pending_state=NULL,pending_count=0 WHERE node_uuid=${node}::uuid AND metric=${metric}`;
                continue;
            }
            const active=value>=threshold;
            await this.db.$transaction(async tx=>{
                await tx.$executeRaw`INSERT INTO node_metric_alert_states(node_uuid,metric) VALUES (${node}::uuid,${metric}) ON CONFLICT DO NOTHING`;
                const states=await tx.$queryRaw<{active:boolean;pending_state:boolean|null;pending_count:number}[]>`SELECT * FROM node_metric_alert_states WHERE node_uuid=${node}::uuid AND metric=${metric} FOR UPDATE`;
                const old=states[0], count=old.pending_state===active?old.pending_count+1:1;
                const transition=old.active!==active && count>=rule.consecutiveSamples;
                await tx.$executeRaw`UPDATE node_metric_alert_states SET active=${transition?active:old.active},pending_state=${active},pending_count=${Math.min(count,rule.consecutiveSamples)} WHERE node_uuid=${node}::uuid AND metric=${metric}`;
                if(transition)await tx.$executeRaw`INSERT INTO node_metric_alert_events(node_uuid,metric,active,value,threshold) VALUES (${node}::uuid,${metric},${active},${value},${threshold})`;
            });
        }
    }
    async deliver() {
        const url=process.env.METRICS_WEBHOOK_URL, secret=process.env.METRICS_WEBHOOK_SECRET;
        if (!url || !secret || secret.length<32) return;
        const rows=await this.db.$queryRaw<{id:string;node_uuid:string;metric:string;active:boolean;value:number;threshold:number;created_at:Date;attempts:number}[]>`
            UPDATE node_metric_alert_events SET lease_until=now()+interval '60 seconds',attempts=attempts+1 WHERE id IN (
            SELECT id FROM node_metric_alert_events WHERE delivered_at IS NULL AND attempts<20 AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at LIMIT 3 FOR UPDATE SKIP LOCKED) RETURNING *`;
        for (const row of rows) {
            try {
                await postSignedWebhook(url,JSON.stringify({id:row.id,event:row.active?'NODE_METRIC_THRESHOLD':'NODE_METRIC_RECOVERED',occurredAt:row.created_at,data:{nodeUuid:row.node_uuid,metric:row.metric,value:row.value,threshold:row.threshold}}),secret,row.id);
                await this.db.$executeRaw`UPDATE node_metric_alert_events SET delivered_at=now(),lease_until=NULL WHERE id=${row.id}::uuid`;
            } catch {
                const seconds=Math.min(3600,2**Math.min(row.attempts,12));
                await this.db.$executeRaw`UPDATE node_metric_alert_events SET lease_until=NULL,next_attempt_at=now()+${seconds}::int*interval '1 second' WHERE id=${row.id}::uuid`;
            }
        }
    }
}
