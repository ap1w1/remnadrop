import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@common/database/prisma.service';
import { isIP, Socket } from 'node:net';

const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
function publicIPv4(ip:string) {
  if(typeof ip !== 'string'||isIP(ip)!==4)return false;
  const [a,b,c]=ip.split('.').map(Number);
  return a!==0&&a!==10&&a!==127&&a<224&&a!==255&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&b===168)&&!(a===192&&b===0&&(c===0||c===2))&&!(a===192&&b===88&&c===99)&&!(a===198&&(b===18||b===19))&&!(a===100&&b>=64&&b<=127)&&!(a===192&&b===0&&c===2)&&!(a===198&&b===51&&c===100)&&!(a===203&&b===0&&c===113);
}
export type IpRecord={id:string;node_uuid:string;ip:string;is_active:boolean;tcp_reachable:boolean|null;last_checked_at:Date|null;last_error:string|null;rotation_minutes:number|null;rotated_at:Date|null};
@Injectable()
export class NodeIpService {
 constructor(private readonly db:PrismaService){}
 private assertNode(id:string){if(!uuid.test(id))throw new BadRequestException('Invalid node UUID');}
 async list(nodeUuid:string){this.assertNode(nodeUuid);return {response:await this.db.$queryRaw<IpRecord[]>`SELECT id,node_uuid,ip::text,is_active,tcp_reachable,last_checked_at,last_error,rotation_minutes,rotated_at FROM node_ip_pool WHERE node_uuid=${nodeUuid}::uuid ORDER BY is_active DESC,created_at`};}
 async add(nodeUuid:string,ip:string,minutes?:number|null){this.assertNode(nodeUuid);if(!publicIPv4(ip))throw new BadRequestException('Only public IPv4 addresses are supported');
   if(minutes!=null&&(!Number.isInteger(minutes)||minutes<5||minutes>525600))throw new BadRequestException('Rotation interval must be 5–525600 minutes');
   if(!await this.db.nodes.findUnique({where:{uuid:nodeUuid}}))throw new NotFoundException('Node not found');
   await this.db.$executeRaw`INSERT INTO node_ip_pool(node_uuid,ip,rotation_minutes) VALUES(${nodeUuid}::uuid,${ip}::inet,${minutes??null}) ON CONFLICT(node_uuid,ip) DO UPDATE SET rotation_minutes=excluded.rotation_minutes`;
   try { await this.probe(nodeUuid,ip); }
   catch (error) {
     if (!(error instanceof BadRequestException)) throw error;
     // A newly configured node might not have any mapped client hosts yet.
     await this.db.$executeRaw`UPDATE node_ip_pool SET last_error='No associated hosts to probe' WHERE node_uuid=${nodeUuid}::uuid AND ip=${ip}::inet`;
   }
   return this.list(nodeUuid);
 }
 private async tcp(ip:string,port:number):Promise<boolean>{return new Promise(resolve=>{
   const socket=new Socket();let settled=false;
   const finish=(good:boolean)=>{if(settled)return;settled=true;socket.destroy();resolve(good)};
   socket.setTimeout(3500);socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));socket.once('timeout',()=>finish(false));socket.connect(port,ip);
 });}
 async probe(nodeUuid:string,ip:string){this.assertNode(nodeUuid);if(!publicIPv4(ip))throw new BadRequestException('Invalid IP');
   const entry=await this.db.$queryRaw<IpRecord[]>`SELECT id,node_uuid,ip::text,is_active,tcp_reachable,last_checked_at,last_error,rotation_minutes,rotated_at FROM node_ip_pool WHERE node_uuid=${nodeUuid}::uuid AND ip=${ip}::inet`;
   if(!entry.length)throw new NotFoundException();
   const hosts=await this.db.$queryRaw<{port:number}[]>`SELECT h.port FROM hosts h JOIN hosts_to_nodes hn ON hn.host_uuid=h.uuid WHERE hn.node_uuid=${nodeUuid}::uuid AND NOT h.is_disabled LIMIT 5`;
   if(!hosts.length)throw new BadRequestException('Bind a host to this node before probing the IP');
   const result=await Promise.all(hosts.map(h=>this.tcp(ip,h.port)));
   const reachable=result.some(Boolean);
   await this.db.$executeRaw`UPDATE node_ip_pool SET tcp_reachable=${reachable},last_checked_at=now(),last_error=${reachable?null:'TCP connection failed on configured host ports'} WHERE node_uuid=${nodeUuid}::uuid AND ip=${ip}::inet`;
   return {response:{ip,tcp_reachable:reachable,ports:hosts.map(h=>h.port)}};
 }
 async remove(nodeUuid:string,id:string){this.assertNode(nodeUuid);if(!uuid.test(id))throw new BadRequestException('Invalid entry ID');
   const rows=await this.db.$queryRaw<IpRecord[]>`SELECT id,node_uuid,ip::text,is_active,tcp_reachable,last_checked_at,last_error,rotation_minutes,rotated_at FROM node_ip_pool WHERE id=${id}::uuid AND node_uuid=${nodeUuid}::uuid`;
   if(!rows.length)throw new NotFoundException();if(rows[0].is_active)throw new ConflictException('Active IP cannot be removed');
   await this.db.$executeRaw`DELETE FROM node_ip_pool WHERE id=${id}::uuid`;return {response:{success:true}};
 }
 async rotate(nodeUuid:string,id:string,source:'manual'|'automation'|'periodic'='manual'){
   this.assertNode(nodeUuid);if(!uuid.test(id))throw new BadRequestException('Invalid entry ID');
   const records=await this.db.$queryRaw<IpRecord[]>`SELECT id,node_uuid,ip::text,is_active,tcp_reachable,last_checked_at,last_error,rotation_minutes,rotated_at FROM node_ip_pool WHERE node_uuid=${nodeUuid}::uuid AND id=${id}::uuid`;
   if(!records.length)throw new NotFoundException();
   const target=records[0];
   if(target.is_active)return {response:{success:true,alreadyActive:true}};
   // Never use stale health checks for a potentially disruptive cutover.
   const probe=await this.probe(nodeUuid,target.ip);
   if(!probe.response.tcp_reachable)throw new ConflictException('IP is not TCP reachable on host ports; rotation aborted');
   return {response:await this.db.$transaction(async tx=>{
     await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${nodeUuid}))`;
     const current=await tx.$queryRaw<{ip:string}[]>`SELECT ip::text FROM node_ip_pool WHERE node_uuid=${nodeUuid}::uuid AND is_active FOR UPDATE`;
     if(current.length===0){
       // Bootstrap with an IP already in use; never rewrite host addresses unexpectedly.
       const used=await tx.$queryRaw<{count:bigint}[]>`SELECT count(*)::bigint AS count FROM hosts_to_nodes hn JOIN hosts h ON hn.host_uuid=h.uuid WHERE hn.node_uuid=${nodeUuid}::uuid AND h.address=${target.ip}`;
       if(!used[0]?.count)throw new ConflictException('For first activation, select an IP already configured on a host of this node');
       await tx.$executeRaw`UPDATE node_ip_pool SET is_active=true,rotated_at=now() WHERE id=${id}::uuid AND node_uuid=${nodeUuid}::uuid`;
       return {success:true,activated:true,hostsUpdated:0,source};
     }
     const oldIp=current[0].ip;
     const shared=await tx.$queryRaw<{count:bigint}[]>`SELECT count(*)::bigint AS count FROM hosts h JOIN hosts_to_nodes hn ON hn.host_uuid=h.uuid WHERE hn.node_uuid=${nodeUuid}::uuid AND h.address=${oldIp} AND (SELECT count(*) FROM hosts_to_nodes x WHERE x.host_uuid=h.uuid)>1`;
     if(shared[0]?.count)throw new ConflictException('Cannot rotate a shared host: split its host entry between nodes first');
     const count=await tx.$executeRaw`UPDATE hosts h SET address=${target.ip},updated_at=now() FROM hosts_to_nodes hn WHERE hn.host_uuid=h.uuid AND hn.node_uuid=${nodeUuid}::uuid AND h.address=${oldIp}`;
     if(count===0)throw new ConflictException('No associated hosts use the active IP; update host addresses manually before rotation');
     // Carry periodic schedule across rotations; otherwise it stops after one cycle.
     const oldInterval=await tx.$queryRaw<{rotation_minutes:number|null}[]>`SELECT rotation_minutes FROM node_ip_pool WHERE node_uuid=${nodeUuid}::uuid AND is_active`;
     await tx.$executeRaw`UPDATE node_ip_pool SET is_active=false,rotation_minutes=NULL WHERE node_uuid=${nodeUuid}::uuid AND is_active`;
     await tx.$executeRaw`UPDATE node_ip_pool SET is_active=true,rotated_at=now(),rotation_minutes=COALESCE(${oldInterval[0]?.rotation_minutes??null}::int,rotation_minutes) WHERE id=${id}::uuid AND node_uuid=${nodeUuid}::uuid`;
     return {success:true,hostsUpdated:count,previousIp:oldIp,newIp:target.ip,source};
   })};
 }
 async rotateNext(nodeUuid:string,source:'automation'|'periodic'){
   const records=(await this.list(nodeUuid)).response;
   const candidates=records.filter(r=>!r.is_active);
   if(!candidates.length)throw new ConflictException('No spare IP address');
   let lastError:unknown;
   for(const candidate of candidates){try{return await this.rotate(nodeUuid,candidate.id,source)}catch(err){lastError=err;}}
   throw lastError??new ConflictException('No candidate IP is reachable');
 }
}
