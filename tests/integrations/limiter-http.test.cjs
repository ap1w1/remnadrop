const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { after, before, test } = require('node:test');
const { appRequire, createSourceLoader, mainBodyParserSetup } = require('./source-loader.cjs');

const { Controller, Get, HttpCode, Logger, Module, Post, Req } = appRequire('@nestjs/common');
const { GUARDS_METADATA } = appRequire('@nestjs/common/constants');
const { NestFactory } = appRequire('@nestjs/core');
Logger.overrideLogger(false);

const load = createSourceLoader({
  '@common/database/prisma.service': { PrismaService: class {} },
  '@queue/_nodes': { NodesQueuesService: class {} },
  '@modules/users/users.service': { UsersService: class {} },
  '@common/utils/startup-app': { isDevelopment: () => false },
});
const operations = 'src/modules/node-operations/';
const { LimiterBridgeGuard, LimiterBridgeController } = load(operations + 'limiter-bridge.controller.ts');
const { LimiterWebhookController } = load(operations + 'limiter-webhook.controller.ts');
const { LimiterService } = load(operations + 'limiter.service.ts');
const { proxyCheckMiddleware } = load('src/common/middlewares/proxy-check.middleware.ts');
const secrets = { apiToken: 'a'.repeat(64), webhookSecret: 'b'.repeat(64) };
const writes = [];
const db = {
  users: { findUnique: async () => ({ uuid: '11111111-1111-4111-8111-111111111111' }) },
  $executeRaw: async (query, ...values) => { writes.push({ query, values }); return 1; },
};
const bridgeGuard = new LimiterBridgeGuard(secrets);
const webhook = new LimiterWebhookController(new LimiterService(db, {}, secrets));
let lastRaw;

class ProbeController {
  bridge(request) {
    bridgeGuard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) });
    return { accepted: true };
  }
  receive(request) {
    lastRaw = request.rawBody;
    return webhook.receive(request, request.headers['x-timestamp'], request.headers['x-signature-v2']);
  }
  raw(request) { return { raw: request.rawBody?.toString('base64') }; }
}
Controller()(ProbeController);
for (const [name, decorator] of [
  ['bridge', Get('limiter-bridge/runtime')],
  ['receive', Post('limiter-webhook')],
  ['raw', Post('raw-body-probe')],
]) {
  decorator(ProbeController.prototype, name, Object.getOwnPropertyDescriptor(ProbeController.prototype, name));
  Req()(ProbeController.prototype, name, 0);
  HttpCode(200)(ProbeController.prototype, name, Object.getOwnPropertyDescriptor(ProbeController.prototype, name));
}
class ProbeModule {}
Module({ controllers: [ProbeController] })(ProbeModule);

let app;
let origin;
before(async () => {
  const parser = mainBodyParserSetup();
  app = await NestFactory.create(ProbeModule, { rawBody: parser.rawBody, logger: false });
  parser.apply(app);
  app.use(proxyCheckMiddleware);
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  origin = 'http://127.0.0.1:' + app.getHttpServer().address().port;
});
after(async () => { if (app) await app.close(); });

test('main.ts parser preserves exact noncanonical JSON bytes above Express default limit', async () => {
  const raw = Buffer.from('{\n  "message": "Тёма", "payload": "' + 'x'.repeat(120_000) + '"\n}\n');
  const response = await fetch(origin + '/api/raw-body-probe', {
    method: 'POST', body: raw,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.1', 'x-forwarded-proto': 'https' },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).raw, raw.toString('base64'));
});

test('loopback bridge exemption still requires the actual Bearer guard', async () => {
  assert.ok(Reflect.getMetadata(GUARDS_METADATA, LimiterBridgeController).includes(LimiterBridgeGuard));
  for (const authorization of [undefined, 'Bearer incorrect']) {
    const response = await fetch(origin + '/api/limiter-bridge/runtime', {
      headers: authorization ? { authorization } : {},
    });
    assert.equal(response.status, 401);
    await response.arrayBuffer();
  }
  const response = await fetch(origin + '/api/limiter-bridge/runtime', { headers: { authorization: 'Bearer ' + secrets.apiToken } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { accepted: true });
});

test('loopback webhook accepts exact HMAC and rejects a signature over reserialized JSON', async () => {
  const raw = Buffer.from('{\n "event": "violation_detected", "user": {"user_id":7,"username":"Тёма"},\n "violation":{"device_limit":2,"ip_count":3}\n}\n');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sign = bytes => createHmac('sha256', secrets.webhookSecret).update(timestamp + '.').update(bytes).digest('hex');
  const post = signature => fetch(origin + '/api/limiter-webhook', {
    method: 'POST', body: raw,
    headers: { 'content-type': 'application/json', 'x-timestamp': timestamp, 'x-signature-v2': signature },
  });
  const beforeWrites = writes.length;
  let response = await post(sign(Buffer.from(JSON.stringify(JSON.parse(raw)))));
  assert.equal(response.status, 400);
  await response.arrayBuffer();
  assert.equal(writes.length, beforeWrites);
  response = await post('sha256=' + sign(raw));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { response: { accepted: true } });
  assert.deepEqual(lastRaw, raw);
  assert.equal(writes.length, beforeWrites + 1);
});

function proxyResult(remoteAddress, pathname, headers = {}, forgedIp = '127.0.0.1') {
  let forwarded = false;
  let destroyed = false;
  const request = { path: pathname, url: pathname, originalUrl: pathname, headers,
    ip: forgedIp, socket: { remoteAddress } };
  proxyCheckMiddleware(request, { socket: { destroy() { destroyed = true; } } }, () => { forwarded = true; });
  return { forwarded, destroyed };
}

test('only actual loopback and narrowly scoped limiter paths bypass proxy requirement', () => {
  for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    for (const pathname of ['/api/limiter-bridge', '/api/limiter-bridge/runtime', '/api/limiter-webhook', '/api/limiter-webhook/']) {
      assert.deepEqual(proxyResult(ip, pathname), { forwarded: true, destroyed: false });
    }
    for (const pathname of ['/api/users', '/api/limiter-bridge-evil', '/api/limiter-webhook/evil', '/api/cloudflare-dns/webhook/node-ip-changed']) {
      assert.deepEqual(proxyResult(ip, pathname), { forwarded: false, destroyed: true });
    }
  }
  for (const pathname of ['/api/limiter-bridge/runtime', '/api/limiter-webhook']) {
    assert.deepEqual(proxyResult('198.51.100.12', pathname, { 'x-forwarded-for': '127.0.0.1' }),
      { forwarded: false, destroyed: true });
    assert.deepEqual(proxyResult('198.51.100.12', pathname), { forwarded: false, destroyed: true });
  }
  assert.deepEqual(proxyResult('198.51.100.12', '/api/users', {
    'x-forwarded-for': '203.0.113.10', 'x-forwarded-proto': 'https',
  }), { forwarded: true, destroyed: false });
});
