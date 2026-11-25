import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/database/prisma.service';
import { ForkWebhooksService } from './fork-webhooks.service';

@Injectable()
export class QuotaWebhooksService {
    constructor(private readonly db: PrismaService, private readonly webhooks: ForkWebhooksService) {}
    async deliver() {
        if (!this.webhooks.destinations().length) return;
        for (const event of ['LOCATION_TRAFFIC_THRESHOLD','LOCATION_TRAFFIC_EXHAUSTED','LOCATION_TRAFFIC_RESET'] as const) {
            const rows=await this.db.$queryRaw<{id:string;user_uuid:string;node_uuid:string;group_uuid:string|null;group_name:string|null;node_uuids:string[];event:string;used_bytes:bigint;limit_bytes:bigint|null;threshold_percent:number|null;attempts:number;created_at:Date}[]>`
                UPDATE node_quota_events SET lease_until=now()+interval '60 seconds',attempts=attempts+1
                WHERE id IN (SELECT id FROM node_quota_events WHERE event=${event} AND delivered_at IS NULL AND attempts<20 AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`;
            for (const row of rows) {
                try {
                    const remaining=row.limit_bytes===null?null:row.limit_bytes>row.used_bytes?row.limit_bytes-row.used_bytes:0n;
                    await this.webhooks.enqueue(row.id,event,row.created_at,{user:{uuid:row.user_uuid},location:{uuid:row.node_uuid,nodeUuids:row.node_uuids.length?row.node_uuids:[row.node_uuid]},group:row.group_uuid?{uuid:row.group_uuid,name:row.group_name}:null,traffic:{usedBytes:row.used_bytes.toString(),limitBytes:row.limit_bytes?.toString()??null,remainingBytes:remaining?.toString()??null,thresholdPercent:row.threshold_percent}});
                    await this.db.$executeRaw`UPDATE node_quota_events SET delivered_at=now(),lease_until=NULL WHERE id=${row.id}::uuid`;
                } catch {
                    const seconds=Math.min(3600,2**Math.min(row.attempts,12));
                    await this.db.$executeRaw`UPDATE node_quota_events SET lease_until=NULL,next_attempt_at=now()+${seconds}::int*interval '1 second' WHERE id=${row.id}::uuid`;
                }
            }
        }
    }
}
