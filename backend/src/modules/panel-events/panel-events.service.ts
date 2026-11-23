import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@common/database/prisma.service';

import { PANEL_EVENT_FEED_LOCK, PANEL_EVENT_TYPES, PanelEventRow, PanelEventType } from './panel-events.constants';
import { parseEventSequence, parseEventsQuery, validateNotificationPreferences } from './panel-events.validation';

interface PreferencesRow {
    browser_enabled: boolean;
    push_enabled: boolean;
    event_types: PanelEventType[];
}

@Injectable()
export class PanelEventsService {
    constructor(private readonly db: PrismaService) {}

    private validate<T>(action: () => T): T {
        try { return action(); }
        catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'Некорректные параметры'); }
    }

    private async stats(tx: Prisma.TransactionClient, adminUuid: string) {
        const rows = await tx.$queryRaw<{ unread_count: bigint; latest_sequence: bigint }[]>`
            SELECT count(*) FILTER (WHERE r.event_id IS NULL) AS unread_count,
                coalesce(max(e.sequence),0) AS latest_sequence
            FROM panel_events e LEFT JOIN panel_event_reads r
                ON r.event_id=e.id AND r.admin_uuid=${adminUuid}::uuid`;
        return {
            unreadCount: Number(rows[0].unread_count),
            latestSequence: rows[0].latest_sequence.toString(),
        };
    }

    async summary(adminUuid: string) {
        const response = await this.db.$transaction(async tx => {
            // This is a short read barrier, not a global serialization of writers.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PANEL_EVENT_FEED_LOCK}::bigint)`;
            return this.stats(tx, adminUuid);
        });
        return { response };
    }

    async list(adminUuid: string, query: Record<string, unknown>) {
        const input = this.validate(() => parseEventsQuery(query));
        const filters: Prisma.Sql[] = [];
        if (input.before !== null) filters.push(Prisma.sql`e.sequence < ${input.before}`);
        if (input.after !== null) filters.push(Prisma.sql`e.sequence > ${input.after}`);
        if (input.type) filters.push(Prisma.sql`e.type=${input.type}`);
        if (input.severity) filters.push(Prisma.sql`e.severity=${input.severity}`);
        if (input.unread) filters.push(Prisma.sql`r.event_id IS NULL`);
        const where = filters.length ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}` : Prisma.empty;
        const direction = input.after !== null ? Prisma.sql`ASC` : Prisma.sql`DESC`;
        const response = await this.db.$transaction(async tx => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PANEL_EVENT_FEED_LOCK}::bigint)`;
            const rows = await tx.$queryRaw<PanelEventRow[]>(Prisma.sql`
                SELECT e.*,r.event_id IS NOT NULL AS is_read
                FROM panel_events e LEFT JOIN panel_event_reads r
                    ON r.event_id=e.id AND r.admin_uuid=${adminUuid}::uuid
                ${where} ORDER BY e.sequence ${direction} LIMIT ${input.limit + 1}`);
            const items = rows.slice(0, input.limit).map(row => ({
                id: row.id,
                sequence: row.sequence.toString(),
                type: row.type,
                severity: row.severity,
                title: row.title,
                message: row.message,
                nodeUuid: row.node_uuid,
                nodeName: row.node_name,
                data: row.data,
                occurredAt: row.occurred_at,
                createdAt: row.created_at,
                isRead: row.is_read,
            }));
            return {
                items,
                ...await this.stats(tx, adminUuid),
                nextCursor: rows.length > input.limit ? items[items.length - 1].sequence : null,
            };
        });
        return { response };
    }

    async markRead(adminUuid: string, input: unknown) {
        const through = this.validate(() => parseEventSequence(
            input && typeof input === 'object' && !Array.isArray(input)
                ? (input as Record<string, unknown>).throughSequence : undefined,
        ));
        const response = await this.db.$transaction(async tx => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PANEL_EVENT_FEED_LOCK}::bigint)`;
            const rows = await tx.$queryRaw<{ cutoff: bigint }[]>`
                SELECT least(${through}::bigint,coalesce(max(sequence),0)) AS cutoff FROM panel_events`;
            const cutoff = rows[0].cutoff;
            await tx.$executeRaw`
                INSERT INTO panel_event_reads(admin_uuid,event_id)
                    SELECT ${adminUuid}::uuid,id FROM panel_events WHERE sequence<=${cutoff}
                ON CONFLICT DO NOTHING`;
            const states = await tx.$queryRaw<{ last_seen_sequence: bigint }[]>`
                INSERT INTO panel_event_read_state(admin_uuid,last_seen_sequence)
                VALUES(${adminUuid}::uuid,${cutoff})
                ON CONFLICT(admin_uuid) DO UPDATE SET
                    last_seen_sequence=greatest(panel_event_read_state.last_seen_sequence,excluded.last_seen_sequence),
                    updated_at=now()
                RETURNING last_seen_sequence`;
            return { ...await this.stats(tx, adminUuid), lastSeenSequence: states[0].last_seen_sequence.toString() };
        });
        return { response };
    }

    async preferences(adminUuid: string) {
        const rows = await this.db.$queryRaw<PreferencesRow[]>`
            SELECT browser_enabled,push_enabled,event_types FROM panel_notification_preferences
            WHERE admin_uuid=${adminUuid}::uuid`;
        const row = rows[0];
        return {
            response: {
                adminUuid,
                browserEnabled: row?.browser_enabled ?? false,
                pushEnabled: row?.push_enabled ?? false,
                eventTypes: row?.event_types ?? [...PANEL_EVENT_TYPES],
            },
        };
    }

    async setPreferences(adminUuid: string, body: unknown) {
        const input = this.validate(() => validateNotificationPreferences(body));
        await this.db.$executeRaw`
            INSERT INTO panel_notification_preferences(admin_uuid,browser_enabled,push_enabled,push_enabled_at,event_types)
            VALUES(${adminUuid}::uuid,${input.browserEnabled},${input.pushEnabled},
                CASE WHEN ${input.pushEnabled} THEN clock_timestamp() ELSE NULL END,${input.eventTypes}::text[])
            ON CONFLICT(admin_uuid) DO UPDATE SET
                browser_enabled=excluded.browser_enabled,
                push_enabled_at=CASE WHEN NOT excluded.push_enabled THEN NULL
                    WHEN NOT panel_notification_preferences.push_enabled THEN clock_timestamp()
                    ELSE panel_notification_preferences.push_enabled_at END,
                push_enabled=excluded.push_enabled,event_types=excluded.event_types,updated_at=now()`;
        return this.preferences(adminUuid);
    }
}
