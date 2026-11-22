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
  const children = [], heartbeats = [], redisClients = [], timerDelays=[];
  const config = { enabled: true, mode:'manual', env: {
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
      setTimeout(fn, delay) { timerDelays.push(delay);const t = setTimeout(fn, Math.min(delay, 5)); t.unref(); return t; },
      clearTimeout, setInterval, clearInterval,
      spawn(binary, args, options) {
        const child = new Child(); children.push({ binary, args, options, child });
        process.nextTick(() => child.emit(spawnError ? 'error' : 'spawn', spawnError));
        return child;
      },
    },
  );
  const control = { socketPath:'/var/lib/remnawave/limiter/control.sock',ready:true,pauseReason:'',pending:0,expected:false,
    setProcessExpected(value){this.expected=value;},isProcessExpected(){return this.expected;},
    async health(){return {ready:this.ready,pauseReason:this.pauseReason,lastCheck:'2026-11-22T19:00:00.000Z'};},
    async pause(){this.ready=false;this.pauseReason='stopping';return {paused:true,pendingRestores:this.pending};},
    async resume(){this.ready=true;this.pauseReason='';},
  };
  const runner = new LimiterRunnerService({
    async runtimeConfig() { return { response: config }; },
    async heartbeat(reason) { heartbeats.push(reason); },
    async pauseForStop(_running,stop){if(config.enabled)return null;const paused=await control.pause();if(paused.pendingRestores===0)await stop();return paused;},
    async activateStartup(){if(config.enabled)await control.resume();return control.health();},
    async withRuntimeChange(operation){return operation();},
  }, { apiToken: 'internal-bearer', webhookSecret: 'internal-hmac', controlToken:'internal-control' },control);
  return { runner, config, children, heartbeats, redisClients, redisState, files,control,timerDelays };
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
  assert.equal(h.children[0].options.env.REMNADROP_PANEL_CONTROL_SOCKET,'/var/lib/remnawave/limiter/control.sock');
  assert.equal(h.children[0].options.env.REMNADROP_PANEL_CONTROL_TOKEN,'internal-control');
  assert.equal(h.runner.status().response.running, true);
  assert.equal(h.runner.status().response.ready,true);
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
  h.config.mode = 'auto';
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

for (const key of ['TELEGRAM_CHAT_ID', 'TELEGRAM_ADMIN_IDS']) {
  test('an invalid partial Telegram config is rejected without killing the current restoration process: ' + key, async () => {
    const h = harness({ REDIS_HOST: 'redis', REDIS_PORT: '6379' });
    await h.runner.tick();
    delete h.config.env[key];
    const reports = [];
    h.runner.limiter.heartbeat = async reason => {
      reports.push({ reason, signal: h.children[0].child.signalCode,
        running: h.runner.status().response.running });
    };
    await h.runner.tick();
    assert.deepEqual(reports, [{
      reason: 'Укажите Chat ID и Admin IDs для Telegram или отключите Telegram-уведомления',
      signal: null, running: true,
    }]);
    assert.equal(h.children.length, 1, 'no replacement starts with missing credentials');
    assert.equal(h.runner.status().response.running, true);
  });
}

test('removing Telegram credentials restarts into panel-only mode',async()=>{
 const h=harness({REDIS_HOST:'redis',REDIS_PORT:'6379'});
 await h.runner.tick();
 for(const key of ['TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','TELEGRAM_ADMIN_IDS'])delete h.config.env[key];
 await h.runner.tick();
 assert.equal(h.children.length,2);
 assert.equal(h.children[0].child.signalCode,'SIGTERM');
 assert.equal(h.children[1].options.env.TELEGRAM_BOT_TOKEN,undefined);
 assert.equal(h.runner.status().response.ready,true);
});

test('spawned process is not reported ready before its authenticated control socket responds',async()=>{
 const h=harness({REDIS_HOST:'redis',REDIS_PORT:'6379'});
 h.control.ready=false;await h.runner.tick();
 assert.equal(h.runner.status().response.running,true);
 assert.equal(h.runner.status().response.ready,false);
 h.control.ready=true;await h.runner.tick();
 assert.equal(h.runner.status().response.ready,true);
 assert.equal(h.runner.status().response.lastCheck,'2026-11-22T19:00:00.000Z');
 assert.equal(h.children.length,1);
});

test('disabled engine drains in-flight restores and keeps recovery running until the queue is empty',async()=>{
 const h=harness({REDIS_HOST:'redis',REDIS_PORT:'6379'});
 await h.runner.tick();h.config.enabled=false;h.control.pending=1;
 await h.runner.tick();
 assert.equal(h.children[0].child.signalCode,null,'a newly queued temporary restore must not be killed');
 assert.equal(h.runner.status().response.restoring,true);assert.equal(h.runner.status().response.ready,false);
 h.control.pending=0;await h.runner.tick();
 assert.equal(h.children[0].child.signalCode,'SIGTERM');
 assert.equal(h.runner.status().response.running,false);
});

test('failed stop barrier never kills the process that owns pending restoration',async()=>{
 const h=harness({REDIS_HOST:'redis',REDIS_PORT:'6379'});
 await h.runner.tick();h.config.enabled=false;
 h.runner.limiter.pauseForStop=async()=>{throw new Error('Redis or pause timeout')};
 await h.runner.tick();assert.equal(h.children[0].child.signalCode,null);
 assert.equal(h.runner.status().response.running,true);assert.match(h.heartbeats.at(-1),/безопасно остановить/);
});

test('disabled Limiter restarts in recovery-only mode after a process restart with queued restores',async()=>{
 const h=harness({REDIS_HOST:'redis',REDIS_PORT:'6379'});
 h.config.enabled=false;h.config.mode='auto';h.control.pending=1;
 await h.runner.tick();
 assert.equal(h.children.length,1);assert.equal(h.runner.status().response.restoring,true);
 assert.equal(h.runner.status().response.ready,false);
 assert.equal(h.control.pauseReason,'stopping');
});

test('startup is activated only after the service rechecks the latest saved enabled state',async()=>{
 const h=harness({REDIS_HOST:'redis',REDIS_PORT:'6379'});
 h.control.ready=false;h.control.pauseReason='startup';
 h.runner.limiter.activateStartup=async()=>{h.config.enabled=false;return h.control.health()};
 await h.runner.tick();
 assert.equal(h.runner.status().response.ready,false);
 await h.runner.tick();assert.equal(h.children[0].child.signalCode,'SIGTERM');
});

test('credential or notification restart drains mutations before replacing the child',async()=>{
 const h=harness({REDIS_HOST:'redis',REDIS_PORT:'6379'});await h.runner.tick();
 let releasePause,pauseStarted;const entered=new Promise(resolve=>{pauseStarted=resolve});
 h.control.pause=()=>new Promise(resolve=>{releasePause=()=>resolve({paused:true,pendingRestores:1});pauseStarted()});
 h.config.env.REMNADROP_TELEGRAM_NOTIFICATIONS='false';const restart=h.runner.tick();await entered;
 assert.equal(h.children.length,1);assert.equal(h.children[0].child.signalCode,null);
 releasePause();await restart;
 assert.equal(h.children[0].child.signalCode,'SIGTERM');assert.equal(h.children.length,2);
});

test('failed restart drain preserves the old process and retries after recovery',async()=>{
 const h=harness({REDIS_HOST:'redis',REDIS_PORT:'6379'});await h.runner.tick();
 const pause=h.control.pause;h.control.pause=async()=>{throw new Error('control unavailable')};
 h.config.env.REMNADROP_TELEGRAM_NOTIFICATIONS='false';await h.runner.tick();
 assert.equal(h.children.length,1);assert.equal(h.children[0].child.signalCode,null);assert.equal(h.control.expected,true);
 h.control.pause=pause;await h.runner.tick();assert.equal(h.children.length,2);
});

test('an aborted stop with enabled=true resumes through the service on the next health check',async()=>{
 const h=harness({REDIS_HOST:'redis',REDIS_PORT:'6379'});await h.runner.tick();
 h.control.pauseReason='stopping';h.control.ready=false;
 await h.runner.tick();assert.equal(h.control.pauseReason,'');assert.equal(h.runner.status().response.ready,true);
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

test('application shutdown drains the shared gate before SIGTERM and allows durable queued restores',async()=>{
 const h=harness({REDIS_HOST:'redis',REDIS_PORT:'6379'});await h.runner.tick();
 let finishTimer,enteredPause;const entered=new Promise(resolve=>{enteredPause=resolve});
 h.control.pause=()=>new Promise(resolve=>{finishTimer=()=>resolve({paused:true,pendingRestores:1});enteredPause()});
 let locked=false;h.runner.limiter.withRuntimeChange=async operation=>{locked=true;try{return await operation()}finally{locked=false}};
 const originalKill=h.children[0].child.kill.bind(h.children[0].child);
 h.children[0].child.kill=signal=>{assert.equal(locked,true,'shutdown must hold lifecycle until process exit');return originalKill(signal)};
 const closing=h.runner.onApplicationShutdown();await entered;
 assert.equal(h.children[0].child.signalCode,null,'pending timer write must finish before SIGTERM');
 finishTimer();await closing;
 assert.equal(h.children[0].child.signalCode,'SIGTERM');assert.equal(h.control.expected,false);
 assert.ok(h.timerDelays.includes(15000),'shutdown grace exceeds upstream 10-second timer storage timeout');
});

test('application shutdown retries a bounded pause timeout once then terminates with a bounded grace',async()=>{
 const h=harness({REDIS_HOST:'redis',REDIS_PORT:'6379'});await h.runner.tick();
 let attempts=0;h.control.pause=async()=>{attempts++;throw new Error('control timed out')};
 await h.runner.onApplicationShutdown();
 assert.equal(attempts,2);assert.equal(h.children[0].child.signalCode,'SIGTERM');
 assert.ok(h.timerDelays.includes(15000));assert.equal(h.runner.status().response.running,false);
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
