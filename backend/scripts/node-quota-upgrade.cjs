const {PrismaClient}=require('@prisma/client');const {randomUUID}=require('node:crypto');const assert=require('node:assert/strict');
async function main(){const db=new PrismaClient();try{
 if(process.argv[2]==='seed'){
  const profile=await db.configProfiles.create({data:{name:'upgrade-fixture',config:{}}});
  const a=await db.nodes.create({data:{name:'upgrade-one',address:'one.invalid'}}),b=await db.nodes.create({data:{name:'upgrade-two',address:'two.invalid'}});
  for(const name of ['single','multiple','collision']){
   const id=randomUUID(),u=await db.users.create({data:{username:name,shortUuid:id,expireAt:new Date('2030-01-01'),trojanPassword:id,vlessUuid:id,ssPassword:id}});
   for(let i=0;i<(name==='collision'?2:1);i++){
    const squad=await db.internalSquads.create({data:{name:name+i}}),inbound=await db.configProfileInbounds.create({data:{profileUuid:profile.uuid,tag:name+i,type:'vless'}});
    await db.internalSquadInbounds.create({data:{internalSquadUuid:squad.uuid,inboundUuid:inbound.uuid}});
    for(const n of name==='multiple'?[a,b]:[a])await db.configProfileInboundsToNodes.create({data:{nodeUuid:n.uuid,configProfileInboundUuid:inbound.uuid}});
    await db.$executeRaw`INSERT INTO user_squad_quotas(user_uuid,squad_uuid,limit_bytes,used_bytes,blocked) VALUES (${u.uuid}::uuid,${squad.uuid}::uuid,100,120,true)`;
   }
  }
  console.log('PASS: seeded legacy exhausted quotas without memberships');
 }else{
  const rows=await db.$queryRaw`SELECT u.username,q.group_uuid,q.limit_bytes,q.used_bytes,q.blocked,g.limit_bytes AS group_limit,g.used_bytes AS group_used
    FROM user_node_quotas q JOIN users u ON u.uuid=q.user_uuid JOIN user_node_quota_groups g ON g.id=q.group_uuid`;
  assert.equal(rows.length,1);assert.equal(rows[0].username,'single');assert.equal(rows[0].used_bytes,120n);assert.equal(rows[0].limit_bytes,null);
  assert.equal(rows[0].group_limit,100n);assert.equal(rows[0].group_used,120n);assert.equal(rows[0].blocked,true);
  assert.equal(await db.internalSquadMembers.count(),4);
  const legacy=await db.$queryRaw`SELECT count(*)::int n FROM user_squad_quotas WHERE migrated_to_node_uuid IS NULL`;assert.equal(legacy[0].n,3);
  assert.equal((await db.$queryRaw`SELECT count(*)::int n FROM quota_sync`)[0].n,3);
  console.log('PASS: upgrade preserves usage and limit, restores memberships, archives ambiguous multi-node and overlapping quotas, queues access synchronization');
 }
}finally{await db.$disconnect()}}
main().catch(e=>{console.error(e);process.exitCode=1});
