// Run with Node 24+: node --test tests/limiter-runtime.cjs
// Exercise the actual TS methods with transport/process boundaries mocked.
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { runInNewContext } = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const root = resolve(__dirname, '..');
function loadSource(filename, names, globals) {
  const source = readFileSync(join(root, filename), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/^@Injectable\(\)\r?\n/gm, '')
    .replace(/^export /gm, '');
  const code = stripTypeScriptTypes(source, { mode: 'transform' });
  const sandbox = { Error, ...globals, module: { exports: {} } };
  runInNewContext(code + '\nmodule.exports = {' + names.join(',') + '};', sandbox);
  return sandbox.module.exports;
}

function harness(env = {}, spawnError = null) {
  const children = [], heartbeats = [], redisClients = [];
  const config = { enabled: true, env: {
    ACTION_MODE: 'manual', TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_CHAT_ID: '123', TELEGRAM_ADMIN_IDS: '123',
  } };
  const files = new Set(['/usr/local/bin/remnawave-limiter']);
  if (env.REDIS_SOCKET) files.add(resolve(env.REDIS_SOCKET));
  const redisState = { persistent: false };
  class FakeRedis {
    constructor(options) { this.options = options; redisClients.push(this); }
    on() {}
    async connect() {}
    async ping() { return 'PONG'; }
    async config(_action, key) {
      return [key, key === 'appendonly' && redisState.persistent ? 'yes' : ''];
    }
    disconnect() { this.disconnected = true; }
  }
  class Logger { log() {} warn() {} error() {} debug() {} }
  class Child extends EventEmitter {
    constructor() {
      super(); this.pid = spawnError ? undefined : 100 + children.length;
      this.exitCode = null; this.signalCode = null;
      this.stdout = new EventEmitter(); this.stderr = new EventEmitter();
    }
    kill(signal) { this.signalCode = signal; this.emit('exit', null, signal); return true; }
  }
  const { LimiterRunnerService } = loadSource(
    'backend/src/modules/node-operations/limiter-runner.service.ts',
    ['LimiterRunnerService'], {
      Logger, Redis: FakeRedis, createHash, join, resolve, URL, Buffer,
      process: { env }, existsSync: path => files.has(path), mkdirSync() {},
      setTimeout(fn, delay) { const t = setTimeout(fn, Math.min(delay, 5)); t.unref(); return t; },
      clearTimeout, setInterval, clearInterval,
      spawn(binary, args, options) {
        const child = new Child(); children.push({ binary, args, options, child });
        process.nextTick(() => child.emit(spawnError ? 'error' : 'spawn', spawnError));
        return child;
      },
    },
  );
  const runner = new LimiterRunnerService({
    async runtimeConfig() { return { response: config }; },
    async heartbeat(reason) { heartbeats.push(reason); },
  }, { apiToken: 'internal-bearer', webhookSecret: 'internal-hmac' });
  return { runner, config, children, heartbeats, redisClients, redisState, files };
}

test('TCP transport uses panel host/port/password with isolated DB 8', async () => {
  const password = 'test:password/@?#';
  const h = harness({ REDIS_SOCKET: '', REDIS_HOST: 'redis', REDIS_PORT: '6379',
    REDIS_PASSWORD: password, REDIS_DB: '0', JWT_AUTH_SECRET: 'do-not-inherit' });
  await h.runner.tick();
  assert.equal(h.children.length, 1);
  const url = new URL(h.children[0].options.env.REDIS_URL);
  assert.equal(url.hostname, 'redis');
  assert.equal(url.port, '6379');
  assert.equal(url.pathname, '/8');
  assert.equal(decodeURIComponent(url.password), password);
  assert.equal(h.redisClients[0].options.host, 'redis');
  assert.equal(h.redisClients[0].options.db, 8);
  assert.equal(h.redisClients[0].options.password, password);
  assert.equal(h.children[0].options.env.JWT_AUTH_SECRET, undefined);
  assert.equal(h.children[0].options.uid, 10001);
  assert.equal(h.runner.status().response.running, true);
  await h.runner.tick();
  assert.equal(h.children.length, 1, 'unchanged config does not start a second process');
});

test('custom Unix socket and password are passed consistently to both clients', async () => {
  const h = harness({ REDIS_SOCKET: '/run/private redis.sock', REDIS_PASSWORD: 'a@b:c' });
  await h.runner.tick();
  assert.equal(h.children.length, 1);
  assert.equal(h.children[0].options.env.REDIS_URL, 'unix://:a%40b%3Ac@/run/private%20redis.sock?db=8');
  assert.equal(h.redisClients[0].options.path, '/run/private redis.sock');
  assert.equal(h.redisClients[0].options.password, 'a@b:c');
  assert.equal(h.redisClients[0].options.db, 8);
});

test('IPv6 Redis hosts work over TCP', () => {
  for (const host of ['::1', '[::1]']) {
    const h = harness({ REDIS_HOST: host, REDIS_PORT: '6380' });
    const connection = h.runner.redisConnection();
    assert.equal(connection.url, 'redis://[::1]:6380/8');
    assert.equal(connection.options.host, '::1');
  }
});

test('missing panel Redis configuration prevents start and reports the reason', async () => {
  const h = harness();
  await h.runner.tick();
  assert.equal(h.children.length, 0);
  assert.match(h.heartbeats.at(-1), /REDIS_SOCKET or REDIS_HOST/);
});

test('a configured missing socket is not silently replaced with another Redis', async () => {
  const h = harness({ REDIS_SOCKET: '/run/expected.sock' });
  h.files.delete('/run/expected.sock');
  await h.runner.tick();
  assert.equal(h.children.length, 0);
  assert.match(h.heartbeats.at(-1), /socket is missing/);
});

test('automatic mode requires persistence on the chosen Redis', async () => {
  const h = harness({ REDIS_HOST: 'redis', REDIS_PORT: '6379' });
  h.config.env.ACTION_MODE = 'auto';
  await h.runner.tick();
  assert.equal(h.children.length, 0);
  assert.match(h.heartbeats.at(-1), /requires durable Valkey/);
  assert.equal(h.redisClients[0].disconnected, true);
  h.redisState.persistent = true;
  await h.runner.tick();
  assert.equal(h.children.length, 1);
});

test('spawn failure is not reported as a running process or successful heartbeat', async () => {
  const h = harness({ REDIS_HOST: 'redis', REDIS_PORT: '6379' }, new Error('spawn EACCES'));
  await h.runner.tick();
  assert.equal(h.runner.status().response.running, false);
  assert.equal(h.runner.status().response.pid, null);
  assert.deepEqual(h.heartbeats, ['spawn EACCES']);
});

test('unexpected child exit records a diagnostic without exposing child output', async () => {
  const h = harness({ REDIS_HOST: 'redis', REDIS_PORT: '6379' });
  await h.runner.tick();
  h.children[0].child.exitCode = 1;
  h.children[0].child.emit('exit', 1, null);
  assert.equal(h.runner.status().response.running, false);
  assert.equal(h.heartbeats.at(-1), 'Limiter exited: code=1 signal=null');
});

test('disabling the configured engine stops the existing child', async () => {
  const h = harness({ REDIS_HOST: 'redis', REDIS_PORT: '6379' });
  await h.runner.tick();
  h.config.enabled = false;
  await h.runner.tick();
  assert.equal(h.children[0].child.signalCode, 'SIGTERM');
  assert.equal(h.runner.status().response.running, false);
});

test('shutdown during a Redis probe cannot start a new orphan child', async () => {
  const h = harness({ REDIS_HOST: 'redis', REDIS_PORT: '6379' });
  let finishProbe, probeStarted;
  const entered = new Promise(resolve => { probeStarted = resolve; });
  h.runner.checkValkey = () => new Promise(resolve => { finishProbe = resolve; probeStarted(); });
  const tick = h.runner.tick();
  await entered;
  await h.runner.onApplicationShutdown();
  finishProbe();
  await tick;
  assert.equal(h.children.length, 0);
});

test('settings reject zero cooldown, which upstream 5.1.0 cannot start with', () => {
  class BadRequestException extends Error {}
  const { normalizeSettings } = loadSource(
    'backend/src/modules/node-operations/limiter.service.ts', ['normalizeSettings'],
    { BadRequestException, isIP: require('node:net').isIP },
  );
  assert.throws(() => normalizeSettings({ cooldownSeconds: 0 }), /cooldownSeconds/);
  assert.equal(normalizeSettings({ cooldownSeconds: 1 }).cooldownSeconds, 1);
});
