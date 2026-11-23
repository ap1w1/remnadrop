const assert=require('node:assert/strict');
const {test}=require('node:test');
const {createSourceLoader}=require('./source-loader.cjs');
const {safeDpiResponse}=createSourceLoader()('src/modules/node-operations/dpi-response-sanitizer.ts');

test('DPI full response keeps measurements without saving subscription credentials',()=>{
 const raw={status:'completed',results:[
   {pop_id:123,connected:false,latency_ms:null,uri:'vless://hidden-user-id@secret.example.com',nested:{password:'opaque',error:'connection denied'}},
   {pop_id:124,connected:true,host:'vless://other-secret',key:'raw-secret',headers:{authorization:'Bearer hidden'}}
 ],balance:12};
 const output=safeDpiResponse(raw);
 assert.equal(output.status,'completed');
 assert.equal(output.balance,12);
 assert.equal(output.results[0].pop_id,123);
 assert.equal(output.results[0].connected,false);
 const serialized=JSON.stringify(output);
 for(const secret of ['hidden-user-id','other-secret','raw-secret','Bearer hidden','opaque'])
   assert.equal(serialized.includes(secret),false);
 assert.match(serialized,/credential redacted/);
});
test('DPI sanitizer handles non-JSON or circular data safely',()=>{
 const self={a:1};self.circular=self;
 const clean=safeDpiResponse(self);
 assert.equal(clean.a,1);assert.equal(clean.circular,'[circular]');
});
