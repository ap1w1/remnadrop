import {
    PANEL_EVENT_SEVERITIES,
    PANEL_EVENT_TYPES,
    PanelEventSeverity,
    PanelEventType,
    PanelNotificationPreferences,
    UUID_PATTERN,
} from './panel-events.constants';

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Ожидается объект с настройками');
    }
    return value as Record<string, unknown>;
}

export function parseEventSequence(value: unknown): bigint {
    if (typeof value !== 'string' || !/^(0|[1-9]\d{0,18})$/.test(value)) {
        throw new Error('Некорректный курсор событий');
    }
    const result = BigInt(value);
    if (result > 9223372036854775807n) throw new Error('Некорректный курсор событий');
    return result;
}

export function parseEventsQuery(query: Record<string, unknown>) {
    if (query.limit !== undefined && typeof query.limit !== 'string' && typeof query.limit !== 'number') {
        throw new Error('Некорректный размер страницы');
    }
    const limit = query.limit === undefined ? 50 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new Error('Размер страницы должен быть от 1 до 100');
    }
    if (query.before !== undefined && query.after !== undefined) {
        throw new Error('Укажите только один курсор: before или after');
    }
    const before = query.before === undefined ? null : parseEventSequence(query.before);
    const after = query.after === undefined ? null : parseEventSequence(query.after);
    if (query.type !== undefined && !PANEL_EVENT_TYPES.includes(query.type as PanelEventType)) {
        throw new Error('Неизвестный тип события');
    }
    if (query.severity !== undefined && !PANEL_EVENT_SEVERITIES.includes(query.severity as PanelEventSeverity)) {
        throw new Error('Неизвестная важность события');
    }
    if (query.unread !== undefined && query.unread !== 'true' && query.unread !== 'false') {
        throw new Error('Параметр unread должен быть true или false');
    }
    return {
        limit, before, after,
        type: query.type as PanelEventType | undefined,
        severity: query.severity as PanelEventSeverity | undefined,
        unread: query.unread === 'true',
    };
}

export function validateNotificationPreferences(value: unknown): PanelNotificationPreferences {
    const input = object(value);
    if (typeof input.browserEnabled !== 'boolean' || typeof input.pushEnabled !== 'boolean') {
        throw new Error('Укажите, включены ли уведомления в браузере и push-уведомления');
    }
    if (!Array.isArray(input.eventTypes) || input.eventTypes.length > PANEL_EVENT_TYPES.length
        || input.eventTypes.some(type => typeof type !== 'string' || !PANEL_EVENT_TYPES.includes(type as PanelEventType))) {
        throw new Error('Выберите допустимые типы уведомлений');
    }
    return {
        browserEnabled: input.browserEnabled,
        pushEnabled: input.pushEnabled,
        eventTypes: [...new Set(input.eventTypes)] as PanelEventType[],
    };
}

export interface SslCertificateInput {
    name: string;
    domains: string[];
    nodeUuids: string[];
    expiresAt: Date;
    reminderDays: number[];
    enabled: boolean;
}

export function validateSslCertificate(value: unknown): SslCertificateInput {
    const input = object(value);
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 120 || /[\x00-\x1f]/.test(name)) {
        throw new Error('Название сертификата должно содержать от 1 до 120 символов');
    }
    if (!Array.isArray(input.nodeUuids) || !input.nodeUuids.length || input.nodeUuids.length > 100
        || input.nodeUuids.some(id => typeof id !== 'string' || !UUID_PATTERN.test(id))) {
        throw new Error('Выберите от 1 до 100 нод');
    }
    const domains = input.domains === undefined ? [] : input.domains;
    if (!Array.isArray(domains) || domains.length > 100 || domains.some(domain =>
        typeof domain !== 'string' || !domain.trim() || domain.length > 253 || /[\s\x00-\x1f/\\:@?#]/.test(domain.trim()))) {
        throw new Error('Укажите домены сертификата без протокола, порта и пути');
    }
    const dateParts = typeof input.expiresAt === 'string'
        ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(input.expiresAt)
        : null;
    if (!dateParts) {
        throw new Error('Укажите дату и время истечения сертификата с часовым поясом');
    }
    const [year, month, day, hour, minute, second] = dateParts.slice(1).map(part => Number(part ?? 0));
    if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()
        || hour > 23 || minute > 59 || second > 59) {
        throw new Error('Некорректная дата истечения сертификата');
    }
    const expiresAt = new Date(input.expiresAt as string);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getUTCFullYear() < 1970 || expiresAt.getUTCFullYear() > 2200) {
        throw new Error('Некорректная дата истечения сертификата');
    }
    const days = input.reminderDays === undefined ? [3, 2, 1] : input.reminderDays;
    if (!Array.isArray(days) || days.length > 20
        || days.some(day => typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > 365)) {
        throw new Error('Дни напоминаний: не более 20 целых чисел от 1 до 365');
    }
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
        throw new Error('Параметр enabled должен быть true или false');
    }
    return {
        name,
        domains: [...new Set((domains as string[]).map(domain => domain.trim().toLowerCase()))],
        nodeUuids: [...new Set((input.nodeUuids as string[]).map(id => id.toLowerCase()))],
        expiresAt,
        reminderDays: [...new Set(days as number[])].sort((a, b) => b - a),
        enabled: input.enabled !== false,
    };
}

export function certificateExpiry(expiresAt: Date, reminderDays: number[], enabled: boolean, now = new Date()) {
    const daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / 86400000);
    const status = !enabled ? 'disabled' : expiresAt <= now ? 'expired'
        : daysRemaining <= Math.max(0, ...reminderDays) ? 'expiring' : 'valid';
    return { daysRemaining, status };
}

/** Only the currently applicable reminder is sent after an outage, never a burst of stale lead days. */
export function sslReminderDay(expiresAt: Date, reminderDays: number[], now = new Date()): number | null {
    if (expiresAt <= now) return 0;
    const days = Math.ceil((expiresAt.getTime() - now.getTime()) / 86400000);
    return reminderDays.includes(days) ? days : null;
}
