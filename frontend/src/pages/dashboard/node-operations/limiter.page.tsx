import { Alert, Badge, Button, Card, Group, MultiSelect, NumberInput, Select, SimpleGrid, Stack, Switch, Table, Text, TextInput, Title, Tooltip } from '@mantine/core'
import { useCallback, useEffect, useState } from 'react'
import { TbAdjustments, TbRefresh, TbShieldCheck, TbShieldExclamation } from 'react-icons/tb'
import { instance } from '@shared/api/axios'
import { Page } from '@shared/ui'
import { nodeOptionLabel, type NodeOptionData } from '@shared/utils/misc/node-option-label'

type Mode='manual'|'auto'
type Settings={enabled:boolean;mode:Mode;checkIntervalSeconds:number;activeWindowSeconds:number;tolerance:number;
 defaultDeviceLimit:number;violationThreshold:number;thresholdWindowSeconds:number;cooldownSeconds:number;
 autoRestoreMinutes:number;subnetGrouping:boolean;ignoredNodes:string[];ignoredUsers:string[];ignoredIps:string[];
 lastScanAt:string|null;lastError:string|null}
type Event={id:string;user_uuid:string|null;username:string;event_type:string;mode:Mode;device_limit:number;observed_count:number;
 ips:Array<{ip:string;nodeUuid:string}>;details:string|null;created_at:string}
const api='/api/limiter'
const defaultConfig:Settings={enabled:false,mode:'manual',checkIntervalSeconds:60,activeWindowSeconds:180,tolerance:1,
 defaultDeviceLimit:0,violationThreshold:3,thresholdWindowSeconds:3600,cooldownSeconds:900,autoRestoreMinutes:15,
 subnetGrouping:false,ignoredNodes:[],ignoredUsers:[],ignoredIps:[],lastScanAt:null,lastError:null}
function errMessage(e:unknown){const a=e as {response?:{data?:{message?:string|string[]}}};return String(a.response?.data?.message??'Не удалось выполнить запрос')}
export function LimiterPage(){
 const [settings,setSettings]=useState<Settings>(defaultConfig),[events,setEvents]=useState<Event[]>([]),[nodes,setNodes]=useState<NodeOptionData[]>([])
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [ignoredIpsText,setIgnoredIpsText]=useState('')
 const refresh=useCallback(async()=>{
   const [a,b]=await Promise.all([instance.get(api+'/settings'),instance.get(api+'/events')])
   const s=a.data.response as Settings;setSettings(s);setIgnoredIpsText(s.ignoredIps.join(', '));setEvents(b.data.response as Event[])
 },[])
 useEffect(()=>{void Promise.all([refresh(),instance.get('/api/nodes').then(r=>setNodes(r.data.response))])
   .catch(e=>setError(errMessage(e))).finally(()=>setLoading(false))},[refresh])
 useEffect(()=>{const id=window.setInterval(()=>{void instance.get(api+'/events').then(r=>setEvents(r.data.response)).catch(()=>{})},30000);return()=>clearInterval(id)},[])
 const change=<K extends keyof Settings>(key:K,value:Settings[K])=>setSettings(s=>({...s,[key]:value}))
 const save=async()=>{
   if(settings.enabled&&settings.mode==='auto'&&!window.confirm('Автоматический режим будет отключать реальные подписки пользователей. Включить автоблокировку?'))return
   setBusy(true);setError('')
   try{
     const {lastScanAt,lastError,...config}=settings
     await instance.put(api+'/settings',{...config,ignoredIps:ignoredIpsText.split(/[,\s]+/).filter(Boolean)})
     await refresh();setNotice('Настройки Limiter применены без перезапуска панели.')
   }catch(e){setError(errMessage(e))}finally{setBusy(false)}
 }
 const ignored=async(uuid:string)=>{
   if(!window.confirm('Добавить пользователя в исключения Limiter?'))return
   try{await instance.post(api+'/ignore/'+uuid);await refresh();setNotice('Пользователь добавлен в исключения.')}catch(e){setError(errMessage(e))}
 }
 const num=(key:keyof Settings,label:string,min:number,max:number,description?:string)=>
   <NumberInput size="sm" label={label} min={min} max={max} allowDecimal={false}
     description={description} value={settings[key] as number} onChange={v=>change(key,Number(v) as never)}/>
 return <Page title="Limiter"><Stack gap="md">
   <Group justify="space-between" wrap="wrap" align="center"><Group gap="sm"><TbShieldCheck size={30}/>
     <div><Title order={2}>Limiter</Title><Text c="dimmed" size="sm">Контроль одновременных IP на всех нодах Remnawave 2.8.1</Text></div></Group>
     <Button variant="light" leftSection={<TbRefresh size={16}/>} loading={loading} onClick={()=>void refresh().catch(e=>setError(errMessage(e)))}>Обновить</Button></Group>
   {error&&<Alert color="red" withCloseButton onClose={()=>setError('')}>{error}</Alert>}
   {notice&&<Alert color="teal" withCloseButton onClose={()=>setNotice('')}>{notice}</Alert>}
   {settings.lastError&&<Alert color="yellow" title="Последний цикл Limiter">{settings.lastError}</Alert>}
   <SimpleGrid cols={{base:1,sm:3}} spacing="xs">
     <Card withBorder p="sm"><Text c="dimmed" size="xs">Состояние</Text><Badge mt={6} color={settings.enabled?'teal':'gray'}>{settings.enabled?'Включён':'Выключен'}</Badge></Card>
     <Card withBorder p="sm"><Text c="dimmed" size="xs">Режим</Text><Title order={4}>{settings.mode==='auto'?'Автоматический':'Ручной'}</Title></Card>
     <Card withBorder p="sm"><Text c="dimmed" size="xs">Последняя проверка</Text><Text size="sm" mt={5}>{settings.lastScanAt?new Date(settings.lastScanAt).toLocaleString('ru-RU'):'Не запускался'}</Text></Card>
   </SimpleGrid>
   <Card withBorder radius="md" padding="md"><Stack gap="md">
     <Group justify="space-between"><Group gap="xs"><TbAdjustments size={21}/><Title order={4}>Настройки проверки</Title></Group>
       <Switch label={settings.enabled?'Limiter работает':'Limiter выключен'} checked={settings.enabled} onChange={e=>change('enabled',e.currentTarget.checked)}/></Group>
     <Alert color="blue" title="Совместимость Remnawave 2.8.1">Используется штатная очередь fetch-users-ips для нод, а не API connections версии 3.x. При недоступности хотя бы одной выбранной ноды автоблокировка не выполняется.</Alert>
     <SimpleGrid cols={{base:1,sm:2,lg:4}} spacing="sm">
       <Select label="Режим реагирования" allowDeselect={false} value={settings.mode} onChange={v=>change('mode',(v??'manual') as Mode)}
         data={[{value:'manual',label:'Ручной — только события'},{value:'auto',label:'Авто — отключать подписки'}]}/>
       {num('checkIntervalSeconds','Проверка каждые, сек',30,3600)}
       {num('activeWindowSeconds','Активный IP, сек',60,3600)}
       {num('tolerance','Допустимое превышение, IP',0,20)}
       {num('defaultDeviceLimit','Лимит по умолчанию',0,100,'0 — без ограничений, если у пользователя не задан HWID')}
       {num('violationThreshold','Повторений до действия',1,30)}
       {num('thresholdWindowSeconds','Окно нарушений, сек',60,86400)}
       {num('cooldownSeconds','Кулдаун, сек',30,86400)}
       {num('autoRestoreMinutes','Автовключение, мин',0,10080,'0 — не включать автоматически')}
     </SimpleGrid>
     <Switch label="Группировать IPv4 по /24" description="Снижает количество ложных превышений при смене IP внутри одной подсети. IPv6 учитываются отдельно."
       checked={settings.subnetGrouping} onChange={e=>change('subnetGrouping',e.currentTarget.checked)}/>
     <MultiSelect searchable label="Исключённые ноды" value={settings.ignoredNodes} onChange={v=>change('ignoredNodes',v)}
       data={nodes.map(n=>({value:n.uuid,label:nodeOptionLabel(n)}))}/>
     <TextInput label="Исключённые IP (через запятую)" description="Указывайте отдельные адреса IPv4/IPv6."
       value={ignoredIpsText} onChange={e=>setIgnoredIpsText(e.currentTarget.value)}/>
     {settings.mode==='auto'&&<Alert color="orange" title="Автоблокировка">При подтверждённом превышении Limiter отключит подписку через UsersService. Временная блокировка завершается автоматически, если установлен срок восстановления.</Alert>}
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
         <Table.Td><Badge color={e.event_type==='disabled'?'red':e.event_type==='restored'?'teal':'yellow'}>{e.event_type==='disabled'?'Блокировка':e.event_type==='restored'?'Восстановление':'Превышение'}</Badge></Table.Td>
         <Table.Td>{e.device_limit}</Table.Td><Table.Td>{e.observed_count}</Table.Td>
         <Table.Td><Tooltip multiline label={(e.ips??[]).map(x=>x.ip+' · '+(nodes.find(n=>n.uuid===x.nodeUuid)?.name??x.nodeUuid)).join('\n')||'Нет IP'}>
           <Text size="xs" c="dimmed">{e.ips?.length??0} IP · подробнее при наведении</Text></Tooltip></Table.Td>
         <Table.Td>{e.user_uuid&&!settings.ignoredUsers.includes(e.user_uuid)&&<Button variant="subtle" size="compact-xs" onClick={()=>void ignored(e.user_uuid!)}>Игнорировать</Button>}</Table.Td>
       </Table.Tr>)}
       {!events.length&&<Table.Tr><Table.Td colSpan={7}><Text ta="center" c="dimmed" py="xl">Нарушений пока не обнаружено</Text></Table.Td></Table.Tr>}
       </Table.Tbody>
     </Table></Table.ScrollContainer>
   </Stack></Card>
   <Text size="xs" c="dimmed">На сервере можно настроить Telegram-уведомления через LIMITER_TELEGRAM_BOT_TOKEN и LIMITER_TELEGRAM_CHAT_ID. Настройки хранятся в PostgreSQL, а события доступны через /api/limiter/events.</Text>
 </Stack></Page>
}
