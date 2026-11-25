const legacyEvents = {
    LOCATION_TRAFFIC_THRESHOLD: 'node_quota.threshold',
    LOCATION_TRAFFIC_EXHAUSTED: 'node_quota.exhausted',
    LOCATION_TRAFFIC_RESET: 'node_quota.reset',
    NODE_METRIC_THRESHOLD: 'node_metric.threshold',
    NODE_METRIC_RECOVERED: 'node_metric.recovered',
    NODE_AUTOMATION_TRIGGERED: 'node_automation.triggered',
    CLOUDFLARE_DNS_IP_UPDATED: 'cloudflare_dns.ip_updated',
} as const;

export type LegacyForkEvent = keyof typeof legacyEvents;

/** Keep the database and destination settings stable while using one public webhook shape. */
export function forkWebhookEnvelope(
    id: string,
    event: string,
    timestamp: Date | string,
    data: unknown,
) {
    const publicEvent = event in legacyEvents
        ? legacyEvents[event as keyof typeof legacyEvents]
        : event;
    return {
        id,
        scope: publicEvent.split('.')[0],
        event: publicEvent,
        timestamp: new Date(timestamp).toISOString(),
        data,
        ...(event !== publicEvent ? { meta: { legacyEvent: event } } : {}),
    };
}
