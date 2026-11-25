import { BadRequestException, Body, CanActivate, Controller, ExecutionContext, Get, HttpCode, Injectable, NotFoundException, Param, Post, Query, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '@common/database/prisma.service';
import { NodesQueuesService } from '@queue/_nodes';
import { UsersService } from '@modules/users/users.service';
import { LimiterService, limiterSubscriptionUrl } from './limiter.service';
import { LimiterBridgeSecretsService } from './limiter-bridge-secrets.service';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';

const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function equalSecrets(a:string,b:string):boolean {
 const ab=Buffer.from(a),bb=Buffer.from(b);
 return ab.length===bb.length&&timingSafeEqual(ab,bb);
}
@Injectable()
export class LimiterBridgeGuard implements CanActivate {
 constructor(private readonly secrets:LimiterBridgeSecretsService){}
 canActivate(ctx:ExecutionContext){
   const token=this.secrets.apiToken;
   const authorization=(ctx.switchToHttp().getRequest<Request>().headers.authorization??'');
   if(!authorization.startsWith('Bearer ')||!equalSecrets(authorization.slice(7),token))
     throw new UnauthorizedException('Invalid Limiter bridge credential');
   return true;
 }
}
function numericId(v:string):bigint{
 if(!/^[1-9][0-9]{0,15}$/.test(v))throw new BadRequestException('Invalid numeric user ID');
 const id=BigInt(v);
 if(id>BigInt(Number.MAX_SAFE_INTEGER))throw new BadRequestException('Numeric ID too large');
 return id;
}
function numericIds(values:unknown):bigint[]{
 if(!Array.isArray(values)||values.length>1000||values.some(v=>typeof v!=='number'||!Number.isSafeInteger(v)||v<1))throw new BadRequestException('Invalid user IDs');
 return values.map(BigInt);
}
@Controller('limiter-bridge')
@UseGuards(LimiterBridgeGuard)
export class LimiterBridgeController {
 constructor(private readonly db:PrismaService,private readonly queues:NodesQueuesService,
   private readonly users:UsersService,private readonly limiter:LimiterService){}
 @Get('runtime')
 runtime(){return this.limiter.runtimeConfig();}
 @Post('heartbeat')
 @HttpCode(200)
 heartbeat(@Body() body:{error?:string}){return this.limiter.heartbeat(body?.error);}
 @Get('api/nodes')
 async nodes(){
   const rows=await this.db.nodes.findMany({select:{uuid:true,name:true,address:true,isConnected:true,isDisabled:true,countryCode:true}});
   return {response:rows};
 }
 @Post('api/connections/by-node/:nodeUuid')
 @HttpCode(200)
 async requestIps(@Param('nodeUuid') nodeUuid:string){
   if(!uuid.test(nodeUuid))throw new BadRequestException('Invalid node ID');
   const scheduled=await this.queues.queryUsersIpsList({nodeUuid});
   if(!scheduled?.jobId)throw new BadRequestException('Unable to schedule node IP request');
   return {response:{jobId:scheduled.jobId}};
 }
 @Get('api/connections/by-node/:jobId')
 async ipsResult(@Param('jobId') jobId:string){
   if(!/^[a-zA-Z0-9:_-]{1,160}$/.test(jobId))throw new BadRequestException('Invalid job ID');
   const data=await this.queues.getUsersIpsListResult(jobId);
   if(!data)throw new NotFoundException('Node IP request not found');
   return {response:{isCompleted:data.isCompleted,isFailed:data.isFailed,
     result:data.result?{...data.result,users:data.result.users.map(u=>({...u,userId:Number(u.userId)}))}:null}};
 }
 @Get('api/users/:userId')
 async user(@Param('userId') userId:string){
   const id=numericId(userId);
   const u=await this.db.users.findUnique({where:{tId:id},select:{
     tId:true,username:true,status:true,email:true,telegramId:true,shortUuid:true,
     hwidDeviceLimit:true,createdAt:true,activeInternalSquads:{select:{internalSquad:{select:{uuid:true,name:true}}}}
   }});
   if(!u)throw new NotFoundException('User does not exist');
   return {response:{id:Number(u.tId),username:u.username,status:u.status,email:u.email,
     telegramId:u.telegramId===null?null:Number(u.telegramId),hwidDeviceLimit:u.hwidDeviceLimit,
     subscriptionUrl:limiterSubscriptionUrl(u.shortUuid)??'',createdAt:u.createdAt,activeInternalSquads:u.activeInternalSquads.map(x=>x.internalSquad)}};
 }
 @Post('api/users/:userId/actions/disable')
 @HttpCode(200)
 async disable(@Param('userId') userId:string){
   const u=await this.db.users.findUnique({where:{tId:numericId(userId)},select:{uuid:true}});
   if(!u)throw new NotFoundException();
   const result=await this.users.disableUser(u.uuid);
   // The pinned Go client recognises A029/A030 in a 400 response. Preserve
   // these results from the operation itself, including concurrent changes;
   // an initial status check would lose that distinction for restore timers.
   if(!result.isOk)throw new BadRequestException({statusCode:400,code:result.code,
     message:result.message??'Unable to disable user'});
   return {response:{success:true}};
 }
 @Post('api/users/:userId/actions/enable')
 @HttpCode(200)
 async enable(@Param('userId') userId:string){
   const u=await this.db.users.findUnique({where:{tId:numericId(userId)},select:{uuid:true}});
   if(!u)throw new NotFoundException();
   const result=await this.users.enableUser(u.uuid);
   if(!result.isOk)throw new BadRequestException({statusCode:400,code:result.code,
     message:result.message??'Unable to enable user'});
   return {response:{success:true}};
 }
 @Post('api/connections/drop')
 @HttpCode(200)
 async drop(@Body() body:{dropBy?:{by?:string;userIds?:number[]};targetNodes?:{target?:string}}){
   if(body?.dropBy?.by!=='userIds'||body?.targetNodes?.target!=='allNodes')throw new BadRequestException('Only userIds/allNodes are supported');
   const ids=numericIds(body.dropBy.userIds);
   const active=await this.db.nodes.findMany({where:{isConnected:true,isDisabled:false,port:{not:null}},
     select:{address:true,port:true,proxyUrl:true,backupProxyUrl:true}});
   for(const node of active){
     if(node.port===null)continue;
     await this.queues.dropUsersConnections({data:{userIds:ids.map(String)},
       node:{address:node.address,port:node.port,proxyUrl:node.proxyUrl,backupProxyUrl:node.backupProxyUrl}});
   }
   return {response:{eventSent:true}};
 }
 private hwidView(d:{hwid:string;user_id:string;platform:string|null;os_version:string|null;device_model:string|null;user_agent:string|null;request_ip:string|null;created_at:Date;updated_at:Date}){
   return {hwid:d.hwid,userId:Number(d.user_id),platform:d.platform??'',osVersion:d.os_version??'',
     deviceModel:d.device_model??'',userAgent:d.user_agent??'',requestIp:d.request_ip??'',
     createdAt:d.created_at,updatedAt:d.updated_at};
 }
 @Get('api/hwid/devices/:userId')
 async userDevices(@Param('userId') userId:string){
   const id=numericId(userId);
   const rows=await this.db.$queryRaw<Array<{hwid:string;user_id:string;platform:string|null;os_version:string|null;device_model:string|null;user_agent:string|null;request_ip:string|null;created_at:Date;updated_at:Date}>>`
     SELECT hwid,user_id::text,platform,os_version,device_model,user_agent,request_ip,created_at,updated_at
     FROM hwid_user_devices WHERE user_id=${id} ORDER BY created_at DESC LIMIT 500`;
   return {response:{total:rows.length,devices:rows.map(x=>this.hwidView(x))}};
 }
 @Get('api/hwid/devices')
 async devices(@Query('start') from:string,@Query('size') size:string,@Query('filters') filters?:string){
   const start=Number(from??0),count=Number(size??100);
   if(!Number.isSafeInteger(start)||start<0||!Number.isSafeInteger(count)||count<1||count>1000)throw new BadRequestException('Invalid pagination');
   let hwid:string|undefined;
   if(filters){
     try {
       const v=JSON.parse(filters) as Array<{id:string;value:string}>;
       if(!Array.isArray(v)||v.length>2||v.some(x=>x.id!=='hwid'||typeof x.value!=='string'))
         throw new Error('invalid filter');
       hwid=v[0]?.value;
     }catch{throw new BadRequestException('Invalid HWID filter')}
   }
   const where=hwid===undefined?Prisma.empty:Prisma.sql`WHERE hwid=${hwid}`;
   const totals=await this.db.$queryRaw<Array<{count:bigint}>>(Prisma.sql`
     SELECT count(*)::bigint AS count FROM hwid_user_devices ${where}`);
   const rows=await this.db.$queryRaw<Array<{hwid:string;user_id:string;platform:string|null;os_version:string|null;device_model:string|null;user_agent:string|null;request_ip:string|null;created_at:Date;updated_at:Date}>>(Prisma.sql`
     SELECT hwid,user_id::text,platform,os_version,device_model,user_agent,request_ip,created_at,updated_at
     FROM hwid_user_devices ${where}
     ORDER BY created_at DESC,user_id DESC,hwid DESC LIMIT ${count} OFFSET ${start}`);
   return {response:{total:Number(totals[0]?.count??0),devices:rows.map(x=>this.hwidView(x))}};
 }
 @Get('api/users/:userId/subscription-request-history')
 async requestHistory(@Param('userId') userId:string){
   const id=numericId(userId);
   const rows=await this.db.$queryRaw<{request_at:Date;request_ip:string|null;user_agent:string|null}[]>`
     SELECT request_at,request_ip,user_agent FROM user_subscription_request_history
     WHERE user_id=${id} ORDER BY request_at DESC LIMIT 200`;
   return {response:{total:rows.length,records:rows.map(r=>({
     requestAt:r.request_at,requestIp:r.request_ip??'',userAgent:r.user_agent??''
   }))}};
 }
 @Post('api/bandwidth-stats/nodes/usage')
 @HttpCode(200)
 async bandwidth(@Query('start') start:string,@Query('end') end:string,
   @Query('minTotalBytes') threshold:string,
   @Body() body:{nodesUuids:string[]}){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||start!==end||!body||!Array.isArray(body.nodesUuids)||
     body.nodesUuids.length>300||body.nodesUuids.some(x=>!uuid.test(x)))throw new BadRequestException('Invalid node usage query');
   const minRaw=threshold??'0';
   if(!/^\d{1,15}$/.test(minRaw))throw new BadRequestException('Invalid minimum traffic');
   const min=BigInt(minRaw);
   if(body.nodesUuids.length===0)return {response:{nodes:[]}};
   const rows=await this.db.$queryRaw<Array<{uuid:string;user_id:string;total_bytes:string}>>(Prisma.sql`
     SELECT n.uuid,h.user_id::text,h.total_bytes::text
     FROM nodes_user_usage_history h JOIN nodes n ON n.id=h.node_id
     WHERE h.created_at=${start}::date AND h.total_bytes>=${min} AND n.uuid IN
       (${Prisma.join(body.nodesUuids.map(x=>Prisma.sql`${x}::uuid`))})`);
   const nodes=body.nodesUuids.map(uuidValue=>({
     uuid:uuidValue,users:rows.filter(r=>r.uuid===uuidValue).map(r=>({id:Number(r.user_id),totalBytes:Number(r.total_bytes)}))
   }));
   return {response:{nodes}};
 }
}
