import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@common/database/prisma.service';
import { NodesQueuesService } from '@queue/_nodes';
import { UsersService } from '@modules/users/users.service';
import { isIP } from 'node:net';

type Settings = {
  enabled:boolean; mode:'manual'|'auto'; checkIntervalSeconds:number; activeWindowSeconds:number;
  tolerance:number; defaultDeviceLimit:number; violationThreshold:number;
  thresholdWindowSeconds:number; cooldownSeconds:number; autoRestoreMinutes:number;
  subnetGrouping:boolean; ignoredNodes:string[]; ignoredUsers:string[]; ignoredIps:string[];
};
type NodeResult={userId:string;ips:{ip:string;lastSeen:string}[]};
const defaults:Settings={
 enabled:false,mode:'manual',checkIntervalSeconds:60,activeWindowSeconds:180,
 tolerance:1,defaultDeviceLimit:0,violationThreshold:3,thresholdWindowSeconds:3600,
 cooldownSeconds:900,autoRestoreMinutes:15,subnetGrouping:false,
 ignoredNodes:[],ignoredUsers:[],ignoredIps:[]
};
const uuid=/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
function normalizeSettings(value:unknown):Settings {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new BadRequestException('Invalid limiter configuration');
 const o=value as Record<string,unknown>;
 const v={...defaults,...o} as Settings;
 if(typeof v.enabled!=='boolean'||!['manual','auto'].includes(v.mode)||typeof v.subnetGrouping!=='boolean')
   throw new BadRequestException('Invalid limiter mode or flags');
 for(const [key,min,max] of [
 ['checkIntervalSeconds',30,3600],['activeWindowSeconds',60,3600],['tolerance',0,20],
 ['defaultDeviceLimit',0,100],['violationThreshold',1,30],['thresholdWindowSeconds',60,86400],
 ['cooldownSeconds',30,86400],['autoRestoreMinutes',0,10080]
 ] as const) {
   if(!Number.isInteger(v[key])||v[key]<min||v[key]>max)throw new BadRequestException('Invalid '+key);
 }
 for(const key of ['ignoredNodes','ignoredUsers','ignoredIps'] as const){
   if(!Array.isArray(v[key])||v[key].length>500||v[key].some(item=>typeof item!=='string'))
     throw new BadRequestException('Invalid '+key);
 }
 if(v.ignoredNodes.some(id=>!uuid.test(id))||v.ignoredUsers.some(id=>!uuid.test(id)))
   throw new BadRequestException('Invalid ignored UUID');
 if(v.ignoredIps.some(ip=>isIP(ip)===0))throw new BadRequestException('Ignored IP list must contain valid IP addresses');
 return v;
}

@Injectable()
export class LimiterService implements OnModuleInit,OnModuleDestroy {
 private timer?:ReturnType<typeof setInterval>;
 private busy=false;
 private readonly logger=new Logger(LimiterService.name);
 constructor(private readonly db:PrismaService,private readonly queues:NodesQueuesService,private readonly users:UsersService){}
 onModuleInit(){if(process.env.INSTANCE_TYPE==='scheduler'){
   this.timer=setInterval(()=>void this.tick(),30000);
   void this.tick();
 }}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
 async settings(){
   const rows=await this.db.$queryRaw<{config:Partial<Settings>;last_scan_at:Date|null;last_error:string|null}[]>`SELECT config,last_scan_at,last_error FROM limiter_settings WHERE id=1`;
   return {response:{...normalizeSettings(rows[0]?.config??{}),lastScanAt:rows[0]?.last_scan_at??null,lastError:rows[0]?.last_error??null}};
 }
 async update(input:unknown){
   const current=(await this.settings()).response;
   if(!input||typeof input!=='object'||Array.isArray(input))throw new BadRequestException('Invalid limiter settings');
   const {lastScanAt,lastError,...saved}=current;
   const incoming=input as Partial<Settings>;
   const config=normalizeSettings({...saved,...incoming});
   await this.db.$executeRaw`UPDATE limiter_settings SET config=${JSON.stringify(config)}::jsonb,updated_at=now(),last_error=NULL WHERE id=1`;
   return this.settings();
 }
 async events(){
   const rows=await this.db.$queryRaw`SELECT id,user_uuid,username,event_type,mode,device_limit,observed_count,ips,details,created_at FROM limiter_events ORDER BY created_at DESC LIMIT 250`;
   return {response:rows};
 }
 async ignore(uuidValue:string){
   if(!uuid.test(uuidValue))throw new BadRequestException('Invalid user UUID');
   const settings=(await this.settings()).response;
   return this.update({...settings,ignoredUsers:[...new Set([...settings.ignoredUsers,uuidValue])]});
 }
 async unignore(uuidValue:string){
   if(!uuid.test(uuidValue))throw new BadRequestException('Invalid user UUID');
   const settings=(await this.settings()).response;
   return this.update({...settings,ignoredUsers:settings.ignoredUsers.filter(x=>x!==uuidValue)});
 }
 private async getNodeIps(nodeUuid:string):Promise<NodeResult[]|null>{
   const scheduled=await this.queues.queryUsersIpsList({nodeUuid});
   if(!scheduled)return null;
   for(let attempt=0;attempt<12;attempt++){
     await new Promise(resolve=>setTimeout(resolve,750));
     const job=await this.queues.getUsersIpsListResult(scheduled.jobId);
     if(!job)break;
     if(job.isFailed)return null;
     if(job.isCompleted&&job.result?.success&&job.result.nodeUuid===nodeUuid){
       return job.result.users as NodeResult[];
     }
   }
   return null;
 }
 private groupKey(ip:string,subnet:boolean){
   if(!subnet||isIP(ip)!==4)return ip;
   return ip.split('.').slice(0,3).join('.')+'.0/24';
 }
 private async restoreDue(){
   const rows=await this.db.$queryRaw<{user_uuid:string}[]>`SELECT user_uuid FROM limiter_restores WHERE restore_at<=now() ORDER BY restore_at LIMIT 30`;
   for(const row of rows){
     try{
       const current=await this.db.users.findUnique({where:{uuid:row.user_uuid},select:{status:true}});
       if(current?.status==='DISABLED'){
         const result=await this.users.enableUser(row.user_uuid);
         if(!result.isOk)throw new Error('User enable failed');
       }
       await this.db.$executeRaw`DELETE FROM limiter_restores WHERE user_uuid=${row.user_uuid}::uuid`;
       await this.db.$executeRaw`INSERT INTO limiter_events(user_uuid,username,event_type,mode,device_limit,observed_count,details)
         SELECT uuid,username,'restored','auto',0,0,'Scheduled restore completed' FROM users WHERE uuid=${row.user_uuid}::uuid`;
     }catch(error){this.logger.warn('Limiter restore failed: '+String(error))}
   }
 }
 private async alert(event:{userUuid:string;username:string;count:number;limit:number;mode:string}){
   const token=process.env.LIMITER_TELEGRAM_BOT_TOKEN,chat=process.env.LIMITER_TELEGRAM_CHAT_ID;
   if(!token||!chat)return;
   const body={chat_id:chat,text:'RemnaDrop Limiter\nПользователь: '+event.username+'\nIP/групп: '+event.count+' (лимит '+event.limit+')\nРежим: '+event.mode};
   try{
     await fetch('https://api.telegram.org/bot'+token+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
   }catch(e){this.logger.warn('Telegram limiter notification failed')}
 }
 async tick(){
   if(this.busy)return;
   this.busy=true;
   try{
     await this.restoreDue();
     const state=(await this.settings()).response;
     if(!state.enabled)return;
     if(state.lastScanAt&&Date.now()-new Date(state.lastScanAt).getTime()<state.checkIntervalSeconds*1000)return;
     await this.db.$executeRaw`UPDATE limiter_settings SET last_scan_at=now(),last_error=NULL WHERE id=1`;
     const nodes=await this.db.nodes.findMany({where:{isConnected:true,isDisabled:false},select:{uuid:true}});
     const selected=nodes.filter(n=>!state.ignoredNodes.includes(n.uuid)).slice(0,200);
     if(!selected.length)return;
     const entries=new Map<string,Map<string,{ip:string;nodeUuid:string}>>();
     let succeeded=0;
     // Rate-limit concurrent queue requests. Incomplete data is audit-only:
     // never disable users based on partial node visibility.
     for(let i=0;i<selected.length;i+=5){
       const batch=await Promise.allSettled(selected.slice(i,i+5).map(async node=>({nodeUuid:node.uuid,results:await this.getNodeIps(node.uuid)})));
       for(const row of batch){
         if(row.status!=='fulfilled'||!row.value.results)continue;
         succeeded++;
         for(const user of row.value.results){
           let byIp=entries.get(user.userId);
           if(!byIp){byIp=new Map();entries.set(user.userId,byIp);}
           for(const ip of user.ips??[]){
             if(isIP(ip.ip)===0||state.ignoredIps.includes(ip.ip))continue;
             const seen=new Date(ip.lastSeen).getTime();
             if(!Number.isFinite(seen)||Math.abs(Date.now()-seen)>state.activeWindowSeconds*1000)continue;
             byIp.set(ip.ip,{ip:ip.ip,nodeUuid:row.value.nodeUuid});
           }
         }
       }
     }
     if(succeeded!==selected.length){
       await this.db.$executeRaw`UPDATE limiter_settings SET last_error=${'Only '+succeeded+'/'+selected.length+' nodes responded. Enforcement skipped.'} WHERE id=1`;
       return;
     }
     const users=await this.db.users.findMany({where:{tId:{in:[...entries.keys()].map(BigInt)}},select:{tId:true,uuid:true,username:true,status:true,hwidDeviceLimit:true}});
     for(const user of users){
       const ips=[...(entries.get(user.tId.toString())?.values()??[])];
       const limit=user.hwidDeviceLimit===null?state.defaultDeviceLimit:user.hwidDeviceLimit;
       if(state.ignoredUsers.includes(user.uuid)||limit===0||user.status!=='ACTIVE')continue;
       const groups=new Set(ips.map(ip=>this.groupKey(ip.ip,state.subnetGrouping)));
       if(groups.size<=limit+state.tolerance)continue;
       try{
         const count=groups.size;
         const counter=await this.db.$queryRaw<{count:number;last_action_at:Date|null}[]>`
           INSERT INTO limiter_user_counters(user_uuid,count,window_start,last_detected_at)
           VALUES (${user.uuid}::uuid,1,now(),now())
           ON CONFLICT(user_uuid) DO UPDATE SET
             count=CASE WHEN limiter_user_counters.window_start < now()-${state.thresholdWindowSeconds}::int*interval '1 second' THEN 1 ELSE limiter_user_counters.count+1 END,
             window_start=CASE WHEN limiter_user_counters.window_start < now()-${state.thresholdWindowSeconds}::int*interval '1 second' THEN now() ELSE limiter_user_counters.window_start END,
             last_detected_at=now()
           RETURNING count,last_action_at`;
         const previous=counter[0];
         if(previous.count<state.violationThreshold)continue;
         if(previous.last_action_at&&Date.now()-previous.last_action_at.getTime()<state.cooldownSeconds*1000)continue;
         await this.db.$executeRaw`UPDATE limiter_user_counters SET count=0,last_action_at=now() WHERE user_uuid=${user.uuid}::uuid`;
         let eventType='violation';
         let detail='Detected excessive simultaneous connections';
         if(state.mode==='auto'){
           const disabled=await this.users.disableUser(user.uuid);
           if(!disabled.isOk)throw new Error('Unable to disable user');
           eventType='disabled';detail='Subscription disabled automatically';
           if(state.autoRestoreMinutes>0){
             await this.db.$executeRaw`INSERT INTO limiter_restores(user_uuid,restore_at) VALUES(${user.uuid}::uuid,now()+${state.autoRestoreMinutes}::int*interval '1 minute')
               ON CONFLICT(user_uuid) DO UPDATE SET restore_at=EXCLUDED.restore_at`;
           }
         }
         await this.db.$executeRaw`INSERT INTO limiter_events(user_uuid,username,event_type,mode,device_limit,observed_count,ips,details)
           VALUES(${user.uuid}::uuid,${user.username},${eventType},${state.mode},${limit},${count},${JSON.stringify(ips)}::jsonb,${detail})`;
         await this.alert({userUuid:user.uuid,username:user.username,count,limit,mode:state.mode});
       }catch(error){this.logger.warn('Limiter user action failed: '+String(error));}
     }
   }catch(error){
     this.logger.warn('Limiter cycle failed: '+String(error));
     try{await this.db.$executeRaw`UPDATE limiter_settings SET last_error=${String(error).slice(0,500)} WHERE id=1`;}catch{}
   }finally{this.busy=false}
 }
}
