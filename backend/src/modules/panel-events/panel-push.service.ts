import webPush from 'web-push';
import { z } from 'zod';

import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';

import { PrismaService } from '@common/database/prisma.service';

import { subscriptionSchema } from './event-policy';
import { parseInput } from './panel-events.service';

@Injectable()
export class PanelPushService {
    constructor(private readonly db: PrismaService) {}
    config() {
        const publicKey = process.env.WEB_PUSH_PUBLIC_KEY;
        return {
            enabled: !!(
                publicKey &&
                process.env.WEB_PUSH_PRIVATE_KEY &&
                process.env.WEB_PUSH_SUBJECT
            ),
            publicKey: publicKey || null,
        };
    }
    async subscribe(admin: string, body: unknown) {
        if (!this.config().enabled)
            throw new ServiceUnavailableException('Web Push ещё не настроен на сервере');
        const input = parseInput(subscriptionSchema, body);
        await this.db.$transaction(async (tx) => {
            await tx.$executeRaw`INSERT INTO panel_event_preferences(admin_uuid) VALUES(${admin}::uuid) ON CONFLICT DO NOTHING`;
            // Lock this owner to enforce the device limit even with concurrent requests.
            await tx.$queryRaw`SELECT admin_uuid FROM panel_event_preferences WHERE admin_uuid=${admin}::uuid FOR UPDATE`;
            const [count] = await tx.$queryRaw<
                { total: number }[]
            >`SELECT count(*)::int AS total FROM panel_push_subscriptions WHERE admin_uuid=${admin}::uuid AND endpoint<>${input.endpoint}`;
            if (count.total >= 20)
                throw new BadRequestException('Можно подключить до 20 устройств');
            // Do not transfer a browser's pending deliveries to a different admin account.
            await tx.$executeRaw`DELETE FROM panel_push_subscriptions WHERE endpoint=${input.endpoint} AND admin_uuid<>${admin}::uuid`;
            await tx.$executeRaw`INSERT INTO panel_push_subscriptions(admin_uuid,endpoint,p256dh,auth)
                VALUES(${admin}::uuid,${input.endpoint},${input.keys.p256dh},${input.keys.auth})
                ON CONFLICT(endpoint) DO UPDATE SET p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth`;
        });
        return { response: { success: true } };
    }
    async unsubscribe(admin: string, body: unknown) {
        const { endpoint } = parseInput(z.object({ endpoint: z.string().max(4096) }), body);
        await this.db
            .$executeRaw`DELETE FROM panel_push_subscriptions WHERE admin_uuid=${admin}::uuid AND endpoint=${endpoint}`;
        return { response: { success: true } };
    }
    async deliver() {
        if (!this.config().enabled) return;
        const rows = await this.db.$queryRaw<
            {
                event_id: bigint;
                subscription_id: string;
                attempts: number;
                endpoint: string;
                p256dh: string;
                auth: string;
                title: string;
                message: string;
                type: string;
                event_types: string[];
            }[]
        >`WITH claimed AS (
            UPDATE panel_push_deliveries SET lease_until=now()+interval '5 minutes',attempts=attempts+1
            WHERE (event_id,subscription_id) IN (SELECT event_id,subscription_id FROM panel_push_deliveries
                WHERE delivered_at IS NULL AND attempts<12 AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now())
                ORDER BY event_id LIMIT 20 FOR UPDATE SKIP LOCKED) RETURNING *)
            SELECT c.*,s.endpoint,s.p256dh,s.auth,e.title,e.message,e.type,p.event_types FROM claimed c
            JOIN panel_push_subscriptions s ON s.id=c.subscription_id JOIN panel_events e ON e.id=c.event_id
            JOIN panel_event_preferences p ON p.admin_uuid=s.admin_uuid`;
        for (const row of rows) {
            try {
                if (row.event_types.includes(row.type)) {
                    await webPush.sendNotification(
                        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
                        JSON.stringify({
                            id: row.event_id.toString(),
                            title: row.title,
                            body: row.message.slice(0, 500),
                            url: '/dashboard/events',
                        }),
                        {
                            TTL: 86400,
                            timeout: 10000,
                            vapidDetails: {
                                subject: process.env.WEB_PUSH_SUBJECT!,
                                publicKey: process.env.WEB_PUSH_PUBLIC_KEY!,
                                privateKey: process.env.WEB_PUSH_PRIVATE_KEY!,
                            },
                        },
                    );
                }
                await this.db
                    .$executeRaw`UPDATE panel_push_deliveries SET delivered_at=now(),lease_until=NULL WHERE event_id=${row.event_id} AND subscription_id=${row.subscription_id}::uuid`;
            } catch (error) {
                const code = (error as { statusCode?: number }).statusCode;
                if (code === 404 || code === 410) {
                    await this.db
                        .$executeRaw`DELETE FROM panel_push_subscriptions WHERE id=${row.subscription_id}::uuid`;
                } else {
                    const seconds = Math.min(3600, 2 ** row.attempts * 30);
                    await this.db
                        .$executeRaw`UPDATE panel_push_deliveries SET lease_until=NULL,next_attempt_at=now()+${seconds}::int*interval '1 second'
                        WHERE event_id=${row.event_id} AND subscription_id=${row.subscription_id}::uuid`;
                }
            }
        }
    }
}
