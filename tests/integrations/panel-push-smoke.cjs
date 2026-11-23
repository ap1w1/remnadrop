'use strict';
// Only the transport is faked: ownership, encryption, leases and retries use
// the migrated disposable PostgreSQL database, never a live browser endpoint.
const assert = require('node:assert/strict');
const { randomUUID, randomBytes, createECDH } = require('node:crypto');
const { appRequire, createSourceLoader } = require('./source-loader.cjs');
assert.equal(process.env.REMNADROP_SMOKE_TEST, '1', 'Run via database-smoke.sh');
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.pathname, '/remnadrop_smoke');
assert.match(url.hostname, /^remnadrop-smoke-[a-z0-9-]+-db$/);
const db = new (appRequire('@prisma/client').PrismaClient)();
const id = randomUUID(), adminA = randomUUID(), adminB = randomUUID();
const sent = [];
let failStatus = null;
const load = createSourceLoader({
    '@common/database/prisma.service': { PrismaService: class {} },
    './panel-push.transport': { deliverWebPush: async (subscription, payload) => {
        if (failStatus) throw Object.assign(new Error('synthetic provider failure'), { statusCode: failStatus });
        sent.push({ endpoint: subscription.endpoint, payload });
    } },
});
const { PanelPushService } = load('src/modules/panel-push/panel-push.service.ts');
const { PanelEventsService } = load('src/modules/panel-events/panel-events.service.ts');
const push = new PanelPushService(db), events = new PanelEventsService(db);
const receiver = createECDH('prime256v1'); receiver.generateKeys();
const subscription = { endpoint: `https://fcm.googleapis.com/fcm/send/smoke-${id}`, expirationTime: null,
    keys: { p256dh: receiver.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
async function append(suffix, type = 'ssl.expiring') {
    return (await db.$queryRaw`SELECT panel_append_event(${type},'warning','Smoke SSL','Synthetic reminder',NULL,NULL,
        ${`push-smoke:${id}:${suffix}`},'{}'::jsonb,clock_timestamp()) AS id`)[0].id;
}
async function preferences(admin, enabled) {
    await events.setPreferences(admin, { browserEnabled: false, pushEnabled: enabled, eventTypes: ['ssl.expiring'] });
}
async function main() {
    for (const [uuid, name] of [[adminA,'a'],[adminB,'b']]) await db.admin.create({ data: {
        uuid, username: `push-smoke-${id}-${name}`, passwordHash: 'fixture-only', role: 'ADMIN',
    } });
    await append('before-subscription');
    const config = (await push.config('https://panel.example.invalid/settings')).response;
    assert.equal(config.enabled, true); assert.match(config.publicKey, /^[A-Za-z0-9_-]{87}$/);
    assert.equal((await push.config()).response.publicKey, config.publicKey, 'VAPID public key must survive repeated initialization');
    assert(!JSON.stringify(config).includes('private'));
    await push.subscribe(adminA, subscription);
    await preferences(adminA, true);
    const relevant = await append('first');
    await append('filtered-type', 'node.cpu_high');
    await push.enqueue(); await push.enqueue();
    let jobs = await db.$queryRaw`SELECT d.* FROM panel_push_deliveries d JOIN panel_push_subscriptions s ON s.id=d.subscription_id WHERE s.admin_uuid=${adminA}::uuid`;
    assert.equal(jobs.length, 1); assert.equal(jobs[0].event_id, relevant);
    const [encrypted] = await db.$queryRaw`SELECT * FROM panel_push_subscriptions WHERE admin_uuid=${adminA}::uuid`;
    assert(!Buffer.from(encrypted.ciphertext).includes(Buffer.from(subscription.endpoint)));
    await push.unsubscribe(adminB, { endpoint: subscription.endpoint });
    assert.equal((await db.$queryRaw`SELECT id FROM panel_push_subscriptions WHERE admin_uuid=${adminA}::uuid`).length, 1, 'Another administrator cannot remove a device');
    await Promise.all([push.deliver(), new PanelPushService(db).deliver()]);
    await push.deliver();
    assert.equal(sent.length, 1, 'Concurrent scheduler leases must claim a delivery once');
    assert.equal(sent[0].payload.id, relevant); assert.equal(sent[0].payload.adminUuid, adminA);
    assert.equal(sent[0].payload.url, '/dashboard/events');
    console.log('PASS stable encrypted VAPID/subscriptions, administrator ownership, event selection, no history replay and concurrent delivery claims');

    const pending = await append('old-owner'); await push.enqueue();
    await push.subscribe(adminB, subscription);
    assert.equal((await db.$queryRaw`SELECT id FROM panel_push_subscriptions WHERE admin_uuid=${adminA}::uuid`).length, 0);
    assert.equal((await db.$queryRaw`SELECT id FROM panel_push_deliveries WHERE event_id=${pending}::uuid`).length, 0, 'Account switch must discard previous owner pending payloads');
    await preferences(adminB, true);
    const retryId = await append('retry'); await push.enqueue();
    failStatus = 503; await push.deliver();
    const [retry] = await db.$queryRaw`SELECT * FROM panel_push_deliveries WHERE event_id=${retryId}::uuid`;
    assert.equal(retry.status, 'pending'); assert.equal(retry.attempts, 1);
    assert.equal(retry.last_error, 'HTTP_503'); assert.equal(sent.length, 1);
    await db.$executeRaw`UPDATE panel_push_deliveries SET next_attempt_at=now() WHERE id=${retry.id}::uuid`;
    failStatus = null; await push.deliver();
    assert.equal(sent.length, 2); assert.equal(sent[1].payload.adminUuid, adminB);
    assert.equal((await db.$queryRaw`SELECT status FROM panel_push_deliveries WHERE id=${retry.id}::uuid`)[0].status, 'sent');

    await append('disabled-before-send'); await push.enqueue();
    await preferences(adminB, false); await push.deliver();
    assert.equal(sent.length, 2, 'Disabling notifications cancels already queued messages');
    await preferences(adminB, true); await push.enqueue(); await push.deliver();
    assert.equal(sent.length, 2, 'Re-enabling must not replay old disabled messages');
    await append('gone-device'); await push.enqueue(); failStatus = 410; await push.deliver();
    assert.equal((await db.$queryRaw`SELECT id FROM panel_push_subscriptions WHERE admin_uuid=${adminB}::uuid`).length, 0);
    console.log('PASS account switching, transient retry, disable/re-enable behavior and expired subscription cleanup');
}
(async () => {
    try { await main(); }
    finally {
        await db.admin.deleteMany({ where: { uuid: { in: [adminA,adminB] } } });
        await db.$executeRaw`DELETE FROM panel_events WHERE source_key LIKE ${`push-smoke:${id}:%`}`;
        await db.$disconnect();
    }
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
