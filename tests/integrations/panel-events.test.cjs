const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createSourceLoader } = require('./source-loader.cjs');
const load = createSourceLoader();
const { PANEL_EVENT_TYPES } = load('src/modules/panel-events/panel-events.constants.ts');
const {
  parseEventSequence, parseEventsQuery, validateNotificationPreferences,
  validateSslCertificate, certificateExpiry, sslReminderDay,
} = load('src/modules/panel-events/panel-events.validation.ts');

test('event cursors preserve bigint precision and reject unsafe or conflicting inputs', () => {
  assert.equal(parseEventSequence('9007199254740993'), 9007199254740993n);
  assert.equal(parseEventSequence('9223372036854775807'), 9223372036854775807n);
  for (const value of [9007199254740993, '-1', '1.2', '01', '9223372036854775808', null]) {
    assert.throws(() => parseEventSequence(value));
  }
  assert.throws(() => parseEventsQuery({ before: '2', after: '1' }));
  for (const query of [{ limit: '101' }, { limit: ['5'] }, { type: 'unknown' }, { severity: 'fatal' }, { unread: 'yes' }]) {
    assert.throws(() => parseEventsQuery(query));
  }
  assert.equal(parseEventsQuery({ after: '0', limit: '2', unread: 'true' }).after, 0n);
});

test('notification settings accept only known event types and allow opting out of all types', () => {
  const settings = validateNotificationPreferences({ browserEnabled: true, pushEnabled: false,
    eventTypes: ['node.connection_lost', 'node.connection_lost', 'ssl.expiring'] });
  assert.deepEqual(settings.eventTypes, ['node.connection_lost', 'ssl.expiring']);
  assert.deepEqual(validateNotificationPreferences({ browserEnabled: false, pushEnabled: false, eventTypes: [] }).eventTypes, []);
  assert.throws(() => validateNotificationPreferences({ browserEnabled: 'true', pushEnabled: false, eventTypes: [] }));
  assert.throws(() => validateNotificationPreferences({ browserEnabled: true, pushEnabled: true, eventTypes: ['user.password'] }));
  assert.equal(PANEL_EVENT_TYPES.length, 15);
});

const node = 'b75d075f-f5c3-422e-b12d-234fd1ae3d83';
const certificate = {
  name: 'Production TLS', domains: ['EXAMPLE.COM', '*.example.com'], nodeUuids: [node],
  expiresAt: '2026-11-26T15:00:00+03:00', reminderDays: [1, 3, 2, 3], enabled: true,
};

test('SSL registry normalizes shared-node certificates and explicit reminder days', () => {
  const value = validateSslCertificate({ ...certificate, nodeUuids: [node, node.toUpperCase()] });
  assert.deepEqual(value.domains, ['example.com', '*.example.com']);
  assert.deepEqual(value.nodeUuids, [node]);
  assert.deepEqual(value.reminderDays, [3, 2, 1]);
  assert.equal(value.expiresAt.toISOString(), '2026-11-26T12:00:00.000Z');
});

test('invalid calendar dates, nodes, URLs and reminder ranges cannot reach SQL', () => {
  for (const patch of [
    { nodeUuids: [] }, { nodeUuids: ['not-a-uuid'] }, { domains: ['https://example.com'] },
    { expiresAt: '2026-02-30T12:00:00Z' }, { expiresAt: '2026-11-26' },
    { expiresAt: '2026-11-26T24:00:00Z' }, { reminderDays: [0] }, { reminderDays: [366] },
    { reminderDays: [1.5] }, { reminderDays: Array.from({ length: 21 }, (_, i) => i + 1) },
  ]) assert.throws(() => validateSslCertificate({ ...certificate, ...patch }), JSON.stringify(patch));
});

test('SSL reminders occur in distinct 3/2/1 day windows and once at expiry', () => {
  const now = new Date('2026-11-23T12:00:00.000Z');
  const at = offset => new Date(now.getTime() + offset);
  const day = 86400000;
  assert.equal(sslReminderDay(at(3 * day + 1), [3, 2, 1], now), null);
  assert.equal(sslReminderDay(at(3 * day), [3, 2, 1], now), 3);
  assert.equal(sslReminderDay(at(2 * day), [3, 2, 1], now), 2);
  assert.equal(sslReminderDay(at(day), [3, 2, 1], now), 1);
  assert.equal(sslReminderDay(at(1), [3, 2, 1], now), 1);
  assert.equal(sslReminderDay(at(0), [3, 2, 1], now), 0);
  assert.equal(sslReminderDay(at(-day), [3, 2, 1], now), 0);
  assert.equal(sslReminderDay(at(day), [7], now), null);
  assert.equal(certificateExpiry(at(day), [3], false, now).status, 'disabled');
  assert.equal(certificateExpiry(at(4 * day), [3], true, now).status, 'valid');
});

test('SSL webhook payloads validate against the existing public webhook contract', () => {
  const { RemnawaveWebhookEventSchema } = load('libs/contract/models/webhook/webhook.schema.ts');
  const payload = {
    id: node, scope: 'ssl', event: 'ssl.expiring', timestamp: '2026-11-23T12:00:00.000Z',
    data: { certificateId: node, name: 'Production TLS', domains: ['example.com'], nodeUuids: [node],
      nodes: [{ uuid: node, name: 'Node' }], expiresAt: '2026-11-26T12:00:00.000Z', reminderDaysBefore: 3,
      expiryRevision: 1, severity: 'warning', title: 'Истекает SSL-сертификат', message: 'Осталось 3 дн.' },
  };
  const parsed = RemnawaveWebhookEventSchema.parse(payload);
  assert.equal(parsed.event, 'ssl.expiring');
  assert.equal(parsed.data.expiresAt.toISOString(), payload.data.expiresAt);
  assert.equal(RemnawaveWebhookEventSchema.safeParse({ ...payload, event: 'ssl.unknown' }).success, false);
});
