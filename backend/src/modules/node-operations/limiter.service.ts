import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@common/database/prisma.service';
import { isIP } from 'node:net';
import { LimiterCredentialsService } from './limiter-credentials.service';
import { LimiterBridgeSecretsService } from './limiter-bridge-secrets.service';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { LimiterControlService, type LimiterUserState } from './limiter-control.service';

export type LimiterSettings = {
 enabled:boolean;mode:'manual'|'auto';checkIntervalSeconds:number;activeWindowSeconds:number;
 tolerance:number;toleranceMultiplier:number;defaultDeviceLimit:number;violationThreshold:number;
 thresholdWindowSeconds:number;cooldownSeconds:number;autoRestoreMinutes:number;softWarnings:boolean;
 subnetGrouping:boolean;subnetPrefixV4:number;asnGrouping:boolean;
 trafficMonitor:boolean;trafficSpikeFactor:number;trafficSpikeMinGb:number;trafficHeavyGb:number;
 trafficHeavyDays:number;sharedHwidMonitor:boolean;sharedHwidHistoryDays:number;dailyReport:boolean;
 updateCheck:boolean;ignoredNodes:string[];ignoredUsers:string[];ignoredIps:string[];
 trafficIgnoredNodes:string[];ignoreDurationMinutes:number;userCacheTtlSeconds:number;logLevel:string;
};
const defaults:LimiterSettings={
 enabled:false,mode:'manual',checkIntervalSeconds:60,activeWindowSeconds:120,tolerance:1,
 toleranceMultiplier:0,defaultDeviceLimit:0,violationThreshold:3,thresholdWindowSeconds:3600,
 cooldownSeconds:300,autoRestoreMinutes:15,softWarnings:false,
 subnetGrouping:false,subnetPrefixV4:24,asnGrouping:false,
 trafficMonitor:false,trafficSpikeFactor:10,trafficSpikeMinGb:150,
 trafficHeavyGb:200,trafficHeavyDays:5,
 sharedHwidMonitor:false,sharedHwidHistoryDays:30,dailyReport:false,updateCheck:false,
 ignoredNodes:[],ignoredUsers:[],ignoredIps:[],trafficIgnoredNodes:[],ignoreDurationMinutes:360,userCacheTtlSeconds:600,logLevel:'info'
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
   checkIntervalSeconds:[1,31536000],activeWindowSeconds:[1,31536000],
   tolerance:[0,2147483647],toleranceMultiplier:[0,100],defaultDeviceLimit:[0,2147483647],
   violationThreshold:[1,2147483647],thresholdWindowSeconds:[1,31536000],
   cooldownSeconds:[1,31536000],autoRestoreMinutes:[0,525600],
   ignoreDurationMinutes:[0,525600],userCacheTtlSeconds:[1,31536000],
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
   throw new BadRequestException('Окно нарушений слишком короткое для выбранного числа повторений, интервала и паузы');
 if(!['trace','debug','info','warn','error'].includes(v.logLevel))throw new BadRequestException('Некорректный уровень журнала');
 for(const k of ['ignoredNodes','ignoredUsers','ignoredIps','trafficIgnoredNodes'] as const){
   if(!Array.isArray(v[k])||v[k].length>500||v[k].some(x=>typeof x!=='string'))
     throw new BadRequestException('Invalid '+k);
 }
 if([...v.ignoredNodes,...v.trafficIgnoredNodes,...v.ignoredUsers].some(id=>!uuid.test(id))||
     v.ignoredIps.some(ip=>!validIpOrCidr(ip)))
   throw new BadRequestException('Invalid UUID or IP/CIDR');
 return v;
}

// Mirrors the exact editable registry of the pinned engine. Both interfaces read this state.
const editable:Record<string,keyof LimiterSettings>={
 ACTION_MODE:'mode',CHECK_INTERVAL:'checkIntervalSeconds',ACTIVE_IP_WINDOW:'activeWindowSeconds',
 COOLDOWN:'cooldownSeconds',TOLERANCE:'tolerance',TOLERANCE_MULTIPLIER:'toleranceMultiplier',
 DEFAULT_DEVICE_LIMIT:'defaultDeviceLimit',USER_CACHE_TTL:'userCacheTtlSeconds',
 VIOLATION_THRESHOLD:'violationThreshold',VIOLATION_THRESHOLD_WINDOW:'thresholdWindowSeconds',
 AUTO_DISABLE_DURATION:'autoRestoreMinutes',IGNORE_DURATION:'ignoreDurationMinutes',AUTO_NOTIFY_SOFT:'softWarnings',
 SUBNET_GROUPING:'subnetGrouping',SUBNET_PREFIX_V4:'subnetPrefixV4',ASN_GROUPING:'asnGrouping',
 DAILY_REPORT:'dailyReport',UPDATE_CHECK:'updateCheck',TRAFFIC_MONITOR:'trafficMonitor',
 TRAFFIC_SPIKE_FACTOR:'trafficSpikeFactor',TRAFFIC_SPIKE_MIN_GB:'trafficSpikeMinGb',
 TRAFFIC_HEAVY_GB:'trafficHeavyGb',TRAFFIC_HEAVY_DAYS:'trafficHeavyDays',
 SHARED_HWID_MONITOR:'sharedHwidMonitor',SHARED_HWID_HISTORY_DAYS:'sharedHwidHistoryDays',LOG_LEVEL:'logLevel',
};
function toOverrides(cfg:LimiterSettings):Record<string,string>{
 return Object.fromEntries(Object.entries(editable).map(([env,key])=>[env,String(cfg[key])]));
}
function fromOverrides(base:LimiterSettings,values:Record<string,string>):LimiterSettings {
 const merged:Record<string,unknown>={...base};
 for(const [env,key] of Object.entries(editable)){
  if(values[env]===undefined)continue;
  merged[key]=typeof defaults[key]==='boolean'?values[env]==='true':typeof defaults[key]==='number'?Number(values[env]):values[env];
 }
 return normalizeSettings(merged);
}
function object(value:unknown):Record<string,unknown> {
 return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
}
function boundedInt(value:unknown,fallback=0):number {
 if(value===undefined||value===null)return fallback;
 if(typeof value!=='number'||!Number.isInteger(value)||value<0||value>2147483647)throw new BadRequestException('Invalid event count');
 return value;
}
export function limiterSubscriptionUrl(shortUuid:string|null|undefined):string|null {
 const domain=process.env.SUB_PUBLIC_DOMAIN;
 if(!domain||!shortUuid)return null;
 try{
  const url=new URL(domain.includes('://')?domain:'https://'+domain);
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password)return null;
  url.pathname=url.pathname.replace(/\/$/,'')+'/'+encodeURIComponent(shortUuid);url.search='';url.hash='';
  return url.toString();
 }catch{return null;}
}

type EventRow={id:string;user_uuid:string|null;user_id:string|null;username:string;event_type:string;mode:string;
 device_limit:number;observed_count:number;ips:unknown[];details:string|null;created_at:Date;occurred_at:Date|null;
 payload:Record<string,unknown>;unique_ip_count:number|null;connection_count:number|null;violations_24h:number|null;
 user_status:string|null;short_uuid:string|null;last_action:Record<string,unknown>|null};

@Injectable()
export class LimiterService {
 constructor(private readonly db:PrismaService,private readonly credentials:LimiterCredentialsService,
  private readonly secrets:LimiterBridgeSecretsService,private readonly control:LimiterControlService){}
 async settings(){
   const rows=await this.db.$queryRaw<Array<{config:Partial<LimiterSettings>;last_scan_at:Date|null;last_error:string|null}>>`
     SELECT config,last_scan_at,last_error FROM limiter_settings WHERE id=1`;
   let cfg=normalizeSettings(rows[0]?.config??{});
   // A Telegram settings change is visible even if its mirror webhook was missed.
   try{cfg=fromOverrides(cfg,await this.control.overrides());}catch{}
   return {response:{...cfg,lastScanAt:rows[0]?.last_scan_at??null,lastError:rows[0]?.last_error??null,engineVersion:'5.1.0'}};
 }
 async update(input:unknown){
   const {lastScanAt,lastError,engineVersion,...current}=(await this.settings()).response;
   if(!input||typeof input!=='object'||Array.isArray(input))throw new BadRequestException('Invalid limiter settings');
   const settings=normalizeSettings({...current,...input});
   if(current.enabled&&!settings.enabled&&await this.control.pendingRestores()>0)
     throw new BadRequestException('Есть временные блокировки. Сначала включите этих пользователей или дождитесь окончания срока.');
   await this.control.applySettings(toOverrides(settings));
   await this.db.$executeRaw`UPDATE limiter_settings SET config=${JSON.stringify(settings)}::jsonb,updated_at=now() WHERE id=1`;
   return this.settings();
 }
 async runtimeSettings(){return {response:await this.control.call('GET','/settings')};}
 async resetSettings(input:unknown){
   const key=object(input).key;
   if(typeof key!=='string'||key!==''&&!editable[key])throw new BadRequestException('Некорректная настройка');
   const items=await this.control.call<Array<{Key:string;Display:string}>>('POST','/settings/reset',{key});
   const {lastScanAt,lastError,engineVersion,...current}=(await this.settings()).response;
   const values=Object.fromEntries(items.filter(item=>editable[item.Key]).map(item=>[item.Key,item.Display]));
   const settings=fromOverrides(current,values);
   await this.db.$executeRaw`UPDATE limiter_settings SET config=${JSON.stringify(settings)}::jsonb,updated_at=now() WHERE id=1`;
   return {response:{settings:(await this.settings()).response,items}};
 }
 async events(){
   const rows=await this.db.$queryRaw<EventRow[]>`
     SELECT e.id,e.user_uuid,COALESCE(e.user_id,u.t_id)::text AS user_id,e.username,e.event_type,e.mode,
       e.device_limit,e.observed_count,e.ips,e.details,e.created_at,e.occurred_at,e.payload,
       e.unique_ip_count,e.connection_count,e.violations_24h,u.status::text AS user_status,u.short_uuid,
       (SELECT jsonb_build_object('action',a.action,'minutes',a.minutes,'source',a.source,
         'success',a.success,'createdAt',a.created_at,'message',a.message)
        FROM limiter_actions a WHERE a.user_uuid=e.user_uuid ORDER BY a.created_at DESC LIMIT 1) AS last_action
     FROM limiter_events e LEFT JOIN users u ON u.uuid=e.user_uuid
     ORDER BY e.created_at DESC LIMIT 250`;
   let states:Record<string,LimiterUserState>|null=null;
   try{states=await this.control.states(rows.flatMap(row=>row.user_id?[row.user_id]:[]));}catch{}
   return {response:rows.map(row=>({...row,subscriptionUrl:limiterSubscriptionUrl(row.short_uuid),
     state:row.user_id?states?.[row.user_id]??null:null,stateAvailable:states!==null}))};
 }
 async summary(){
   const counts=await this.db.$queryRaw<Array<{count24h:number;countWeek:number;users24h:number}>>`
    SELECT count(*) FILTER (WHERE created_at>now()-interval '24 hours')::int AS "count24h",
      count(*)::int AS "countWeek",count(DISTINCT user_uuid) FILTER (WHERE created_at>now()-interval '24 hours')::int AS "users24h"
    FROM limiter_events WHERE event_type='violation_detected' AND created_at>now()-interval '7 days'`;
   let live:unknown=null;
   try{live=await this.control.call('GET','/stats');}catch{}
   return {response:{...(counts[0]??{count24h:0,countWeek:0,users24h:0}),live,liveAvailable:live!==null}};
 }
 async actions(){
   return {response:await this.db.$queryRaw`SELECT id,user_uuid,user_id::text,username,action,minutes,source,
    success,message,created_at FROM limiter_actions ORDER BY created_at DESC LIMIT 250`};
 }
 async ignored(){
   const ids=await this.control.ignoredIds();
   const users=await this.db.users.findMany({where:{tId:{in:ids.map(id=>BigInt(id))}},select:{uuid:true,tId:true,username:true,status:true}});
   const states:Record<string,LimiterUserState>={};
   for(let i=0;i<ids.length;i+=250)Object.assign(states,await this.control.states(ids.slice(i,i+250)));
   return {response:users.map(user=>({uuid:user.uuid,userId:user.tId.toString(),username:user.username,
    status:user.status,...states[user.tId.toString()]}))};
 }
 async action(userUuid:string,input:unknown){
   if(!uuid.test(userUuid))throw new BadRequestException('Invalid user UUID');
   const body=object(input),action=body.action,minutes=body.minutes??0,requestId=body.requestId;
   if(typeof action!=='string'||!['drop','disable','disable_temp','enable','ignore','ignore_temp','unignore'].includes(action)||
    typeof requestId!=='string'||!uuid.test(requestId)||typeof minutes!=='number'||!Number.isInteger(minutes))
     throw new BadRequestException('Некорректное действие Limiter');
   if(['disable_temp','ignore_temp'].includes(action)?minutes<1||minutes>525600:minutes!==0)
     throw new BadRequestException('Укажите срок от 1 минуты до 365 дней');
   const user=await this.db.users.findUnique({where:{uuid:userUuid},select:{tId:true,username:true}});
   if(!user)throw new NotFoundException('Пользователь удалён');
   const id=Number(user.tId);
   if(!Number.isSafeInteger(id))throw new BadRequestException('User ID exceeds Limiter range');
   const result=await this.control.call<Record<string,unknown>>('POST','/actions',{userId:id,action,minutes,requestId});
   // The signed webhook also records bot/automatic actions. Request IDs deduplicate both paths.
   let warning:string|undefined;
   try{await this.audit({userId:id,userUuid,username:user.username,action,minutes,source:'panel',success:true,requestId,message:''});}
   catch{warning='Действие выполнено. Журнал временно недоступен; обновите данные перед повторным действием.';}
   if(action==='ignore'||action==='unignore'){
     try{await this.syncPermanentIgnore(userUuid,action==='ignore');}
     catch{warning='Действие выполнено. Список исключений обновлён; его копия в настройках временно недоступна.';}
   }
   return {response:{...result,...(warning?{warning}:{})}};
 }
 private async syncPermanentIgnore(userUuid:string,ignored:boolean){
   if(ignored){
     await this.db.$executeRaw`UPDATE limiter_settings SET config=jsonb_set(config,'{ignoredUsers}',
       COALESCE((SELECT jsonb_agg(DISTINCT value) FROM jsonb_array_elements_text(COALESCE(config->'ignoredUsers','[]'::jsonb)||jsonb_build_array(${userUuid}::text))),'[]'::jsonb)),updated_at=now() WHERE id=1`;
   }else{
     await this.db.$executeRaw`UPDATE limiter_settings SET config=jsonb_set(config,'{ignoredUsers}',
       COALESCE((SELECT jsonb_agg(value) FROM jsonb_array_elements_text(COALESCE(config->'ignoredUsers','[]'::jsonb)) WHERE value<>${userUuid}),'[]'::jsonb)),updated_at=now() WHERE id=1`;
   }
 }
 // Compatibility endpoints use the same actual handler as the event actions.
 async ignore(userUuid:string){return this.action(userUuid,{action:'ignore',requestId:randomUUID()});}
 async unignore(userUuid:string){return this.action(userUuid,{action:'unignore',requestId:randomUUID()});}
 async runtimeConfig(){
   const cfg=(await this.settings()).response,credentials=await this.credentials.get();
   const users=await this.db.users.findMany({where:{uuid:{in:cfg.ignoredUsers}},select:{tId:true}});
   if(cfg.enabled){
     await this.control.importLegacyIgnoredUsers(users.map(user=>user.tId.toString()));
     await this.control.importLegacySettings(toOverrides(cfg));
   }
   // A stable factory base makes Telegram and panel per-setting resets identical.
   // Current values are the shared Redis overrides, seeded from older installations once.
   const env:Record<string,string>={...toOverrides(defaults),
     WHITELIST_USER_IDS:'',IGNORED_NODE_UUIDS:cfg.ignoredNodes.join(','),
     TRAFFIC_IGNORED_NODE_UUIDS:cfg.trafficIgnoredNodes.join(','),IP_WHITELIST:cfg.ignoredIps.join(','),
   };
   if(credentials.telegramBotToken){
     env.TELEGRAM_BOT_TOKEN=credentials.telegramBotToken;
     env.TELEGRAM_CHAT_ID=credentials.telegramChatId??'';
     env.TELEGRAM_ADMIN_IDS=credentials.telegramAdminIds??'';
   }
   if(credentials.maxmindLicenseKey)env.MAXMIND_LICENSE_KEY=credentials.maxmindLicenseKey;
   env.SHARED_HWID_SQUAD_UUIDS=(credentials.sharedHwidSquadUuids??[]).join(',');
   return {response:{enabled:cfg.enabled,mode:cfg.mode,version:'5.1.0',env}};
 }
 async heartbeat(error?:string,lastCheck?:string|null){
   const parsed=lastCheck?new Date(lastCheck):null;
   const date=parsed&&!Number.isNaN(parsed.getTime())&&parsed.getUTCFullYear()>2000?parsed:null;
   await this.db.$executeRaw`UPDATE limiter_settings SET last_scan_at=COALESCE(${date}::timestamptz,last_scan_at),last_error=${error?.slice(0,300)??null} WHERE id=1`;
   return {response:{accepted:true}};
 }
 private async audit(a:{userId:number;userUuid:string|null;username:string;action:string;minutes:number;source:string;success:boolean;requestId:string;message:string}){
   await this.db.$executeRaw`INSERT INTO limiter_actions(user_uuid,user_id,username,action,minutes,source,success,request_id,message)
    VALUES(${a.userUuid}::uuid,${BigInt(a.userId)},${a.username},${a.action},${a.minutes},${a.source},${a.success},${a.requestId},${a.message.slice(0,500)})
    ON CONFLICT(request_id) DO NOTHING`;
 }
 async recordWebhook(raw:Buffer,signature:string,timestamp:string){
   if(raw.length>2*1024*1024)throw new BadRequestException('Webhook is too large');
   const age=Math.abs(Date.now()-Number(timestamp)*1000);
   if(!/^\d{10}$/.test(timestamp)||!Number.isFinite(age)||age>300000)throw new BadRequestException('Invalid webhook timestamp');
   const expected=createHmac('sha256',this.secrets.webhookSecret).update(timestamp+'.').update(raw).digest('hex');
   const provided=signature.toLowerCase().replace(/^sha256=/,'');
   if(!/^[0-9a-f]{64}$/.test(provided)||!timingSafeEqual(Buffer.from(provided,'hex'),Buffer.from(expected,'hex')))
      throw new BadRequestException('Invalid webhook signature');
   let parsed:unknown;
   try{parsed=JSON.parse(raw.toString('utf8'));}catch{throw new BadRequestException('Invalid JSON');}
   const payload=object(parsed),event=String(payload.event??''),data=object(payload.data);
   const accepted=['violation_detected','soft_violation_detected','traffic_spike','traffic_heavy','shared_hwid','daily_report','update_available','action','settings_changed'];
   if(!accepted.includes(event))throw new BadRequestException('Unsupported Limiter webhook event');
   if(event==='settings_changed'){
     const overrides:Record<string,string>={};
     // Read the current runtime snapshot: a delayed webhook must not undo newer changes or resets.
     const items=await this.control.call<Array<{Key:string;Display:string}>>('GET','/settings');
     for(const item of items)if(editable[item.Key]&&typeof item.Display==='string')overrides[item.Key]=item.Display;
     const {lastScanAt,lastError,engineVersion,...current}=(await this.settings()).response;
     const settings=fromOverrides(current,overrides);
     await this.db.$executeRaw`UPDATE limiter_settings SET config=${JSON.stringify(settings)}::jsonb,updated_at=now() WHERE id=1`;
     return {response:{accepted:true}};
   }
   const puser=object(payload.user),userId=Number(puser.user_id),hasUser=!['daily_report','update_available'].includes(event);
   if(hasUser&&(!Number.isSafeInteger(userId)||userId<=0||typeof puser.username!=='string'||puser.username.length>128))
     throw new BadRequestException('Invalid user ID or username');
   const user=hasUser?await this.db.users.findUnique({where:{tId:BigInt(userId)},select:{uuid:true,username:true}}):null;
   const username=user?.username??(hasUser?String(puser.username):event==='daily_report'?'Ежедневный отчёт':'Обновление Limiter');
   const hash=createHash('sha256').update(timestamp+'.').update(raw).digest('hex');
   if(event==='action'){
     const action=String(data.action??''),source=String(data.source??'');
     if(!['drop','disable','disable_temp','enable','ignore','ignore_temp','unignore'].includes(action)||
       !['panel','telegram','auto','restore'].includes(source)||typeof data.success!=='boolean')throw new BadRequestException('Invalid Limiter action');
     const minutes=boundedInt(data.minutes);
     if(minutes>525600)throw new BadRequestException('Invalid action duration');
     const requestId=typeof data.requestId==='string'&&uuid.test(data.requestId)?data.requestId:hash;
     await this.audit({userId,userUuid:user?.uuid??null,username,action,minutes,source,success:data.success,
       requestId,message:typeof data.message==='string'?data.message:''});
     if(user&&data.success&&(action==='ignore'||action==='unignore'))await this.syncPermanentIgnore(user.uuid,action==='ignore');
     return {response:{accepted:true}};
   }
   const v=object(payload.violation),ips=Array.isArray(v.ips)?v.ips.slice(0,1000):[];
   for(const ip of ips)if(typeof object(ip).ip!=='string'||!isIP(String(object(ip).ip)))throw new BadRequestException('Invalid event IP');
   const occurred=typeof payload.timestamp==='string'?new Date(payload.timestamp):new Date(Number(timestamp)*1000);
   if(Number.isNaN(occurred.getTime()))throw new BadRequestException('Invalid event time');
   const unique=v.ip_count===undefined?null:boundedInt(v.ip_count);
   const connection=v.connection_count===undefined?null:boundedInt(v.connection_count);
   const violations=v.violation_count_24h===undefined?null:boundedInt(v.violation_count_24h);
   await this.db.$executeRaw`INSERT INTO limiter_events(user_uuid,user_id,username,event_type,mode,device_limit,
     observed_count,ips,details,webhook_sha256,payload,unique_ip_count,connection_count,violations_24h,occurred_at)
     VALUES(${user?.uuid??null}::uuid,${hasUser?BigInt(userId):null},${username},${event},
       ${payload.action_mode==='auto'?'auto':'manual'},${boundedInt(v.device_limit)},${boundedInt(v.device_group_count??v.ip_count)},
       ${JSON.stringify(ips)}::jsonb,NULL,${hash},${JSON.stringify(payload)}::jsonb,${unique},${connection},${violations},${occurred})
     ON CONFLICT(webhook_sha256) DO NOTHING`;
   return {response:{accepted:true}};
 }
}
