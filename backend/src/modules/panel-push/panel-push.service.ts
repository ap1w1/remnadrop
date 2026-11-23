import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '@common/database/prisma.service';
import { createHash } from 'node:crypto';
import webpush from 'web-push';
import { deliverWebPush } from './panel-push.transport';
import {
    BrowserPushSubscription, EncryptedPushSecret, openPushSecret, pushEndpoint,
    pushEndpointHash, pushRetry, pushSubject, sealPushSecret, validatePushSubscription,
} from './panel-push.security';

interface VapidRow extends EncryptedPushSecret { public_key: string; subject: string }
interface PushDelivery { id: string; subscription_id: string; event_id: string; attempts: number }
interface PushTarget extends EncryptedPushSecret {
    admin_uuid: string;
    subscription_version: string;
    type: string;
    severity: string;
    title: string;
    message: string;
}

@Injectable()
export class PanelPushService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(PanelPushService.name);
    private timer?: ReturnType<typeof setInterval>;
    private busy = false;
    constructor(private readonly db: PrismaService) {}

    onModuleInit() {
        if (process.env.INSTANCE_TYPE !== 'scheduler') return;
        this.timer = setInterval(() => void this.tick(), 15_000);
        this.timer.unref();
        void this.tick();
    }
    onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

    private async keys(referer?: string) {
        let rows = await this.db.$queryRaw<VapidRow[]>`SELECT public_key,subject,iv,tag,ciphertext FROM panel_push_vapid WHERE id=1`;
        if (!rows.length) {
            const generated = webpush.generateVAPIDKeys();
            const subject = pushSubject(referer);
            const secret = sealPushSecret(generated.privateKey, 'vapid');
            await this.db.$executeRaw`INSERT INTO panel_push_vapid(id,public_key,subject,iv,tag,ciphertext)
                VALUES(1,${generated.publicKey},${subject},${secret.iv},${secret.tag},${secret.ciphertext}) ON CONFLICT(id) DO NOTHING`;
            rows = await this.db.$queryRaw<VapidRow[]>`SELECT public_key,subject,iv,tag,ciphertext FROM panel_push_vapid WHERE id=1`;
        }
        if (!rows.length) throw new ServiceUnavailableException('Не удалось подготовить push-уведомления');
        return { publicKey: rows[0].public_key, subject: rows[0].subject, privateKey: openPushSecret(rows[0], 'vapid') };
    }

    async config(referer?: string) {
        try {
            const keys = await this.keys(referer);
            return { response: { enabled: true, publicKey: keys.publicKey } };
        } catch (error) {
            if (!(error instanceof ServiceUnavailableException)) throw error;
            return { response: { enabled: false, publicKey: null, reason: error.message } };
        }
    }

    async subscribe(adminUuid: string, input: unknown, referer?: string) {
        const subscription = validatePushSubscription(input);
        await this.keys(referer);
        const endpointHash = pushEndpointHash(subscription.endpoint);
        const secret = sealPushSecret(JSON.stringify(subscription), 'subscription');
        await this.db.$transaction(async tx => {
            // Serialize registration for one administrator and cap abandoned devices.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${adminUuid},9127))`;
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${endpointHash},9128))`;
            const own = await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM panel_push_subscriptions WHERE admin_uuid=${adminUuid}::uuid AND endpoint_hash<>${endpointHash}`;
            if (Number(own[0]?.count ?? 0) >= 30) throw new BadRequestException('Слишком много push-подписок. Отключите уведомления на неиспользуемых устройствах');
            // An endpoint belongs to one browser. Switching accounts must never
            // retain queued payloads for the previous owner.
            await tx.$executeRaw`DELETE FROM panel_push_subscriptions WHERE endpoint_hash=${endpointHash} AND admin_uuid<>${adminUuid}::uuid`;
            await tx.$executeRaw`INSERT INTO panel_push_subscriptions(admin_uuid,endpoint_hash,iv,tag,ciphertext)
                VALUES(${adminUuid}::uuid,${endpointHash},${secret.iv},${secret.tag},${secret.ciphertext})
                ON CONFLICT(endpoint_hash) DO UPDATE SET iv=EXCLUDED.iv,tag=EXCLUDED.tag,ciphertext=EXCLUDED.ciphertext,updated_at=now()`;
        });
        return { response: { subscribed: true } };
    }

    async unsubscribe(adminUuid: string, input: unknown) {
        const endpoint = pushEndpoint(input && typeof input === 'object' ? (input as { endpoint?: unknown }).endpoint : undefined);
        const hash = pushEndpointHash(endpoint);
        await this.db.$executeRaw`DELETE FROM panel_push_subscriptions WHERE endpoint_hash=${hash} AND admin_uuid=${adminUuid}::uuid`;
        return { response: { subscribed: false } };
    }

    /** Durable per-subscription receipts also handle events committing out of
     * sequence: delivery never depends on a max(sequence) cursor. */
    async enqueue() {
        await this.db.$executeRaw`INSERT INTO panel_push_deliveries(event_id,subscription_id)
            SELECT e.id,s.id FROM panel_events e
            JOIN panel_notification_preferences p ON p.push_enabled=true AND e.type=ANY(p.event_types)
            JOIN panel_push_subscriptions s ON s.admin_uuid=p.admin_uuid
            WHERE e.created_at>=now()-interval '24 hours'
              AND e.created_at>=s.created_at AND e.created_at>=p.push_enabled_at
              AND NOT EXISTS(SELECT 1 FROM panel_push_deliveries d WHERE d.event_id=e.id AND d.subscription_id=s.id)
            ORDER BY e.sequence LIMIT 500 ON CONFLICT(event_id,subscription_id) DO NOTHING`;
    }

    async deliver() {
        const jobs = await this.db.$queryRaw<PushDelivery[]>`WITH due AS (
            SELECT id FROM panel_push_deliveries
            WHERE status IN ('pending','sending') AND next_attempt_at<=now()
              AND (lease_until IS NULL OR lease_until<now())
            ORDER BY next_attempt_at LIMIT 12 FOR UPDATE SKIP LOCKED
        ) UPDATE panel_push_deliveries d SET status='sending',attempts=attempts+1,lease_until=now()+interval '2 minutes'
          FROM due WHERE d.id=due.id RETURNING d.id,d.subscription_id,d.event_id,d.attempts`;
        if (!jobs.length) return;
        const keys = await this.keys();
        for (let i = 0; i < jobs.length; i += 4) {
            await Promise.allSettled(jobs.slice(i, i + 4).map(job => this.deliverOne(job, keys)));
        }
    }

    private async deliverOne(job: PushDelivery, keys: { publicKey: string; privateKey: string; subject: string }) {
        const rows = await this.db.$queryRaw<PushTarget[]>`SELECT s.admin_uuid,s.updated_at::text AS subscription_version,s.iv,s.tag,s.ciphertext,e.type,e.severity,e.title,e.message
            FROM panel_push_subscriptions s JOIN panel_push_deliveries d ON d.subscription_id=s.id
            JOIN panel_events e ON e.id=d.event_id
            JOIN panel_notification_preferences p ON p.admin_uuid=s.admin_uuid
            WHERE d.id=${job.id}::uuid AND d.status='sending' AND d.attempts=${job.attempts} AND d.lease_until>now()
              AND p.push_enabled=true AND e.type=ANY(p.event_types)
              AND e.created_at>=p.push_enabled_at AND e.created_at>=s.created_at AND e.created_at>=now()-interval '24 hours'`;
        if (!rows.length) {
            await this.db.$executeRaw`UPDATE panel_push_deliveries SET status='cancelled',lease_until=NULL
                WHERE id=${job.id}::uuid AND status='sending' AND attempts=${job.attempts}`;
            return;
        }
        const row = rows[0];
        try {
            const subscription = validatePushSubscription(JSON.parse(openPushSecret(row, 'subscription'))) as BrowserPushSubscription;
            const payload = { id: job.event_id, adminUuid: row.admin_uuid, type: row.type,
                title: row.title.slice(0, 160), message: row.message.slice(0, 500), url: '/dashboard/events' };
            const topic = createHash('sha256').update(job.event_id).digest('base64url').slice(0, 32);
            await deliverWebPush(subscription, payload, keys, topic, row.severity === 'critical');
            await this.db.$transaction([
                this.db.$executeRaw`UPDATE panel_push_deliveries SET status='sent',delivered_at=now(),lease_until=NULL,last_error=NULL
                    WHERE id=${job.id}::uuid AND status='sending' AND attempts=${job.attempts}`,
                this.db.$executeRaw`UPDATE panel_push_subscriptions SET last_success_at=now() WHERE id=${job.subscription_id}::uuid`,
            ]);
        } catch (error) {
            const retry = pushRetry(error, job.attempts);
            if (retry.remove || error instanceof BadRequestException) {
                await this.db.$executeRaw`DELETE FROM panel_push_subscriptions WHERE id=${job.subscription_id}::uuid AND updated_at=${row.subscription_version}::timestamptz
                    AND EXISTS(SELECT 1 FROM panel_push_deliveries WHERE id=${job.id}::uuid AND attempts=${job.attempts})`;
            } else {
                const retryable = retry.retry && !(error instanceof ServiceUnavailableException);
                await this.db.$executeRaw`UPDATE panel_push_deliveries SET status=${retryable ? 'pending' : 'failed'},
                    lease_until=NULL,next_attempt_at=now()+${retry.delay}::int*interval '1 second',last_error=${error instanceof ServiceUnavailableException ? 'PUSH_KEY_UNAVAILABLE' : retry.code}
                    WHERE id=${job.id}::uuid AND status='sending' AND attempts=${job.attempts}`;
            }
        }
    }

    private async tick() {
        if (this.busy) return;
        this.busy = true;
        try {
            await this.enqueue();
            await this.deliver();
            await this.db.$executeRaw`DELETE FROM panel_push_deliveries WHERE created_at<now()-interval '7 days'`;
        } catch { this.logger.warn('Push delivery cycle failed; pending deliveries will be retried'); }
        finally { this.busy = false; }
    }
}
