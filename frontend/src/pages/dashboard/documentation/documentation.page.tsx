import { Accordion, Badge, Button, Card, CopyButton, Divider, Group, SegmentedControl, Select, SimpleGrid, Stack, Tabs, Text, TextInput, Title, Tooltip } from '@mantine/core'
import { CodeHighlight } from '@mantine/code-highlight'
import { useMemo, useState } from 'react'
import { TbBook2, TbCheck, TbCode, TbCopy, TbSearch, TbWebhook } from 'react-icons/tb'
import { Page } from '@shared/ui'
import catalog from './catalog.generated.json'
import webhookContracts from './webhook-contracts.generated.json'

type ApiEndpoint={method:string;path:string;summary:string;category:string;origin:string}
const methods=['ALL','GET','POST','PUT','PATCH','DELETE'] as const
const colors:Record<string,string>={GET:'teal',POST:'blue',PUT:'orange',PATCH:'yellow',DELETE:'red'}
const sampleWebhook={
  scope:'node',event:'node.connection_lost',timestamp:'2026-11-20T12:00:00.000Z',
  data:{uuid:'00000000-0000-0000-0000-000000000000',name:'Example node'},meta:{}
}
const sampleQuota={id:'00000000-0000-0000-0000-000000000000',scope:'node_quota',event:'node_quota.exhausted',
  timestamp:'2026-11-20T12:00:00.000Z',data:{user:{uuid:'user-uuid'},location:{uuid:'node-uuid',nodeUuids:['node-uuid']},group:null,traffic:{usedBytes:'104857600',limitBytes:'104857600',remainingBytes:'0',thresholdPercent:null}},meta:{legacyEvent:'LOCATION_TRAFFIC_EXHAUSTED'}}
const sampleGroupQuota={...sampleQuota,data:{...sampleQuota.data,location:{uuid:'node-a-uuid',nodeUuids:['node-a-uuid','node-b-uuid']},group:{uuid:'group-uuid',name:'США + Европа'},traffic:{usedBytes:'21474836480',limitBytes:'21474836480',remainingBytes:'0'}}}
const sampleMetric={id:'00000000-0000-0000-0000-000000000000',scope:'node_metric',event:'node_metric.threshold',timestamp:'2026-11-20T12:00:00.000Z',data:{nodeUuid:'node-uuid',metric:'online_drop',value:45,threshold:30},meta:{legacyEvent:'NODE_METRIC_THRESHOLD'}}
const sampleAutomation={id:'execution-uuid',scope:'node_automation',event:'node_automation.triggered',timestamp:'2026-11-20T12:00:00.000Z',data:{nodeUuid:'node-uuid',ruleId:'rule-uuid',executionId:'execution-uuid'},meta:{legacyEvent:'NODE_AUTOMATION_TRIGGERED'}}
const sampleTorrent={scope:'torrent_blocker',event:'torrent_blocker.report',timestamp:'2026-11-24T12:00:00.000Z',data:{report:{actionReport:{blocked:true,ip:'203.0.113.7',blockDuration:3600,willUnblockAt:'2026-11-24T13:00:00.000Z',userId:'100',processedAt:'2026-11-24T12:00:00.000Z'},xrayReport:{email:null,level:null,protocol:'bittorrent',network:'tcp',source:'203.0.113.7',destination:'198.51.100.8:443',routeTarget:null,originalTarget:null,inboundTag:null,inboundName:null,inboundLocal:null,outboundTag:null,ts:1795521600},device:null,deviceIdentification:{status:'unknown',method:'ip',candidateCount:0}},device:null,deviceIdentification:{status:'unknown',method:'ip',candidateCount:0},node:{uuid:'node-uuid',name:'Example node'},user:{uuid:'user-uuid',username:'example'}}}
const sampleSsl={id:'42',scope:'ssl',event:'ssl.expiring',timestamp:'2026-11-24T12:00:00.000Z',data:{certificateId:'certificate-uuid',name:'Edge TLS',domain:'vpn.example.com',nodeUuids:['node-uuid'],expiresOn:'2026-11-27',reminderDays:3,daysRemaining:3}}
const sampleCloudflare={id:'00000000-0000-0000-0000-000000000000',scope:'cloudflare_dns',event:'cloudflare_dns.ip_updated',timestamp:'2026-11-24T12:00:00.000Z',data:{accountId:'account-id',zoneId:'zone-id',recordId:'record-id',domain:'vpn.example.com',nodeUuid:'node-uuid',oldIp:'203.0.113.10',newIp:'203.0.113.11',source:'manual'},meta:{legacyEvent:'CLOUDFLARE_DNS_IP_UPDATED'}}
const sampleBackup={id:'00000000-0000-0000-0000-000000000000',scope:'backup',event:'backup.completed',timestamp:'2026-11-24T12:00:00.000Z',data:{targetId:'storage-uuid',runId:'00000000-0000-0000-0000-000000000000',storageType:'ftp',name:'Удалённая копия',fileName:'remnadrop-20261124T120000-00000000.dump',sizeBytes:'1048576',sha256:'a'.repeat(64),error:'',occurredAt:'2026-11-24T12:00:00.000Z'}}
const legacyEventByName:Record<string,string>={
  'node_quota.threshold':'LOCATION_TRAFFIC_THRESHOLD',
  'node_quota.exhausted':'LOCATION_TRAFFIC_EXHAUSTED',
  'node_quota.reset':'LOCATION_TRAFFIC_RESET',
  'node_metric.threshold':'NODE_METRIC_THRESHOLD',
  'node_metric.recovered':'NODE_METRIC_RECOVERED',
  'node_automation.triggered':'NODE_AUTOMATION_TRIGGERED',
}
const limiterWebhookEvents=['violation_detected','soft_violation_detected','traffic_spike','traffic_heavy','shared_hwid','daily_report','update_available','action','settings_changed'].map(event=>'limiter.'+event)
const webhookNames=[...new Set([...catalog.webhooks,...limiterWebhookEvents,'backup.completed','backup.failed'])].sort()
const limiterWebhookData=(event:string)=>['daily_report','update_available'].includes(event.slice(8))
  ?{event:event.slice(8),occurredAt:'2026-11-24T12:00:00.000Z'}
  :event==='limiter.action'
    ?{user:{uuid:'user-uuid',id:42,username:'example'},action:'ignore_temp',source:'panel',minutes:360,success:true,message:''}
    :{user:{uuid:'user-uuid',id:42,username:'example'},violation:{deviceLimit:5,observedCount:9,uniqueIpCount:9,connectionCount:12,violations24h:3,ips:[]},occurredAt:'2026-11-24T12:00:00.000Z',mode:'manual'}
const quotaCategory=(endpoint:ApiEndpoint)=>endpoint.path.includes('node-quotas')?'Лимиты нод':endpoint.category
const quotaSummary=(endpoint:ApiEndpoint)=>{
  const path=endpoint.path,method=endpoint.method
  if(path.endsWith('/groups'))return method==='GET'?'Список групп лимитов пользователя':'Создать группу с общим лимитом'
  if(path.includes('/groups/:groupUuid'))return method==='PUT'?'Изменить состав и лимит группы':method==='DELETE'?'Удалить группу, сохранив расход нод':'Сбросить расход группы'
  if(path.endsWith('/global-settings'))return method==='GET'?'Общие настройки лимитов нод':'Изменить общие настройки лимитов нод'
  if(path.endsWith('/settings'))return method==='GET'?'Настройки лимитов пользователя':'Изменить настройки лимитов пользователя'
  if(path.endsWith('/status'))return 'Расход, блокировка и группы пользователя'
  if(path.endsWith('/reset-all'))return 'Сбросить расход всех нод пользователя'
  if(path.endsWith('/:nodeUuid/reset'))return 'Сбросить расход одной ноды'
  if(path.endsWith('/:nodeUuid'))return method==='PUT'?'Задать лимит одной ноды':method==='DELETE'?'Удалить лимит ноды':'Сбросить расход ноды'
  return 'Лимиты нод пользователя'
}
const quotaRequest=(endpoint:ApiEndpoint):unknown=>{
  if(!['POST','PUT'].includes(endpoint.method))return null
  if(endpoint.path.endsWith('/groups')||endpoint.path.endsWith('/groups/:groupUuid'))return {name:'США + Европа',nodeUuids:['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002'],limitBytes:'21474836480'}
  if(endpoint.path.endsWith('/global-settings'))return {periodDays:30,thresholdPercents:[50,80,95]}
  if(endpoint.path.endsWith('/settings'))return {periodDays:30,thresholdPercent:80}
  if(endpoint.path.endsWith('/:nodeUuid'))return {limitBytes:'10737418240',periodDays:null,thresholdPercent:80}
  return null
}
const createUserRequest={username:'example',expireAt:'2027-01-01T00:00:00.000Z',trafficLimitBytes:0,nodeQuotaGroups:[{name:'США + Европа',nodeUuids:['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002'],limitBytes:'21474836480'}]}
const requestExample=(endpoint:ApiEndpoint):unknown=>{
  if(endpoint.method==='POST'&&endpoint.path==='/api/users')return createUserRequest
  if(endpoint.method==='POST'&&endpoint.path==='/api/node-automations')return {name:'Восстановление связи',node_uuids:['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002'],trigger_type:'node_recovered',enabled:true,cooldown_minutes:5,actions:[{type:'webhook',url:'https://example.com/node-recovered'}]}
  if(endpoint.method==='PUT'&&endpoint.path==='/api/panel-events/preferences')return {browserEnabled:true,eventTypes:['node.offline','node.online'],excludedNodeUuids:['00000000-0000-0000-0000-000000000001']}
  if(endpoint.method==='PUT'&&endpoint.path==='/api/dpi-checker/settings/proxy')return {proxyUrl:'socks5://user:password@proxy.example.com:1080'}
  return quotaRequest(endpoint)
}
const endpointSummary=(endpoint:ApiEndpoint)=>endpoint.method==='POST'&&endpoint.path==='/api/users'?'Создать пользователя, при необходимости с группами лимитов нод':quotaCategory(endpoint)==='Лимиты нод'?quotaSummary(endpoint):endpoint.summary
const quotaResponse=(endpoint:ApiEndpoint):unknown=>{
  if(endpoint.path.endsWith('/groups')&&endpoint.method==='GET')return {response:[{id:'00000000-0000-0000-0000-000000000003',name:'США + Европа',node_uuids:['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002'],limit_bytes:'21474836480',used_bytes:'1048576',blocked:false,threshold_percent:50,sent_threshold_percents:[],period_days:null,reset_at:null}]}
  if(endpoint.path.endsWith('/groups')&&endpoint.method==='POST')return {response:{id:'00000000-0000-0000-0000-000000000003'}}
  if(endpoint.path.endsWith('/status'))return {response:{pendingSync:false,groups:[],items:[{nodeUuid:'00000000-0000-0000-0000-000000000001',usedBytes:'1048576',limitBytes:'10737418240',remainingBytes:'10736369664',blocked:false,groupUuid:null}]}}
  return null
}
const infoFor=(event:string)=>event.startsWith('backup.')?'Резервное копирование · общие настройки вебхуков Remnawave':event.startsWith('limiter.')?'Limiter · общие настройки вебхуков Remnawave':event.startsWith('node_quota.')?'Индивидуальная или общая квота нод':event.startsWith('node_metric.')?'Детектор мониторинга':event.startsWith('ssl.')?'Напоминание SSL-сертификата':event==='node_automation.triggered'?'Автоматизация ноды':event==='cloudflare_dns.ip_updated'?'Изменение IP DNS-записи':event==='torrent_blocker.report'?'Торрент-блокер: device и deviceIdentification включены всегда':'Стандартный вебхук Remnawave'
const webhookSample=(event:string)=>event.startsWith('backup.')?{...sampleBackup,event,data:{...sampleBackup.data,...(event==='backup.failed'?{fileName:null,sizeBytes:'0',sha256:'',error:'pg_dump failed'}:{})}}:event.startsWith('limiter.')?{id:'00000000-0000-0000-0000-000000000000',scope:'limiter',event,timestamp:'2026-11-24T12:00:00.000Z',data:limiterWebhookData(event)}:event==='torrent_blocker.report'?sampleTorrent:event.startsWith('ssl.')?{...sampleSsl,event}:event==='cloudflare_dns.ip_updated'?sampleCloudflare:event.startsWith('node_quota.')?{...sampleQuota,event,data:{...sampleQuota.data,traffic:{...sampleQuota.data.traffic,thresholdPercent:event==='node_quota.threshold'?80:null}},meta:{legacyEvent:legacyEventByName[event]}}:event.startsWith('node_metric.')?{...sampleMetric,event,meta:{legacyEvent:legacyEventByName[event]}}:event==='node_automation.triggered'?sampleAutomation:{...sampleWebhook,event,scope:event.split('.')[0]}
const webhookContract=(event:string)=>{
  const scope=event.split('.')[0]
  if(scope==='backup'||scope==='limiter')return {type:'object',properties:{id:{type:'string',format:'uuid'},scope:{type:'string',const:scope},event:{type:'string',const:event},timestamp:{type:'string',format:'date-time'},data:scope==='backup'?{type:'object',properties:{targetId:{type:'string',format:'uuid'},runId:{type:'string',format:'uuid'},storageType:{type:'string',enum:['local','s3','ftp','gdrive']},name:{type:'string'},fileName:{type:['string','null']},sizeBytes:{type:'string'},sha256:{type:'string'},error:{type:'string'},occurredAt:{type:'string',format:'date-time'}}}:{type:'object',description:'Поля зависят от события; точный пример приведён выше.'}},required:['id','scope','event','timestamp','data']}
  const schemas=webhookContracts as unknown as Record<string,{properties:Record<string,unknown>}>
  const schema=schemas[scope]
  return schema?{...schema,properties:{...schema.properties,event:{type:'string',const:event}}}:null
}
const webhookSource=(event:string)=>event.startsWith('backup.')?'backend/src/modules/squad-quotas/backup-webhooks.service.ts':event.startsWith('limiter.')?'backend/src/modules/node-operations/limiter-outbound-webhook.service.ts':event.startsWith('ssl.')?'backend/src/modules/panel-events/panel-events.worker.ts':event.startsWith('node_quota.')?'backend/src/modules/squad-quotas/quota-webhooks.service.ts':event.startsWith('node_metric.')?'backend/src/modules/squad-quotas/node-metric-alerts.service.ts':event==='node_automation.triggered'?'backend/src/modules/node-operations/automations.service.ts':event==='cloudflare_dns.ip_updated'?'backend/src/modules/node-operations/cloudflare-dns.service.ts':'backend/libs/contract/models/webhook/webhook.schema.ts'
function CopyValue({value,label}:{value:string;label?:string}){return <CopyButton value={value}>{({copied,copy})=><Tooltip label={copied?'Скопировано':'Копировать'}><Button size="compact-xs" variant="subtle" color={copied?'teal':'gray'} leftSection={copied?<TbCheck size={13}/>:<TbCopy size={13}/>} onClick={copy}>{label??'Копировать'}</Button></Tooltip>}</CopyButton>}
export function DocumentationPage(){
  const [search,setSearch]=useState(''),[method,setMethod]=useState<string>('ALL'),[category,setCategory]=useState<string|null>('all'),[webhookQuery,setWebhookQuery]=useState('')
  const endpoints=catalog.endpoints as ApiEndpoint[]
  const categories=useMemo(()=>[...new Set(endpoints.map(quotaCategory))].sort(),[endpoints])
  const visible=useMemo(()=>endpoints.filter(e=>(method==='ALL'||e.method===method)&&(category==='all'||quotaCategory(e)===category)&&`${e.method} ${e.path} ${endpointSummary(e)} ${quotaCategory(e)}`.toLowerCase().includes(search.toLowerCase())),[endpoints,method,category,search])
  const hooks=webhookNames.filter(s=>s.toLowerCase().includes(webhookQuery.toLowerCase()))
  return <Page title="Документация"><Stack gap="lg">
    <Group align="center" gap="sm"><TbBook2 size={30} color="var(--mantine-primary-color-filled)"/><div><Title order={2}>Документация API</Title><Text c="dimmed" size="sm">Маршруты форка, методы запросов и исходящие вебхуки</Text></div></Group>
    <SimpleGrid cols={{base:1,sm:3}} spacing="md"><Card withBorder radius="md" p="md"><Text c="dimmed" size="sm">Маршруты API</Text><Title order={2}>{endpoints.length}</Title></Card><Card withBorder radius="md" p="md"><Text c="dimmed" size="sm">Группы методов</Text><Title order={2}>{categories.length}</Title></Card><Card withBorder radius="md" p="md"><Text c="dimmed" size="sm">Исходящие события</Text><Title order={2}>{webhookNames.length}</Title></Card></SimpleGrid>
    <Tabs defaultValue="api" variant="outline" keepMounted={false}><Tabs.List><Tabs.Tab value="api" leftSection={<TbCode size={16}/>}>API-запросы</Tabs.Tab><Tabs.Tab value="webhooks" leftSection={<TbWebhook size={16}/>}>Вебхуки</Tabs.Tab></Tabs.List>
    <Tabs.Panel value="api" pt="lg"><Stack gap="md">
       <Text size="sm" c="dimmed">Список сформирован из контрактов и контроллеров именно этого форка. Для точных DTO, параметров, кодов ответов и полных схем откройте штатный Swagger/Scalar, если он включён через IS_DOCS_ENABLED. Авторизация зависит от метода (JWT, API-токен, публичный доступ).</Text>
       <SimpleGrid cols={{base:1,md:2}}><TextInput leftSection={<TbSearch size={16}/>} label="Поиск по API" placeholder="Путь, метод или описание" value={search} onChange={e=>setSearch(e.currentTarget.value)}/><Select label="Раздел" searchable clearable={false} value={category} onChange={setCategory} data={[{value:'all',label:'Все разделы'},...categories.map(c=>({value:c,label:c}))]}/></SimpleGrid>
       <Group justify="space-between" wrap="wrap"><Group gap="sm"><SegmentedControl size="xs" data={methods.map(m=>({value:m,label:m==='ALL'?'Все':m}))} value={method} onChange={setMethod}/><Button size="compact-sm" variant={category==='Лимиты нод'?'filled':'light'} onClick={()=>{setCategory(category==='Лимиты нод'?'all':'Лимиты нод');setMethod('ALL');setSearch('')}}>Лимиты нод</Button></Group><Text size="sm" c="dimmed">Найдено: {visible.length}</Text></Group>
       <Accordion variant="separated" radius="md" multiple>{visible.map((e,i)=><Accordion.Item key={`${e.method}-${e.path}-${i}`} value={`${e.method}-${e.path}-${i}`}>
           <Accordion.Control><Group wrap="nowrap" gap="sm"><Badge color={colors[e.method]??'gray'} variant="light" miw={60}>{e.method}</Badge><Stack gap={2} style={{minWidth:0}}><Text size="sm" fw={600} ff="monospace" style={{overflowWrap:'anywhere'}}>{e.path}</Text><Text size="xs" c="dimmed">{endpointSummary(e)}</Text></Stack></Group></Accordion.Control>
           <Accordion.Panel><Stack gap="xs"><Group justify="space-between"><Badge variant="outline">{quotaCategory(e)}</Badge><CopyValue value={e.path}/></Group><Text size="sm" c="dimmed">Пример HTTP-запроса (параметры пути замените на реальные значения):</Text>
            <CodeHighlight language="bash" code={`curl -X ${e.method} "https://YOUR_PANEL${e.path}" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"${requestExample(e)?` \
  --data '${JSON.stringify(requestExample(e))}'`:''}`}/>{e.method==='POST'&&e.path==='/api/users'&&<><Text size="sm" fw={600}>Создание с группами лимитов нод</Text><CodeHighlight language="json" code={JSON.stringify(createUserRequest,null,2)}/><Text size="xs" c="dimmed">nodeQuotaGroups необязателен. Для лимита одной ноды создайте группу с одним UUID; для общего лимита укажите несколько UUID. Одна нода может входить только в одну группу пользователя.</Text></>}{quotaCategory(e)==='Лимиты нод'&&<><Text size="xs" c="dimmed">Байты передаются строкой. В одной группе 1–20 нод; у пользователя каждая нода может входить только в одну группу.</Text>{quotaRequest(e)&&<><Text size="sm" fw={600}>Тело запроса</Text><CodeHighlight language="json" code={JSON.stringify(quotaRequest(e),null,2)}/></>}{quotaResponse(e)&&<><Text size="sm" fw={600}>Пример ответа</Text><CodeHighlight language="json" code={JSON.stringify(quotaResponse(e),null,2)}/></>}</>}<Text size="xs" c="dimmed">Для методов с телом требуется JSON по DTO контракта; здесь не выполняются запросы и не раскрываются ключи.</Text></Stack></Accordion.Panel>
       </Accordion.Item>)}</Accordion>
       {!visible.length&&<Card withBorder radius="md" p="xl"><Text c="dimmed" ta="center">Совпадений нет. Измените фильтры.</Text></Card>}
    </Stack></Tabs.Panel>
    <Tabs.Panel value="webhooks" pt="lg"><Stack gap="md"><Text size="sm" c="dimmed">Все события используют scope, event, timestamp и data. События форка отправляются через штатные WEBHOOK_ENABLED, WEBHOOK_URL и WEBHOOK_SECRET_HEADER с подписью X-Remnawave-Signature. У событий форка есть id для дедупликации; прежнее имя события доступно в meta.legacyEvent. Для лимитов нод data.group содержит UUID и название группы либо null; data.location.nodeUuids содержит все ноды группы. data.traffic показывает общий расход группы. У торрент-блокера data.device всегда присутствует: объект устройства либо null; data.deviceIdentification показывает точность определения.</Text>
      <TextInput leftSection={<TbSearch size={16}/>} label="Поиск по событиям" placeholder="user.*, node_quota.*, node_metric.*" value={webhookQuery} onChange={e=>setWebhookQuery(e.currentTarget.value)}/>
      <Accordion variant="separated" radius="md" multiple>{hooks.map((name,i)=><Accordion.Item key={name} value={`${name}-${i}`}><Accordion.Control><Group gap="sm" wrap="nowrap"><Badge color="violet" variant="light">EVENT</Badge><Stack gap={2}><Text ff="monospace" size="sm" fw={600}>{name}</Text><Text size="xs" c="dimmed">{infoFor(name)}</Text></Stack></Group></Accordion.Control><Accordion.Panel><Stack>{webhookContract(name)&&<><Text size="sm" fw={600}>Поля и типы по контракту</Text><CodeHighlight language="json" code={JSON.stringify(webhookContract(name),null,2)}/></>}{(!webhookContract(name)||name==='torrent_blocker.report')&&<><Group justify="space-between"><Text size="sm">Пример JSON</Text><CopyValue value={JSON.stringify(webhookSample(name),null,2)}/></Group><CodeHighlight language="json" code={JSON.stringify(webhookSample(name),null,2)}/></>}{name.startsWith('node_quota.')&&<><Text size="sm" fw={600}>Пример для общего лимита группы</Text><CodeHighlight language="json" code={JSON.stringify({...sampleGroupQuota,event:name,meta:{legacyEvent:legacyEventByName[name]}},null,2)}/></>}<Button component="a" href={`https://github.com/ap1w1/remnadrop/blob/main/${webhookSource(name)}`} target="_blank" rel="noopener noreferrer" variant="subtle" size="xs">Посмотреть все поля в обработчике</Button><Divider/><Text size="xs" c="dimmed">Общие поля Remnawave: scope, event, timestamp и data. Состав data зависит от события; обработчик выше задаёт окончательную структуру.</Text></Stack></Accordion.Panel></Accordion.Item>)}</Accordion>
    </Stack></Tabs.Panel></Tabs>
  </Stack></Page>
}
