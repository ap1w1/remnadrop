const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSourceLoader } = require('../../tests/integrations/source-loader.cjs');
const load = createSourceLoader({
    '@common/config/app-config': { TypedConfigService: class {} },
    '@common/config/common-config': { NotificationsConfigService: class {} },
    '@queue/notifications/webhook-logger/webhook-logger.service': { WebhookLoggerQueueService: class {} },
});
const { ForkWebhooksService } = load('src/modules/squad-quotas/fork-webhooks.service.ts');

test('fork events use the configured Remnawave destinations and queue', async () => {
    const settings = { WEBHOOK_ENABLED: true, WEBHOOK_URL: 'https://one.example/hook, https://two.example/hook' };
    const calls = [];
    const service = new ForkWebhooksService(
        { get: key => settings[key] },
        { isEnabled: () => true },
        { sendWebhooks: async (...args) => { calls.push(args); } },
    );
    assert.equal(await service.enqueue('event-id', 'LOCATION_TRAFFIC_THRESHOLD', '2026-11-25T10:00:00Z', { usedBytes: '100' }), true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0][1], ['https://one.example/hook', 'https://two.example/hook']);
    const payload = JSON.parse(calls[0][0].payload);
    assert.deepEqual(payload, {
        id: 'event-id', scope: 'node_quota', event: 'node_quota.threshold',
        timestamp: '2026-11-25T10:00:00.000Z', data: { usedBytes: '100' },
        meta: { legacyEvent: 'LOCATION_TRAFFIC_THRESHOLD' },
    });
    assert.equal(calls[0][0].timestamp, payload.timestamp);
    settings.WEBHOOK_ENABLED = false;
    assert.equal(await service.enqueue('second-id', 'LOCATION_TRAFFIC_RESET', new Date(), {}), false);
    assert.equal(calls.length, 1);
});
