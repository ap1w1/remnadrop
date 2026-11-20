// Run only against an isolated development installation, inside its API container.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const jwt=require('jsonwebtoken');
const {PrismaClient}=require('@prisma/client');
const constants=require('../dist/libs/contract/constants');
async function main() {
 const db=new PrismaClient();
 const suffix=randomUUID();
 let admin,user,node,squad;
 try {
  admin=await db.admin.create({data:{username:`smoke-${suffix}`,passwordHash:'disabled-test-account',role:constants.ROLE.ADMIN}});
  const token=jwt.sign({uuid:admin.uuid,username:admin.username,role:admin.role},process.env.APP_SECRET,{expiresIn:'5m'});
  const headers={'X-Forwarded-For':'127.0.0.1','X-Forwarded-Proto':'https',Authorization:`Bearer ${token}`,[constants.REMNAWAVE_CLIENT_TYPE_HEADER]:constants.REMNAWAVE_CLIENT_TYPE_BROWSER,'Content-Type':'application/json'};
  const request=async(path,options={})=>{
   const r=await fetch('http://127.0.0.1:3000'+path,{headers,...options});
   assert.ok(r.ok,`${path}: HTTP ${r.status} ${await (r.ok?Promise.resolve(''):r.text())}`);
   return r.json();
  };
  user=await db.users.create({data:{username:`test-${suffix}`,shortUuid:suffix,expireAt:new Date('2030-01-01'),trojanPassword:suffix,vlessUuid:randomUUID(),ssPassword:suffix}});
  squad=await db.internalSquads.create({data:{name:`test-${suffix}`}});
  await db.internalSquadMembers.create({data:{userId:user.tId,internalSquadUuid:squad.uuid}});
  node=await db.nodes.create({data:{name:`test-${suffix}`,address:`${suffix}.invalid`}});
  const path=`/api/users/${user.uuid}/node-quotas`;
  await request(`${path}/${node.uuid}`,{method:'PUT',body:JSON.stringify({limitBytes:'1000',periodDays:30})});
  const quotas=await request(path);
  assert.equal(String(quotas.response[0].limit_bytes),'1000');
  await request(`${path}/${node.uuid}/reset`,{method:'POST'});
  const defaults=(await request('/api/monitoring/settings')).response.defaults;
  await request(`/api/monitoring/settings/${node.uuid}`,{method:'PUT',body:JSON.stringify({...defaults,enabled:true,onlineDropPercent:40})});
  assert.equal((await request('/api/monitoring/settings')).response.rules.find(r=>r.scope===node.uuid).settings.onlineDropPercent,40);
  await request(`/api/monitoring/settings/${node.uuid}`,{method:'DELETE'});
  await request('/api/monitoring/alerts');
  const query=new URLSearchParams({nodes:node.uuid,from:new Date(Date.now()-3600000).toISOString(),to:new Date().toISOString()});
  await request('/api/nodes/metrics/history?'+query);
  const agentToken=(await request(`/api/nodes/${node.uuid}/metrics-agent/token`)).response.token;
  await request(`/api/nodes/${node.uuid}/metrics-agent`,{method:'POST',headers:{...headers,Authorization:`Bearer ${agentToken}`},body:JSON.stringify({cpu:42})});
  const denied=await fetch('http://127.0.0.1:3000'+path,{headers:{'X-Forwarded-For':'127.0.0.1','X-Forwarded-Proto':'https'}});
  assert.equal(denied.status,401);
  console.log('PASS: authenticated quota API, reset, history, CPU token and ingestion, anonymous rejection');
 } finally {
  if(user) await db.users.delete({where:{uuid:user.uuid}});
  if(squad) await db.internalSquads.delete({where:{uuid:squad.uuid}});
  if(node) await db.nodes.delete({where:{uuid:node.uuid}});
  if(admin) await db.admin.delete({where:{uuid:admin.uuid}});
  await db.$disconnect();
 }
}
main().catch(e=>{console.error(e);process.exitCode=1});
