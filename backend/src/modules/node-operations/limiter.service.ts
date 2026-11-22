import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@common/database/prisma.service';
import { isIP } from 'node:net';
import { LimiterCredentialsService } from './limiter-credentials.service';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type LimiterSettings = {
 enabled:boolean;mode:'manual'|'auto';checkIntervalSeconds:number;activeWindowSeconds:number;
 tolerance:number;toleranceMultiplier:number;defaultDeviceLimit:number;violationThreshold:number;
 thresholdWindowSeconds:number;cooldownSeconds:number;autoRestoreMinutes:number;softWarnings:boolean;
 subnetGrouping:boolean;subnetPrefixV4:number;asnGrouping:boolean;
 trafficMonitor:boolean;trafficSpikeFactor:number;trafficSpikeMinGb:number;trafficHeavyGb:number;
 trafficHeavyDays:number;sharedHwidMonitor:boolean;sharedHwidHistoryDays:number;dailyReport:boolean;
 updateCheck:boolean;ignoredNodes:string[];ignoredUsers:string[];ignoredIps:string[];
 trafficIgnoredNodes:string[];
};
const defaults:LimiterSettings={
 enabled:false,mode:'manual',checkIntervalSeconds:60,activeWindowSeconds:120,tolerance:1,
 toleranceMultiplier:0,defaultDeviceLimit:0,violationThreshold:3,thresholdWindowSeconds:3600,
 cooldownSeconds:300,autoRestoreMinutes:15,softWarnings:false,
 subnetGrouping:false,subnetPrefixV4:24,asnGrouping:false,
 trafficMonitor:false,trafficSpikeFactor:10,trafficSpikeMinGb:150,
 trafficHeavyGb:200,trafficHeavyDays:5,
 sharedHwidMonitor:false,sharedHwidHistoryDays:30,dailyReport:false,updateCheck:false,
 ignoredNodes:[],ignoredUsers:[],ignoredIps:[],trafficIgnoredNodes:[]
};
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function validIpOrCidr(value:string):boolean{
 const parts=value.split('/');
 if(parts.length>2||isIP(parts[0])===0)return false;
 if(parts.length===1)return true;
 const prefix=Number(parts[1]);
 return /^\d{1,3}$/.test(parts[1])&&prefix>=(isIP(parts[0])===4?0:0)&&prefix<=(isIP(parts[0])===4?32:128);
}
function normalizeSettings(input:unknown):LimiterSettings{
 if(!input||typeof input!=='object'||Array.isArray(input))throw new BadRequestException('Invalid Limiter settings');
 const v={...defaults,...input} as LimiterSettings;
 if(typeof v.enabled!=='boolean'||!['manual','auto'].includes(v.mode)||['softWarnings','subnetGrouping','asnGrouping','trafficMonitor','sharedHwidMonitor','dailyReport','updateCheck'].some(k=>typeof(v as unknown as Record<string,unknown>)[k]!=='boolean'))
   throw new BadRequestException('Invalid Limiter flags');
 const ranges={
   checkIntervalSeconds:[30,3600],activeWindowSeconds:[60,3600],
   tolerance:[0,20],toleranceMultiplier:[0,100],defaultDeviceLimit:[0,100],
   violationThreshold:[1,50],thresholdWindowSeconds:[60,86400],
   cooldownSeconds:[0,86400],autoRestoreMinutes:[0,525600],
   subnetPrefixV4:[8,32],trafficSpikeFactor:[1.5,100],trafficSpikeMinGb:[1,1000000],
   trafficHeavyGb:[0,1000000],trafficHeavyDays:[1,7],sharedHwidHistoryDays:[0,365]
 } as const;
 for(const [key,[min,max]] of Object.entries(ranges)){
   const value=(v as unknown as Record<string,number>)[key];
   if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||
     (!['trafficSpikeFactor','toleranceMultiplier'].includes(key)&&!Number.isInteger(value)))
     throw new BadRequestException('Invalid Limiter setting: '+key);
 }
 if(v.thresholdWindowSeconds<=(v.violationThreshold-1)*(v.cooldownSeconds+v.checkIntervalSeconds))
   throw new BadRequestException('Violation threshold is unreachable with current cooldown and check interval');
 for(const k of ['ignoredNodes','ignoredUsers','ignoredIps','trafficIgnoredNodes'] as const){
   if(!Array.isArray(v[k])||v[k].length>500||v[k].some(x=>typeof x!=='string'))
     throw new BadRequestException('Invalid '+k);
 }
 if([...v.ignoredNodes,...v.trafficIgnoredNodes,...v.ignoredUsers].some(id=>!uuid.test(id))||
     v.ignoredIps.some(ip=>!validIpOrCidr(ip)))
   throw new BadRequestException('Invalid UUID or IP/CIDR');
 return v;
}

@Injectable()
export class LimiterService {
 constructor(private readonly db:PrismaService,private readonly credentials:LimiterCredentialsService){}
 async settings(){
   const rows=await this.db.$queryRaw<Array<{config:Partial<LimiterSettings>;last_scan_at:Date|null;last_error:string|null}>>`
     SELECT config,last_scan_at,last_error FROM limiter_settings WHERE id=1`;
   const cfg=normalizeSettings(rows[0]?.config??{});
   return {response:{...cfg,lastScanAt:rows[0]?.last_scan_at??null,lastError:rows[0]?.last_error??null,engineVersion:'5.1.0'}};
 }
 async update(input:unknown){
   const saved=(await this.settings()).response;
   const {lastScanAt,lastError,engineVersion,...current}=saved;
   if(!input||typeof input!=='object'||Array.isArray(input))throw new BadRequestException('Invalid limiter settings');
   const settings=normalizeSettings({...current,...input});
   await this.db.$executeRaw`UPDATE limiter_settings SET config=${JSON.stringify(settings)}::jsonb,updated_at=now() WHERE id=1`;
   return this.settings();
 }
 async events(){
   const rows=await this.db.$queryRaw`
     SELECT id,user_uuid,username,event_type,mode,device_limit,observed_count,ips,details,created_at
     FROM limiter_events ORDER BY created_at DESC LIMIT 250`;
   return {response:rows};
 }
 async ignore(userUuid:string){
   if(!uuid.test(userUuid))throw new BadRequestException('Invalid user UUID');
   const saved=(await this.settings()).response;
   return this.update({...saved,ignoredUsers:[...new Set([...saved.ignoredUsers,userUuid])]});
 }
 async unignore(userUuid:string){
   if(!uuid.test(userUuid))throw new BadRequestException('Invalid user UUID');
   const saved=(await this.settings()).response;
   return this.update({...saved,ignoredUsers:saved.ignoredUsers.filter(x=>x!==userUuid)});
 }
 async runtimeConfig(){
   const cfg=(await this.settings()).response;
   const credentials=await this.credentials.get();
   const users=await this.db.users.findMany({where:{uuid:{in:cfg.ignoredUsers}},select:{tId:true}});
   const env:Record<string,string>={
     ACTION_MODE:cfg.mode,CHECK_INTERVAL:String(cfg.checkIntervalSeconds),
     ACTIVE_IP_WINDOW:String(cfg.activeWindowSeconds),
     TOLERANCE:String(cfg.tolerance),TOLERANCE_MULTIPLIER:String(cfg.toleranceMultiplier),
     DEFAULT_DEVICE_LIMIT:String(cfg.defaultDeviceLimit),VIOLATION_THRESHOLD:String(cfg.violationThreshold),
     VIOLATION_THRESHOLD_WINDOW:String(cfg.thresholdWindowSeconds),COOLDOWN:String(cfg.cooldownSeconds),
     AUTO_DISABLE_DURATION:String(cfg.autoRestoreMinutes),AUTO_NOTIFY_SOFT:String(cfg.softWarnings),
     SUBNET_GROUPING:String(cfg.subnetGrouping),SUBNET_PREFIX_V4:String(cfg.subnetPrefixV4),
     ASN_GROUPING:String(cfg.asnGrouping),TRAFFIC_MONITOR:String(cfg.trafficMonitor),
     TRAFFIC_SPIKE_FACTOR:String(cfg.trafficSpikeFactor),TRAFFIC_SPIKE_MIN_GB:String(cfg.trafficSpikeMinGb),
     TRAFFIC_HEAVY_GB:String(cfg.trafficHeavyGb),TRAFFIC_HEAVY_DAYS:String(cfg.trafficHeavyDays),
     SHARED_HWID_MONITOR:String(cfg.sharedHwidMonitor),SHARED_HWID_HISTORY_DAYS:String(cfg.sharedHwidHistoryDays),
     DAILY_REPORT:String(cfg.dailyReport),UPDATE_CHECK:String(cfg.updateCheck),
     WHITELIST_USER_IDS:users.map(u=>u.tId.toString()).join(','),
     IGNORED_NODE_UUIDS:cfg.ignoredNodes.join(','),
     TRAFFIC_IGNORED_NODE_UUIDS:cfg.trafficIgnoredNodes.join(','),
     IP_WHITELIST:cfg.ignoredIps.join(','),
   };
   if(credentials.telegramBotToken)env.TELEGRAM_BOT_TOKEN=credentials.telegramBotToken;
   if(credentials.telegramChatId)env.TELEGRAM_CHAT_ID=credentials.telegramChatId;
   if(credentials.telegramAdminIds)env.TELEGRAM_ADMIN_IDS=credentials.telegramAdminIds;
   if(credentials.maxmindLicenseKey)env.MAXMIND_LICENSE_KEY=credentials.maxmindLicenseKey;
   env.SHARED_HWID_SQUAD_UUIDS=(credentials.sharedHwidSquadUuids??[]).join(',');
   return {response:{enabled:cfg.enabled,version:'5.1.0',env}};
 }
 async heartbeat(error?:string){
   await this.db.$executeRaw`UPDATE limiter_settings SET last_scan_at=now(),last_error=${error?.slice(0,300)??null} WHERE id=1`;
   return {response:{accepted:true}};
 }
 async recordWebhook(raw:Buffer,signature:string,timestamp:string){
   const secret=process.env.REMNADROP_LIMITER_WEBHOOK_SECRET;
   if(!secret||secret.length<32)throw new BadRequestException('Webhook disabled');
   const age=Math.abs(Date.now()-Number(timestamp)*1000);
   if(!/^\d{10}$/.test(timestamp)||!Number.isFinite(age)||age>300000)throw new BadRequestException('Invalid webhook timestamp');
   const expected=createHmac('sha256',secret).update(timestamp+'.').update(raw).digest('hex');
   const provided=signature.toLowerCase().replace(/^sha256=/,'');
   if(!/^[0-9a-f]{64}$/.test(provided)||!timingSafeEqual(Buffer.from(provided,'hex'),Buffer.from(expected,'hex')))
      throw new BadRequestException('Invalid webhook signature');
   let obj:unknown;
   try{obj=JSON.parse(raw.toString('utf8'))}catch{throw new BadRequestException('Invalid JSON')}
   if(!obj||typeof obj!=='object')throw new BadRequestException('Invalid Limiter webhook');
   const payload=obj as {event?:string;action_mode?:string;user?:{user_id?:number;username?:string};violation?:{device_limit?:number;device_group_count?:number;ip_count?:number;ips?:unknown[]}};
   if(!['violation_detected','soft_violation_detected'].includes(payload.event??'')||!payload.user||
      typeof payload.user.username!=='string'||payload.user.username.length>128)
      throw new BadRequestException('Unsupported Limiter webhook event');
   const userId=Number(payload.user.user_id);
   if(!Number.isSafeInteger(userId)||userId<=0)throw new BadRequestException('Invalid user ID');
   const user=await this.db.users.findUnique({where:{tId:BigInt(userId)},select:{uuid:true}});
   const hash=createHash('sha256').update(timestamp+'.').update(raw).digest('hex');
   const ips=(payload.violation?.ips??[]).slice(0,250);
   await this.db.$executeRaw`INSERT INTO limiter_events(user_uuid,username,event_type,mode,device_limit,observed_count,ips,details,webhook_sha256)
     VALUES(${user?.uuid??null}::uuid,${payload.user.username},${payload.event},
     ${payload.action_mode==='auto'?'auto':'manual'},${Number(payload.violation?.device_limit??0)},
     ${Number(payload.violation?.device_group_count??payload.violation?.ip_count??0)},
     ${JSON.stringify(ips)}::jsonb,'upstream Limiter 5.1.0',${hash}) ON CONFLICT(webhook_sha256) DO NOTHING`;
   return {response:{accepted:true}};
 }
}
