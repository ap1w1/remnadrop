const assert = require('node:assert/strict');
const { test } = require('node:test');
const { appRequire, createSourceLoader } = require('./source-loader.cjs');

appRequire('@nestjs/common').Logger.overrideLogger(false);
const load = createSourceLoader({
  '@common/database/prisma.service': { PrismaService: class {} },
  './dpi-checker.service': { DpiCheckerService: class {} },
  './node-ip.service': { NodeIpService: class {} },
  './cloudflare-dns.service': { CloudflareDnsService: class {} },
  '@modules/squad-quotas/quota-webhooks.service': {
    postSignedWebhook: async () => { throw new Error('An external webhook must not run in this fixture'); },
  },
});
const { AutomationsService, validateAutomation } = load('src/modules/node-operations/automations.service.ts');
const NODE = '22222222-2222-4222-8222-222222222222';
const HOST = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const RULE = '44444444-4444-4444-8444-444444444444';
const EXECUTION = '55555555-5555-4555-8555-555555555555';
const ZONE = 'a'.repeat(32), RECORD = 'b'.repeat(32);
const OLD_IP = '192.0.2.10', NEW_IP = '192.0.2.11';
const dns = (overrides = {}) => ({ type: 'cloudflare_dns', accountId: ACCOUNT, zoneId: ZONE,
  recordId: RECORD, ipSource: 'static', newIp: NEW_IP, ...overrides });
const rule = (overrides = {}) => ({
  id: RULE, name: 'Резервный IP', node_uuid: NODE, enabled: true, trigger_type: 'online_drop',
  drop_percent: 50, min_online: 5, duration_minutes: 5, cooldown_minutes: 60,
  interval_minutes: 60, failure_policy: 'stop', actions: [{ type: 'hide_hosts', hosts: [HOST] }],
  pending_since: null, last_run_at: null, created_at: new Date(Date.now() - 86400000),
  updated_at: new Date(), revision: 1, active_execution_id: null, execution_lease_until: null,
  ...overrides,
});
function sqlParts(strings, values) {
  return Array.isArray(strings) ? { query: strings.join('?'), values }
    : { query: strings.strings.join('?'), values: strings.values };
}
function fixture(options = {}) {
  const calls = [], reads = [], writes = [];
  const saved = rule(options.rule);
  let owned = 0, claimed = false, finalStatus, finalDetails;
  const db = {
    nodes: { findUnique: async () => ({ uuid: NODE, name: 'Финляндия-2' }) },
    $queryRaw: async (strings, ...values) => {
      const sql = sqlParts(strings, values); reads.push(sql);
      if (sql.query.includes('WITH claimed AS')) {
        if (claimed) return [];
        claimed = true;
        return [{ id: values[0] }];
      }
      if (sql.query.includes('FROM node_metric_samples')) return [{ online: 2, available: 1,
        baseline: 20, sampled_at: new Date(), sample_count: 5, ...(options.sample || {}) }];
      if (sql.query.includes('SELECT * FROM node_automation_rules WHERE id=')) return [structuredClone(saved)];
      if (sql.query.includes('FROM hosts h')) return [{ uuid: HOST, remark: 'Финляндия', links: options.links ?? 1 }];
      throw new Error('Unexpected fixture read: ' + sql.query);
    },
    $executeRaw: async (strings, ...values) => {
      const sql = sqlParts(strings, values); writes.push(sql);
      if (sql.query.includes('SET execution_lease_until=')) {
        owned++;
        return options.loseLeaseAt === owned ? 0 : 1;
      }
      if (sql.query.includes('UPDATE hosts SET')) return options.changedHosts ?? 1;
      if (sql.query.includes('SET status=?')) {
        finalStatus = sql.values[0]; finalDetails = JSON.parse(sql.values[1]);
      }
      return 1;
    },
  };
  const dpi = {
    prepare: async input => { calls.push(['dpi.prepare', input]); return { response: { id: 'dpi-job' } }; },
    start: async (id, cost) => { calls.push(['dpi.start', id, cost]); if (options.dpiFailure) throw new Error('DPI budget exceeded'); },
    cancel: async id => { calls.push(['dpi.cancel', id]); },
  };
  const ips = {
    list: async id => { calls.push(['ips.list', id]); return { response: [
      { ip: OLD_IP, is_active: true }, { ip: NEW_IP, is_active: false },
    ] }; },
    rotateNext: async (id, source) => {
      calls.push(['ips.rotateNext', id, source]);
      return { response: options.rotationResult ?? { success: true, previousIp: OLD_IP, newIp: NEW_IP } };
    },
  };
  const cf = {
    getRecordTarget: async input => { calls.push(['cf.getRecordTarget', input]); return {
      response: { ...input, domain: 'vpn.example.com', type: options.recordType ?? 'A', content: OLD_IP },
    }; },
    previewRecordChange: async input => { calls.push(['cf.previewRecordChange', input]);
      if (options.previewFailure) throw new Error('Cloudflare token cannot access this record');
      return { response: { ...input, domain: 'vpn.example.com', oldIp: OLD_IP, newIp: input.newIp, changed: input.newIp !== OLD_IP } };
    },
    updateRecordIp: async (input, source) => { calls.push(['cf.updateRecordIp', input, source]);
      if (options.dnsFailure) throw new Error('Cloudflare record changed before the update');
      return { response: { ...input, updated: true, noop: false, auditRecorded: true } };
    },
    syncAfterRotation: async (...args) => { calls.push(['cf.syncAfterRotation', ...args]);
      if (options.syncFailure) throw new Error('One linked DNS record failed');
      return { updated: 1, failed: 0, skipped: 0 };
    },
  };
  return { service: new AutomationsService(db, dpi, ips, cf), db, dpi, ips, cf, calls, reads, writes, saved,
    final: () => ({ status: finalStatus, details: finalDetails }) };
}

test('legacy inputs preserve online-drop and continue-on-error behavior', () => {
  const validated = validateAutomation({ name: 'Legacy rule', node_uuid: NODE,
    enabled: true, actions: [{ type: 'hide_hosts', hosts: [HOST] }] });
  assert.equal(validated.trigger_type, 'online_drop');
  assert.equal(validated.failure_policy, 'continue');
});

test('a manual DNS workflow needs an account, zone and record but no node', () => {
  const validated = validateAutomation(rule({ trigger_type: 'manual', node_uuid: null, actions: [dns()] }));
  assert.equal(validated.node_uuid, null);
  assert.equal(validated.actions[0].accountId, ACCOUNT);
  for (const actions of [[null], [dns({ accountId: 'invalid' })], [dns({ recordId: '' })],
    [dns({ ipSource: 'static', newIp: 'not-an-ip' })], [dns({ ipSource: 'rotated' })]]) {
    assert.throws(() => validateAutomation(rule({ actions })), error => error.getStatus() === 400);
  }
});

test('ordered rotation dependencies, repeated rotation and node requirements are validated', () => {
  assert.doesNotThrow(() => validateAutomation(rule({ actions: [{ type: 'rotate_ip' }, dns({ ipSource: 'rotated' })] })));
  assert.throws(() => validateAutomation(rule({ actions: [dns({ ipSource: 'rotated' }), { type: 'rotate_ip' }] })), /Перед обновлением DNS/);
  assert.throws(() => validateAutomation(rule({ actions: [{ type: 'rotate_ip' }, { type: 'rotate_ip' }] })), /только один раз/);
  assert.throws(() => validateAutomation(rule({ trigger_type: 'manual', node_uuid: null })), /выберите ноду/);
  assert.throws(() => validateAutomation(rule({ trigger_type: 'interval', interval_minutes: 15, cooldown_minutes: 60 })), /не может быть больше/);
});

test('conditional DPI gate enforces safe IP/DNS branches and validates regional cost controls', () => {
  const gate={type:'dpi_check',hosts:[HOST],location:'russia',
    locations:[{location:'russia',pop_ids:[10,12]},{location:'china'}],
    gate:{minUnavailableRegions:2,timeoutMinutes:15}};
  const failover={type:'rotate_ip',when:'dpi_unavailable'};
  assert.doesNotThrow(()=>validateAutomation(rule({actions:[gate,failover,dns({ipSource:'rotated',when:'dpi_unavailable'})]})));
  assert.throws(()=>validateAutomation(rule({actions:[gate,{type:'rotate_ip'}]})),/только в ветке/);
  assert.throws(()=>validateAutomation(rule({actions:[{type:'dpi_check',hosts:[HOST],location:'russia'},{type:'rotate_ip'}]})),/только после ожидания/);
  assert.throws(()=>validateAutomation(rule({actions:[gate,{type:'rotate_ip',when:'dpi_unknown'}]})),/только в ветке/);
  assert.throws(()=>validateAutomation(rule({actions:[{...gate,locations:[{location:'russia'},{location:'russia'}]}]})),/повторяться/);
  assert.throws(()=>validateAutomation(rule({actions:[{...gate,gate:{minUnavailableRegions:0,timeoutMinutes:1}}]})),/порог регионов/);
});

test('preview reads targets and trigger state without reserving, charging, writing DNS or sending webhooks', async t => {
  const previous = process.env.AUTOMATIONS_WEBHOOK_SECRET;
  process.env.AUTOMATIONS_WEBHOOK_SECRET = 'fixture-signing-secret-with-at-least-32-characters';
  t.after(() => { if (previous === undefined) delete process.env.AUTOMATIONS_WEBHOOK_SECRET; else process.env.AUTOMATIONS_WEBHOOK_SECRET = previous; });
  const f = fixture();
  const input = rule({ actions: [
    { type: 'dpi_check', hosts: [HOST], location: 'russia',gate:{minUnavailableRegions:2,timeoutMinutes:15} },
    { type: 'hide_hosts', hosts: [HOST],when:'dpi_unavailable' }, { type: 'show_hosts', hosts: [HOST],when:'dpi_available' },
    { type: 'rotate_ip', updateCloudflare: true,when:'dpi_unavailable' }, dns({ ipSource: 'rotated',when:'dpi_unavailable' }), dns({when:'dpi_unavailable'}),
    { type: 'webhook', url: 'https://example.com/events',when:'dpi_unknown' },
  ] });
  const before = structuredClone(input);
  const result = (await f.service.preview(input, input)).response;
  assert.equal(result.valid, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.actions.length, 7);
  assert.equal(f.writes.length, 0, 'preview must not update counters, leases, executions, jobs or rule state');
  assert.deepEqual(input, before, 'preview does not rewrite the supplied stored rule');
  assert.deepEqual(f.calls.map(call => call[0]), ['ips.list', 'cf.getRecordTarget', 'cf.previewRecordChange']);
  assert.match(result.actions[4].target, /vpn\.example\.com/);
});

test('preview reports per-action access errors and shared-host conflicts without performing changes', async () => {
  const f = fixture({ links: 2, previewFailure: true });
  const response = (await f.service.preview(rule({ actions: [{ type: 'hide_hosts', hosts: [HOST] }, dns()] }))).response;
  assert.equal(response.valid, false);
  assert.match(response.actions[0].error, /Общие хосты/);
  assert.match(response.actions[1].error, /cannot access/);
  assert.equal(f.writes.length, 0);
  assert.equal(f.calls.some(call => /update|rotate|prepare|start/.test(call[0])), false);
});

test('missing fresh metrics and insufficient baseline never count as an outage', async () => {
  const stale = fixture({ sample: { online: null, available: null, sampled_at: null } });
  const missing = await stale.service.evaluate(rule({ trigger_type: 'node_offline', pending_since: new Date(0) }));
  assert.equal(missing.matched, false);
  assert.equal(missing.ready, false);
  const insufficient = fixture({ sample: { online: 0, baseline: 1, sample_count: 1 } });
  assert.equal((await insufficient.service.evaluate(rule())).matched, false);
  assert.equal(stale.writes.length, 0);
});

test('confirmed outage needs sustained duration and cooldown; interval is based on the last run', async () => {
  const f = fixture({ sample: { online: 0, available: 0 } });
  const pending = await f.service.evaluate(rule({ trigger_type: 'node_offline' }));
  assert.equal(pending.matched, true); assert.equal(pending.ready, false);
  const ready = await f.service.evaluate(rule({ pending_since: new Date(Date.now() - 6 * 60000) }));
  assert.equal(ready.ready, true);
  const cooling = await f.service.evaluate(rule({ pending_since: new Date(0), last_run_at: new Date() }));
  assert.equal(cooling.ready, false); assert.ok(cooling.cooldownSeconds > 0);
  assert.equal((await f.service.evaluate(rule({ trigger_type: 'interval', last_run_at: new Date() }))).ready, false);
  assert.equal((await f.service.evaluate(rule({ trigger_type: 'interval', last_run_at: new Date(Date.now() - 61 * 60000) }))).ready, true);
});

test('manual run requires explicit confirmation and rejects a stale reviewed revision before any effect', async () => {
  const f = fixture();
  await assert.rejects(f.service.runNow(RULE), error => error.getStatus() === 400);
  await assert.rejects(f.service.runNow(RULE, null), error => error.getStatus() === 400);
  await assert.rejects(f.service.runNow(RULE, { confirmed: true, expectedRevision: 99 }), error => error.getStatus() === 409);
  assert.equal(f.writes.length, 0);
  assert.equal(f.calls.length, 0);
});

test('concurrent manual requests cannot both start when the atomic claim is already held', async () => {
  const f = fixture({ rule: { trigger_type: 'manual', node_uuid: null, actions: [dns()] } });
  let runs = 0;
  f.service.execute = async () => { runs++; };
  const results = await Promise.allSettled([f.service.runNow(RULE, { confirmed: true, expectedRevision: 1 }),
    f.service.runNow(RULE, { confirmed: true, expectedRevision: 1 })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected');
  assert.equal(rejected.reason.getStatus(), 409);
  assert.equal(runs, 1);
});

test('DNS action uses the exact account/zone/record and the actual successful rotation result', async () => {
  const f = fixture();
  await f.service.execute(rule({ actions: [{ type: 'rotate_ip' }, dns({ ipSource: 'rotated', newIp: '198.51.100.99' })] }), EXECUTION);
  const write = f.calls.find(call => call[0] === 'cf.updateRecordIp');
  assert.equal(write[1].accountId, ACCOUNT); assert.equal(write[1].zoneId, ZONE); assert.equal(write[1].recordId, RECORD);
  assert.equal(write[1].newIp, NEW_IP); assert.equal(write[1].expectedOldIp, OLD_IP); assert.equal(write[2], 'automation');
  assert.equal(f.final().status, 'completed');
});

test('failed rotation cannot write DNS even with continue-on-error selected', async () => {
  const f = fixture({ rotationResult: { success: false } });
  await f.service.execute(rule({ failure_policy: 'continue', actions: [{ type: 'rotate_ip' }, dns({ ipSource: 'rotated' })] }), EXECUTION);
  assert.equal(f.calls.some(call => call[0] === 'cf.updateRecordIp'), false);
  assert.equal(f.final().status, 'failed');
  assert.deepEqual(f.final().details.map(detail => detail.status), ['failed', 'failed']);
});

test('failure policies record skipped actions or continue independent actions with partial outcome', async () => {
  const stop = fixture({ dnsFailure: true });
  const input = rule({ actions: [dns(), { type: 'hide_hosts', hosts: [HOST] }] });
  await stop.service.execute(input, EXECUTION);
  assert.equal(stop.writes.some(write => write.query.includes('UPDATE hosts SET')), false);
  assert.deepEqual(stop.final().details.map(detail => detail.status), ['failed', 'skipped']);
  const keepGoing = fixture({ dnsFailure: true });
  await keepGoing.service.execute({ ...input, failure_policy: 'continue' }, EXECUTION);
  assert.equal(keepGoing.final().status, 'partial_failure');
  assert.deepEqual(keepGoing.final().details.map(detail => detail.status), ['failed', 'completed']);
});

test('lost or expired execution lease prevents every remaining effect regardless of failure policy', async () => {
  const f = fixture({ loseLeaseAt: 1 });
  await f.service.execute(rule({ failure_policy: 'continue', actions: [dns(), { type: 'rotate_ip' }] }), EXECUTION);
  assert.equal(f.calls.length, 0);
  assert.equal(f.final().status, 'failed');
  assert.deepEqual(f.final().details.map(detail => detail.status), ['failed', 'skipped']);
});

test('DPI budget failure cancels the prepared job and leaves later actions untouched', async () => {
  const f = fixture({ dpiFailure: true });
  await f.service.execute(rule({ actions: [{ type: 'dpi_check', hosts: [HOST], location: 'russia' }, dns()] }), EXECUTION);
  assert.deepEqual(f.calls.map(call => call[0]), ['dpi.prepare', 'dpi.start', 'dpi.cancel']);
  assert.equal(f.final().status, 'failed');
  assert.deepEqual(f.final().details.map(detail => detail.status), ['failed', 'skipped']);
});

test('changed host membership fails atomically and a DNS sync failure records that the node IP already changed', async () => {
  const hosts = fixture({ changedHosts: 0 });
  await hosts.service.execute(rule(), EXECUTION);
  assert.equal(hosts.final().status, 'failed');
  assert.match(hosts.final().details[0].message, /Хосты не изменены/);
  const dnsSync = fixture({ syncFailure: true });
  await dnsSync.service.execute(rule({ actions: [{ type: 'rotate_ip', updateCloudflare: true }, dns({ ipSource: 'rotated' })] }), EXECUTION);
  assert.match(dnsSync.final().details[0].message, /IP ноды изменён/);
  assert.deepEqual(dnsSync.final().details.map(detail => detail.status), ['failed', 'skipped']);
});
