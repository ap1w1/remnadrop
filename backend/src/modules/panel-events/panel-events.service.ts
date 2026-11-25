import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

import { BadRequestException, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { PrismaService } from '@common/database/prisma.service';

import { CrmEvent } from '@integration-modules/notifications/interfaces';
import { ServiceEvent } from '@integration-modules/notifications/interfaces';

import { cursorSchema, EVENT_TYPES, eventTypeSchema, preferencesSchema } from './event-policy';

export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success)
        throw new BadRequestException(result.error.issues.map((i) => i.message).join('; '));
    return result.data;
}

@Injectable()
export class PanelEventsService {
    constructor(private readonly db: PrismaService) {}

    @OnEvent('service.login_attempt_success')
    async login(event: ServiceEvent) {
        const attempt = event.data.loginAttempt;
        if (!attempt) return;
        await this.db.$executeRaw`INSERT INTO panel_events(source_key,type,severity,title,message,data)
            VALUES(${`login:${randomUUID()}`},'auth.login','info','Вход в панель',
                ${`${attempt.username} · ${attempt.ip}`},
                ${JSON.stringify({ username: attempt.username, ip: attempt.ip, userAgent: attempt.userAgent })}::jsonb)`;
    }

    @OnEvent('crm.*')
    async billing(event: CrmEvent) {
        const key = createHash('sha256')
            .update(JSON.stringify([event.eventName, event.data]))
            .digest('hex');
        await this.db
            .$executeRaw`INSERT INTO panel_events(source_key,type,severity,title,message,data)
            VALUES(${`billing:${key}`},'billing.reminder','warning','Напоминание об оплате ноды',
                ${`${event.data.nodeName} · ${event.data.providerName} · ${new Date(event.data.nextBillingAt).toISOString().slice(0, 10)}`},
                ${JSON.stringify({ ...event.data, eventName: event.eventName })}::jsonb) ON CONFLICT(source_key) DO NOTHING`;
    }

    async list(
        admin: string,
        query: {
            before?: string;
            after?: string;
            type?: string;
            severity?: string;
            limit?: string;
        },
    ) {
        const input = parseInput(
            z.object({
                before: cursorSchema.optional(),
                after: cursorSchema.optional(),
                type: eventTypeSchema.optional(),
                severity: z.enum(['info', 'warning', 'error', 'success']).optional(),
                limit: z.coerce.number().int().min(1).max(100).default(50),
            }),
            query,
        );
        // A single snapshot prevents clearing events that were not present in the returned page.
        return this.db.$transaction(
            async (tx) => {
                const [summary] = await tx.$queryRaw<{ unread: number; latestId: string }[]>`
                SELECT count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM panel_event_reads r WHERE r.admin_uuid=${admin}::uuid AND r.event_id=panel_events.id))::int AS unread,
                    coalesce(max(id),0)::text AS "latestId" FROM panel_events`;
                const items =
                    await tx.$queryRaw`SELECT e.id::text,e.type,e.severity,e.title,e.message,
                    e.node_uuid AS "nodeUuid",n.name AS "nodeName",n.country_code AS "countryCode",
                    n.address AS "nodeAddress",e.data,e.created_at AS "createdAt"
                FROM panel_events e LEFT JOIN nodes n ON n.uuid=e.node_uuid
                WHERE e.id<=${summary.latestId}::bigint
                    AND (${input.before ?? null}::bigint IS NULL OR e.id<${input.before ?? null}::bigint)
                    AND (${input.after ?? null}::bigint IS NULL OR e.id>${input.after ?? null}::bigint)
                    AND (${input.type ?? null}::text IS NULL OR e.type=${input.type ?? null})
                    AND (${input.severity ?? null}::text IS NULL OR e.severity=${input.severity ?? null})
                ORDER BY e.id DESC LIMIT ${input.limit}`;
                return { response: { ...summary, items } };
            },
            { isolationLevel: 'RepeatableRead' },
        );
    }

    async read(admin: string, body: unknown) {
        const { through } = parseInput(z.object({ through: cursorSchema }), body);
        await this.db.$executeRaw`INSERT INTO panel_event_reads(admin_uuid,event_id)
            SELECT ${admin}::uuid,id FROM panel_events WHERE id<=${through}::bigint ON CONFLICT DO NOTHING`;
        return { response: { success: true } };
    }
    async preferences(admin: string) {
        const rows = await this.db.$queryRaw<{ browserEnabled: boolean; eventTypes: string[]; excludedNodeUuids: string[] }[]>`
            SELECT browser_enabled AS "browserEnabled",event_types AS "eventTypes",excluded_node_uuids::text[] AS "excludedNodeUuids" FROM panel_event_preferences WHERE admin_uuid=${admin}::uuid`;
        return {
            response: {
                adminUuid: admin,
                ...(rows[0] ?? { browserEnabled: false, eventTypes: [...EVENT_TYPES], excludedNodeUuids: [] }),
            },
        };
    }
    async savePreferences(admin: string, body: unknown) {
        const input = parseInput(preferencesSchema, body);
        await this.db
            .$executeRaw`INSERT INTO panel_event_preferences(admin_uuid,browser_enabled,event_types,excluded_node_uuids)
            VALUES(${admin}::uuid,${input.browserEnabled},${input.eventTypes}::text[],${input.excludedNodeUuids}::uuid[])
            ON CONFLICT(admin_uuid) DO UPDATE SET browser_enabled=EXCLUDED.browser_enabled,event_types=EXCLUDED.event_types,excluded_node_uuids=EXCLUDED.excluded_node_uuids`;
        return this.preferences(admin);
    }
}
