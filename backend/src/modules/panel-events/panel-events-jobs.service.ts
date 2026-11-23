import { createHash, randomUUID } from 'node:crypto';

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '@common/config/app-config';
import { NotificationsConfigService } from '@common/config/common-config';
import { PrismaService } from '@common/database/prisma.service';
import { NOTIFICATION_CONFIGS } from '@modules/infra-billing/interfaces/notification-config.constant';
import { WebhookLoggerJobNames } from '@queue/notifications/webhook-logger/enums';
import { WebhookLoggerQueueService } from '@queue/notifications/webhook-logger/webhook-logger.service';

interface DueCertificate {
    id: string;
    name: string;
    domains: string[];
    expires_at: Date;
    expiry_revision: number;
    reminder_day: number;
}

const BILLING_DAYS: Record<keyof typeof NOTIFICATION_CONFIGS, number> = {
    INFRA_BILLING_NODE_PAYMENT_IN_7_DAYS: 7,
    INFRA_BILLING_NODE_PAYMENT_IN_48HRS: 2,
    INFRA_BILLING_NODE_PAYMENT_IN_24HRS: 1,
    INFRA_BILLING_NODE_PAYMENT_DUE_TODAY: 0,
    INFRA_BILLING_NODE_PAYMENT_OVERDUE_24HRS: -1,
    INFRA_BILLING_NODE_PAYMENT_OVERDUE_48HRS: -2,
    INFRA_BILLING_NODE_PAYMENT_OVERDUE_7_DAYS: -7,
};

@Injectable()
export class PanelEventsJobsService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(PanelEventsJobsService.name);
    private timer?: ReturnType<typeof setInterval>;
    private busy = false;

    constructor(
        private readonly db: PrismaService,
        private readonly webhooks: WebhookLoggerQueueService,
        private readonly config: TypedConfigService,
        private readonly notificationsConfig: NotificationsConfigService,
    ) {}

    onModuleInit() {
        if (process.env.INSTANCE_TYPE !== 'scheduler') return;
        this.timer = setInterval(() => void this.tick(), 60000);
        void this.tick();
    }

    onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

    private webhookUrls() {
        if (!this.config.get('WEBHOOK_ENABLED') || !this.config.get('WEBHOOK_SECRET_HEADER')) return [];
        return [...new Set((this.config.get('WEBHOOK_URL') ?? '').split(',').map(url => url.trim()).filter(Boolean))];
    }

    async tick() {
        if (this.busy) return;
        this.busy = true;
        try {
            const results = await Promise.allSettled([this.createSslEvents(), this.createBillingEvents()]);
            for (const result of results) if (result.status === 'rejected') this.logger.error(String(result.reason));
            await this.deliverSslWebhooks();
        } catch (error) { this.logger.error(String(error)); }
        finally { this.busy = false; }
    }

    async createSslEvents() {
        const withWebhooks = this.webhookUrls().length > 0;
        // Row claims + unique source keys make overlapping scheduler instances safe.
        // A reminder uses the current lead day, so a restart does not replay 3/2/1 together.
        return this.db.$transaction(async tx => {
            const due = await tx.$queryRaw<DueCertificate[]>`
                SELECT c.*,d.reminder_day FROM ssl_certificates c
                CROSS JOIN LATERAL (SELECT CASE WHEN c.expires_at<=now() THEN 0
                    ELSE ceil(extract(epoch FROM (c.expires_at-now()))/86400)::int END AS reminder_day) d
                WHERE c.enabled AND (d.reminder_day=0 OR d.reminder_day=ANY(c.reminder_days))
                    AND NOT EXISTS (SELECT 1 FROM panel_events e
                        WHERE e.source_key='ssl:'||c.id::text||':'||c.expiry_revision::text||':'||d.reminder_day::text)
                ORDER BY c.expires_at,c.id LIMIT 50 FOR UPDATE OF c SKIP LOCKED`;
            for (const certificate of due) {
                const nodes = await tx.$queryRaw<{ uuid: string; name: string }[]>`
                    SELECT n.uuid,n.name FROM ssl_certificate_nodes cn JOIN nodes n ON n.uuid=cn.node_uuid
                    WHERE cn.certificate_id=${certificate.id}::uuid ORDER BY n.name`;
                const expired = certificate.reminder_day === 0;
                const type = expired ? 'ssl.expired' : 'ssl.expiring';
                const title = expired ? 'SSL-сертификат истёк' : 'Истекает SSL-сертификат';
                const message = expired
                    ? `Срок действия сертификата «${certificate.name}» истёк.`
                    : `До истечения сертификата «${certificate.name}» осталось ${certificate.reminder_day} дн.`;
                const sourceKey = `ssl:${certificate.id}:${certificate.expiry_revision}:${certificate.reminder_day}`;
                const data = JSON.stringify({
                    certificateId: certificate.id,
                    name: certificate.name,
                    domains: certificate.domains,
                    nodeUuids: nodes.map(node => node.uuid),
                    nodes,
                    expiresAt: certificate.expires_at,
                    reminderDaysBefore: certificate.reminder_day,
                    expiryRevision: certificate.expiry_revision,
                });
                const inserted = await tx.$queryRaw<{ id: string | null }[]>`
                    SELECT panel_append_event(${type},${expired ? 'critical' : 'warning'},${title},${message},
                        ${nodes.length === 1 ? nodes[0].uuid : null}::uuid,
                        ${nodes.length === 1 ? nodes[0].name : null},${sourceKey},${data}::jsonb,clock_timestamp()) AS id`;
                if (inserted[0].id && withWebhooks && this.notificationsConfig.isEnabled(type, 'webhook')) {
                    await tx.$executeRaw`INSERT INTO panel_event_webhooks(event_id)
                        VALUES(${inserted[0].id}::uuid) ON CONFLICT DO NOTHING`;
                }
            }
            return due.length;
        }, { timeout: 15000 });
    }

    async createBillingEvents() {
        // Use the existing billing notification windows, including overdue reminders.
        const windows = (Object.keys(NOTIFICATION_CONFIGS) as (keyof typeof NOTIFICATION_CONFIGS)[])
            .map(key => Prisma.sql`(${key}::text,${NOTIFICATION_CONFIGS[key].from()}::timestamp,
                ${NOTIFICATION_CONFIGS[key].to()}::timestamp,${BILLING_DAYS[key]}::int)`);
        const rows = await this.db.$queryRaw<{
            uuid: string; node_uuid: string | null; node_name: string;
            provider_uuid: string; provider_name: string; next_billing_at: Date;
            kind: string; days: number;
        }[]>(Prisma.sql`
            SELECT b.uuid,b.node_uuid,coalesce(n.name,b.name,'Без названия') AS node_name,
                b.provider_uuid,p.name AS provider_name,b.next_billing_at,w.kind,w.days
            FROM infra_billing_nodes b
            JOIN infra_providers p ON p.uuid=b.provider_uuid
            LEFT JOIN nodes n ON n.uuid=b.node_uuid
            JOIN (VALUES ${Prisma.join(windows)}) AS w(kind,from_date,to_date,days)
                ON b.next_billing_at>=w.from_date AND b.next_billing_at<w.to_date`);
        for (const row of rows) {
            const title = row.days < 0 ? 'Просрочена оплата ноды' : 'Напоминание об оплате ноды';
            const when = row.days < 0 ? `просрочена на ${-row.days} дн.`
                : row.days === 0 ? 'сегодня' : `через ${row.days} дн.`;
            const message = `Оплата «${row.node_name}» у ${row.provider_name}: ${when}.`;
            const key = `billing:${row.uuid}:${row.next_billing_at.toISOString()}:${row.kind}`;
            const data = JSON.stringify({
                billingNodeUuid: row.uuid,
                providerUuid: row.provider_uuid,
                providerName: row.provider_name,
                nextBillingAt: row.next_billing_at,
                daysRemaining: row.days,
                notificationType: row.kind,
            });
            await this.db.$queryRaw`SELECT panel_append_event('billing.payment_due',
                ${row.days < 0 ? 'critical' : 'warning'},${title},${message},${row.node_uuid}::uuid,
                ${row.node_name},${key},${data}::jsonb,clock_timestamp())`;
        }
        return rows.length;
    }

    async deliverSslWebhooks() {
        const urls = this.webhookUrls();
        if (!urls.length) return;
        const lease = randomUUID();
        const rows = await this.db.$queryRaw<{
            id: string; type: string; severity: string; title: string; message: string;
            node_uuid: string | null; node_name: string | null; data: Record<string, unknown>;
            occurred_at: Date; attempts: number;
        }[]>`
            WITH claimed AS (
                UPDATE panel_event_webhooks SET lease_until=now()+interval '60 seconds',lease_token=${lease}::uuid,attempts=attempts+1
                WHERE event_id IN (
                    SELECT event_id FROM panel_event_webhooks WHERE enqueued_at IS NULL AND next_attempt_at<=now()
                        AND (lease_until IS NULL OR lease_until<now())
                    ORDER BY next_attempt_at LIMIT 25 FOR UPDATE SKIP LOCKED
                ) RETURNING event_id,attempts
            ) SELECT e.*,c.attempts FROM claimed c JOIN panel_events e ON e.id=c.event_id`;
        for (const event of rows) {
            try {
                const timestamp = event.occurred_at.toISOString();
                const payload = JSON.stringify({
                    id: event.id,
                    scope: 'ssl',
                    event: event.type,
                    timestamp,
                    data: { ...event.data, severity: event.severity, title: event.title, message: event.message },
                });
                // Stable per-destination job IDs also deduplicate a retry after an enqueue/DB crash.
                // Existing processor applies X-Remnawave-Signature and network retries.
                await this.webhooks.queue.addBulk(urls.map(url => ({
                    name: WebhookLoggerJobNames.sendWebhook,
                    data: { payload, timestamp, url },
                    opts: {
                        jobId: `panel-ssl-${event.id}-${createHash('sha256').update(url).digest('hex').slice(0, 24)}`,
                        attempts: 8,
                        backoff: { type: 'exponential', delay: 10000 },
                        removeOnComplete: { age: 604800 },
                        removeOnFail: { age: 2592000 },
                    },
                })));
                await this.db.$executeRaw`UPDATE panel_event_webhooks SET enqueued_at=now(),lease_until=NULL,lease_token=NULL
                    WHERE event_id=${event.id}::uuid AND lease_token=${lease}::uuid`;
            } catch {
                const delay = Math.min(3600, 2 ** Math.min(event.attempts, 12));
                await this.db.$executeRaw`UPDATE panel_event_webhooks
                    SET lease_until=NULL,lease_token=NULL,next_attempt_at=now()+${delay}::int*interval '1 second'
                    WHERE event_id=${event.id}::uuid AND lease_token=${lease}::uuid`;
                this.logger.warn(`SSL webhook ${event.id}: queue handoff failed; retry scheduled`);
            }
        }
    }
}
