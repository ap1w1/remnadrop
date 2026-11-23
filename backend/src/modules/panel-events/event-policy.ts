import { z } from 'zod';

export const EVENT_TYPES = [
    'node.offline',
    'node.online',
    'automation.triggered',
    'automation.failed',
    'billing.reminder',
    'ssl.expiring',
    'ssl.expired',
    'metric.cpu',
    'metric.memory',
    'metric.online_drop',
    'metric.traffic_drop',
] as const;
export const eventTypeSchema = z.enum(EVENT_TYPES);
export const cursorSchema = z
    .string()
    .regex(/^\d{1,19}$/)
    .refine((value) => BigInt(value) <= 9223372036854775807n);
export const preferencesSchema = z.object({
    browserEnabled: z.boolean(),
    eventTypes: z
        .array(eventTypeSchema)
        .max(EVENT_TYPES.length)
        .transform((v) => [...new Set(v)]),
});
export const certificateSchema = z.object({
    name: z.string().trim().min(1).max(120),
    domain: z
        .string()
        .trim()
        .min(1)
        .max(253)
        .regex(/^(\*\.)?(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z0-9-]{2,63}$/),
    nodeUuids: z
        .array(z.string().uuid())
        .min(1)
        .max(200)
        .transform((v) => [...new Set(v)]),
    expiresOn: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .refine((v) => {
            const date = new Date(`${v}T00:00:00Z`);
            return (
                Number.isFinite(date.getTime()) &&
                date.toISOString().slice(0, 10) === v &&
                v >= '2000-01-01' &&
                v <= '2200-12-31'
            );
        }, 'Укажите существующую дату'),
    reminderDays: z
        .array(z.number().int().min(1).max(365))
        .min(1)
        .max(30)
        .transform((v) => [...new Set(v)].sort((a, b) => b - a)),
    enabled: z.boolean(),
});

// Only browser vendor push services are accepted; no arbitrary server-side destinations.
export function validPushEndpoint(value: string): boolean {
    try {
        const url = new URL(value);
        return (
            url.protocol === 'https:' &&
            !url.username &&
            !url.password &&
            !url.hash &&
            !url.port &&
            [
                'fcm.googleapis.com',
                'updates.push.services.mozilla.com',
                'web.push.apple.com',
                'notify.windows.com',
            ].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
        );
    } catch {
        return false;
    }
}
export const subscriptionSchema = z.object({
    endpoint: z.string().max(4096).refine(validPushEndpoint, 'Неизвестный сервис Web Push'),
    keys: z.object({
        p256dh: z
            .string()
            .regex(/^[\w-]{87}=?$/)
            .refine((v) => Buffer.from(v, 'base64url')[0] === 4),
        auth: z.string().regex(/^[\w-]{22}(==)?$/),
    }),
});

/** UTC calendar days, including one expired reminder. Catch up with the closest due threshold. */
export function dueReminder(expiresOn: string, days: number[], now = new Date()): number | null {
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const remaining = Math.round((Date.parse(`${expiresOn}T00:00:00Z`) - today) / 86400000);
    const due = [...days, 0].filter((day) => remaining <= day);
    return due.length ? Math.min(...due) : null;
}
