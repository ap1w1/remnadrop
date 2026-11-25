const assert=require('node:assert/strict');
const {test}=require('node:test');
const {createHash,createHmac}=require('node:crypto');
const {createSourceLoader}=require('./source-loader.cjs');
const load=createSourceLoader({
  '@common/database/prisma.service':{PrismaService:class{}},
});
const {LimiterOutboundWebhookService}=load('src/modules/node-operations/limiter-outbound-webhook.service.ts');
const URL='https://hooks.example.org/api/limiter';
const SECRET='super-secret-for-ci-test-at-least-32-chars';
function withConfig(t,url=URL){
  const prev=Object.fromEntries(['WEBHOOK_ENABLED','WEBHOOK_URL','WEBHOOK_SECRET_HEADER'].map(name=>[name,process.env[name]]));
  Object.assign(process.env,{WEBHOOK_ENABLED:'true',WEBHOOK_URL:url,WEBHOOK_SECRET_HEADER:SECRET});
  t.after(()=>{for(const [key,value]of Object.entries(prev)){if(value===undefined)delete process.env[key];else process.env[key]=value}});
}
const row=()=>({
  id:'11111111-1111-4111-8111-111111111111',
  event_key:'event-one',event_type:'violation_detected',
  destination_hash:createHash('sha256').update(URL).digest('hex'),
  payload:{user:{id:42}},attempts:1,created_at:new Date('2026-11-22T22:00:00Z'),
});
function fixture(rows=[]){
  const writes=[];let reads=0;
  const db={
    $executeRaw:async(strings,...params)=>{writes.push({query:strings.join('?'),params});return 1;},
    $queryRaw:async()=>{reads++;return rows;},
  };
  return {service:new LimiterOutboundWebhookService(db),writes,getReads:()=>reads};
}
test('enqueue requires the panel webhook configuration',async t=>{
  const f=fixture();
  const oldEnabled=process.env.WEBHOOK_ENABLED;
  process.env.WEBHOOK_ENABLED='false';
  t.after(()=>{if(oldEnabled===undefined)delete process.env.WEBHOOK_ENABLED;else process.env.WEBHOOK_ENABLED=oldEnabled});
  await f.service.enqueue('id','action',{user:{id:42}});
  assert.equal(f.writes.length,0);
});
test('configured outgoing webhook stores an event key and never persists signing secret',async t=>{
  withConfig(t);
  const f=fixture();
  await f.service.enqueue('action:key','action',{user:{id:42}});
  assert.equal(f.writes.length,1);
  assert.match(f.writes[0].query,/ON CONFLICT\(event_key\) DO NOTHING/);
  assert.equal(f.writes[0].params[0],'action:key:'+createHash('sha256').update(URL).digest('hex'));
  assert.equal(JSON.stringify(f.writes).includes(SECRET),false);
});
test('outbox delivers with Remnawave signature and records success',async t=>{
  withConfig(t);
  const delivered=[];
  const oldFetch=global.fetch;
  global.fetch=async(...args)=>{delivered.push(args);return {ok:true,status:200}};
  t.after(()=>{global.fetch=oldFetch});
  const f=fixture([row()]);
  await f.service.deliver();
  assert.equal(delivered.length,1);
  assert.equal(delivered[0][0],URL);
  const request=delivered[0][1],payload=JSON.parse(request.body);
  assert.equal(payload.id,row().id);
  assert.equal(payload.event,'limiter.violation_detected');
  assert.equal(request.headers['X-Remnawave-Signature'],createHmac('sha256',SECRET).update(request.body).digest('hex'));
  assert.equal(request.headers['X-Remnawave-Timestamp'],row().created_at.toISOString());
  assert.match(f.writes.map(w=>w.query).join(' '),/delivered_at=now/);
});
test('a destination change cannot forward previously queued IP-bearing events',async t=>{
  withConfig(t,'https://another.example.org/event');
  const delivered=[];
  const oldFetch=global.fetch;
  global.fetch=async(...args)=>{delivered.push(args);return {ok:true,status:200}};
  t.after(()=>{global.fetch=oldFetch});
  const f=fixture([row()]);
  await f.service.deliver();
  assert.equal(delivered.length,0);
  assert.match(f.writes.map(w=>w.query).join(' '),/last_error=/);
});
