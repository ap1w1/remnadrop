const { test } = require('node:test');
const assert = require('node:assert/strict');
const { forkWebhookEnvelope } = require('../dist/src/modules/squad-quotas/fork-webhook-envelope');

test('fork webhook names and envelopes match the documented format', () => {
    const names = {
        LOCATION_TRAFFIC_THRESHOLD: 'node_quota.threshold',
        LOCATION_TRAFFIC_EXHAUSTED: 'node_quota.exhausted',
        LOCATION_TRAFFIC_RESET: 'node_quota.reset',
        NODE_METRIC_THRESHOLD: 'node_metric.threshold',
        NODE_METRIC_RECOVERED: 'node_metric.recovered',
        NODE_AUTOMATION_TRIGGERED: 'node_automation.triggered',
        CLOUDFLARE_DNS_IP_UPDATED: 'cloudflare_dns.ip_updated',
    };
    for (const [legacyEvent, event] of Object.entries(names)) {
        assert.deepEqual(forkWebhookEnvelope('event-id', legacyEvent, new Date('2026-11-25T10:00:00Z'), { value: 1 }), {
            id: 'event-id',
            scope: event.split('.')[0],
            event,
            timestamp: '2026-11-25T10:00:00.000Z',
            data: { value: 1 },
            meta: { legacyEvent },
        });
    }
    assert.deepEqual(forkWebhookEnvelope('42', 'ssl.expiring', '2026-11-25T10:00:00Z', { domain: 'example.com' }), {
        id: '42', scope: 'ssl', event: 'ssl.expiring', timestamp: '2026-11-25T10:00:00.000Z', data: { domain: 'example.com' },
    });
});
