'use strict';

const assert = require('node:assert/strict');
const { createDecipheriv, createHash, createHmac, randomBytes, randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const { setTimeout: delay } = require('node:timers/promises');

// This script is mounted into disposable containers by database-smoke.sh.
assert.equal(process.env.REMNADROP_SMOKE_TEST, '1', 'Run via database-smoke.sh');
const databaseUrl = new URL(process.env.DATABASE_URL);
assert.equal(databaseUrl.pathname, '/remnadrop_smoke');
assert.match(databaseUrl.hostname, /^remnadrop-smoke-[a-z0-9-]+-db$/);
const appRequire = createRequire('/app/package.json');
const { PrismaClient } = appRequire('@prisma/client');
const db = new PrismaClient();
const migration = '20261122000100_integrations_limiter_cloudflare';
const sentinelUuid = '6b703d9c-3a43-46a4-bda1-a85421b2c001';
const sentinelVless = '6b703d9c-3a43-46a4-bda1-a85421b2c002';
const username = 'smoke_migration_sentinel';
const trafficUsed = 123456789n;
const lifetimeUsed = 987654321n;
const headers = {
  'Content-Type': 'application/json',
  'X-Forwarded-For': '127.0.0.1',
  'X-Forwarded-Proto': 'https',
  'X-Remnawave-Client-Type': 'browser',
};

async function migrationHistory(expected) {
  const rows = await db.$queryRaw`
    SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations
    WHERE rolled_back_at IS NULL ORDER BY migration_name`;
  assert.equal(rows.length, expected, 'Unexpected number of active migrations');
  assert(rows.every(row => row.finished_at), 'Unfinished migration exists');
  assert.equal(new Set(rows.map(row => row.migration_name)).size, expected, 'Duplicate migration history');
  assert.equal(rows.some(row => row.migration_name === migration), expected === 129);
}

async function assertSentinel() {
  const user = await db.users.findUnique({ where: { uuid: sentinelUuid }, include: { traffic: true } });
  assert(user, 'Existing user was lost during upgrade');
  assert.equal(user.username, username);
  assert.equal(user.status, 'ACTIVE');
  assert.equal(user.vlessUuid, sentinelVless);
  assert.equal(user.description, 'pre-integration migration sentinel');
  assert.equal(user.expireAt.toISOString(), '2099-01-01T00:00:00.000Z');
  assert.equal(user.traffic.usedTrafficBytes, trafficUsed);
  assert.equal(user.traffic.lifetimeUsedTrafficBytes, lifetimeUsed);
}

async function prepareBaseline() {
  await migrationHistory(128);
  const [{ table_name: table }] = await db.$queryRaw`SELECT to_regclass('public.limiter_settings')::text AS table_name`;
  assert.equal(table, null, 'Integration schema must be absent before upgrade');
  await db.users.create({ data: {
    uuid: sentinelUuid, shortUuid: 'SmokeSentinel281A', username,
    status: 'ACTIVE', expireAt: new Date('2099-01-01T00:00:00.000Z'),
    trojanPassword: 'smoke-only-trojan-password', ssPassword: 'smoke-only-ss-password',
    vlessUuid: sentinelVless, description: 'pre-integration migration sentinel',
    traffic: { create: { usedTrafficBytes: trafficUsed, lifetimeUsedTrafficBytes: lifetimeUsed } },
  } });
  await assertSentinel();
  console.log('PASS baseline 128 migrations, seed and existing user/traffic fixture');
}

async function verifyUpgrade() {
  await migrationHistory(129);
  await assertSentinel();
  const rows = await db.$queryRaw`SELECT config FROM limiter_settings WHERE id=1`;
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].config.enabled, true, 'Upgrade must not enable Limiter');
  for (const table of ['limiter_credentials', 'limiter_events', 'cf_dns_credentials',
    'cf_dns_zone_bindings', 'cf_dns_events', 'cf_dns_webhook_receipts', 'cf_dns_record_host_links']) {
    const result = await db.$queryRaw`SELECT to_regclass(${`public.${table}`})::text AS table_name`;
    assert.equal(result[0].table_name, table, `Missing integration table ${table}`);
  }
  console.log('PASS 129 applied migrations, integration tables and unchanged existing user/traffic');
}

async function request(path, { method = 'GET', body, rawBody, token, expected = 200, extraHeaders = {} } = {}) {
  const response = await fetch('http://127.0.0.1:3000' + path, {
    method, redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { ...headers, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...extraHeaders },
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  assert.equal(response.status, expected, `${method} ${path}: HTTP ${response.status}, expected ${expected}`);
  const value = await response.json();
  return value;
}

async function waitForApi() {
  let last;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:3000/api/auth/status', {
        headers, signal: AbortSignal.timeout(1500), redirect: 'error',
      });
      if (response.status === 200) return;
      last = `HTTP ${response.status}`;
    } catch (error) { last = error.message; }
    await delay(1000);
  }
  throw new Error('Real API did not start: ' + last);
}

async function apiSmoke() {
  await waitForApi();
  const started = Date.now();
  await verifyUpgrade();
  const initial = (await request('/api/auth/status')).response;
  assert.equal(initial.isRegisterAllowed, true, 'Smoke database must have no existing admin');
  const admin = { username: 'smoke_admin', password: 'SmokeA1_' + randomBytes(24).toString('hex') };
  const registration = (await request('/api/auth/register', { method: 'POST', body: admin, expected: 201 })).response;
  assert.equal(typeof registration.accessToken, 'string');
  const login = (await request('/api/auth/login', { method: 'POST', body: admin })).response;
  const token = login.accessToken;
  assert.equal(typeof token, 'string');
  await request('/api/limiter/settings', { expected: 401 });
  const user = (await request('/api/users/' + sentinelUuid, { token })).response;
  assert.equal(user.uuid, sentinelUuid);
  assert.equal(user.username, username);
  console.log('PASS real admin registration/login, browser JWT authentication and existing user API');

  const settings = (await request('/api/limiter/settings', { token })).response;
  assert.equal(settings.enabled, false);
  assert.equal(settings.mode, 'manual');
  assert.equal(settings.engineVersion, '5.1.0');
  const status = (await request('/api/limiter/status', { token })).response;
  assert.equal(status.embedded, true);
  assert.equal(status.running, false);
  assert.equal(status.pid, null);
  assert.equal((await request('/api/limiter/credentials', { token })).response.configured, false);
  await request('/api/limiter/settings', { method: 'PUT', token, body: { enabled: false, checkIntervalSeconds: 90 } });
  const saved = (await request('/api/limiter/settings', { token })).response;
  assert.equal(saved.enabled, false);
  assert.equal(saved.checkIntervalSeconds, 90);

  // Synthetic credentials are stored/round-tripped only while the engine stays off.
  const fakeBotToken = '12345:' + randomBytes(24).toString('hex');
  const credentials = (await request('/api/limiter/credentials', { method: 'PUT', token, body: {
    telegramBotToken: fakeBotToken, telegramChatId: '-1001234567890', telegramAdminIds: '123456',
    maxmindLicenseKey: '', sharedHwidSquadUuids: [],
  } })).response;
  assert.equal(credentials.configured, true);
  assert(!JSON.stringify(credentials).includes(fakeBotToken), 'Secret leaked in API response');
  const [encrypted] = await db.$queryRaw`SELECT iv,tag,ciphertext FROM limiter_credentials WHERE id=1`;
  const key = createHash('sha256').update('remnadrop-limiter-credentials-v1\0').update(process.env.APP_SECRET).digest();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.iv));
  decipher.setAuthTag(Buffer.from(encrypted.tag));
  const decrypted = JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext)), decipher.final()]).toString());
  assert.equal(decrypted.telegramBotToken, fakeBotToken);
  assert(!Buffer.from(encrypted.ciphertext).includes(Buffer.from(fakeBotToken)));
  assert.equal((await request('/api/limiter/credentials', { method: 'DELETE', token })).response.configured, false);
  assert.deepEqual((await request('/api/limiter/events', { token })).response, []);
  console.log('PASS disabled Limiter settings/status and encrypted credentials CRUD');

  const cfStatus = (await request('/api/cloudflare-dns/settings', { token })).response;
  assert.equal(cfStatus.configured, false);
  const overview = (await request('/api/cloudflare-dns/overview', { token })).response;
  assert.deepEqual(overview.zones, []);
  assert.deepEqual(overview.records, []);
  assert.deepEqual(overview.bindings, []);
  assert.deepEqual(overview.zoneErrors, []);
  assert.deepEqual((await request('/api/cloudflare-dns/events', { token })).response, []);
  assert.deepEqual((await request('/api/cloudflare-dns/links', { token })).response, []);
  // Invalid token fails validation before any Cloudflare network request.
  await request('/api/cloudflare-dns/settings', { method: 'PUT', token, body: { apiToken: 'short' }, expected: 400 });
  console.log('PASS Cloudflare settings/overview/history without a token or external DNS requests');

  // No bindings/token exist, so this signed event exercises rawBody + receipts
  // without mutating DNS. Whitespace ensures re-serialized JSON cannot pass HMAC.
  const event = { eventId: randomUUID(), nodeUuid: sentinelUuid, oldIp: '203.0.113.1', newIp: '203.0.113.2' };
  const rawBody = JSON.stringify(event, null, 2) + '\n';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = 'sha256=' + createHmac('sha256', process.env.CLOUDFLARE_DNS_INCOMING_SECRET)
    .update(timestamp + '.').update(rawBody).digest('hex');
  const webhook = { method: 'POST', rawBody, expected: 201, extraHeaders: {
    'X-Webhook-Event-Id': event.eventId, 'X-Webhook-Timestamp': timestamp, 'X-Webhook-Signature': signature,
  } };
  const received = (await request('/api/cloudflare-dns/webhook/node-ip-changed', webhook)).response;
  assert.equal(received.success, true);
  assert.equal(received.updated, 0);
  assert.equal((await request('/api/cloudflare-dns/webhook/node-ip-changed', webhook)).response.duplicate, true);
  await request('/api/cloudflare-dns/webhook/node-ip-changed', { ...webhook, expected: 401,
    extraHeaders: { ...webhook.extraHeaders, 'X-Webhook-Signature': 'sha256=' + '0'.repeat(64) } });
  console.log('PASS real HTTP raw-body HMAC, rejected bad signature and database replay receipt');

  await delay(Math.max(0, 6500 - (Date.now() - started)));
  const finalStatus = (await request('/api/limiter/status', { token })).response;
  const finalSettings = (await request('/api/limiter/settings', { token })).response;
  assert.equal(finalStatus.running, false);
  assert.equal(finalStatus.pid, null);
  assert.equal(finalSettings.enabled, false);
  assert.equal(finalSettings.lastError, null, 'Disabled runner hit a startup/database error');
  await assertSentinel();
  console.log('PASS Limiter stayed disabled through its first lifecycle tick; existing user and traffic preserved');
}

(async () => {
  try {
    const mode = process.argv[2];
    if (mode === 'prepare-baseline') await prepareBaseline();
    else if (mode === 'verify-upgrade') await verifyUpgrade();
    else if (mode === 'api') await apiSmoke();
    else throw new Error('Expected prepare-baseline, verify-upgrade or api mode');
  } finally { await db.$disconnect(); }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
