'use strict';

const assert = require('node:assert/strict');
const { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
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
const uxMigrations = [
  '20261122220000_limiter_events',
  '20261122221000_cloudflare_accounts',
  '20261122222000_automation_workflows',
];
const currentMigrationCount = fs.readdirSync('/app/prisma/migrations')
  .filter(name => fs.existsSync(path.join('/app/prisma/migrations', name, 'migration.sql'))).length;
const legacyAccount = '00000000-0000-4000-8000-000000000001';
const fixtureNode = '6b703d9c-3a43-46a4-bda1-a85421b2c010';
const fixtureHost = '6b703d9c-3a43-46a4-bda1-a85421b2c011';
const fixtureRule = '6b703d9c-3a43-46a4-bda1-a85421b2c012';
const fixtureExecution = '6b703d9c-3a43-46a4-bda1-a85421b2c013';
const fixtureLimiterEvent = '6b703d9c-3a43-46a4-bda1-a85421b2c014';
const fixtureDnsEvent = '6b703d9c-3a43-46a4-bda1-a85421b2c015';
const fixtureZone = 'a'.repeat(32);
const fixtureRecord = 'b'.repeat(32);
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
  assert.equal(rows.some(row => row.migration_name === migration), expected >= 129);
  if (expected > 129) {
    for (const name of uxMigrations) assert(rows.some(row => row.migration_name === name), 'Missing migration ' + name);
  }
}

function stageMigrations(includeLegacy) {
  const directory = '/app/prisma/migrations';
  const destination = '/tmp/remnadrop-deferred-migrations';
  fs.mkdirSync(destination, { recursive: true });
  for (const name of fs.readdirSync(directory)) {
    if (fs.existsSync(path.join(directory, name, 'migration.sql'))
      && (includeLegacy ? name > migration : name >= migration)) {
      fs.renameSync(path.join(directory, name), path.join(destination, name));
    }
  }
}

// Synthetic test credential only, never sent to Cloudflare. Deriving the same
// plaintext allows verification after a different disposable container starts.
function legacyCredential() {
  const token = 'smoke-cloudflare-' + createHash('sha256').update(process.env.APP_SECRET).digest('hex');
  const key = createHash('sha256').update('remnadrop-cloudflare-dns-v1\0').update(process.env.APP_SECRET).digest();
  return { token, key };
}

async function prepareLegacy() {
  await migrationHistory(129);
  await assertSentinel();
  const { token, key } = legacyCredential();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  await db.$executeRaw`INSERT INTO cf_dns_credentials(id,iv,tag,ciphertext) VALUES(1,${iv},${tag},${ciphertext})`;
  await db.nodes.create({ data: { uuid: fixtureNode, name: 'Migration fixture node', address: '192.0.2.10', port: 2222, isDisabled: true } });
  await db.hosts.create({ data: { uuid: fixtureHost, remark: 'Migration fixture host', address: 'migration.example.com', port: 443 } });
  await db.$executeRaw`INSERT INTO hosts_to_nodes(host_uuid,node_uuid) VALUES(${fixtureHost}::uuid,${fixtureNode}::uuid)`;
  await db.$executeRaw`INSERT INTO cf_dns_zone_bindings(domain,zone_id,auto_sync) VALUES('example.com',${fixtureZone},false)`;
  await db.$executeRaw`INSERT INTO cf_dns_record_host_links(zone_id,record_id,host_uuid) VALUES(${fixtureZone},${fixtureRecord},${fixtureHost}::uuid)`;
  await db.$executeRaw`INSERT INTO cf_dns_events(id,zone_id,record_id,record_name,node_uuid,old_ip,new_ip,source,status)
    VALUES(${fixtureDnsEvent}::uuid,${fixtureZone},${fixtureRecord},'migration.example.com',${fixtureNode}::uuid,'192.0.2.9','192.0.2.10','manual','success')`;
  await db.$executeRaw`INSERT INTO limiter_events(id,user_uuid,username,event_type,mode,device_limit,observed_count,ips,details)
    VALUES(${fixtureLimiterEvent}::uuid,${sentinelUuid}::uuid,${username},'violation_detected','manual',5,9,
      '[{"ip":"198.51.100.7","node_uuid":"6b703d9c-3a43-46a4-bda1-a85421b2c010"}]'::jsonb,'pre-upgrade event')`;
  const actions = [{ type: 'hide_hosts', hosts: [fixtureHost] }];
  await db.$executeRaw`INSERT INTO node_automation_rules(id,node_uuid,name,enabled,actions)
    VALUES(${fixtureRule}::uuid,${fixtureNode}::uuid,'Preserved automation',false,${JSON.stringify(actions)}::jsonb)`;
  await db.$executeRaw`INSERT INTO node_automation_executions(id,rule_id,finished_at,status,details)
    VALUES(${fixtureExecution}::uuid,${fixtureRule}::uuid,now(),'completed','[]'::jsonb)`;
  console.log('PASS previous release fixtures: encrypted Cloudflare credential, zone/link/history, Limiter event, automation');
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
  await migrationHistory(currentMigrationCount);
  await assertSentinel();
  const rows = await db.$queryRaw`SELECT config FROM limiter_settings WHERE id=1`;
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].config.enabled, true, 'Upgrade must not enable Limiter');
  for (const table of ['limiter_credentials', 'limiter_events', 'cf_dns_credentials',
    'cf_dns_zone_bindings', 'cf_dns_events', 'cf_dns_webhook_receipts', 'cf_dns_record_host_links', 'cf_dns_accounts']) {
    const result = await db.$queryRaw`SELECT to_regclass(${`public.${table}`})::text AS table_name`;
    assert.equal(result[0].table_name, table, `Missing integration table ${table}`);
  }
  const [account] = await db.$queryRaw`SELECT * FROM cf_dns_accounts WHERE id=${legacyAccount}::uuid`;
  assert(account, 'Existing Cloudflare account was lost');
  const { token, key } = legacyCredential();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(account.iv));
  decipher.setAuthTag(Buffer.from(account.tag));
  assert.equal(Buffer.concat([decipher.update(Buffer.from(account.ciphertext)), decipher.final()]).toString(), token);
  const [binding] = await db.$queryRaw`SELECT * FROM cf_dns_zone_bindings WHERE account_id=${legacyAccount}::uuid`;
  assert.equal(binding.domain, 'example.com');
  assert.equal(binding.auto_sync, false);
  const [link] = await db.$queryRaw`SELECT * FROM cf_dns_record_host_links WHERE account_id=${legacyAccount}::uuid`;
  assert.equal(link.host_uuid, fixtureHost);
  const [event] = await db.$queryRaw`SELECT * FROM cf_dns_events WHERE id=${fixtureDnsEvent}::uuid`;
  assert.equal(event.account_id, legacyAccount);
  const [limiter] = await db.$queryRaw`SELECT * FROM limiter_events WHERE id=${fixtureLimiterEvent}::uuid`;
  assert.equal(limiter.observed_count, 9);
  assert.equal(limiter.details, 'pre-upgrade event');
  const [rule] = await db.$queryRaw`SELECT * FROM node_automation_rules WHERE id=${fixtureRule}::uuid`;
  assert.equal(rule.name, 'Preserved automation');
  assert.equal(rule.enabled, false);
  assert.equal(rule.trigger_type, 'online_drop');
  assert.equal(rule.failure_policy, 'continue');
  assert.deepEqual(rule.actions, [{ type: 'hide_hosts', hosts: [fixtureHost] }]);
  const [execution] = await db.$queryRaw`SELECT * FROM node_automation_executions WHERE id=${fixtureExecution}::uuid`;
  assert.equal(execution.rule_name, rule.name);
  console.log('PASS current migrations, preserved users/traffic/credentials/events/automation and unchanged ciphertext format');
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

async function automationSmoke(token) {
  const ruleInput = {
    node_uuid: fixtureNode, name: 'Smoke manual workflow', enabled: false,
    trigger_type: 'manual', drop_percent: 50, min_online: 5, duration_minutes: 5,
    cooldown_minutes: 60, interval_minutes: 60, failure_policy: 'stop',
    actions: [{ type: 'hide_hosts', hosts: [fixtureHost] }],
  };
  const options = (await request('/api/node-automations/options', { token })).response;
  assert(options.nodes.some(node => node.uuid === fixtureNode));
  assert(options.hosts.some(host => host.uuid === fixtureHost && host.node_uuids.includes(fixtureNode)));
  const before = await db.$queryRaw`SELECT count(*)::int AS count FROM node_automation_executions`;
  const preview = (await request('/api/node-automations/preview', { method: 'POST', token, body: ruleInput, expected: 201 })).response;
  assert.equal(preview.readOnly, true);
  assert.equal(preview.valid, true);
  assert.equal(preview.actions[0].type, 'hide_hosts');
  assert.equal((await db.hosts.findUnique({ where: { uuid: fixtureHost } })).isHidden, false);
  assert.deepEqual(await db.$queryRaw`SELECT count(*)::int AS count FROM node_automation_executions`, before);

  const created = (await request('/api/node-automations', { method: 'POST', token, body: ruleInput, expected: 201 })).response;
  const rule = created.find(item => item.name === ruleInput.name);
  assert(rule);
  await request(`/api/node-automations/${rule.id}/run`, { method: 'POST', token, body: {}, expected: 400 });
  await request(`/api/node-automations/${rule.id}/run`, { method: 'POST', token,
    body: { confirmed: true, expectedRevision: rule.revision + 1 }, expected: 409 });
  const started = (await request(`/api/node-automations/${rule.id}/run`, { method: 'POST', token,
    body: { confirmed: true, expectedRevision: rule.revision }, expected: 201 })).response;
  assert.equal(started.status, 'running');
  let finished;
  for (let attempt = 0; attempt < 30; attempt++) {
    const executions = (await request(`/api/node-automations/executions?ruleId=${rule.id}`, { token })).response;
    finished = executions.find(item => item.id === started.executionId);
    const [state] = await db.$queryRaw`SELECT active_execution_id FROM node_automation_rules WHERE id=${rule.id}::uuid`;
    if (finished && finished.status !== 'running' && state.active_execution_id === null) break;
    await delay(100);
  }
  assert.equal(finished?.status, 'completed');
  assert.equal(finished.details[0].status, 'completed');
  assert.equal((await db.hosts.findUnique({ where: { uuid: fixtureHost } })).isHidden, true);
  const copied = (await request(`/api/node-automations/${rule.id}/duplicate`, { method: 'POST', token, body: {}, expected: 201 })).response;
  const copy = copied.find(item => item.id !== rule.id && item.name.startsWith(ruleInput.name));
  assert(copy);
  assert.equal(copy.enabled, false);
  await request(`/api/node-automations/${copy.id}`, { method: 'DELETE', token });
  await request(`/api/node-automations/${rule.id}`, { method: 'DELETE', token });
  const history = (await request('/api/node-automations/executions', { token })).response;
  const preserved = history.find(item => item.id === started.executionId);
  assert(preserved, 'Deleting an automation must preserve its execution history');
  assert.equal(preserved.rule_id, null);
  assert.equal(preserved.name, ruleInput.name);
  assert(history.some(item => item.id === fixtureExecution), 'Pre-upgrade execution disappeared');
  console.log('PASS real automation options, read-only preview, confirmation/revision guards, host action, duplication and preserved history');
}

async function automationScopeSmoke(token) {
  for (const scopes of [['nodes:*'], ['*']]) {
    const created = (await request('/api/tokens', { method: 'POST', token, expected: 201,
      body: { name: 'Automation scope smoke ' + scopes[0], expiresInDays: 1, scopes } })).response;
    assert.equal(typeof created.token, 'string');
    try {
      await request('/api/node-automations/options', { token: created.token });
      for (const [method, path, body] of [
        ['POST', '/api/node-automations', {}],
        ['POST', '/api/node-automations/preview', {}],
        ['POST', `/api/node-automations/${fixtureRule}/preview`, {}],
        ['POST', `/api/node-automations/${fixtureRule}/run`, { confirmed: true }],
        ['POST', `/api/node-automations/${fixtureRule}/duplicate`, {}],
        ['PUT', `/api/node-automations/${fixtureRule}/enabled`, { enabled: true }],
        ['PUT', `/api/node-automations/${fixtureRule}`, {}],
        ['DELETE', `/api/node-automations/${fixtureRule}`, undefined],
      ]) await request(path, { method, body, token: created.token, expected: 403 });
    } finally { await request('/api/tokens/' + created.uuid, { method: 'DELETE', token }); }
  }
  const [rule] = await db.$queryRaw`SELECT enabled FROM node_automation_rules WHERE id=${fixtureRule}::uuid`;
  assert.equal(rule.enabled, false);
  console.log('PASS real node-scoped and full-scope API tokens cannot mutate or run administrator automation workflows');
}

async function limiterEngineSmoke(token) {
  await request('/api/limiter/settings', { method: 'PUT', token, body: { enabled: true, mode: 'manual' } });
  let running;
  for (let attempt = 0; attempt < 80; attempt++) {
    running = (await request('/api/limiter/status', { token })).response;
    if (running.running && running.ready) break;
    await delay(1000);
  }
  assert.equal(running?.ready, true, 'Built Go Limiter did not become ready without Telegram');
  const path = '/api/limiter/users/' + sentinelUuid + '/actions';
  const body = { action: 'ignore_temp', minutes: 360, requestId: randomUUID() };
  const first = (await request(path, { method: 'POST', token, body, expected: 201 })).response;
  assert.equal(first.success, true);
  assert.equal(first.state.ignored, true);
  assert.equal(first.state.permanentIgnore, false);
  const second = (await request(path, { method: 'POST', token, body, expected: 201 })).response;
  assert.deepEqual(second, first, 'Retry must return the saved result without repeating the action');
  const ignored = (await request('/api/limiter/ignored', { token })).response;
  assert(ignored.some(user => user.uuid === sentinelUuid && user.ignored));
  await request(path, { method: 'POST', token, body: { action: 'unignore', requestId: randomUUID() }, expected: 201 });
  assert(!(await request('/api/limiter/ignored', { token })).response.some(user => user.uuid === sentinelUuid));
  await request(path, { method: 'POST', token, body: { action: 'disable_temp', minutes: 1440, requestId: randomUUID() }, expected: 201 });
  assert.equal((await db.users.findUnique({ where: { uuid: sentinelUuid } })).status, 'DISABLED');
  await request('/api/limiter/settings', { method: 'PUT', token, body: { enabled: false }, expected: 400 });
  await request(path, { method: 'POST', token, body: { action: 'enable', requestId: randomUUID() }, expected: 201 });
  await assertSentinel();
  const actions = (await request('/api/limiter/actions', { token })).response;
  assert.equal(actions.filter(action => action.action === 'ignore_temp' && action.user_uuid === sentinelUuid).length, 1);
  assert(actions.some(action => action.action === 'disable_temp' && action.success));
  assert(actions.some(action => action.action === 'enable' && action.success));
  const summary = (await request('/api/limiter/summary', { token })).response;
  assert.equal(summary.liveAvailable, true);
  await request('/api/limiter/settings', { method: 'PUT', token, body: { enabled: false } });
  for (let attempt = 0; attempt < 45; attempt++) {
    running = (await request('/api/limiter/status', { token })).response;
    if (!running.running) break;
    await delay(1000);
  }
  assert.equal(running.running, false, 'Disabling Limiter must stop its child process');
  console.log('PASS built Go engine without Telegram, shared temporary ignore/block/restore state, idempotency, audit and shutdown');
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
  assert.equal(settings.telegramNotifications, true);
  const status = (await request('/api/limiter/status', { token })).response;
  assert.equal(status.embedded, true);
  assert.equal(status.running, false);
  assert.equal(status.pid, null);
  assert.equal((await request('/api/limiter/credentials', { token })).response.configured, false);
  await request('/api/limiter/settings', { method: 'PUT', token, body: { enabled: false, checkIntervalSeconds: 90, telegramNotifications: false } });
  const saved = (await request('/api/limiter/settings', { token })).response;
  assert.equal(saved.enabled, false);
  assert.equal(saved.checkIntervalSeconds, 90);
  assert.equal(saved.telegramNotifications, false);

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
  await request('/api/limiter/settings', { method: 'PUT', token, body: { telegramNotifications: true } });
  await request('/api/limiter/settings', { method: 'PUT', token, body: { telegramNotifications: false } });
  const [retainedCredential] = await db.$queryRaw`SELECT ciphertext FROM limiter_credentials WHERE id=1`;
  assert.deepEqual(Buffer.from(retainedCredential.ciphertext), Buffer.from(encrypted.ciphertext), 'Telegram duplication toggle must preserve saved credentials');
  assert.equal((await request('/api/limiter/credentials', { method: 'DELETE', token })).response.configured, false);
  const migratedLimiterEvents = (await request('/api/limiter/events', { token })).response;
  assert.equal(migratedLimiterEvents.length, 1);
  assert.equal(migratedLimiterEvents[0].id, fixtureLimiterEvent);
  assert.equal(migratedLimiterEvents[0].observed_count, 9);
  assert.equal(migratedLimiterEvents[0].stateAvailable, true);
  console.log('PASS disabled Limiter settings/status and encrypted credentials CRUD');

  const migratedAccounts = (await request('/api/cloudflare-dns/accounts', { token })).response;
  assert.equal(migratedAccounts.length, 1);
  assert.equal(migratedAccounts[0].id, legacyAccount);
  assert.equal(migratedAccounts[0].configured, true);
  assert(!JSON.stringify(migratedAccounts).includes(legacyCredential().token), 'Cloudflare credential leaked in account response');
  const migratedEvents = (await request('/api/cloudflare-dns/events', { token })).response;
  assert(migratedEvents.some(event => event.id === fixtureDnsEvent));
  assert.equal((await request('/api/cloudflare-dns/links', { token })).response[0].account_id, legacyAccount);
  // Remove the synthetic migrated account before any endpoint can call Cloudflare.
  await request('/api/cloudflare-dns/accounts/' + legacyAccount, { method: 'DELETE', token });
  const cfStatus = (await request('/api/cloudflare-dns/settings', { token })).response;
  assert.equal(cfStatus.configured, false);
  const overview = (await request('/api/cloudflare-dns/overview', { token })).response;
  assert.deepEqual(overview.zones, []);
  assert.deepEqual(overview.records, []);
  assert.deepEqual(overview.bindings, []);
  assert.deepEqual(overview.zoneErrors, []);
  const retainedEvents = (await request('/api/cloudflare-dns/events', { token })).response;
  assert.equal(retainedEvents.find(event => event.id === fixtureDnsEvent).account_id, null);
  assert(retainedEvents.find(event => event.id === fixtureDnsEvent).account_name);
  assert.deepEqual((await request('/api/cloudflare-dns/links', { token })).response, []);
  // Invalid token fails validation before any Cloudflare network request.
  await request('/api/cloudflare-dns/accounts', { method: 'POST', token, body: { name: 'Invalid credential', apiToken: 'short' }, expected: 400 });
  console.log('PASS migrated Cloudflare account, secret redaction, safe account removal and retained DNS history without external requests');

  await automationScopeSmoke(token);
  await automationSmoke(token);

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
  await limiterEngineSmoke(token);
}

(async () => {
  try {
    const mode = process.argv[2];
    if (mode === 'stage-baseline') stageMigrations(false);
    else if (mode === 'stage-legacy') stageMigrations(true);
    else if (mode === 'prepare-baseline') await prepareBaseline();
    else if (mode === 'prepare-legacy') await prepareLegacy();
    else if (mode === 'verify-upgrade') await verifyUpgrade();
    else if (mode === 'api') await apiSmoke();
    else throw new Error('Expected stage-baseline, stage-legacy, prepare-baseline, prepare-legacy, verify-upgrade or api mode');
  } finally { await db.$disconnect(); }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
