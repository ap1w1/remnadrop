const assert = require('node:assert/strict');
const { test } = require('node:test');
const { appRequire, createSourceLoader } = require('./source-loader.cjs');

appRequire('@nestjs/common').Logger.overrideLogger(false);
const load = createSourceLoader({
  '@common/database/prisma.service': { PrismaService: class {} },
  '@queue/_nodes': { NodesQueuesService: class {} },
  '@modules/users/users.service': { UsersService: class {} },
});
const { LimiterBridgeController } = load('src/modules/node-operations/limiter-bridge.controller.ts');
const { limiterSubscriptionUrl } = load('src/modules/node-operations/limiter.service.ts');
const USER = '11111111-1111-4111-8111-111111111111';

function fixture(result, found = true) {
  const calls = [];
  const db = { users: { findUnique: async ({where}) => {
    assert.equal(where.tId, 42n);
    return found ? { uuid: USER } : null;
  } } };
  const users = {
    disableUser: async id => { calls.push(['disable', id]); return result; },
    enableUser: async id => { calls.push(['enable', id]); return result; },
  };
  return { calls, bridge: new LimiterBridgeController(db, {}, users, {}) };
}

test('bridge preserves A029/A030 after a concurrent desired-state change for Go restore semantics', async () => {
  // The user lookup can precede a concurrent action. Use the actual operation's
  // result, rather than assuming a status observed before the call is current.
  for (const [action, code, message] of [
    ['disable', 'A029', 'User already disabled'],
    ['enable', 'A030', 'User already enabled'],
  ]) {
    const {bridge, calls} = fixture({isOk:false, code, message});
    await assert.rejects(bridge[action]('42'), error => {
      assert.equal(error.getStatus(), 400);
      assert.deepEqual(error.getResponse(), {statusCode:400, code, message});
      // This is the exact check in pinned Go api.hasPanelError.
      assert.ok(JSON.stringify(error.getResponse()).includes('"'+code+'"'));
      return true;
    });
    assert.deepEqual(calls, [[action, USER]]);
  }
});

test('bridge keeps successful enable/disable responses and actual user UUID targeting', async () => {
  for (const action of ['disable', 'enable']) {
    const {bridge, calls} = fixture({isOk:true,response:{uuid:USER}});
    assert.deepEqual(await bridge[action]('42'), {response:{success:true}});
    assert.deepEqual(calls, [[action, USER]]);
  }
});

test('bridge does not reinterpret a real operation failure as already enabled or disabled', async () => {
  for (const [action, code] of [['disable','A028'], ['enable','A031']]) {
    const {bridge} = fixture({isOk:false,code,message:'Operation failed'});
    await assert.rejects(bridge[action]('42'), error => {
      assert.equal(error.getStatus(), 400);
      assert.equal(error.getResponse().code, code);
      assert.ok(!['A029','A030'].includes(error.getResponse().code));
      return true;
    });
  }
});

test('deleted users and invalid numeric IDs never reach subscription actions', async () => {
  const {bridge, calls} = fixture({isOk:true}, false);
  for (const action of ['disable','enable']) {
    await assert.rejects(bridge[action]('42'), error => error.getStatus()===404);
    for (const value of ['-1','0','4.2','9007199254740992','../../users']) {
      await assert.rejects(bridge[action](value), error => error.getStatus()===400);
    }
  }
  assert.deepEqual(calls, []);
});

test('subscription links use configured public subscription domain and the short UUID', t => {
  const original=process.env.SUB_PUBLIC_DOMAIN;
  t.after(()=>{if(original===undefined)delete process.env.SUB_PUBLIC_DOMAIN;else process.env.SUB_PUBLIC_DOMAIN=original;});
  process.env.SUB_PUBLIC_DOMAIN='subscriptions.example.com';
  assert.equal(limiterSubscriptionUrl('short-id'), 'https://subscriptions.example.com/short-id');
  process.env.SUB_PUBLIC_DOMAIN='https://subscriptions.example.com/sub/';
  assert.equal(limiterSubscriptionUrl('short-id'), 'https://subscriptions.example.com/sub/short-id');
  assert.equal(limiterSubscriptionUrl('a/b'), 'https://subscriptions.example.com/sub/a%2Fb');
  for (const value of ['javascript:alert(1)', 'https://user:secret@example.com', '']) {
    process.env.SUB_PUBLIC_DOMAIN=value;
    assert.equal(limiterSubscriptionUrl('short-id'), null);
  }
  process.env.SUB_PUBLIC_DOMAIN='subscriptions.example.com';
  assert.equal(limiterSubscriptionUrl(null), null);
});

test('bridge user view exposes its subscription URL and no transport credentials', async t => {
  const original=process.env.SUB_PUBLIC_DOMAIN;
  process.env.SUB_PUBLIC_DOMAIN='subscriptions.example.com';
  t.after(()=>{if(original===undefined)delete process.env.SUB_PUBLIC_DOMAIN;else process.env.SUB_PUBLIC_DOMAIN=original;});
  let selection;
  const db={users:{findUnique:async query=>{selection=query;return {
    tId:42n,username:'example-user',status:'ACTIVE',email:null,telegramId:null,
    shortUuid:'short-id',hwidDeviceLimit:5,createdAt:new Date('2026-11-22T00:00:00Z'),
    activeInternalSquads:[{internalSquad:{uuid:USER,name:'Example'}}],
  };}}};
  const bridge=new LimiterBridgeController(db,{}, {}, {});
  const {response}=await bridge.user('42');
  assert.equal(selection.where.tId,42n);
  assert.equal(response.subscriptionUrl,'https://subscriptions.example.com/short-id');
  assert.equal(response.id,42);
  assert.deepEqual(response.activeInternalSquads,[{uuid:USER,name:'Example'}]);
  for(const key of ['trojanPassword','ssPassword','vlessUuid']) {
    assert.ok(!Object.hasOwn(selection.select,key));
    assert.ok(!Object.hasOwn(response,key));
  }
});
