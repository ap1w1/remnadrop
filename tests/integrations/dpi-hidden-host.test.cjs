const assert=require('node:assert/strict');
const {test}=require('node:test');
const {createSourceLoader}=require('./source-loader.cjs');
const HOST='11111111-1111-4111-8111-111111111111';
const USER='22222222-2222-4222-8222-222222222222';
const SQUAD='33333333-3333-4333-8333-333333333333';
const INBOUND='44444444-4444-4444-8444-444444444444';
let hostQuery;
class HostQuery {constructor(userId,returnDisabledHosts,returnHiddenHosts){
  this.userId=userId;this.returnDisabledHosts=returnDisabledHosts;this.returnHiddenHosts=returnHiddenHosts;
}}
const {DpiCheckerService}=createSourceLoader({
  '@common/database/prisma.service':{PrismaService:class{}},
  '@modules/hosts/queries/get-hosts-for-user':{GetHostsForUserQuery:HostQuery},
  '@modules/subscription-settings/queries/get-cached-subscrtipion-settings':{GetCachedSubscriptionSettingsQuery:class{}},
  '@modules/subscription-template/resolve-proxy/resolve-proxy-config.service':{ResolveProxyConfigService:class{}},
  '@modules/subscription-template/generators/xray.generator.service':{XrayGeneratorService:class{}},
  '@modules/users/users.service':{UsersService:class{}},
  '@modules/users/dtos/create-user.dto':{CreateUserRequestDto:class{}},
  './dpi-credentials.service':{DpiCredentialsService:class{}},
})('src/modules/node-operations/dpi-checker.service.ts');
test('hidden enabled host with inbound is allowed for a temporary DPI-only user',async()=>{
  let where;let insertions=0;
  const db={
    hosts:{findMany:async opts=>{
      where=opts.where;return [{uuid:HOST,configProfileInboundUuid:INBOUND,isHidden:true,isDisabled:false}]
    }},
    internalSquads:{create:async()=>({uuid:SQUAD}),deleteMany:async()=>{}},
    users:{findUnique:async()=>({uuid:USER,tId:42n})},
    $executeRaw:async()=>{insertions++;return 1},
  };
  const users={
    createUser:async()=>({isOk:true,response:{uuid:USER}}),
    getUserByUniqueFields:async()=>({isOk:true,response:{tId:42n,uuid:USER}}),
    deleteUser:async()=>({isOk:true}),
  };
  const queries={execute:async q=>{
    if(q instanceof HostQuery){hostQuery=q;return {isOk:true,response:[{uuid:HOST,configProfileInboundUuid:INBOUND}]}};
    return {queryStrategy:'UseIPv4'};
  }};
  const resolve={resolveProxyConfig:async()=>({})};
  const generator={generateLinks:()=>['vless://fake-fixture-only']};
  const credentials={getKey:async()=>'fixture-api-key'};
  const service=new DpiCheckerService(db,users,queries,resolve,generator,credentials);
  service.api=async()=>({estimated_cost:0.15,affordable:true});
  const response=(await service.prepare({hosts:[HOST],location:'russia',pop_ids:[7]})).response;
  assert.equal(response.hosts,1);
  assert.equal(response.points,1);
  assert.equal(where.isDisabled,false);
  assert.equal(Object.hasOwn(where,'isHidden'),false,'visibility is not a diagnostic availability filter');
  assert.equal(hostQuery.returnHiddenHosts,true,'the temporary DPI user may see selected hidden hosts');
  assert.equal(hostQuery.returnDisabledHosts,false);
  assert.equal(insertions,1);
});
