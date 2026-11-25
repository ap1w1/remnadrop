import { z } from 'zod';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '@common/database/prisma.service';
import { ForkWebhooksService } from '@modules/squad-quotas/fork-webhooks.service';

import { certificateSchema, dueReminder } from './event-policy';
import { parseInput } from './panel-events.service';

type Certificate = {
    id: string;
    name: string;
    domain: string;
    expiresOn: string;
    reminderDays: number[];
    enabled: boolean;
    nodeUuids: string[];
    nodeNames: string[];
};

@Injectable()
export class SslCertificatesService {
    constructor(private readonly db: PrismaService, private readonly webhooks: ForkWebhooksService) {}
    async list(): Promise<{ response: Certificate[] }> {
        const rows = await this.db.$queryRaw<
            Certificate[]
        >`SELECT c.id,c.name,c.domain,c.expires_on::text AS "expiresOn",
            c.reminder_days AS "reminderDays",c.enabled,
            coalesce(array_agg(n.uuid::text ORDER BY n.name) FILTER (WHERE n.uuid IS NOT NULL),'{}') AS "nodeUuids",
            coalesce(array_agg(n.name ORDER BY n.name) FILTER (WHERE n.uuid IS NOT NULL),'{}') AS "nodeNames"
            FROM ssl_certificates c LEFT JOIN ssl_certificate_nodes cn ON cn.certificate_id=c.id
            LEFT JOIN nodes n ON n.uuid=cn.node_uuid GROUP BY c.id ORDER BY c.expires_on,c.name`;
        return { response: rows };
    }
    async save(id: string | undefined, body: unknown) {
        if (id) parseInput(z.string().uuid(), id);
        const input = parseInput(certificateSchema, body);
        return this.db.$transaction(async (tx) => {
            const nodes = await tx.nodes.count({ where: { uuid: { in: input.nodeUuids } } });
            if (nodes !== input.nodeUuids.length)
                throw new BadRequestException('Одна из выбранных нод не найдена');
            let certificateId = id;
            if (id) {
                const changed =
                    await tx.$executeRaw`UPDATE ssl_certificates SET name=${input.name},domain=${input.domain},
                    expires_on=${input.expiresOn}::date,reminder_days=${input.reminderDays}::integer[],enabled=${input.enabled},updated_at=now() WHERE id=${id}::uuid`;
                if (!changed) throw new NotFoundException('Сертификат не найден');
                await tx.$executeRaw`DELETE FROM ssl_certificate_nodes WHERE certificate_id=${id}::uuid`;
            } else {
                const [row] = await tx.$queryRaw<
                    { id: string }[]
                >`INSERT INTO ssl_certificates(name,domain,expires_on,reminder_days,enabled)
                    VALUES(${input.name},${input.domain},${input.expiresOn}::date,${input.reminderDays}::integer[],${input.enabled}) RETURNING id`;
                certificateId = row.id;
            }
            for (const node of input.nodeUuids)
                await tx.$executeRaw`INSERT INTO ssl_certificate_nodes(certificate_id,node_uuid) VALUES(${certificateId}::uuid,${node}::uuid)`;
            return { response: { id: certificateId } };
        });
    }
    async remove(id: string) {
        parseInput(z.string().uuid(), id);
        const deleted = await this.db
            .$executeRaw`DELETE FROM ssl_certificates WHERE id=${id}::uuid`;
        if (!deleted) throw new NotFoundException('Сертификат не найден');
        return { response: { success: true } };
    }

    async reminders() {
        const { response: certificates } = await this.list();
        const now = new Date();
        const destinations = [...new Set(this.webhooks.destinations())];
        for (const cert of certificates) {
            if (!cert.enabled || !cert.nodeUuids.length) continue;
            const threshold = dueReminder(cert.expiresOn, cert.reminderDays, now);
            if (threshold === null) continue;
            const remaining = Math.round(
                (Date.parse(`${cert.expiresOn}T00:00:00Z`) -
                    Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`)) /
                    86400000,
            );
            const type = threshold === 0 ? 'ssl.expired' : 'ssl.expiring';
            await this.db.$transaction(async (tx) => {
                // Lock the current version: concurrent edits/deletes must not emit stale reminders.
                const current = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM ssl_certificates
                    WHERE id=${cert.id}::uuid AND expires_on=${cert.expiresOn}::date AND reminder_days=${cert.reminderDays}::integer[] AND enabled FOR UPDATE`;
                if (!current.length) return;
                const events = await tx.$queryRaw<
                    { id: bigint }[]
                >`INSERT INTO panel_events(source_key,type,severity,title,message,node_uuid,data)
                    VALUES(${`ssl:${cert.id}:${cert.expiresOn}:${threshold}`},${type},${threshold === 0 ? 'error' : 'warning'},
                        ${threshold === 0 ? 'Истёк SSL-сертификат' : 'Истекает SSL-сертификат'},
                        ${`${cert.name} · ${cert.domain} · ${cert.expiresOn} · ${cert.nodeNames.join(', ')}`},${cert.nodeUuids[0]}::uuid,
                        ${JSON.stringify({
                            certificateId: cert.id,
                            name: cert.name,
                            domain: cert.domain,
                            nodeUuids: cert.nodeUuids,
                            expiresOn: cert.expiresOn,
                            reminderDays: threshold,
                            daysRemaining: remaining,
                        })}::jsonb)
                    ON CONFLICT(source_key) DO NOTHING RETURNING id`;
                for (const event of events)
                    for (const url of destinations) {
                        await tx.$executeRaw`INSERT INTO panel_webhook_deliveries(event_id,destination) VALUES(${event.id},${url}) ON CONFLICT DO NOTHING`;
                    }
            });
        }
    }
}
