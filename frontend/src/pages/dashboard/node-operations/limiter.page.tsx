import { Alert, Badge, Button, Card, Group, MultiSelect, NumberInput, PasswordInput, Select, SimpleGrid, Stack, Switch, Table, Text, TextInput, Title, Tooltip } from '@mantine/core'
import { useCallback, useEffect, useState } from 'react'
import { TbAdjustments, TbRefresh, TbShieldCheck } from 'react-icons/tb'
import { instance } from '@shared/api/axios'
import { Page } from '@shared/ui'
import { nodeOptionLabel, type NodeOptionData } from '@shared/utils/misc/node-option-label'

type Mode='manual'|'auto'
type Settings={enabled:boolean;mode:Mode;checkIntervalSeconds:number;activeWindowSeconds:number;tolerance:number;
 toleranceMultiplier:number;defaultDeviceLimit:number;violationThreshold:number;thresholdWindowSeconds:number;cooldownSeconds:number;
 autoRestoreMinutes:number;softWarnings:boolean;subnetGrouping:boolean;subnetPrefixV4:number;asnGrouping:boolean;
 trafficMonitor:boolean;trafficSpikeFactor:number;trafficSpikeMinGb:number;trafficHeavyGb:number;trafficHeavyDays:number;
 sharedHwidMonitor:boolean;sharedHwidHistoryDays:number;dailyReport:boolean;updateCheck:boolean;
 ignoredNodes:string[];trafficIgnoredNodes:string[];ignoredUsers:string[];ignoredIps:string[];
 lastScanAt:string|null;lastError:string|null;engineVersion:string}
type Event={id:string;user_uuid:string|null;username:string;event_type:string;mode:Mode;device_limit:number;observed_count:number;
 ips:Array<{ip:string;nodeUuid?:string;node_uuid?:string}>;details:string|null;created_at:string}
const api='/api/limiter'
const defaultConfig:Settings={enabled:false,mode:'manual',checkIntervalSeconds:60,activeWindowSeconds:120,tolerance:1,
 toleranceMultiplier:0,defaultDeviceLimit:0,violationThreshold:3,thresholdWindowSeconds:3600,cooldownSeconds:300,autoRestoreMinutes:15,
 softWarnings:false,subnetGrouping:false,subnetPrefixV4:24,asnGrouping:false,
 trafficMonitor:false,trafficSpikeFactor:10,trafficSpikeMinGb:150,trafficHeavyGb:200,trafficHeavyDays:5,
 sharedHwidMonitor:false,sharedHwidHistoryDays:30,dailyReport:false,updateCheck:false,
 ignoredNodes:[],trafficIgnoredNodes:[],ignoredUsers:[],ignoredIps:[],lastScanAt:null,lastError:null,engineVersion:'5.1.0'}
function errMessage(e:unknown){const a=e as {response?:{data?:{message?:string|string[]}}};return String(a.response?.data?.message??'Не удалось выполнить запрос')}
export function LimiterPage(){
 const [settings,setSettings]=useState<Settings>(defaultConfig),[events,setEvents]=useState<Event[]>([]),[nodes,setNodes]=useState<NodeOptionData[]>([])
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [ignoredIpsText,setIgnoredIpsText]=useState('')
 const [credentialStatus,setCredentialStatus]=useState(false)
 const [engineStatus,setEngineStatus]=useState<{embedded:boolean;running:boolean;pid:number|null;version:string;redisDatabase:number}|null>(null)
 const [telegramToken,setTelegramToken]=useState(''),[telegramChat,setTelegramChat]=useState(''),[telegramAdmins,setTelegramAdmins]=useState('')
 const [maxmindKey,setMaxmindKey]=useState(''),[hwidSquadIds,setHwidSquadIds]=useState('')
 const refresh=useCallback(async()=>{
   const [a,b,c,d]=await Promise.all([instance.get(api+'/settings'),instance.get(api+'/events'),instance.get(api+'/credentials'),instance.get(api+'/status')])
   const s=a.data.response as Settings;setSettings(s);setIgnoredIpsText(s.ignoredIps.join(', '));setEvents(b.data.response as Event[]);setCredentialStatus(Boolean(c.data.response.configured));setEngineStatus(d.data.response)
 },[])
 useEffect(()=>{void Promise.all([refresh(),instance.get('/api/nodes').then(r=>setNodes(r.data.response))])
   .catch(e=>setError(errMessage(e))).finally(()=>setLoading(false))},[refresh])
 useEffect(()=>{const id=window.setInterval(()=>{void instance.get(api+'/events').then(r=>setEvents(r.data.response)).catch(()=>{})},30000);return()=>clearInterval(id)},[])
 const change=<K extends keyof Settings>(key:K,value:Settings[K])=>setSettings(s=>({...s,[key]:value}))
 const save=async()=>{
   if(settings.enabled&&settings.mode==='auto'&&!window.confirm('Автоматический режим будет отключать реальные подписки пользователей. Включить автоблокировку?'))return
   setBusy(true);setError('')
   try{
     const {lastScanAt,lastError,engineVersion,...config}=settings
     await instance.put(api+'/settings',{...config,ignoredIps:ignoredIpsText.split(/[,\s]+/).filter(Boolean)})
     await refresh();setNotice('Настройки сохранены. Сервис Limiter 5.1.0 применит их при следующей синхронизации.')
   }catch(e){setError(errMessage(e))}finally{setBusy(false)}
 }
 const saveCredentials=async()=>{
   setBusy(true);setError('')
   try{
     await instance.put(api+'/credentials',{
       telegramBotToken:telegramToken,telegramChatId:telegramChat,telegramAdminIds:telegramAdmins,
       maxmindLicenseKey:maxmindKey,
       sharedHwidSquadUuids:hwidSquadIds.split(/[\s,]+/).filter(Boolean)
     })
     setCredentialStatus(true);setTelegramToken('');setTelegramChat('');setTelegramAdmins('')
     setMaxmindKey('');setHwidSquadIds('')
     setNotice('Секреты зашифрованы. Встроенный Limiter применит их автоматически.')
   }catch(e){setError(errMessage(e))}finally{setBusy(false)}
 }
 const removeCredentials=async()=>{
   if(!window.confirm('Удалить сохранённые токены и настройки Telegram/MaxMind?'))return
   setBusy(true)
   try{await instance.delete(api+'/credentials');setCredentialStatus(false);setNotice('Секретные настройки удалены.')}catch(e){setError(errMessage(e))}finally{setBusy(false)}
 }
 const ignored=async(uuid:string)=>{
   if(!window.confirm('Добавить пользователя в исключения Limiter?'))return
   try{await instance.post(api+'/ignore/'+uuid);await refresh();setNotice('Пользователь добавлен в исключения.')}catch(e){setError(errMessage(e))}
 }
 const unignore=async(uuid:string)=>{
   try{await instance.post(api+'/unignore/'+uuid);await refresh();setNotice('Пользователь удалён из исключений.')}
   catch(e){setError(errMessage(e))}
 }
 const num=(key:keyof Settings,label:string,min:number,max:number,description?:string,allowDecimal=false)=>
   <NumberInput size="sm" label={label} min={min} max={max} allowDecimal={allowDecimal}
     description={description} value={settings[key] as number} onChange={v=>change(key,Number(v) as never)}/>
 return <Page title="Limiter"><Stack gap="md">
   <Group justify="space-between" wrap="wrap" align="center"><Group gap="sm"><TbShieldCheck size={30}/>
     <div><Title order={2}>Limiter</Title><Text c="dimmed" size="sm">Встроенный Limiter 5.1.0 — один Docker-контейнер с RemnaDrop 2.8.1</Text></div></Group>
     <Button variant="light" leftSection={<TbRefresh size={16}/>} loading={loading} onClick={()=>void refresh().catch(e=>setError(errMessage(e)))}>Обновить</Button></Group>
   {error&&<Alert color="red" withCloseButton onClose={()=>setError('')}>{error}</Alert>}
   {notice&&<Alert color="teal" withCloseButton onClose={()=>setNotice('')}>{notice}</Alert>}
   {settings.lastError&&<Alert color="yellow" title="Состояние подключения Limiter">{settings.lastError}</Alert>}
   {settings.enabled&&(!settings.lastScanAt||Date.now()-new Date(settings.lastScanAt).getTime()>120000)&&
     <Alert color="orange" title="Сервис не подтверждён">Limiter разрешён, но встроенный процесс не запущен. Проверьте Telegram-настройки, Redis и журнал панели.</Alert>}
   <SimpleGrid cols={{base:1,sm:4}} spacing="xs">
     <Card withBorder p="sm"><Text c="dimmed" size="xs">Состояние</Text><Badge mt={6} color={settings.enabled?'teal':'gray'}>{settings.enabled?'Разрешён':'Выключен'}</Badge></Card>
     <Card withBorder p="sm"><Text c="dimmed" size="xs">Режим</Text><Title order={4}>{settings.mode==='auto'?'Автоматический':'Ручной'}</Title></Card>
     <Card withBorder p="sm"><Text c="dimmed" size="xs">Процесс в контейнере remnawave</Text>
       <Badge mt={6} color={engineStatus?.running?'teal':'gray'} variant="light">{engineStatus?.running?'Работает':'Не запущен'}</Badge>
       <Text size="xs" c="dimmed" mt={3}>{engineStatus?.version??'5.1.0'} · Valkey DB {engineStatus?.redisDatabase??8}</Text>
     </Card>
     <Card withBorder p="sm"><Text c="dimmed" size="xs">Последняя связь с сервисом</Text><Text size="sm" mt={5}>{settings.lastScanAt?new Date(settings.lastScanAt).toLocaleString('ru-RU'):'Не запускался'}</Text></Card>
   </SimpleGrid>
   <Card withBorder radius="md" padding="md"><Stack gap="md">
     <Group justify="space-between"><Title order={4}>Интеграции Limiter 5.1.0</Title>
       <Badge color={credentialStatus?'teal':'gray'} variant="light">{credentialStatus?'Секреты сохранены':'Не настроено'}</Badge></Group>
     <Text size="sm" c="dimmed">Telegram обязателен для оригинального Limiter 5.1.0. Данные шифруются в PostgreSQL и передаются только встроенному процессу.</Text>
     <SimpleGrid cols={{base:1,sm:2}}>
       <PasswordInput label="Telegram Bot Token" description="Токен от BotFather"
         placeholder={credentialStatus?'Введите новый токен для замены':'123456:...'}
         autoComplete="off" value={telegramToken} onChange={e=>setTelegramToken(e.currentTarget.value)}/>
       <TextInput label="Chat ID" placeholder="-1001234567890" value={telegramChat} onChange={e=>setTelegramChat(e.currentTarget.value)}/>
       <TextInput label="Admin IDs" description="Telegram ID через запятую" placeholder="123456789,987654321"
         value={telegramAdmins} onChange={e=>setTelegramAdmins(e.currentTarget.value)}/>
       <PasswordInput label="MaxMind License Key (необязательно)" placeholder="Лицензионный ключ MaxMind для ASN"
         autoComplete="off" value={maxmindKey} onChange={e=>setMaxmindKey(e.currentTarget.value)}/>
     </SimpleGrid>
     <TextInput label="UUID сквадов для анализа повторных триалов" placeholder="uuid, uuid, ..."
       description="Пусто — все пользователи. Задаётся только если включён мониторинг общего HWID."
       value={hwidSquadIds} onChange={e=>setHwidSquadIds(e.currentTarget.value)}/>
     <Group justify="end">
       {credentialStatus&&<Button variant="subtle" color="red" onClick={()=>void removeCredentials()} disabled={busy}>Удалить секреты</Button>}
       <Button loading={busy} disabled={!telegramToken||!telegramChat||!telegramAdmins}
         onClick={()=>void saveCredentials()}>Сохранить Telegram / MaxMind</Button>
     </Group>
   </Stack></Card>
   <Card withBorder radius="md" padding="md"><Stack gap="md">
     <Group justify="space-between"><Group gap="xs"><TbAdjustments size={21}/><Title order={4}>Настройки проверки</Title></Group>
       <Switch label={settings.enabled?'Включить Limiter 5.1.0':'Limiter выключен'} checked={settings.enabled} onChange={e=>change('enabled',e.currentTarget.checked)}/></Group>
     <Alert color="blue" title="Limiter 5.1.0 + Remnawave 2.8.1">Оригинальный Go Limiter 5.1.0 уже включён в образ панели. NestJS запускает его внутри контейнера remnawave и подключает к существующему Valkey. Дополнительный контейнер, порт и API-токен не требуются.</Alert>
     <SimpleGrid cols={{base:1,sm:2,lg:4}} spacing="sm">
       <Select label="Режим реагирования" allowDeselect={false} value={settings.mode} onChange={v=>change('mode',(v??'manual') as Mode)}
         data={[{value:'manual',label:'Ручной — Telegram-алерты и кнопки'},{value:'auto',label:'Авто — отключать подписки'}]}/>
       {num('checkIntervalSeconds','Проверка каждые, сек',30,3600)}
       {num('activeWindowSeconds','Активный IP, сек',60,3600)}
       {num('tolerance','Допустимое превышение, IP',0,20)}
       {num('toleranceMultiplier','Допуск, множитель',0,100,undefined,true)}
       {num('defaultDeviceLimit','Лимит по умолчанию',0,100,'0 — без ограничений, если у пользователя не задан HWID')}
       {num('violationThreshold','Повторений до действия',1,30)}
       {num('thresholdWindowSeconds','Окно нарушений, сек',60,86400)}
       {num('cooldownSeconds','Кулдаун, сек',30,86400)}
       {num('autoRestoreMinutes','Автовключение, мин',0,10080,'0 — не включать автоматически')}
     </SimpleGrid>
     <SimpleGrid cols={{base:1,sm:2,lg:3}}>
       <Switch label="Группировать IP по подсетям" checked={settings.subnetGrouping} onChange={e=>change('subnetGrouping',e.currentTarget.checked)}/>
       <Switch label="Группировка по ASN" description="Требует базу MaxMind ASN" checked={settings.asnGrouping} onChange={e=>change('asnGrouping',e.currentTarget.checked)}/>
       <Switch label="Мягкие предупреждения" description="В пределах допуска без блокировки" checked={settings.softWarnings} onChange={e=>change('softWarnings',e.currentTarget.checked)}/>
     </SimpleGrid>
     {settings.subnetGrouping&&num('subnetPrefixV4','Префикс IPv4',8,32)}
     <MultiSelect searchable label="Исключённые ноды" value={settings.ignoredNodes} onChange={v=>change('ignoredNodes',v)}
       data={nodes.map(n=>({value:n.uuid,label:nodeOptionLabel(n)}))}/>
     <TextInput label="Исключённые IP (через запятую)" description="Указывайте отдельные адреса IPv4/IPv6."
       value={ignoredIpsText} onChange={e=>setIgnoredIpsText(e.currentTarget.value)}/>
     <Text size="xs" c="dimmed">IP и подсети CIDR допускаются. Пример: 192.0.2.10, 2001:db8::/32</Text>
     {settings.ignoredUsers.length>0&&<Stack gap={4}>
       <Text size="sm" fw={600}>Пользователи в исключениях</Text>
       <Group gap="xs" wrap="wrap">
         {settings.ignoredUsers.map(uuid=><Button key={uuid} size="compact-xs" variant="light" color="gray"
           onClick={()=>void unignore(uuid)} aria-label={'Удалить из исключений '+uuid}>
           {events.find(e=>e.user_uuid===uuid)?.username??uuid} ×
         </Button>)}
       </Group>
     </Stack>}
     <Card withBorder p="sm" radius="md"><Stack gap="sm">
       <Title order={5}>Мониторинг аномального трафика (5.1.0)</Title>
       <Switch label="Включить обнаружение всплесков и высокого трафика" checked={settings.trafficMonitor}
         onChange={e=>change('trafficMonitor',e.currentTarget.checked)}/>
       <SimpleGrid cols={{base:1,sm:2,lg:4}}>
         {num('trafficSpikeFactor','Кратность всплеска',1.5,100,undefined,true)}
         {num('trafficSpikeMinGb','Минимальный всплеск, ГБ',1,1000000)}
         {num('trafficHeavyGb','Высокий трафик в сутки, ГБ',0,1000000)}
         {num('trafficHeavyDays','Суток с высоким трафиком (из 7)',1,7)}
       </SimpleGrid>
       <MultiSelect label="Исключить ноды из мониторинга трафика" searchable value={settings.trafficIgnoredNodes}
         onChange={v=>change('trafficIgnoredNodes',v)}
         data={nodes.map(n=>({value:n.uuid,label:nodeOptionLabel(n)}))}/>
     </Stack></Card>
     <Card withBorder p="sm" radius="md"><Stack gap="sm">
       <Title order={5}>Общий HWID / повторные пробные периоды (5.1.0)</Title>
       <Switch label="Отслеживать один HWID у разных аккаунтов" checked={settings.sharedHwidMonitor}
         onChange={e=>change('sharedHwidMonitor',e.currentTarget.checked)}/>
       {num('sharedHwidHistoryDays','Хранить историю устройств, дней',0,365,'0 — без исторических совпадений')}
       <Text size="xs" c="dimmed">Ограничение мониторинга отдельными внутренними сквадами задаётся переменной SHARED_HWID_SQUAD_UUIDS на сервере.</Text>
     </Stack></Card>
     <Group gap="lg"><Switch label="Ежедневный отчёт" checked={settings.dailyReport} onChange={e=>change('dailyReport',e.currentTarget.checked)}/>
       <Switch label="Проверять обновления Limiter" checked={settings.updateCheck} onChange={e=>change('updateCheck',e.currentTarget.checked)}/></Group>
     {settings.mode==='auto'&&<Alert color="orange" title="Автоблокировка">Исходный Limiter 5.1.0 отключает подписки по превышению лимита. Временные блокировки и их восстановление управляются самим сервисом.</Alert>}
     <Group justify="end"><Button disabled={busy} variant="default" onClick={()=>void refresh()}>Отменить изменения</Button>
       <Button loading={busy} onClick={()=>void save()}>Сохранить настройки</Button></Group>
   </Stack></Card>
   <Card withBorder radius="md" p="md"><Stack gap="sm">
     <Group justify="space-between"><Title order={4}>Список событий</Title><Badge variant="light">{events.length} последних</Badge></Group>
     <Table.ScrollContainer minWidth={720}><Table highlightOnHover verticalSpacing="xs">
       <Table.Thead><Table.Tr><Table.Th>Время</Table.Th><Table.Th>Пользователь</Table.Th><Table.Th>Тип</Table.Th><Table.Th>Лимит</Table.Th><Table.Th>Обнаружено</Table.Th><Table.Th>IP и ноды</Table.Th><Table.Th/></Table.Tr></Table.Thead>
       <Table.Tbody>{events.map(e=><Table.Tr key={e.id}>
         <Table.Td><Text size="xs">{new Date(e.created_at).toLocaleString('ru-RU')}</Text></Table.Td>
         <Table.Td><Text fw={600} size="sm">{e.username}</Text></Table.Td>
         <Table.Td><Badge color={e.event_type==='soft_violation_detected'?'blue':'yellow'}>{e.event_type==='soft_violation_detected'?'Предупреждение':'Превышение'}</Badge></Table.Td>
         <Table.Td>{e.device_limit}</Table.Td><Table.Td>{e.observed_count}</Table.Td>
         <Table.Td><Tooltip multiline label={(e.ips??[]).map(x=>x.ip+' · '+(nodes.find(n=>n.uuid===(x.nodeUuid??x.node_uuid))?.name??x.nodeUuid??x.node_uuid)).join('\n')||'Нет IP'}>
           <Text size="xs" c="dimmed">{e.ips?.length??0} IP · подробнее при наведении</Text></Tooltip></Table.Td>
         <Table.Td>{e.user_uuid&&!settings.ignoredUsers.includes(e.user_uuid)&&<Button variant="subtle" size="compact-xs" onClick={()=>void ignored(e.user_uuid!)}>Игнорировать</Button>}</Table.Td>
       </Table.Tr>)}
       {!events.length&&<Table.Tr><Table.Td colSpan={7}><Text ta="center" c="dimmed" py="xl">Нарушений пока не обнаружено</Text></Table.Td></Table.Tr>}
       </Table.Tbody>
     </Table></Table.ScrollContainer>
   </Stack></Card>
   <Text size="xs" c="dimmed">Limiter 5.1.0 запускается внутри контейнера remnawave после включения. Используется Valkey панели через Unix-сокет (отдельная Redis DB 8). Автоблокировка требует сохраняемого Redis (AOF или RDB). События поступают в PostgreSQL через внутренний подписанный вебхук.</Text>
 </Stack></Page>
}
