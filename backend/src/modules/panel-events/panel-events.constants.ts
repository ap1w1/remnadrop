export const PANEL_EVENT_TYPES = [
    'node.connection_lost',
    'node.connection_restored',
    'automation.triggered',
    'automation.failed',
    'billing.payment_due',
    'ssl.expiring',
    'ssl.expired',
    'node.cpu_high',
    'node.cpu_recovered',
    'node.memory_high',
    'node.memory_recovered',
    'node.online_drop',
    'node.online_recovered',
    'node.traffic_drop',
    'node.traffic_recovered',
] as const;

export type PanelEventType = (typeof PANEL_EVENT_TYPES)[number];
export const PANEL_EVENT_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type PanelEventSeverity = (typeof PANEL_EVENT_SEVERITIES)[number];

/**
 * Writers take a shared transaction lock before allocating an event sequence.
 * A feed reader briefly takes the exclusive lock to capture a committed prefix.
 * Writers do not serialize one another, and a delayed lower sequence cannot be
 * skipped by a browser polling after a previously returned high watermark.
 * Never perform network I/O inside a transaction holding this lock.
 */
export const PANEL_EVENT_FEED_LOCK = 681754210;

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PanelEventRow {
    id: string;
    sequence: bigint;
    type: PanelEventType;
    severity: PanelEventSeverity;
    title: string;
    message: string;
    node_uuid: string | null;
    node_name: string | null;
    data: Record<string, unknown>;
    occurred_at: Date;
    created_at: Date;
    is_read: boolean;
}

export interface PanelNotificationPreferences {
    browserEnabled: boolean;
    pushEnabled: boolean;
    eventTypes: PanelEventType[];
}
