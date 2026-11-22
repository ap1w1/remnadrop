import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '@common/database/prisma.service';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { postSignedWebhook } from '@modules/squad-quotas/quota-webhooks.service';

type Zone = {id:string;name:string;status:string};
type DnsRecord = {id:string;zone_id?:string;name:string;type:string;content:string;proxied?:boolean;ttl:number};
type Link = {hostUuid:string;hostName:string;nodeUuid:string;nodeName:string;names:string[];recordIds:string[]};
type Binding = {domain:string;zone_id:string;auto_sync:boolean};
const hex32=/^[0-9a-f]{32}$/i;
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const domainPattern=/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;
const canonical=(s:string)=>s.trim().toLowerCase().replace(/\.$/,'');
function namesFor(value:string):string[]{
 return value.split(/[,;\s]+/).map(v=>v.replace(/^https?:\/\//,'').split('/')[0].split(':')[0])
    .map(canonical).filter(v=>domainPattern.test(v));
}
@Injectable()
export class CloudflareDnsService {
 private readonly logger=new Logger(CloudflareDnsService.name);
 constructor(private readonly db:PrismaService){}
 private encryptionKey(){
   const secret=process.env.CLOUDFLARE_DNS_ENCRYPTION_KEY??process.env.APP_SECRET??process.env.JWT_AUTH_SECRET;
   if(!secret||secret.length<32||secret==='change_me')throw new ServiceUnavailableException('Set a stable CLOUDFLARE_DNS_ENCRYPTION_KEY');
   return createHash('sha256').update('remnadrop-cloudflare-dns-v1\0').update(secret).digest();
 }
 private async token():Promise<string>{
   const rows=await this.db.$queryRaw<{iv:Uint8Array;tag:Uint8Array;ciphertext:Uint8Array}[]>`SELECT iv,tag,ciphertext FROM cf_dns_credentials WHERE id=1`;
   if(!rows.length){
     if(!process.env.CLOUDFLARE_DNS_API_TOKEN)throw new ServiceUnavailableException('Cloudflare DNS token is not configured');
     return process.env.CLOUDFLARE_DNS_API_TOKEN;
   }
   try{
     const cipher=createDecipheriv('aes-256-gcm',this.encryptionKey(),Buffer.from(rows[0].iv));
     cipher.setAuthTag(Buffer.from(rows[0].tag));
     return Buffer.concat([cipher.update(Buffer.from(rows[0].ciphertext)),cipher.final()]).toString('utf8');
   }catch{throw new ServiceUnavailableException('Cannot decrypt Cloudflare token. Check stable encryption key');}
 }
 async status(){
   const rows=await this.db.$queryRaw<{updated_at:Date}[]>`SELECT updated_at FROM cf_dns_credentials WHERE id=1`;
   return {response:{configured:rows.length>0||!!process.env.CLOUDFLARE_DNS_API_TOKEN,source:rows.length?'stored':process.env.CLOUDFLARE_DNS_API_TOKEN?'environment':'none',updatedAt:rows[0]?.updated_at??null}};
 }
 private async call<T>(token:string,path:string,init:RequestInit={}):Promise<T>{
   // All requests are restricted to Cloudflare's fixed API origin and validated IDs.
   if(!path.startsWith('/')||path.includes('..')||path.includes('//'))throw new BadRequestException('Unsafe Cloudflare API path');
   let res:Response;
   try{
     res=await fetch('https://api.cloudflare.com/client/v4'+path,{
       ...init,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),
       headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...init.headers}
     });
   }catch{throw new ServiceUnavailableException('Cloudflare API unavailable');}
   const payload=await res.json().catch(()=>null) as {success?:boolean;result?:T;errors?:Array<{message:string}>}|null;
   if(!res.ok||!payload||!payload.success)
     throw new BadRequestException('Cloudflare API rejected request ('+res.status+'): '+String(payload?.errors?.[0]?.message??'unknown error').slice(0,160));
   return payload.result as T;
 }
 async configureToken(apiToken:string){
   if(typeof apiToken!=='string'||apiToken.trim().length<20||apiToken.length>512||/\s/.test(apiToken))
     throw new BadRequestException('Invalid Cloudflare API token');
   const token=apiToken.trim();
   await this.call(token,'/user/tokens/verify');
   const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',this.encryptionKey(),iv);
   const data=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);
   const tag=cipher.getAuthTag();
   await this.db.$executeRaw`INSERT INTO cf_dns_credentials(id,iv,tag,ciphertext)
     VALUES(1,${iv},${tag},${data})
     ON CONFLICT(id) DO UPDATE SET iv=EXCLUDED.iv,tag=EXCLUDED.tag,ciphertext=EXCLUDED.ciphertext,updated_at=now()`;
   return this.status();
 }
 async removeToken(){await this.db.$executeRaw`DELETE FROM cf_dns_credentials WHERE id=1`;return this.status();}
 private async zones(token:string):Promise<Zone[]>{
   const all:Zone[]=[];
   for(let page=1;page<=10;page++){
     const rows=await this.call<Zone[]>(token,'/zones?per_page=50&page='+page);
     all.push(...rows);
     if(rows.length<50)break;
   }
   return all;
 }
 private async zone(token:string,id:string):Promise<Zone>{
   if(!hex32.test(id))throw new BadRequestException('Invalid zone ID');
   return this.call<Zone>(token,'/zones/'+id);
 }
 private async records(token:string,zoneId:string):Promise<DnsRecord[]>{
   if(!hex32.test(zoneId))throw new BadRequestException('Invalid zone ID');
   const all:DnsRecord[]=[];
   for(let page=1;page<=20;page++){
     const rows=await this.call<DnsRecord[]>(token,'/zones/'+zoneId+'/dns_records?per_page=100&page='+page);
     all.push(...rows);
     if(rows.length<100)break;
   }
   return all;
 }
 async bindings(){return this.db.$queryRaw<Binding[]>`SELECT domain,zone_id,auto_sync FROM cf_dns_zone_bindings ORDER BY domain`;}
 async upsertBinding(domainInput:string,zoneId:string,autoSync:boolean){
   const domain=canonical(domainInput??'');
   if(!domainPattern.test(domain)||!hex32.test(zoneId)||typeof autoSync!=='boolean')throw new BadRequestException('Invalid domain, zone ID or auto-sync option');
   const zone=await this.zone(await this.token(),zoneId);
   if(canonical(zone.name)!==domain)throw new ConflictException('Zone ID belongs to another domain');
   await this.db.$executeRaw`INSERT INTO cf_dns_zone_bindings(domain,zone_id,auto_sync)
     VALUES(${domain},${zoneId.toLowerCase()},${autoSync})
     ON CONFLICT(domain) DO UPDATE SET zone_id=excluded.zone_id,auto_sync=excluded.auto_sync,updated_at=now()`;
   return {response:await this.bindings()};
 }
 private async links():Promise<Link[]>{
   const rows=await this.db.$queryRaw<{host_uuid:string;remark:string;address:string;node_uuid:string;node_name:string}[]>`
     SELECT h.uuid AS host_uuid,h.remark,h.address,n.uuid AS node_uuid,n.name AS node_name
     FROM hosts h JOIN hosts_to_nodes hn ON hn.host_uuid=h.uuid
     JOIN nodes n ON n.uuid=hn.node_uuid
     WHERE NOT h.is_disabled`;
   const explicit=await this.db.$queryRaw<{host_uuid:string;zone_id:string;record_id:string}[]>`SELECT host_uuid,zone_id,record_id FROM cf_dns_record_host_links`;
   return rows.map(r=>({
     hostUuid:r.host_uuid,hostName:r.remark,nodeUuid:r.node_uuid,nodeName:r.node_name,
     // Only the configured connect address (or explicit binding) is safe for DNS writes.
     // TLS SNI and Host headers can be unrelated camouflage domains; never mutate those.
     names:[...new Set(namesFor(r.address))],
     recordIds:explicit.filter(x=>x.host_uuid===r.host_uuid).map(x=>x.record_id)
   }));
 }
 /** A host with CNAME alias is related to the terminal A/AAAA record too. */
 private aliases(records:DnsRecord[],record:DnsRecord):Set<string>{
   const names=new Set([canonical(record.name)]);
   for(let step=0;step<6;step++){
     let changed=false;
     for(const r of records){
       if(r.type==='CNAME'&&names.has(canonical(r.content))&&!names.has(canonical(r.name))){
         names.add(canonical(r.name));changed=true;
       }
     }
     if(!changed)break;
   }
   return names;
 }
 private connected(records:DnsRecord[],record:DnsRecord,links:Link[]):Link[]{
   const names=this.aliases(records,record);
   return links.filter(l=>l.recordIds.includes(record.id)||l.names.some(name=>names.has(name)));
 }
 async overview(){
   const status=(await this.status()).response;
   const bindings=await this.bindings();
   if(!status.configured)return {response:{status,zones:[],records:[],bindings}};
   const token=await this.token(), zones=await this.zones(token);
   const links=await this.links();
   const displayed:Array<DnsRecord&{zoneId:string;zoneName:string;linkedHosts:Omit<Link,'names'>[]}>=[];
   for(const zone of zones){
     try{
       const records=await this.records(token,zone.id);
       for(const rec of records.filter(r=>['A','AAAA','CNAME'].includes(r.type))){
         displayed.push({...rec,zoneId:zone.id,zoneName:zone.name,
           linkedHosts:this.connected(records,rec,links).map(({names,...link})=>link)});
       }
     }catch(error){this.logger.warn('Cloudflare DNS zone query failed for '+zone.id)}
   }
   return {response:{status,zones,records:displayed,bindings}};
 }
 async bindHost(input:{zoneId:string;recordId:string;hostUuid:string}){
   if(!hex32.test(input?.zoneId)||!hex32.test(input?.recordId)||!uuid.test(input?.hostUuid))
     throw new BadRequestException('Invalid DNS record or host');
   await this.call<DnsRecord>(await this.token(),'/zones/'+input.zoneId+'/dns_records/'+input.recordId);
   const host=await this.db.hosts.findUnique({where:{uuid:input.hostUuid},select:{uuid:true}});
   if(!host)throw new NotFoundException('Host not found');
   await this.db.$executeRaw`INSERT INTO cf_dns_record_host_links(zone_id,record_id,host_uuid)
     VALUES(${input.zoneId.toLowerCase()},${input.recordId.toLowerCase()},${input.hostUuid}::uuid)
     ON CONFLICT DO NOTHING`;
   return {response:{linked:true}};
 }
 async unbindHost(input:{zoneId:string;recordId:string;hostUuid:string}){
   if(!hex32.test(input?.zoneId)||!hex32.test(input?.recordId)||!uuid.test(input?.hostUuid))
     throw new BadRequestException('Invalid DNS record or host');
   await this.db.$executeRaw`DELETE FROM cf_dns_record_host_links WHERE zone_id=${input.zoneId.toLowerCase()}
     AND record_id=${input.recordId.toLowerCase()} AND host_uuid=${input.hostUuid}::uuid`;
   return {response:{linked:false}};
 }
 async explicitLinks(){
   return {response:await this.db.$queryRaw`SELECT zone_id,record_id,host_uuid FROM cf_dns_record_host_links`};
 }
 async events(){return {response:await this.db.$queryRaw`
   SELECT id,zone_id,record_id,record_name,node_uuid,old_ip::text,new_ip::text,source,status,message,created_at
   FROM cf_dns_events ORDER BY created_at DESC LIMIT 200`};}
 private async log(input:{zoneId:string;recordId:string|null;recordName:string;nodeUuid:string|null;oldIp:string;newIp:string;source:string;status:string;message:string}){
   await this.db.$executeRaw`INSERT INTO cf_dns_events(zone_id,record_id,record_name,node_uuid,old_ip,new_ip,source,status,message)
     VALUES(${input.zoneId},${input.recordId},${input.recordName},${input.nodeUuid}::uuid,${input.oldIp}::inet,${input.newIp}::inet,${input.source},${input.status},${input.message})`;
 }
 async replaceIp(input:{zoneId:string;recordId:string;nodeUuid:string;expectedOldIp:string;newIp:string;source?:string}){
   if(!hex32.test(input?.zoneId)||!hex32.test(input?.recordId)||!uuid.test(input?.nodeUuid)
     ||isIP(input?.expectedOldIp)===0||isIP(input?.newIp)===0||isIP(input.expectedOldIp)!==isIP(input.newIp))
     throw new BadRequestException('Invalid record/node IDs or IP addresses');
   if(input.expectedOldIp===input.newIp)throw new BadRequestException('Old and new IP are identical');
   const token=await this.token();
   const record=await this.call<DnsRecord>(token,'/zones/'+input.zoneId+'/dns_records/'+input.recordId);
   if(!['A','AAAA'].includes(record.type)||record.content!==input.expectedOldIp)
     throw new ConflictException('DNS record has changed or is not A/AAAA. Refresh before retrying.');
   const all=await this.records(token,input.zoneId);
   const matches=this.connected(all,record,await this.links()).filter(link=>link.nodeUuid===input.nodeUuid);
   if(!matches.length)throw new ConflictException('Record is not connected to a host on the specified node');
   // Preserve type, TTL, proxy mode, comment etc: only modify the content field.
   try{
     await this.call(token,'/zones/'+input.zoneId+'/dns_records/'+input.recordId,{
       method:'PATCH',body:JSON.stringify({content:input.newIp})
     });
     await this.log({zoneId:input.zoneId,recordId:input.recordId,recordName:record.name,nodeUuid:input.nodeUuid,
       oldIp:input.expectedOldIp,newIp:input.newIp,source:input.source??'manual',status:'updated',message:'Cloudflare A/AAAA updated'});
   }catch(error){
     await this.log({zoneId:input.zoneId,recordId:input.recordId,recordName:record.name,nodeUuid:input.nodeUuid,
       oldIp:input.expectedOldIp,newIp:input.newIp,source:input.source??'manual',status:'failed',message:String(error).slice(0,250)});
     throw error;
   }
   const webhook=process.env.CLOUDFLARE_DNS_WEBHOOK_URL,secret=process.env.CLOUDFLARE_DNS_WEBHOOK_SECRET;
   if(webhook&&secret&&secret.length>=32){
     const id=randomUUID();
     const payload=JSON.stringify({id,event:'CLOUDFLARE_DNS_IP_UPDATED',occurredAt:new Date().toISOString(),
       zoneId:input.zoneId,recordId:input.recordId,domain:record.name,nodeUuid:input.nodeUuid,
       oldIp:input.expectedOldIp,newIp:input.newIp,source:input.source??'manual'});
     try{await postSignedWebhook(webhook,payload,secret,id)}
     catch(error){this.logger.warn('Cloudflare DNS outbound webhook delivery failed: '+String(error));}
   }
   return {response:{updated:true,domain:record.name,nodeUuid:input.nodeUuid,oldIp:input.expectedOldIp,newIp:input.newIp}};
 }
 async syncAfterRotation(nodeUuid:string,oldIp:string,newIp:string){
   if(!uuid.test(nodeUuid)||isIP(oldIp)!==4||isIP(newIp)!==4)throw new BadRequestException('Invalid node or rotation');
   const bindings=(await this.bindings()).filter(b=>b.auto_sync);
   if(!bindings.length)return {updated:0,failed:0,skipped:0};
   const links=(await this.links()).filter(l=>l.nodeUuid===nodeUuid);
   if(!links.length)return {updated:0,failed:0,skipped:0};
   const token=await this.token();
   let updated=0,failed=0,skipped=0;
   for(const binding of bindings){
     try{
       const records=await this.records(token,binding.zone_id);
       for(const rec of records.filter(r=>r.type==='A'&&r.content===oldIp)){
         if(!this.connected(records,rec,links).length){skipped++;continue;}
         try{
           await this.replaceIp({zoneId:binding.zone_id,recordId:rec.id,nodeUuid,expectedOldIp:oldIp,newIp,source:'ip_rotation'});
           updated++;
         }catch(e){failed++;this.logger.warn('Cloudflare DNS sync failed for '+rec.name+': '+String(e));}
       }
     }catch(e){failed++;this.logger.warn('Cloudflare DNS zone sync failed: '+String(e))}
   }
   if(failed)throw new ServiceUnavailableException('Cloudflare DNS partly updated: '+updated+' succeeded, '+failed+' failed. Inspect DNS event log.');
   return {updated,failed,skipped};
 }
}
