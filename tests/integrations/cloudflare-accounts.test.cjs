const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createCipheriv, createDecipheriv, createHash, randomBytes } = require('node:crypto');
const { appRequire, createSourceLoader } = require('./source-loader.cjs');

appRequire('@nestjs/common').Logger.overrideLogger(false);
const load = createSourceLoader({
  '@common/database/prisma.service': { PrismaService: class {} },
  '@modules/squad-quotas/quota-webhooks.service': { postSignedWebhook: async () => { throw new Error('Mock webhook delivery failed'); } },
});
const { CloudflareDnsService } = load('src/modules/node-operations/cloudflare-dns.service.ts');
const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';
const LEGACY = '00000000-0000-4000-8000-000000000001';
const ZONE_A = 'a'.repeat(32), ZONE_B = 'c'.repeat(32);
const RECORD_A = 'b'.repeat(32), RECORD_B = 'd'.repeat(32);
const TOKEN_A = 'cfat_a_fixture_account_token_with_checksum_123456';
const TOKEN_B = 'fixture_second_account_token_read_write_12345678';
const APP_SECRET = 'fixture-app-secret-'.repeat(5);
const key = () => createHash('sha256').update('remnadrop-cloudflare-dns-v1\0').update(APP_SECRET).digest();
function encryptedAccount(id, name, token) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return { id, name, credential_source:'stored', iv, tag:cipher.getAuthTag(), ciphertext,
    zone_count:1, last_synced_at:null, last_error:null, updated_at:new Date() };
}
function decrypt(row) {
  const cipher = createDecipheriv('aes-256-gcm', key(), row.iv); cipher.setAuthTag(row.tag);
  return Buffer.concat([cipher.update(row.ciphertext), cipher.final()]).toString('utf8');
}
function fixture(t, options = {}) {
  const originalFetch = global.fetch;
  const env = {};
  for (const name of ['APP_SECRET','CLOUDFLARE_DNS_ENCRYPTION_KEY','CLOUDFLARE_DNS_API_TOKEN','CLOUDFLARE_DNS_WEBHOOK_URL','CLOUDFLARE_DNS_WEBHOOK_SECRET']) {
    env[name] = process.env[name]; delete process.env[name];
  }
  process.env.APP_SECRET = APP_SECRET;
  if (options.environment) process.env.CLOUDFLARE_DNS_API_TOKEN = TOKEN_A;
  t.after(() => {
    global.fetch = originalFetch;
    for (const [name,value] of Object.entries(env)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  const accounts = options.noAccounts ? [] : [encryptedAccount(ACCOUNT_A, 'Рабочие домены', TOKEN_A), encryptedAccount(ACCOUNT_B, 'Резерв', TOKEN_B)];
  const zones = new Map([
    [TOKEN_A, options.zones || [{id:ZONE_A,name:'example.com',status:'active',account:{id:'e'.repeat(32),name:'Cloudflare A'}}]],
    [TOKEN_B, [{id:ZONE_B,name:'second.example',status:'active'}]],
  ]);
  const records = new Map([
    [ZONE_A, options.records || [{id:RECORD_A,zone_id:ZONE_A,name:'vpn.example.com',type:'A',content:'192.0.2.10',ttl:300,proxied:true}]],
    [ZONE_B, [{id:RECORD_B,zone_id:ZONE_B,name:'vpn.second.example',type:'AAAA',content:'2001:db8::1',ttl:1,proxied:false}]],
  ]);
  const queries = [], writes = [], calls = [];
  const db = {
    $queryRaw: async (strings, ...values) => {
      const query = strings.join('?'); queries.push({query,values});
      if (query.includes('FROM cf_dns_accounts')) return accounts.map(row => ({...row}));
      if (query.includes('FROM node_automation_rules')) return options.activeRule ? [{name:'Резервный DNS'}] : [];
      if (query.includes('FROM hosts h') || query.includes('FROM cf_dns_record_host_links') || query.includes('FROM cf_dns_zone_bindings')) return [];
      throw new Error('Unexpected fixture query: ' + query);
    },
    $executeRaw: async (strings, ...values) => {
      const query = strings.join('?'); writes.push({query,values});
      if (query.includes('INSERT INTO cf_dns_accounts')) {
        if (values.length === 1) {
          if (!accounts.some(row => row.id === values[0])) accounts.push({id:values[0],name:'Основной аккаунт',credential_source:'environment',iv:null,tag:null,ciphertext:null,zone_count:0,last_synced_at:null,last_error:null,updated_at:new Date()});
        } else accounts.push({id:values[0],name:values[1],credential_source:'stored',iv:values[2],tag:values[3],ciphertext:values[4],zone_count:values[5],last_synced_at:new Date(),last_error:null,updated_at:new Date()});
      } else if (query.includes('UPDATE cf_dns_accounts')) {
        const row = accounts.find(account => account.id === values.at(-1));
        if (row) {
          if (query.includes("credential_source='stored'")) Object.assign(row,{name:values[0],credential_source:'stored',iv:values[1],tag:values[2],ciphertext:values[3],zone_count:values[4],last_error:null});
          else if (query.includes('SET name=')) row.name = values[0];
          else if (query.includes('SET zone_count=')) Object.assign(row,{zone_count:values[0],last_synced_at:new Date(),last_error:null});
          else if (query.includes('SET last_error=')) row.last_error = values[0];
        }
      } else if (query.includes('DELETE FROM cf_dns_accounts')) {
        const index = accounts.findIndex(row => row.id === values[0]); if (index >= 0) accounts.splice(index,1);
      } else if (query.includes('INSERT INTO cf_dns_events')) {
        if (options.auditFailure) throw new Error('Fixture audit database unavailable');
      } else throw new Error('Unexpected fixture write: ' + query);
      return 1;
    },
  };
  let recordReads = 0;
  global.fetch = async (url, init = {}) => {
    const parsed = new URL(url), path = parsed.pathname.replace('/client/v4',''), method = init.method || 'GET';
    const token = init.headers.Authorization.replace(/^Bearer /,'');
    calls.push({path,method,token,url:String(url),body:init.body});
    assert.equal(parsed.origin,'https://api.cloudflare.com'); assert.equal(init.redirect,'error');
    const reply = (result, info) => ({ok:true,status:200,json:async () => ({success:true,result:structuredClone(result),...(info ? {result_info:info} : {})})});
    const denied = () => ({ok:false,status:403,json:async () => ({success:false,errors:[{message:'Do not leak '+token}]})});
    if (!zones.has(token) || (options.rejectSecond && token === TOKEN_B)) return denied();
    const allowed = zones.get(token);
    if (path === '/zones' && method === 'GET') {
      const page = Number(parsed.searchParams.get('page')), size = Number(parsed.searchParams.get('per_page'));
      const start = options.repeatZonePage ? 0 : (page-1)*size;
      return reply(allowed.slice(start,start+size),{page,total_pages:Math.max(1,Math.ceil(allowed.length/size)),total_count:allowed.length});
    }
    const match = path.match(/^\/zones\/([a-f0-9]{32})(?:\/dns_records(?:\/([a-f0-9]{32}))?)?$/);
    if (!match) throw new Error('Unexpected API path '+path);
    const [,zoneId,recordId] = match, zone = allowed.find(zone => zone.id === zoneId);
    if (!zone) return denied();
    if (path === '/zones/'+zoneId) return reply(zone);
    if (options.failedRecordZone === zoneId) return {ok:false,status:503,json:async () => ({success:false})};
    if (!recordId) {
      const rows = records.get(zoneId) || [], page = Number(parsed.searchParams.get('page')), size = Number(parsed.searchParams.get('per_page'));
      return reply(rows.slice((page-1)*size,page*size),{page,total_pages:Math.max(1,Math.ceil(rows.length/size)),total_count:rows.length});
    }
    const record = (records.get(zoneId) || []).find(record => record.id === recordId);
    if (!record) return denied();
    if (method === 'GET') {
      recordReads++;
      return reply({...record,...(options.foreignRecord ? {zone_id:ZONE_B} : {}),...(recordReads > 1 && options.changedRecord ? options.changedRecord : {})});
    }
    if (method === 'PATCH') {
      Object.assign(record,JSON.parse(init.body)); return reply(record);
    }
    throw new Error('Unexpected API method '+method);
  };
  return {service:new CloudflareDnsService(db),accounts,zones,records,queries,writes,calls,
    change:{accountId:ACCOUNT_A,zoneId:ZONE_A,recordId:RECORD_A,expectedOldIp:'192.0.2.10',newIp:'192.0.2.11'}};
}

test('manual IP change works without any Remnawave host or node binding and preserves record settings', async t => {
  const f = fixture(t), result = await f.service.updateRecordIp(f.change);
  assert.equal(result.response.updated,true);
  const patches = f.calls.filter(call => call.method === 'PATCH');
  assert.equal(patches.length,1); assert.equal(patches[0].token,TOKEN_A);
  assert.deepEqual(JSON.parse(patches[0].body),{content:'192.0.2.11'});
  assert.ok(!f.queries.some(query => query.query.includes('FROM hosts')));
  assert.equal(f.records.get(ZONE_A)[0].ttl,300); assert.equal(f.records.get(ZONE_A)[0].proxied,true);
  const audit = f.writes.find(write => write.query.includes('cf_dns_events'));
  assert.equal(audit.values[0],ACCOUNT_A); assert.equal(audit.values[1],'Рабочие домены'); assert.equal(audit.values[9],'updated');
});

test('account-bound DNS edit cannot use a different account token to reach a zone', async t => {
  const f = fixture(t);
  await assert.rejects(f.service.updateRecordIp({...f.change,accountId:ACCOUNT_B}),error => error.getStatus() === 400 && !error.message.includes(TOKEN_B));
  assert.equal(f.calls.filter(call => call.method === 'PATCH').length,0);
});

test('manual target rejects missing account, foreign record and wrong address family', async t => {
  const f = fixture(t);
  await assert.rejects(f.service.updateRecordIp({...f.change,accountId:undefined}),error => error.getStatus() === 400);
  await assert.rejects(f.service.updateRecordIp({...f.change,newIp:'2001:db8::2'}),error => error.getStatus() === 400);
  await assert.rejects(f.service.updateRecordIp({...f.change,recordId:'../../escape'}),error => error.getStatus() === 400);
  assert.equal(f.calls.filter(call => call.method === 'PATCH').length,0);
});

test('unexpected record zone is rejected before any write', async t => {
  const f = fixture(t,{foreignRecord:true});
  await assert.rejects(f.service.updateRecordIp(f.change),error => error.getStatus() === 409);
  assert.equal(f.calls.filter(call => call.method === 'PATCH').length,0);
});

test('direct DNS edit detects a stale expected IP', async t => {
  const f = fixture(t);
  await assert.rejects(f.service.updateRecordIp({...f.change,expectedOldIp:'192.0.2.20'}),error => error.getStatus() === 409);
  assert.equal(f.calls.filter(call => call.method === 'PATCH').length,0);
});

test('direct DNS edit detects a concurrent change immediately before PATCH', async t => {
  const f = fixture(t,{changedRecord:{content:'192.0.2.99'}});
  await assert.rejects(f.service.updateRecordIp(f.change),error => error.getStatus() === 409);
  assert.equal(f.calls.filter(call => call.method === 'PATCH').length,0);
});

test('preview with environment fallback performs no database or DNS writes', async t => {
  const f = fixture(t,{noAccounts:true,environment:true});
  const result = await f.service.previewRecordChange({...f.change,accountId:LEGACY});
  assert.equal(result.response.changed,true); assert.equal(result.response.oldIp,'192.0.2.10');
  assert.equal(f.writes.length,0); assert.equal(f.calls.filter(call => call.method !== 'GET').length,0);
});

test('idempotent current-IP edit returns no-op without provider PATCH or audit write', async t => {
  const f = fixture(t), result = await f.service.updateRecordIp({...f.change,newIp:'192.0.2.10'});
  assert.equal(result.response.noop,true); assert.equal(result.response.updated,false);
  assert.equal(f.calls.filter(call => call.method === 'PATCH').length,0); assert.equal(f.writes.length,0);
});

test('account-owned token is verified through actual zone access and stored encrypted', async t => {
  const f = fixture(t), token = 'cfat_new_account_fixture_checksum_1234567890';
  f.zones.set(token,[{id:'e'.repeat(32),name:'new.example',status:'active'}]);
  const result = await f.service.addAccount({name:'Новый аккаунт',apiToken:token});
  const account = f.accounts.find(account => account.id === result.response.id);
  assert.equal(decrypt(account),token); assert.notEqual(account.ciphertext.toString('utf8'),token);
  assert.ok(!f.calls.some(call => call.path.includes('/user/tokens/verify')));
  for (const field of ['iv','tag','ciphertext','apiToken']) assert.equal(Object.hasOwn(result.response,field),false);
  assert.ok(!JSON.stringify((await f.service.accounts()).response).includes(token));
});

test('rotating one account credential leaves all other accounts intact', async t => {
  const f = fixture(t), before = Buffer.from(f.accounts[1].ciphertext), token = 'cfat_rotated_token_fixture_checksum_1234567890';
  f.zones.set(token,[{id:ZONE_A,name:'example.com',status:'active'}]);
  await f.service.updateAccount(ACCOUNT_A,{name:'Обновлённый',apiToken:token});
  assert.equal(decrypt(f.accounts[0]),token); assert.deepEqual(f.accounts[1].ciphertext,before); assert.equal(decrypt(f.accounts[1]),TOKEN_B);
});

test('all zone and record pages are loaded beyond previous 500-zone and 2000-record limits', async t => {
  const manyZones = Array.from({length:551},(_,index) => ({id:index.toString(16).padStart(32,'0'),name:`zone${index}.example`,status:'active'}));
  manyZones[0] = {id:ZONE_A,name:'example.com',status:'active'};
  const manyRecords = Array.from({length:2101},(_,index) => ({id:index.toString(16).padStart(32,'0'),name:`host${index}.example.com`,type:'A',content:'192.0.2.10',ttl:300}));
  const f = fixture(t,{zones:manyZones,records:manyRecords});
  assert.equal((await f.service.listZones(ACCOUNT_A)).response.length,551);
  assert.equal((await f.service.listRecords(ACCOUNT_A,ZONE_A)).response.length,2101);
  assert.equal(f.calls.filter(call => call.path === '/zones').length,12);
  assert.equal(f.calls.filter(call => call.path.endsWith('/dns_records')).length,22);
});

test('broken provider pagination fails explicitly rather than returning a truncated account', async t => {
  const manyZones = Array.from({length:51},(_,index) => ({id:index.toString(16).padStart(32,'0'),name:`zone${index}.example`,status:'active'}));
  const f = fixture(t,{zones:manyZones,repeatZonePage:true});
  await assert.rejects(f.service.listZones(ACCOUNT_A),error => error.getStatus() === 503);
});

test('one inaccessible account does not hide domains of other accounts', async t => {
  const f = fixture(t,{rejectSecond:true}), result = (await f.service.overview()).response;
  assert.equal(result.zones.length,1); assert.equal(result.zones[0].accountId,ACCOUNT_A);
  assert.equal(result.records.length,1); assert.equal(result.accountErrors.length,1); assert.equal(result.accountErrors[0].accountId,ACCOUNT_B);
  assert.ok(!JSON.stringify(result).includes(TOKEN_A)); assert.ok(!JSON.stringify(result).includes(TOKEN_B));
});

test('zone record failure is visible while other accounts remain usable', async t => {
  const f = fixture(t,{failedRecordZone:ZONE_A}), result = (await f.service.overview()).response;
  assert.equal(result.zones.length,2); assert.equal(result.zoneErrors.length,1); assert.equal(result.records[0].accountId,ACCOUNT_B);
});

test('account used by enabled automation cannot be deleted', async t => {
  const f = fixture(t,{activeRule:true});
  await assert.rejects(f.service.deleteAccount(ACCOUNT_A),error => error.getStatus() === 409);
  assert.equal(f.accounts.length,2); assert.ok(!f.writes.some(write => write.query.includes('DELETE FROM cf_dns_accounts')));
});

test('audit or outgoing webhook failure does not misreport a successful DNS update', async t => {
  const f = fixture(t,{auditFailure:true});
  process.env.CLOUDFLARE_DNS_WEBHOOK_URL = 'https://hooks.example.test';
  process.env.CLOUDFLARE_DNS_WEBHOOK_SECRET = 'test-secret-'.repeat(5);
  const result = await f.service.updateRecordIp(f.change,'automation');
  assert.equal(result.response.updated,true); assert.equal(result.response.auditRecorded,false);
  assert.equal(f.calls.filter(call => call.method === 'PATCH').length,1);
  assert.equal(f.writes.filter(write => write.query.includes('cf_dns_events')).length,1);
  assert.equal(f.writes.find(write => write.query.includes('cf_dns_events')).values[9],'updated');
});
