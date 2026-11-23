import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { PrismaService } from '@common/database/prisma.service';

import { postSignedWebhook } from '@modules/squad-quotas/quota-webhooks.service';

import { PanelPushService } from './panel-push.service';
import { SslCertificatesService } from './ssl-certificates.service';

@Injectable()
export class PanelEventsWorker implements OnModuleInit, OnModuleDestroy {
    private timer?: ReturnType<typeof setInterval>;
    private busy = false;
    private readonly logger = new Logger(PanelEventsWorker.name);
    constructor(
        private readonly db: PrismaService,
        private readonly ssl: SslCertificatesService,
        private readonly push: PanelPushService,
    ) {}
    onModuleInit() {
        if (process.env.INSTANCE_TYPE === 'scheduler') {
            this.timer = setInterval(() => void this.tick(), 30000);
            void this.tick();
        }
    }
    onModuleDestroy() {
        if (this.timer) clearInterval(this.timer);
    }
    async tick() {
        if (this.busy) return;
        this.busy = true;
        try {
            // One failed transport must not stop the other channels or SSL evaluation.
            for (const task of [
                () => this.ssl.reminders(),
                () => this.push.deliver(),
                () => this.webhooks(),
            ]) {
                try {
                    await task();
                } catch {
                    this.logger.error('Panel notification task failed; retrying next tick');
                }
            }
        } finally {
            this.busy = false;
        }
    }
    async webhooks() {
        const secret = process.env.SSL_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET_HEADER;
        if (!secret || secret.length < 32) return;
        const rows = await this.db.$queryRaw<
            {
                event_id: bigint;
                destination: string;
                attempts: number;
                type: string;
                created_at: Date;
                data: unknown;
            }[]
        >`WITH claimed AS (
            UPDATE panel_webhook_deliveries SET lease_until=now()+interval '2 minutes',attempts=attempts+1
            WHERE (event_id,destination) IN (SELECT event_id,destination FROM panel_webhook_deliveries
                WHERE delivered_at IS NULL AND attempts<20 AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now())
                ORDER BY event_id LIMIT 5 FOR UPDATE SKIP LOCKED) RETURNING *)
            SELECT c.*,e.type,e.created_at,e.data FROM claimed c JOIN panel_events e ON e.id=c.event_id`;
        for (const row of rows) {
            try {
                const id = row.event_id.toString();
                await postSignedWebhook(
                    row.destination,
                    JSON.stringify({
                        id,
                        event: row.type,
                        occurredAt: row.created_at,
                        data: row.data,
                    }),
                    secret,
                    id,
                );
                await this.db
                    .$executeRaw`UPDATE panel_webhook_deliveries SET delivered_at=now(),lease_until=NULL WHERE event_id=${row.event_id} AND destination=${row.destination}`;
            } catch {
                const seconds = Math.min(3600, 2 ** Math.min(row.attempts, 12));
                await this.db
                    .$executeRaw`UPDATE panel_webhook_deliveries SET lease_until=NULL,next_attempt_at=now()+${seconds}::int*interval '1 second'
                    WHERE event_id=${row.event_id} AND destination=${row.destination}`;
            }
        }
    }
}
