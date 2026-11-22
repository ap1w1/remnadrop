const assert=require('node:assert/strict');
const {test}=require('node:test');
const {createHash}=require('node:crypto');
const {createSourceLoader}=require('./source-loader.cjs');
const delivered=[];
const load=createSourceLoader({
  '@common/database/prisma.service':{PrismaService:class{}},
  '@modules/squad-quotas/quota-webhooks.service':{
    postSignedWebhook:async(...args)=>{delivered.push(args);},
  },
});
const {LimiterOutboundWebhookService}=load('src/modules/node-operations/limiter-outbound-webhook.service.ts');
const URL='https://hooks.example.org/api/limiter';
const SECRET='super-secret-for-ci-test-at-least-32-chars';
function withConfig(t,url=URL){
  const prev=Object.fromEntries(['LIMITER_OUTBOUND_WEBHOOK_URL','LIMITER_OUTBOUND_WEBHOOK_SECRET',
    'LIMITER_OUTBOUND_WEBHOOK_EVENTS'].map(name=>[name,process.env[name]]));
  Object.assign(process.env,{LIMITER_OUTBOUND_WEBHOOK_URL:url,LIMITER_OUTBOUND_WEBHOOK_SECRET:SECRET,
    LIMITER_OUTBOUND_WEBHOOK_EVENTS:'violation_detected,action'});
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
test('enqueue is idempotent and requires explicit valid outbound configuration',async t=>{
  const f=fixture();
  const oldUrl=process.env.LIMITER_OUTBOUND_WEBHOOK_URL;
  delete process.env.LIMITER_OUTBOUND_WEBHOOK_URL;
  t.after(()=>{if(oldUrl===undefined)delete process.env.LIMITER_OUTBOUND_WEBHOOK_URL;else process.env.LIMITER_OUTBOUND_WEBHOOK_URL=oldUrl});
  await f.service.enqueue('id','action',{user:{id:42}});
  assert.equal(f.writes.length,0);
});
test('configured outgoing webhook stores an event key and never persists signing secret',async t=>{
  withConfig(t);
  const f=fixture();
  await f.service.enqueue('action:key','action',{user:{id:42}});
  assert.equal(f.writes.length,1);
  assert.match(f.writes[0].query,/ON CONFLICT\(event_key\) DO NOTHING/);
  assert.equal(f.writes[0].params[0],'action:key');
  assert.equal(JSON.stringify(f.writes).includes(SECRET),false);
});
test('outbox delivers signed event with stable event ID and records success',async t=>{
  withConfig(t);delivered.length=0;
  const f=fixture([row()]);
  await f.service.deliver();
  assert.equal(delivered.length,1);
  assert.equal(delivered[0][0],URL);
  assert.equal(delivered[0][2],SECRET);
  assert.equal(delivered[0][3],row().id);
  assert.match(f.writes.map(w=>w.query).join(' '),/delivered_at=now/);
});
test('a destination change cannot forward previously queued IP-bearing events',async t=>{
  withConfig(t,'https://another.example.org/event');delivered.length=0;
  const f=fixture([row()]);
  await f.service.deliver();
  assert.equal(delivered.length,0);
  assert.match(f.writes.map(w=>w.query).join(' '),/last_error=/);
});
