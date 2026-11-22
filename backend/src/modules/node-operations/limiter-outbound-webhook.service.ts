import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@common/database/prisma.service';
import { createHash } from 'node:crypto';
import { postSignedWebhook } from '@modules/squad-quotas/quota-webhooks.service';

const allowedEvents = new Set([
    'violation_detected','soft_violation_detected','traffic_spike','traffic_heavy',
    'shared_hwid','daily_report','update_available','action','settings_changed'
]);
type WebhookItem = {
    id:string;event_key:string;event_type:string;destination_hash:string;payload:unknown;
    attempts:number;created_at:Date;
};
/** Outbound events are separate from the trusted Go->panel ingestion endpoint. */
@Injectable()
export class LimiterOutboundWebhookService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(LimiterOutboundWebhookService.name);
    private timer?: ReturnType<typeof setInterval>;
    private busy = false;
    constructor(private readonly db:PrismaService) {}
    private config() {
        const url=process.env.LIMITER_OUTBOUND_WEBHOOK_URL?.trim() || '';
        const secret=process.env.LIMITER_OUTBOUND_WEBHOOK_SECRET || '';
        const wanted=(process.env.LIMITER_OUTBOUND_WEBHOOK_EVENTS || [...allowedEvents].join(','))
            .split(',').map(s=>s.trim()).filter(Boolean);
        return {url,secret,events:new Set(wanted.filter(s=>allowedEvents.has(s))),
            valid:url.startsWith('https://') && secret.length>=32 && wanted.every(s=>allowedEvents.has(s))};
    }
    async status() {
        const cfg=this.config();
        const counts=await this.db.$queryRaw<{pending:number;failed:number;delivered:number}[]>`
            SELECT count(*) FILTER (WHERE delivered_at IS NULL AND attempts<12)::int AS pending,
                count(*) FILTER (WHERE delivered_at IS NULL AND attempts>=12)::int AS failed,
                count(*) FILTER (WHERE delivered_at IS NOT NULL)::int AS delivered
            FROM limiter_outbound_webhook_queue`;
        let destination:string|null=null;
        try {destination=cfg.url?new URL(cfg.url).hostname:null;}catch{destination=null;}
        return {response:{configured:cfg.valid,destination,events:[...cfg.events],...(counts[0]??{pending:0,failed:0,delivered:0})}};
    }
    onModuleInit() {
        if (process.env.INSTANCE_TYPE && !['scheduler','api'].includes(process.env.INSTANCE_TYPE)) return;
        this.timer=setInterval(()=>void this.deliver(),20000);
        this.timer.unref();
        void this.deliver();
    }
    onModuleDestroy() {if(this.timer)clearInterval(this.timer);}
    async enqueue(eventKey:string,eventType:string,data:Record<string,unknown>) {
        const cfg=this.config();
        if (!cfg.valid || !cfg.events.has(eventType)) return;
        const hash=createHash('sha256').update(cfg.url).digest('hex');
        const payload=JSON.stringify(data);
        if (payload.length>65536) throw new Error('Limiter outgoing webhook payload exceeds 64 KiB');
        await this.db.$executeRaw`INSERT INTO limiter_outbound_webhook_queue(event_key,event_type,destination_hash,payload)
            VALUES (${eventKey},${eventType},${hash},${payload}::jsonb) ON CONFLICT(event_key) DO NOTHING`;
    }
    private async deliver() {
        if (this.busy) return;
        const cfg=this.config();
        if (!cfg.valid) return;
        this.busy=true;
        try {
            const hash=createHash('sha256').update(cfg.url).digest('hex');
            const items=await this.db.$queryRaw<WebhookItem[]>`
                UPDATE limiter_outbound_webhook_queue SET lease_until=now()+interval '90 seconds',attempts=attempts+1
                WHERE id IN (SELECT id FROM limiter_outbound_webhook_queue
                    WHERE delivered_at IS NULL AND attempts<12 AND next_attempt_at<=now()
                      AND (lease_until IS NULL OR lease_until<now())
                    ORDER BY created_at LIMIT 25 FOR UPDATE SKIP LOCKED) RETURNING *`;
            for (const item of items) {
                try {
                    if(item.destination_hash!==hash) throw new Error('Destination was changed: refusing to forward older event');
                    const body=JSON.stringify({id:item.id,event:item.event_type,occurredAt:item.created_at,data:item.payload});
                    await postSignedWebhook(cfg.url,body,cfg.secret,item.id);
                    await this.db.$executeRaw`UPDATE limiter_outbound_webhook_queue
                        SET delivered_at=now(),lease_until=NULL,last_error=NULL WHERE id=${item.id}::uuid`;
                } catch (cause) {
                    const message=cause instanceof Error?cause.message:String(cause);
                    const next=Math.min(3600,2**Math.min(item.attempts,12));
                    // Changed endpoint must not receive old events even after retries.
                    await this.db.$executeRaw`UPDATE limiter_outbound_webhook_queue
                        SET lease_until=NULL,next_attempt_at=now()+${next}::int*interval '1 second',last_error=${message.slice(0,350)}
                        WHERE id=${item.id}::uuid`;
                    this.logger.warn('Limiter outbound '+item.id+': '+message.slice(0,200));
                }
            }
            await this.db.$executeRaw`DELETE FROM limiter_outbound_webhook_queue
                WHERE id IN (SELECT id FROM limiter_outbound_webhook_queue
                  WHERE delivered_at<now()-interval '7 days' ORDER BY delivered_at LIMIT 1000)`;
        } catch (cause) {
            this.logger.warn('Limiter outbound queue: '+String(cause));
        } finally {this.busy=false;}
    }
}
