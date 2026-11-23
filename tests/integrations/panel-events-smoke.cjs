'use strict';

// Runs only against the disposable PostgreSQL created by database-smoke.sh.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { appRequire, createSourceLoader } = require('./source-loader.cjs');

assert.equal(process.env.REMNADROP_SMOKE_TEST, '1', 'Run via database-smoke.sh');
const databaseUrl = new URL(process.env.DATABASE_URL);
assert.equal(databaseUrl.pathname, '/remnadrop_smoke');
assert.match(databaseUrl.hostname, /^remnadrop-smoke-[a-z0-9-]+-db$/);

const { PrismaClient } = appRequire('@prisma/client');
const db = new PrismaClient();
const load = createSourceLoader({
  '@common/database/prisma.service': { PrismaService: class {} },
  '@common/config/app-config': { TypedConfigService: class {} },
  '@common/config/common-config': { NotificationsConfigService: class {} },
  '@queue/notifications/webhook-logger/webhook-logger.service': { WebhookLoggerQueueService: class {} },
  '@queue/notifications/webhook-logger/enums': { WebhookLoggerJobNames: { sendWebhook: 'sendWebhook' } },
});
const { PanelEventsService } = load('src/modules/panel-events/panel-events.service.ts');
const { SslCertificatesService } = load('src/modules/panel-events/ssl-certificates.service.ts');
const { PanelEventsJobsService } = load('src/modules/panel-events/panel-events-jobs.service.ts');
const events = new PanelEventsService(db);
const ssl = new SslCertificatesService(db);
const fixture = randomUUID();
const nodeUuid = randomUUID();
const adminA = randomUUID();
const adminB = randomUUID();
const execution = randomUUID();
const provider = randomUUID();
const billing = randomUUID();
let certificateId;
let failEnqueue = true;
const queued = [];
const config = { get: key => ({ WEBHOOK_ENABLED: true, WEBHOOK_SECRET_HEADER: 'smoke-secret',
  WEBHOOK_URL: 'https://webhook.example.invalid/events' })[key] };
const jobs = new PanelEventsJobsService(db, { queue: { addBulk: async batch => {
  if (failEnqueue) throw new Error('Synthetic queue outage');
  queued.push(...batch);
} } }, config, { isEnabled: () => true });

async function append(client, suffix) {
  return client.$queryRaw`SELECT panel_append_event('automation.triggered','info','Test','Test',
    ${nodeUuid}::uuid,'Smoke node',${`smoke:${fixture}:${suffix}`},'{}'::jsonb,clock_timestamp()) AS id`;
}

async function fixtureEvents() {
  return db.$queryRaw`SELECT * FROM panel_events WHERE node_uuid=${nodeUuid}::uuid ORDER BY sequence`;
}

async function main() {
  for (const [uuid, suffix] of [[adminA, 'a'], [adminB, 'b']]) {
    await db.admin.create({ data: { uuid, username: `events-smoke-${fixture}-${suffix}`, passwordHash: 'fixture-only', role: 'ADMIN' } });
  }
  await db.nodes.create({ data: { uuid: nodeUuid, name: `Events fixture ${fixture}`, address: `events-${fixture}.invalid`,
    port: 2222, isConnected: true } });
  assert.equal((await fixtureEvents()).length, 0, 'Installing/creating a node must not manufacture an outage');
  await db.nodes.update({ where: { uuid: nodeUuid }, data: { isConnected: false } });
  await db.nodes.update({ where: { uuid: nodeUuid }, data: { isConnected: false } });
  await db.nodes.update({ where: { uuid: nodeUuid }, data: { isConnected: true } });
  await db.nodes.update({ where: { uuid: nodeUuid }, data: { isDisabled: true, isConnected: false } });
  assert.deepEqual((await fixtureEvents()).map(row => row.type), ['node.connection_lost', 'node.connection_restored']);
  await assert.rejects(db.$transaction(async tx => {
    await append(tx, 'rollback');
    throw new Error('roll back source operation');
  }), /roll back source operation/);
  assert.equal((await fixtureEvents()).length, 2, 'A rolled-back source operation must not leave an event');

  await db.$executeRaw`INSERT INTO node_automation_executions(id,rule_id,rule_name,node_uuid,source)
    VALUES(${execution}::uuid,NULL,'Smoke automation',${nodeUuid}::uuid,'automatic')`;
  await db.$executeRaw`UPDATE node_automation_executions SET status='waiting_dpi' WHERE id=${execution}::uuid`;
  await db.$executeRaw`UPDATE node_automation_executions SET status='partial_failure',finished_at=now() WHERE id=${execution}::uuid`;
  await db.$executeRaw`UPDATE node_automation_executions SET status='partial_failure' WHERE id=${execution}::uuid`;
  let rows = await fixtureEvents();
  assert.equal(rows.filter(row => row.type === 'automation.triggered').length, 1);
  assert.equal(rows.filter(row => row.type === 'automation.failed').length, 1);
  for (const [metric, active, value] of [['cpu', true, 95], ['cpu', false, 35], ['memory', true, 97], ['unknown', true, 1]]) {
    await db.$executeRaw`INSERT INTO node_metric_alert_events(node_uuid,metric,active,value,threshold)
      VALUES(${nodeUuid}::uuid,${metric},${active},${value},90)`;
  }
  rows = await fixtureEvents();
  assert.deepEqual(rows.filter(row => row.source_key.startsWith('metric:')).map(row => row.type),
    ['node.cpu_high', 'node.cpu_recovered', 'node.memory_high']);
  console.log('PASS durable node transitions, intentional disable, transaction rollback, automation and metric triggers');

  const input = { name: 'Smoke TLS', domains: ['example.invalid'], nodeUuids: [nodeUuid],
    expiresAt: new Date(Date.now() + 3 * 86400000 - 1000).toISOString(), reminderDays: [3, 2, 1], enabled: true };
  certificateId = (await ssl.save(adminA, input)).response.id;
  await Promise.all([jobs.createSslEvents(), jobs.createSslEvents()]);
  await jobs.createSslEvents();
  let sslEvents = await db.$queryRaw`SELECT * FROM panel_events WHERE data->>'certificateId'=${certificateId} ORDER BY sequence`;
  assert.deepEqual(sslEvents.map(row => row.data.reminderDaysBefore), [3]);
  // Move the simulated clock windows while keeping the same renewal revision.
  for (const days of [2, 1, 0]) {
    await db.$executeRaw`UPDATE ssl_certificates SET expires_at=now()+${days}::int*interval '1 day'-interval '1 second'
      WHERE id=${certificateId}::uuid`;
    await jobs.createSslEvents();
    await jobs.createSslEvents();
  }
  sslEvents = await db.$queryRaw`SELECT * FROM panel_events WHERE data->>'certificateId'=${certificateId} ORDER BY sequence`;
  assert.deepEqual(sslEvents.map(row => row.data.reminderDaysBefore), [3, 2, 1, 0]);
  assert.equal(sslEvents.at(-1).type, 'ssl.expired');
  const renewed = { ...input, expiresAt: new Date(Date.now() + 86400000 - 1000).toISOString() };
  await ssl.save(adminA, renewed, certificateId);
  await jobs.createSslEvents();
  await ssl.save(adminA, { ...renewed, name: 'Renamed certificate' }, certificateId);
  await jobs.createSslEvents();
  sslEvents = await db.$queryRaw`SELECT * FROM panel_events WHERE data->>'certificateId'=${certificateId} ORDER BY sequence`;
  assert.equal(sslEvents.length, 5, 'Renewal re-arms reminders; editing a label must not');
  assert.equal(sslEvents.at(-1).data.expiryRevision, 2);
  await ssl.save(adminA, { ...renewed, enabled: false, expiresAt: new Date(Date.now() - 1000).toISOString() }, certificateId);
  await jobs.createSslEvents();
  assert.equal((await db.$queryRaw`SELECT id FROM panel_events WHERE data->>'certificateId'=${certificateId}`).length, 5);
  const listed = (await ssl.list()).response.items.find(item => item.id === certificateId);
  assert.equal(listed.status, 'disabled');
  assert.deepEqual(listed.nodeUuids, [nodeUuid]);

  await jobs.deliverSslWebhooks();
  assert.equal(queued.length, 0, 'Queue outage must not lose the DB outbox');
  await db.$executeRaw`UPDATE panel_event_webhooks SET next_attempt_at=now() WHERE event_id IN
    (SELECT id FROM panel_events WHERE data->>'certificateId'=${certificateId})`;
  failEnqueue = false;
  await jobs.deliverSslWebhooks();
  await jobs.deliverSslWebhooks();
  assert.equal(queued.length, 5);
  assert.equal(new Set(queued.map(job => job.opts.jobId)).size, 5);
  assert(queued.every(job => JSON.parse(job.data.payload).scope === 'ssl'));
  console.log('PASS SSL 3/2/1/expiry dedupe, concurrent schedulers, renewal, disabled registry and durable webhook handoff');

  await db.infraProviders.create({ data: { uuid: provider, name: `Events provider ${fixture}` } });
  const billingAt = new Date();
  billingAt.setUTCDate(billingAt.getUTCDate() + 2);
  billingAt.setUTCHours(12, 0, 0, 0);
  await db.infraBillingNodes.create({ data: { uuid: billing, providerUuid: provider, nodeUuid, nextBillingAt: billingAt } });
  await jobs.createBillingEvents();
  await jobs.createBillingEvents();
  const billingEvents = await db.$queryRaw`SELECT * FROM panel_events WHERE data->>'billingNodeUuid'=${billing}`;
  assert.equal(billingEvents.length, 1);
  assert.equal(billingEvents[0].data.daysRemaining, 2);

  const defaults = (await events.preferences(adminA)).response;
  assert.equal(defaults.browserEnabled, false);
  assert.equal(defaults.pushEnabled, false);
  assert.equal(defaults.eventTypes.length, 15);
  await events.setPreferences(adminA, { browserEnabled: true, pushEnabled: true, eventTypes: ['ssl.expiring'] });
  await db.$executeRaw`UPDATE panel_notification_preferences SET push_enabled_at='2020-01-01' WHERE admin_uuid=${adminA}::uuid`;
  await events.setPreferences(adminA, { browserEnabled: true, pushEnabled: true, eventTypes: ['ssl.expiring', 'ssl.expired'] });
  let preferences = await db.$queryRaw`SELECT push_enabled_at FROM panel_notification_preferences WHERE admin_uuid=${adminA}::uuid`;
  assert.equal(preferences[0].push_enabled_at.getUTCFullYear(), 2020, 'Editing types must not reset push start time');
  await events.setPreferences(adminA, { browserEnabled: false, pushEnabled: false, eventTypes: [] });
  preferences = await db.$queryRaw`SELECT push_enabled_at FROM panel_notification_preferences WHERE admin_uuid=${adminA}::uuid`;
  assert.equal(preferences[0].push_enabled_at, null);
  assert.equal((await events.preferences(adminB)).response.browserEnabled, false, 'Preferences are per administrator');

  const captured = (await events.summary(adminA)).response;
  await append(db, 'arrived-after-click');
  const read = (await events.markRead(adminA, { throughSequence: captured.latestSequence })).response;
  assert.equal(read.unreadCount, 1, 'An event arriving after the click must remain unread');
  assert((await events.summary(adminB)).response.unreadCount > 1, 'Marking read must not affect other administrators');
  const oldRead = (await events.markRead(adminA, { throughSequence: '0' })).response;
  assert.equal(oldRead.lastSeenSequence, read.lastSeenSequence, 'Read watermark must be monotonic');
  const unread = (await events.list(adminA, { unread: 'true' })).response.items;
  assert.equal(unread.length, 1);
  assert.equal(unread[0].isRead, false);
  console.log('PASS payment reminder dedupe, notification opt-in, per-admin preferences and snapshot read semantics');

  // The second writer can commit while the first holds its shared feed lock.
  // A reader must wait for the first, or polling would permanently skip its sequence.
  const baseline = (await events.summary(adminA)).response.latestSequence;
  let releaseSlow;
  const release = new Promise(resolve => { releaseSlow = resolve; });
  let allocated;
  const allocation = new Promise(resolve => { allocated = resolve; });
  const slow = db.$transaction(async tx => {
    await append(tx, 'slow-low-sequence');
    allocated();
    await release;
  }, { timeout: 10000 });
  await allocation;
  await append(db, 'fast-high-sequence');
  let readerFinished = false;
  const reading = events.list(adminA, { after: baseline, limit: '1' }).then(result => {
    readerFinished = true;
    return result;
  });
  try {
    await delay(100);
    assert.equal(readerFinished, false, 'Feed captured an unsafe watermark before earlier writer committed');
  } finally { releaseSlow(); }
  await slow;
  const first = (await reading).response;
  assert.equal(first.items.length, 1);
  assert(first.nextCursor);
  const second = (await events.list(adminA, { after: first.nextCursor, limit: '1' })).response;
  assert.equal(second.items.length, 1);
  assert(BigInt(first.items[0].sequence) < BigInt(second.items[0].sequence));
  assert.equal(first.items[0].title, 'Test');
  assert.equal(second.nextCursor, null);
  assert.equal(first.latestSequence, second.items[0].sequence);
  console.log('PASS concurrent writer/read barrier and ascending paginated browser notification feed');
}

main().finally(async () => {
  if (certificateId) await db.$executeRaw`DELETE FROM ssl_certificates WHERE id=${certificateId}::uuid`;
  await db.$executeRaw`DELETE FROM panel_events WHERE node_uuid=${nodeUuid}::uuid`;
  await db.$executeRaw`DELETE FROM node_metric_alert_events WHERE node_uuid=${nodeUuid}::uuid`;
  await db.$executeRaw`DELETE FROM node_automation_executions WHERE id=${execution}::uuid`;
  await db.infraBillingNodes.deleteMany({ where: { uuid: billing } });
  await db.infraProviders.deleteMany({ where: { uuid: provider } });
  await db.nodes.deleteMany({ where: { uuid: nodeUuid } });
  await db.admin.deleteMany({ where: { uuid: { in: [adminA, adminB] } } });
  await db.$disconnect();
}).catch(error => { console.error(error); process.exitCode = 1; });
