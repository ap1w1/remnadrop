export const limiterApi='/api/limiter'
export const limiterPath='/dashboard/tools/limiter'
export type Mode='manual'|'auto'
export type Settings={enabled:boolean;mode:Mode;checkIntervalSeconds:number;activeWindowSeconds:number;tolerance:number;
 toleranceMultiplier:number;defaultDeviceLimit:number;violationThreshold:number;thresholdWindowSeconds:number;cooldownSeconds:number;
 autoRestoreMinutes:number;ignoreDurationMinutes:number;userCacheTtlSeconds:number;logLevel:string;softWarnings:boolean;subnetGrouping:boolean;subnetPrefixV4:number;asnGrouping:boolean;
 trafficMonitor:boolean;trafficSpikeFactor:number;trafficSpikeMinGb:number;trafficHeavyGb:number;trafficHeavyDays:number;
 sharedHwidMonitor:boolean;sharedHwidHistoryDays:number;dailyReport:boolean;updateCheck:boolean;
 ignoredNodes:string[];trafficIgnoredNodes:string[];ignoredUsers:string[];ignoredIps:string[];
 lastScanAt:string|null;lastError:string|null;engineVersion:string}
export const defaultConfig:Settings={enabled:false,mode:'manual',checkIntervalSeconds:60,activeWindowSeconds:120,tolerance:1,
 toleranceMultiplier:0,defaultDeviceLimit:0,violationThreshold:3,thresholdWindowSeconds:3600,cooldownSeconds:300,autoRestoreMinutes:15,
 ignoreDurationMinutes:360,userCacheTtlSeconds:600,logLevel:'info',softWarnings:false,subnetGrouping:false,subnetPrefixV4:24,asnGrouping:false,
 trafficMonitor:false,trafficSpikeFactor:10,trafficSpikeMinGb:150,trafficHeavyGb:200,trafficHeavyDays:5,
 sharedHwidMonitor:false,sharedHwidHistoryDays:30,dailyReport:false,updateCheck:false,
 ignoredNodes:[],trafficIgnoredNodes:[],ignoredUsers:[],ignoredIps:[],lastScanAt:null,lastError:null,engineVersion:'5.1.0'}
export type UserState={ignored:boolean;permanentIgnore:boolean;ignoredUntil:string|null;restoreAt:string|null}
export type NodeConnection={node_uuid?:string;node_name?:string;last_seen?:string}
export type IpEvidence={ip:string;node_name?:string;node_uuid?:string;nodeUuid?:string;last_seen?:string;asn?:number;asn_org?:string;nodes?:NodeConnection[]}
export type Audit={id:string;user_uuid:string|null;user_id:string;username:string;action:string;minutes:number;source:string;success:boolean;message:string;created_at:string}
export type LimiterEvent={id:string;user_uuid:string|null;user_id:string|null;username:string;event_type:string;mode:Mode;device_limit:number;observed_count:number;
 ips:IpEvidence[];details:string|null;created_at:string;occurred_at:string|null;unique_ip_count:number|null;connection_count:number|null;violations_24h:number|null;
 payload:{violation?:{effective_limit?:number;grouping_mode?:string;subnet_count?:number;asn_group_count?:number};data?:Record<string,unknown>;evidence?:{
 Fetches?:{Total:number;IPs:number;ASNs:number;Apps:number;Rows:Array<{IP:string;Org:string;Apps:string[];Count:number;Online:boolean}>};
 Devices?:{Items:Array<{Name:string;App:string;Seen:string}>}}};
 subscriptionUrl:string|null;user_status:string|null;state:UserState|null;stateAvailable:boolean;
 last_action:{action:string;source:string;success:boolean;createdAt:string;message:string}|null}
export type EngineStatus={running:boolean;ready:boolean;lastCheck:string|null}
export type Summary={count24h:number;countWeek:number;users24h:number;liveAvailable:boolean;live:{
 violations?:{Count24h:number;CountWeek:number;Top:Array<{UserID:string;Username:string;Count:number}>};heavyTraffic?:Record<string,unknown>;lastCheck:string}|null}
export type IgnoredUser=UserState&{uuid:string;userId:string;username:string;status:string}
export type Credentials={configured:boolean;telegramConfigured:boolean;maxmindConfigured:boolean;telegramChatId:string;telegramAdminIds:string;sharedHwidSquadUuids:string[]}
export const eventTitles:Record<string,string>={violation_detected:'Превышение лимита',soft_violation_detected:'Предупреждение',traffic_spike:'Всплеск трафика',traffic_heavy:'Высокий трафик',shared_hwid:'Общий HWID',daily_report:'Ежедневный отчёт',update_available:'Доступно обновление'}
export const actionTitles:Record<string,string>={drop:'Сбросить подключения',disable:'Отключить навсегда',disable_temp:'Отключить на время',enable:'Включить подписку',ignore:'Игнорировать постоянно',ignore_temp:'Игнорировать на время',unignore:'Убрать из исключений'}
export const sourceTitles:Record<string,string>={panel:'Панель',telegram:'Telegram',auto:'Автоматически',restore:'Истёк срок блокировки'}
export function errMessage(e:unknown){const a=e as {response?:{data?:{message?:string|string[]}}};return String(a.response?.data?.message??'Не удалось выполнить запрос. Попробуйте ещё раз.')}
export function dateText(value:string|null|undefined){if(!value||Number.isNaN(Date.parse(value))||value.startsWith('0001-'))return '—';return new Date(value).toLocaleString('ru-RU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}
export function bytes(value:unknown){const n=Number(value);if(!Number.isFinite(n))return '—';if(n===0)return '0 Б';const i=Math.min(4,Math.max(0,Math.floor(Math.log(n)/Math.log(1024))));return (n/1024**i).toLocaleString('ru-RU',{maximumFractionDigits:1})+' '+['Б','КиБ','МиБ','ГиБ','ТиБ'][i]}
export function obj(value:unknown):Record<string,unknown>{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}}
export function rows(value:unknown):Record<string,unknown>[]{return Array.isArray(value)?value.map(obj):[]}
