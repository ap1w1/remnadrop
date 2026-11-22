const assert = require('node:assert/strict');
const { test } = require('node:test');
const { appRequire, createSourceLoader } = require('./source-loader.cjs');

appRequire('@nestjs/common').Logger.overrideLogger(false);
const load = createSourceLoader({
  '@common/database/prisma.service': { PrismaService: class {} },
  '@common/guards/jwt-guards/def-jwt-guard': { JwtDefaultGuard: class {} },
  '@modules/squad-quotas/quota-webhooks.service': {
    postSignedWebhook: async () => { throw new Error('Unexpected external webhook in fixture'); },
  },
});
const { CloudflareDnsService } = load('src/modules/node-operations/cloudflare-dns.service.ts');
const ZONE = 'a'.repeat(32);
const RECORD = 'b'.repeat(32);
const HOST = '11111111-1111-4111-8111-111111111111';
const NODE = '22222222-2222-4222-8222-222222222222';
const OTHER_NODE = '33333333-3333-4333-8333-333333333333';
const OLD_IP = '192.0.2.10';
const NEW_IP = '192.0.2.11';

function fixture(t, options = {}) {
  const calls = [];
  const record = { id: RECORD, type: 'A', name: 'vpn.example.com', content: OLD_IP, ttl: 300, proxied: true };
  const hosts = options.hosts || [{ host_uuid: HOST, remark: 'FR', address: 'unrelated.example.net', node_uuid: NODE, node_name: 'FR-1' }];
  const mappings = options.mappings || [{ host_uuid: HOST, zone_id: ZONE, record_id: RECORD }];
  const databaseWrites = [];
  const db = {
    $queryRaw: async strings => {
      const query = strings.join('?');
      if (query.includes('FROM cf_dns_credentials')) return [];
      if (query.includes('FROM hosts h')) return hosts;
      if (query.includes('FROM cf_dns_record_host_links')) return mappings;
      if (query.includes('FROM cf_dns_zone_bindings')) return [];
      throw new Error('Unexpected fixture query: ' + query);
    },
    $executeRaw: async (strings, ...values) => { databaseWrites.push({ query: strings.join('?'), values }); return 1; },
  };
  const originalFetch = global.fetch;
  const originalToken = process.env.CLOUDFLARE_DNS_API_TOKEN;
  const originalWebhook = process.env.CLOUDFLARE_DNS_WEBHOOK_URL;
  process.env.CLOUDFLARE_DNS_API_TOKEN = 'fixture-token-not-a-real-cloudflare-secret';
  delete process.env.CLOUDFLARE_DNS_WEBHOOK_URL;
  t.after(() => {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.CLOUDFLARE_DNS_API_TOKEN;
    else process.env.CLOUDFLARE_DNS_API_TOKEN = originalToken;
    if (originalWebhook === undefined) delete process.env.CLOUDFLARE_DNS_WEBHOOK_URL;
    else process.env.CLOUDFLARE_DNS_WEBHOOK_URL = originalWebhook;
  });
  let recordReads = 0;
  global.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ url: String(url), ...init, method });
    assert.ok(String(url).startsWith('https://api.cloudflare.com/client/v4/'));
    assert.equal(init.redirect, 'error');
    const expectedPath = '/zones/' + ZONE + '/dns_records/' + RECORD;
    const pathname = new URL(url).pathname.replace('/client/v4', '');
    let result;
    if (pathname === expectedPath && method === 'GET') {
      recordReads += 1;
      result = recordReads > 1 && options.changedFinalRecord ? { ...record, ...options.changedFinalRecord } : record;
    } else if (pathname === '/zones/' + ZONE + '/dns_records' && method === 'GET') {
      result = [record, ...(options.aliases || [])];
    } else if (pathname === expectedPath && method === 'PATCH') {
      result = { ...record, content: NEW_IP };
    } else throw new Error('Unexpected Cloudflare fixture request: ' + method + ' ' + url);
    return { ok: true, status: 200, json: async () => ({ success: true, result }) };
  };
  return { service: new CloudflareDnsService(db), calls, databaseWrites,
    input: { zoneId: ZONE, recordId: RECORD, nodeUuid: NODE, expectedOldIp: OLD_IP, newIp: NEW_IP } };
}

test('DNS replacement requires both zone and record of the explicit mapping', async t => {
  const f = fixture(t, { mappings: [{ host_uuid: HOST, zone_id: 'c'.repeat(32), record_id: RECORD }] });
  await assert.rejects(f.service.replaceIp(f.input), error => error.getStatus() === 409);
  assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 0);
});

test('DNS shared by another active node is not rewritten', async t => {
  const f = fixture(t, { hosts: [
    { host_uuid: HOST, remark: 'FR', address: 'vpn.example.com', node_uuid: NODE, node_name: 'FR-1' },
    { host_uuid: '44444444-4444-4444-8444-444444444444', remark: 'DE', address: 'vpn.example.com', node_uuid: OTHER_NODE, node_name: 'DE-1' },
  ] });
  await assert.rejects(f.service.replaceIp(f.input), error => error.getStatus() === 409);
  assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 0);
});

test('DNS changed after initial inspection is rejected before PATCH', async t => {
  const f = fixture(t, { changedFinalRecord: { content: '192.0.2.99' } });
  await assert.rejects(f.service.replaceIp(f.input), error => error.getStatus() === 409);
  assert.equal(f.calls.filter(call => call.method === 'GET' && call.url.endsWith('/' + RECORD)).length, 2);
  assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 0);
});

test('authorized DNS change preserves all fields except content', async t => {
  const f = fixture(t);
  const response = await f.service.replaceIp(f.input);
  assert.equal(response.response.updated, true);
  const patches = f.calls.filter(call => call.method === 'PATCH');
  assert.equal(patches.length, 1);
  assert.deepEqual(JSON.parse(patches[0].body), { content: NEW_IP });
  assert.equal(f.calls.filter(call => call.method === 'GET' && call.url.endsWith('/' + RECORD)).length, 2);
  assert.ok(f.databaseWrites.some(write => write.query.includes('INSERT INTO cf_dns_events')));
});

test('Cloudflare API role can replace DNS only with the declared hosts write scope', () => {
  const { CloudflareDnsController } = load('src/modules/node-operations/cloudflare-dns.controller.ts');
  const { RolesGuard } = load('src/common/guards/roles/roles.guard.ts');
  const { ScopesGuard } = load('src/common/guards/scopes/scopes.guard.ts');
  const { ROLE } = load('libs/contract/constants');
  const { Reflector } = appRequire('@nestjs/core');
  const roles = new RolesGuard(new Reflector());
  const scopes = new ScopesGuard(new Reflector());
  const context = (method, grants) => ({
    getHandler: () => CloudflareDnsController.prototype[method],
    getClass: () => CloudflareDnsController,
    switchToHttp: () => ({ getRequest: () => ({ user: { role: ROLE.API, scopes: grants } }) }),
  });
  for (const grant of ['hosts:cloudflare-replace-ip', 'hosts:write', 'hosts:*', '*']) {
    assert.equal(roles.canActivate(context('replace', [grant])), true);
    assert.equal(scopes.canActivate(context('replace', [grant])), true);
  }
  for (const grants of [[], ['hosts:read'], ['nodes:write']]) {
    assert.equal(scopes.canActivate(context('replace', grants)), false);
  }
  assert.throws(() => roles.canActivate(context('update', ['*'])));
  assert.throws(() => roles.canActivate(context('bind', ['*'])));
});
