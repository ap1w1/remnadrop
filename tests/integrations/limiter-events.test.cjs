// Run directly with Node24 or as part of the image integration suite.
// Production TypeScript is executed; only database/control/credential boundaries are replaced.
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {readFileSync,existsSync}=require('node:fs');
const {resolve}=require('node:path');
const {stripTypeScriptTypes}=require('node:module');
const {runInNewContext}=require('node:vm');
const crypto=require('node:crypto');
const {isIP}=require('node:net');
class BadRequestException extends Error{}
class NotFoundException extends Error{}
class ServiceUnavailableException extends Error{}
const root=resolve(__dirname,'../..');
const sourceRoot=existsSync('/app/src/modules/node-operations')?'/app/src/modules/node-operations':resolve(root,'backend/src/modules/node-operations');
function load(file,names){
 const text=readFileSync(resolve(sourceRoot,file),'utf8')
  .replace(/^import .*;\r?\n/gm,'').replace(/^@Injectable\(\)\r?\n/gm,'').replace(/^export /gm,'');
 const scope={Buffer,process,URL,isIP,...crypto,BadRequestException,NotFoundException,ServiceUnavailableException,module:{exports:{}}};
 runInNewContext(stripTypeScriptTypes(text,{mode:'transform'})+'\nmodule.exports={'+names.join(',')+'};',scope);
 return scope.module.exports;
}
const {LimiterService,normalizeSettings}=load('limiter.service.ts',['LimiterService','normalizeSettings']);
const {LimiterCredentialsService}=load('limiter-credentials.service.ts',['LimiterCredentialsService']);
const USER='11111111-1111-4111-8111-111111111111';
const REQUEST='22222222-2222-4222-8222-222222222222';
const secrets={webhookSecret:'internal-webhook-secret',apiToken:'internal-api',controlToken:'internal-control'};
function fixture(config={}){
 const writes=[],calls=[];
 const db={users:{findUnique:async()=>({uuid:USER,tId:42n,username:'sample'}),findMany:async()=>[]},
  $queryRaw:async()=>[{config,last_scan_at:null,last_error:null}],
  $executeRaw:async(query,...values)=>{writes.push({sql:query.join('?'),values});return 1;}};
 const control={overrides:async()=>({}),pendingRestores:async()=>0,health:async()=>null,isProcessExpected:()=>false,pause:async()=>({paused:true,pendingRestores:0}),resume:async()=>{},importLegacyIgnoredUsers:async()=>{},
  importLegacySettings:async values=>{calls.push({importSettings:values})},
  call:async(method,path,body)=>{calls.push({method,path,body});return {success:true,action:body?.action};},
  applySettings:async values=>{calls.push({settings:values})}};
 const credentials={get:async()=>({})};
 const service=new LimiterService(db,credentials,secrets,control);
 return {db,control,credentials,service,writes,calls};
}
function signed(service,payload,timestamp=String(Math.floor(Date.now()/1000))){
 const raw=Buffer.from(JSON.stringify(payload));
 const signature=crypto.createHmac('sha256',secrets.webhookSecret).update(timestamp+'.').update(raw).digest('hex');
 return service.recordWebhook(raw,signature,timestamp);
}

test('signed device event persists complete IP/node/provider evidence and distinct counts',async()=>{
 const h=fixture();const payload={event:'violation_detected',action_mode:'manual',user:{user_id:42,username:'sample'},
  violation:{device_limit:5,device_group_count:7,ip_count:9,connection_count:12,violation_count_24h:3,
   ips:[{ip:'203.0.113.10',asn:64500,asn_org:'Example provider',nodes:[{node_uuid:USER,node_name:'Helsinki',last_seen:'2026-11-22T12:00:00Z'}]}]},
  evidence:{Fetches:{Total:10,IPs:2,Rows:[{IP:'203.0.113.10',Org:'Example provider',Apps:['client'],Count:10,Online:true}]},Devices:{Items:[{Name:'Phone',App:'client',Seen:'2026-11-22T12:00:00Z'}]}},
  timestamp:new Date().toISOString()};
 await signed(h.service,payload);
 assert.equal(h.writes.length,1);assert.ok(h.writes[0].values.includes(JSON.stringify(payload)));
 assert.ok(h.writes[0].values.includes(12));assert.ok(h.writes[0].values.includes(9));assert.ok(h.writes[0].values.includes(7));
 assert.match(h.writes[0].sql,/ON CONFLICT\(webhook_sha256\) DO NOTHING/);
});

test('traffic, HWID, daily report and update notices remain recordable without Telegram',async()=>{
 for(const [event,hasUser] of [['traffic_spike',true],['traffic_heavy',true],['shared_hwid',true],['daily_report',false],['update_available',false]]){
  const h=fixture();const payload={event,data:{Bytes:123,HWID:'shared',Accounts:[{UserID:42}],latest:'5.2.0'},
   ...(hasUser?{user:{user_id:42,username:'sample'}}:{})};
  await signed(h.service,payload);
  assert.equal(h.writes.length,1);assert.ok(h.writes[0].values.includes(JSON.stringify(payload)));
 }
});

test('invalid signatures, stale timestamps, malformed IPs and unsupported event types cause no writes',async()=>{
 const h=fixture();const raw=Buffer.from('{}');
 await assert.rejects(h.service.recordWebhook(raw,'0'.repeat(64),String(Math.floor(Date.now()/1000))),/signature/);
 await assert.rejects(signed(h.service,{event:'daily_report'},'1000000000'),/timestamp/);
 await assert.rejects(signed(h.service,{event:'unknown'}),/Unsupported/);
 await assert.rejects(signed(h.service,{event:'violation_detected',user:{user_id:42,username:'sample'},violation:{ips:[{ip:'not-an-ip'}]}}),/Invalid event IP/);
 assert.equal(h.writes.length,0);
});

test('restore failure and bot actions share the audit without executing another action',async()=>{
 const h=fixture();await signed(h.service,{event:'action',user:{user_id:42,username:'42'},data:{action:'enable',source:'restore',success:false,message:'Retry exhausted'}});
 assert.match(h.writes[0].sql,/INSERT INTO limiter_actions/);
 assert.ok(h.writes[0].values.includes(false));assert.ok(h.writes[0].values.includes('restore'));
 assert.equal(h.calls.length,0,'an activity mirror must never execute an action or create a feedback loop');
});

test('panel actions resolve the numeric ID on the server and preserve the retry key',async()=>{
 const h=fixture({enabled:true});const response=await h.service.action(USER,{action:'disable_temp',minutes:1440,requestId:REQUEST,userId:999});
 assert.equal(response.response.success,true);
 assert.equal(h.calls[0].path,'/actions');assert.equal(h.calls[0].body.userId,42);assert.equal(h.calls[0].body.requestId,REQUEST);
 assert.equal(h.calls[0].body.minutes,1440);
 assert.match(h.writes[0].sql,/ON CONFLICT\(request_id\) DO NOTHING/);
});

test('invalid temporary durations and deleted users never reach the engine',async()=>{
 const h=fixture();
 for(const minutes of [0,-1,525601,1.5])await assert.rejects(h.service.action(USER,{action:'disable_temp',minutes,requestId:REQUEST}));
 h.db.users.findUnique=async()=>null;
 await assert.rejects(h.service.action(USER,{action:'enable',requestId:REQUEST}),/удалён/);
 assert.equal(h.calls.length,0);
});

test('successful actions stay successful when audit persistence fails',async()=>{
 const h=fixture();h.db.$executeRaw=async()=>{throw new Error('Database down')};
 const result=await h.service.action(USER,{action:'unignore',requestId:REQUEST});
 assert.equal(result.response.success,true);assert.match(result.response.warning,/Действие выполнено/);
 assert.equal(h.calls.filter(c=>c.path==='/actions').length,1);
});

test('a delayed settings webhook reads the current runtime snapshot instead of reverting it',async()=>{
 const h=fixture({cooldownSeconds:300,enabled:true,telegramNotifications:true,ignoredUsers:[USER]});
 h.control.call=async()=>[{Key:'COOLDOWN',Display:'10'}];
 await signed(h.service,{event:'settings_changed',data:{COOLDOWN:'999'}});
 assert.equal(JSON.parse(h.writes[0].values[0]).cooldownSeconds,10);
 assert.match(h.writes[0].sql,/config=config\|\|/);
 for(const key of ['enabled','telegramNotifications','ignoredUsers','ignoredNodes','ignoredIps'])
   assert.equal(Object.hasOwn(JSON.parse(h.writes[0].values[0]),key),false,'delayed mirror must never overwrite '+key);
});

test('headless runtime keeps factory reset values stable and actual mode separate',async()=>{
 const h=fixture({enabled:true,mode:'auto',cooldownSeconds:10,telegramNotifications:false});
 const {response}=await h.service.runtimeConfig();
 assert.equal(response.mode,'auto');assert.equal(response.env.ACTION_MODE,'manual');assert.equal(response.env.COOLDOWN,'300');
 assert.equal(response.env.REMNADROP_TELEGRAM_NOTIFICATIONS,'false');assert.equal(response.env.TELEGRAM_BOT_TOKEN,undefined);
 assert.equal(h.calls[0].importSettings.COOLDOWN,'10');assert.equal(h.calls[0].importSettings.ACTION_MODE,'auto');
 assert.equal(normalizeSettings({}).telegramNotifications,true);
 assert.throws(()=>normalizeSettings({telegramNotifications:'false'}),/flags/);
});

test('disabling Limiter is rejected while temporary restores are pending',async()=>{
 const h=fixture({enabled:true});h.control.pendingRestores=async()=>1;
 await assert.rejects(h.service.update({enabled:false}),/временные блокировки/);
 assert.equal(h.writes.length,0);assert.equal(h.calls.length,0);
});

test('stop barrier catches a temporary timer written after the stop request began',async()=>{
 const h=fixture({enabled:true});let resumed=0;
 h.control.health=async()=>({ready:true,pauseReason:''});
 h.control.pendingRestores=async()=>0; // A pre-barrier lookup would miss the race.
 h.control.pause=async()=>({paused:true,pendingRestores:1});
 h.control.resume=async()=>{resumed++};
 await assert.rejects(h.service.update({enabled:false}),/временные блокировки/);
 assert.equal(resumed,1);assert.equal(h.writes.length,0);
});

test('failed settings apply or database write reopens admission instead of leaving a running limiter paused',async()=>{
 for(const failed of ['apply','database','pause']){
  const h=fixture({enabled:true});let resumed=0;
  h.control.health=async()=>({ready:true});h.control.resume=async()=>{resumed++};
  if(failed==='apply')h.control.applySettings=async()=>{throw new Error('apply failure')};
  if(failed==='database')h.db.$executeRaw=async()=>{throw new Error('database failure')};
  if(failed==='pause')h.control.pause=async()=>{throw new Error('pause timeout')};
  await assert.rejects(h.service.update({enabled:false}));assert.equal(resumed,1,failed);
 }
});

test('startup activation cannot cross an in-progress enabled=false commit',async()=>{
 const config={enabled:true},h=fixture(config);let writeEntered,finishWrite,resumed=0;
 const entered=new Promise(resolve=>{writeEntered=resolve});
 const committed=new Promise(resolve=>{finishWrite=resolve});
 h.control.health=async()=>({ready:false,pauseReason:'startup'});
 h.control.resume=async()=>{resumed++};
 h.db.$executeRaw=async(_query,value)=>{writeEntered();await committed;Object.assign(config,JSON.parse(value));return 1;};
 const stop=h.service.update({enabled:false});await entered;
 const activate=h.service.activateStartup();
 finishWrite();await stop;await activate;
 assert.equal(config.enabled,false);assert.equal(resumed,0);
});

test('panel cannot create new disables after the saved enabled flag is false',async()=>{
 const h=fixture({enabled:false});
 await assert.rejects(h.service.action(USER,{action:'disable_temp',minutes:1440,requestId:REQUEST}),/выключен/);
 assert.equal(h.calls.length,0);
 // Recovery remains available while the disabled engine finishes its queue.
 assert.equal((await h.service.action(USER,{action:'enable',requestId:REQUEST})).response.success,true);
});

test('a known running engine with a failed health/pause probe never falls back to a racy Redis count',async()=>{
 const h=fixture({enabled:false});let stopped=0,lookups=0;
 h.control.isProcessExpected=()=>true;h.control.pause=async()=>{throw new Error('socket unavailable')};
 h.control.pendingRestores=async()=>{lookups++;return 0};
 await assert.rejects(h.service.pauseForStop(true,async()=>{stopped++}),/socket/);
 assert.equal(stopped,0);assert.equal(lookups,0);
 const active=fixture({enabled:true});active.control.isProcessExpected=()=>true;
 active.control.pause=h.control.pause;
 await assert.rejects(active.service.update({enabled:false}),/socket/);
 assert.equal(active.writes.length,0,'failed live-engine barrier must not persist disabled');
});

test('settings cannot resume admission until a drained stop or config replacement has finished',async()=>{
 for(const operation of ['stop','restart']){
  const h=fixture({enabled:false});let entered,release,resumes=0;
  const started=new Promise(resolve=>{entered=resolve});const finished=new Promise(resolve=>{release=resolve});
  h.control.health=async()=>({ready:false,pauseReason:'stopping'});h.control.resume=async()=>{resumes++};
  const critical=operation==='stop'
   ? h.service.pauseForStop(true,async()=>{entered();await finished})
   : h.service.withRuntimeChange(async()=>{entered();await finished});
  await started;
  const enable=h.service.update({enabled:true});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(resumes,0,operation);
  release();await critical;await enable;assert.equal(resumes,1,operation);
 }
});

test('partial secret updates preserve the existing Telegram token and never return it',async t=>{
 const original=process.env.REMNADROP_LIMITER_ENCRYPTION_KEY;process.env.REMNADROP_LIMITER_ENCRYPTION_KEY='a'.repeat(64);
 t.after(()=>{if(original===undefined)delete process.env.REMNADROP_LIMITER_ENCRYPTION_KEY;else process.env.REMNADROP_LIMITER_ENCRYPTION_KEY=original});
 let stored=null;
 const db={$executeRaw:async(_query,iv,tag,ciphertext)=>{stored={iv,tag,ciphertext};return 1;},$queryRaw:async query=>{
  if(query.join('').includes('SELECT updated_at'))return stored?[{updated_at:new Date()}]:[];
  return stored?[stored]:[];
 }};
 const credentials=new LimiterCredentialsService(db),token='123456:'+'x'.repeat(35);
 await credentials.save({telegramBotToken:token,telegramChatId:'-1001234',telegramAdminIds:'123'});
 const result=await credentials.save({telegramBotToken:'',maxmindLicenseKey:'maxmind-license',sharedHwidSquadUuids:[]});
 assert.equal((await credentials.get()).telegramBotToken,token);
 assert.equal((await credentials.get()).maxmindLicenseKey,'maxmind-license');
 assert.equal(result.response.telegramConfigured,true);assert.equal(result.response.maxmindConfigured,true);
 assert.equal(JSON.stringify(result).includes(token),false);assert.equal(JSON.stringify(stored).includes(token),false);
});
