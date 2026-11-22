import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Post, Put, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Roles } from '@common/decorators/roles/roles';
import { ApiScopeResource } from '@common/decorators/scopes';
import { JwtDefaultGuard } from '@common/guards/jwt-guards/def-jwt-guard';
import { RolesGuard } from '@common/guards/roles';
import { ScopesGuard } from '@common/guards/scopes';
import { ROLE } from '@libs/contracts/constants';
import { PrismaService } from '@common/database/prisma.service';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { CloudflareDnsService } from './cloudflare-dns.service';

@Controller('cloudflare-dns')
@Roles(ROLE.ADMIN)
@ApiScopeResource('hosts')
@UseGuards(JwtDefaultGuard,RolesGuard,ScopesGuard)
export class CloudflareDnsController {
 constructor(private readonly cf:CloudflareDnsService){}
 @Get('settings') settings(){return this.cf.status();}
 @Put('settings') update(@Body() input:{apiToken:string}){return this.cf.configureToken(input.apiToken);}
 @Delete('settings') deleteToken(){return this.cf.removeToken();}
 @Get('overview') overview(){return this.cf.overview();}
 @Get('events') events(){return this.cf.events();}
 @Put('zones') bind(@Body() input:{domain:string;zoneId:string;autoSync:boolean}){
   return this.cf.upsertBinding(input.domain,input.zoneId,input.autoSync);
 }
 @Post('replace-ip') replace(@Body() input:{zoneId:string;recordId:string;nodeUuid:string;expectedOldIp:string;newIp:string}){
   return this.cf.replaceIp(input);
 }
}

/** External integration: HMAC-signed, timestamp-bounded and replay-protected.
 * Never accept an API token or arbitrary URL from the incoming webhook body. */
@Controller('cloudflare-dns/webhook')
export class CloudflareDnsWebhookController {
 constructor(private readonly cf:CloudflareDnsService,private readonly db:PrismaService){}
 @Post('node-ip-changed')
 async rotated(
   @Body() body:{eventId:string;nodeUuid:string;oldIp:string;newIp:string},
   @Headers('x-webhook-event-id') id:string|undefined,
   @Headers('x-webhook-timestamp') timestamp:string|undefined,
   @Headers('x-webhook-signature') signature:string|undefined,
 ){
   const secret=process.env.CLOUDFLARE_DNS_INCOMING_SECRET;
   if(!secret||secret.length<32)throw new UnauthorizedException('Incoming Cloudflare DNS webhook disabled');
   if(!id||!timestamp||!signature||body?.eventId!==id||!/^[\da-f-]{36}$/i.test(id))
     throw new UnauthorizedException('Invalid webhook headers');
   const epoch=Number(timestamp);
   if(!Number.isSafeInteger(epoch)||Math.abs(Date.now()-epoch*1000)>300000)
     throw new UnauthorizedException('Webhook timestamp outside permitted window');
   const expected=createHmac('sha256',secret).update(timestamp+'.'+JSON.stringify(body)).digest('hex');
   const given=signature.toLowerCase().replace(/^sha256=/,'');
   if(!/^[0-9a-f]{64}$/.test(given)||!timingSafeEqual(Buffer.from(given,'hex'),Buffer.from(expected,'hex')))
     throw new UnauthorizedException('Invalid webhook signature');
   const received=await this.db.$executeRaw\`INSERT INTO cf_dns_webhook_receipts(event_id)
     VALUES(\${id}::uuid) ON CONFLICT DO NOTHING\`;
   if(!received)return {response:{duplicate:true}};
   try{
     if(!body.nodeUuid||!body.oldIp||!body.newIp)throw new BadRequestException('Missing rotation fields');
     const result=await this.cf.syncAfterRotation(body.nodeUuid,body.oldIp,body.newIp);
     return {response:{success:true,...result}};
   }catch(error){
     await this.db.$executeRaw\`DELETE FROM cf_dns_webhook_receipts WHERE event_id=\${id}::uuid\`;
     throw error;
   }
 }
}
