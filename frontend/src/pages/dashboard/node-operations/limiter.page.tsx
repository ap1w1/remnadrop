import { Alert, Badge, Button, Card, Divider, Group, Menu, Modal, NumberInput, Select, SimpleGrid, Skeleton, Stack, Table, Tabs, Text, TextInput, Title, UnstyledButton } from '@mantine/core'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { TbChevronDown, TbChevronUp, TbDots, TbRefresh, TbSearch, TbSettings, TbShieldCheck } from 'react-icons/tb'
import { instance } from '@shared/api/axios'
import { Page } from '@shared/ui'
import { EventDetails, ReportDetails } from './limiter/event-details'
import { actionTitles, dateText, defaultConfig, errMessage, eventTitles, limiterApi as api, limiterPath, sourceTitles, type Audit, type EngineStatus, type IgnoredUser, type LimiterEvent, type Settings, type Summary } from './limiter/types'
export { LimiterSettingsPage } from './limiter/settings-page'

type ActionDraft={uuid:string;username:string;action:string;minutes:number;requestId:string}
function eventColor(type:string){return type==='soft_violation_detected'?'blue':type==='shared_hwid'?'violet':type.startsWith('traffic_')?'orange':'yellow'}
function statusOf(event:LimiterEvent){return event.state?.ignored?'ignored':event.user_status==='DISABLED'?'disabled':'active'}
function UserStatus({event}:{event:LimiterEvent}){
 if(event.state?.ignored)return <Badge variant="light" color="gray">{event.state.permanentIgnore?'В исключениях':'Игнорируется до '+dateText(event.state.ignoredUntil)}</Badge>
 if(event.user_status==='DISABLED')return <Badge variant="light" color="red">{event.state?.restoreAt?'Отключён до '+dateText(event.state.restoreAt):'Отключён'}</Badge>
 if(event.user_status&&event.user_status!=='ACTIVE')return <Badge variant="light" color="gray">{({EXPIRED:'Истёк срок',LIMITED:'Лимит трафика'} as Record<string,string>)[event.user_status]??event.user_status}</Badge>
 return null
}

export function LimiterPage(){
 const [settings,setSettings]=useState<Settings>(defaultConfig),[events,setEvents]=useState<LimiterEvent[]>([]),[audits,setAudits]=useState<Audit[]>([])
 const [status,setStatus]=useState<EngineStatus>({running:false,ready:false,lastCheck:null}),[summary,setSummary]=useState<Summary|null>(null)
 const [ignored,setIgnored]=useState<IgnoredUser[]>([]),[ignoredError,setIgnoredError]=useState('')
 const [loading,setLoading]=useState(true),[refreshing,setRefreshing]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [tab,setTab]=useState<string|null>('events'),[search,setSearch]=useState(''),[kind,setKind]=useState('all'),[stateFilter,setStateFilter]=useState('all'),[period,setPeriod]=useState('all')
 const [expanded,setExpanded]=useState<Set<string>>(new Set()),[draft,setDraft]=useState<ActionDraft|null>(null),[acting,setActing]=useState(false),[actionError,setActionError]=useState('')
 const [duration,setDuration]=useState('1440')
 const refresh=useCallback(async()=>{
  const [a,b,c,d,e]=await Promise.all([instance.get(api+'/settings'),instance.get(api+'/events'),instance.get(api+'/status'),instance.get(api+'/summary'),instance.get(api+'/actions')])
  setSettings(a.data.response);setEvents(b.data.response);setStatus(c.data.response);setSummary(d.data.response);setAudits(e.data.response)
 },[])
 const refreshIgnored=useCallback(async()=>{
  try{const result=await instance.get(api+'/ignored');setIgnored(result.data.response);setIgnoredError('')}
  catch(e){setIgnoredError(errMessage(e))}
 },[])
 useEffect(()=>{let cancelled=false;void refresh().catch(e=>{if(!cancelled)setError(errMessage(e))}).finally(()=>{if(!cancelled)setLoading(false)});return()=>{cancelled=true}},[refresh])
 useEffect(()=>{const timer=window.setInterval(()=>{void refresh().catch(e=>setError(errMessage(e)));if(tab==='ignored')void refreshIgnored()},30000);return()=>clearInterval(timer)},[refresh,refreshIgnored,tab])
 useEffect(()=>{if(tab==='ignored')void refreshIgnored()},[tab,refreshIgnored])
 const manualRefresh=async()=>{setRefreshing(true);setError('');try{await refresh();if(tab==='ignored')await refreshIgnored()}catch(e){setError(errMessage(e))}finally{setRefreshing(false)}}
 const filtered=useMemo(()=>{
  const q=search.trim().toLowerCase(),cutoff=period==='all'?0:Date.now()-Number(period)*3600000
  return events.filter(event=>event.event_type!=='daily_report'&&(kind==='all'||event.event_type===kind)&&
   (stateFilter==='all'||statusOf(event)===stateFilter)&&Date.parse(event.created_at)>=cutoff&&
   (!q||[event.username,event.user_id,...(event.ips??[]).flatMap(ip=>[ip.ip,ip.node_name,...(ip.nodes??[]).map(n=>n.node_name)])].some(value=>value?.toLowerCase().includes(q))))
 },[events,kind,stateFilter,period,search])
 const openAction=(uuid:string,username:string,action:string,minutes=0)=>{
  setActionError('');setDuration(String(minutes||1440));setDraft({uuid,username,action,minutes,requestId:crypto.randomUUID()})
 }
 const confirmAction=async()=>{
  if(!draft)return;setActing(true);setActionError('')
  try{
   const result=await instance.post(api+'/users/'+draft.uuid+'/actions',{action:draft.action,minutes:draft.minutes,requestId:draft.requestId})
   setNotice(result.data.response.warning??'Действие выполнено: '+actionTitles[draft.action]+'. Пользователь '+draft.username+'.')
   setDraft(null);await refresh();if(tab==='ignored')await refreshIgnored()
  }catch(e){setActionError(errMessage(e))}finally{setActing(false)}
 }
 const toggle=(id:string)=>setExpanded(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next})
 const actionsFor=(event:LimiterEvent)=>{
  if(!event.user_uuid)return event.event_type==='update_available'?null:<Text size="xs" c="dimmed">Пользователь удалён. Событие сохранено в истории.</Text>
  const disabled=!status.ready,uuid=event.user_uuid,name=event.username
  return <Group gap="xs" wrap="wrap">
   {event.user_status==='DISABLED'
    ? <Button h={44} variant="light" color="teal" disabled={disabled} onClick={()=>openAction(uuid,name,'enable')}>Включить подписку</Button>
    : settings.mode==='manual'&&<>
     <Button h={44} variant="light" color="red" disabled={disabled} onClick={()=>openAction(uuid,name,'disable_temp',1440)}>Отключить на 1 день</Button>
     <Button h={44} variant="subtle" color="red" disabled={disabled} onClick={()=>openAction(uuid,name,'disable')}>Отключить навсегда</Button>
    </>}
   {event.state?.ignored
    ? <Button h={44} variant="light" color="gray" disabled={disabled} onClick={()=>openAction(uuid,name,'unignore')}>Убрать из исключений</Button>
    : <Button h={44} variant="light" color="gray" disabled={disabled} onClick={()=>openAction(uuid,name,'ignore_temp',360)}>Игнорировать 6 часов</Button>}
   <Menu withinPortal position="bottom-end"><Menu.Target><Button h={44} variant="subtle" color="gray" disabled={disabled} rightSection={<TbDots size={17}/>} aria-label={'Другие действия для '+name}>Ещё</Button></Menu.Target><Menu.Dropdown>
    <Menu.Item mih={44} onClick={()=>openAction(uuid,name,'drop')}>Сбросить подключения</Menu.Item>
    <Menu.Item mih={44} disabled={event.state?.permanentIgnore} onClick={()=>openAction(uuid,name,'ignore_temp',settings.ignoreDurationMinutes||360)}>{event.state?.permanentIgnore?'Сначала уберите постоянное исключение':'Игнорировать на другой срок'}</Menu.Item>
    <Menu.Item mih={44} onClick={()=>openAction(uuid,name,'ignore')}>Игнорировать постоянно</Menu.Item>
    {settings.mode==='auto'&&event.user_status!=='DISABLED'&&<><Menu.Divider/><Menu.Item mih={44} color="red" onClick={()=>openAction(uuid,name,'disable_temp',1440)}>Отключить на время</Menu.Item><Menu.Item mih={44} color="red" onClick={()=>openAction(uuid,name,'disable')}>Отключить навсегда</Menu.Item></>}
   </Menu.Dropdown></Menu>
  </Group>
 }
 return <Page title="Limiter"><Stack gap="lg">
  <Group justify="space-between" wrap="wrap"><Group gap="sm"><TbShieldCheck size={30}/><div><Title order={2}>Limiter</Title><Text size="sm" c="dimmed">Нарушения, подключения и действия с подписками</Text></div></Group>
   <Group gap="xs"><Button h={44} variant="default" leftSection={<TbRefresh size={18}/>} loading={refreshing} onClick={()=>void manualRefresh()}>Обновить</Button><Button h={44} component={Link} to={limiterPath+'/settings'} variant="light" leftSection={<TbSettings size={18}/>}>Настройки</Button></Group>
  </Group>
  {error&&<Alert color="red" title="Не удалось обновить данные" withCloseButton onClose={()=>setError('')}>{error}</Alert>}
  {notice&&<Alert color="teal" withCloseButton onClose={()=>setNotice('')}>{notice}</Alert>}
  {settings.lastError&&<Alert color="orange" title="Требуется внимание">{settings.lastError}</Alert>}
  {!settings.enabled&&!loading&&<Alert color="gray" title="Проверка отключена">История доступна. Чтобы получать новые события и выполнять действия, включите Limiter в настройках.</Alert>}
  {settings.enabled&&!status.ready&&!loading&&<Alert color="yellow" title="Limiter ещё не готов">Действия станут доступны после запуска. {settings.lastScanAt?'Последняя проверка: '+dateText(settings.lastScanAt):'Ожидаем первую проверку.'}</Alert>}
  <SimpleGrid cols={{base:2,md:4}} spacing="sm">
   <Card withBorder radius="md" p="md"><Text size="xs" c="dimmed">Нарушений за 24 часа</Text>{loading?<Skeleton h={28} mt={6}/>:<Title order={3} mt={4}>{summary?.live?.violations?.Count24h??summary?.count24h??'—'}</Title>}</Card>
   <Card withBorder radius="md" p="md"><Text size="xs" c="dimmed">Пользователей за 24 часа</Text>{loading?<Skeleton h={28} mt={6}/>:<Title order={3} mt={4}>{summary?.users24h??'—'}</Title>}</Card>
   <Card withBorder radius="md" p="md"><Text size="xs" c="dimmed">Режим реагирования</Text><Text fw={600} mt={6}>{settings.mode==='manual'?'Ручной':'Автоматический'}</Text><Text size="xs" c="dimmed">{settings.mode==='manual'?'Действия выбирает администратор':'По заданным порогам'}</Text></Card>
   <Card withBorder radius="md" p="md"><Group gap="xs"><Text size="xs" c="dimmed">Проверка</Text><Badge size="xs" color={status.ready?'teal':'gray'} variant="light">{status.ready?'Работает':settings.enabled?'Запускается':'Выключена'}</Badge></Group><Text size="sm" mt={6}>{dateText(status.lastCheck??settings.lastScanAt)}</Text><Text size="xs" c="dimmed">Последний успешный проход</Text></Card>
  </SimpleGrid>
  <Tabs value={tab} onChange={setTab}><Tabs.List mb="md">
   <Tabs.Tab value="events" mih={44}>События</Tabs.Tab><Tabs.Tab value="stats" mih={44}>Статистика</Tabs.Tab><Tabs.Tab value="actions" mih={44}>Действия</Tabs.Tab><Tabs.Tab value="ignored" mih={44}>Исключения</Tabs.Tab>
  </Tabs.List>
  <Tabs.Panel value="events"><Stack gap="md">
   <SimpleGrid cols={{base:1,sm:2,lg:4}} spacing="sm">
    <TextInput label="Поиск" placeholder="Пользователь, IP или нода" leftSection={<TbSearch size={17}/>} value={search} onChange={e=>setSearch(e.currentTarget.value)}/>
    <Select label="Тип события" allowDeselect={false} value={kind} onChange={v=>setKind(v??'all')} data={[{value:'all',label:'Все события'},...Object.entries(eventTitles).filter(([key])=>key!=='daily_report').map(([value,label])=>({value,label}))]}/>
    <Select label="Состояние пользователя" allowDeselect={false} value={stateFilter} onChange={v=>setStateFilter(v??'all')} data={[{value:'all',label:'Все'},{value:'active',label:'Без блокировки и исключений'},{value:'disabled',label:'Отключён'},{value:'ignored',label:'В исключениях'}]}/>
    <Select label="Период" allowDeselect={false} value={period} onChange={v=>setPeriod(v??'all')} data={[{value:'all',label:'Вся доступная история'},{value:'1',label:'Последний час'},{value:'24',label:'Последние 24 часа'},{value:'168',label:'Последняя неделя'}]}/>
   </SimpleGrid>
   <Group justify="space-between"><Text size="sm" fw={600}>Последние события</Text><Text size="xs" c="dimmed">Показано {filtered.length} из {events.filter(e=>e.event_type!=='daily_report').length} · до 250 последних</Text></Group>
   {loading?<Stack>{[0,1,2].map(i=><Skeleton h={100} radius="md" key={i}/>)}</Stack>:filtered.length?filtered.map(event=><Card key={event.id} withBorder radius="md" p="md">
    <UnstyledButton onClick={()=>toggle(event.id)} aria-expanded={expanded.has(event.id)} aria-controls={'event-'+event.id} style={{width:'100%',minHeight:44,textAlign:'left',borderRadius:6}}>
     <Group justify="space-between" align="flex-start" wrap="nowrap"><Stack gap={6} style={{minWidth:0}}><Group gap="xs" wrap="wrap"><Text fw={650} style={{overflowWrap:'anywhere'}}>{event.username}</Text><Badge variant="light" color={eventColor(event.event_type)}>{eventTitles[event.event_type]??event.event_type}</Badge><UserStatus event={event}/></Group>
      <Text size="sm" c="dimmed">{['violation_detected','soft_violation_detected'].includes(event.event_type)?`${event.observed_count} устройств · лимит ${event.device_limit} · ${event.unique_ip_count??event.ips?.length??'—'} уникальных IP`:'Подробнее о событии'} · {dateText(event.occurred_at??event.created_at)}</Text></Stack>
      <Group gap="xs" wrap="nowrap"><Text visibleFrom="sm" size="xs" c="dimmed">{expanded.has(event.id)?'Свернуть':'Подробнее'}</Text>{expanded.has(event.id)?<TbChevronUp size={20}/>:<TbChevronDown size={20}/>}</Group>
     </Group>
    </UnstyledButton>
    <div id={'event-'+event.id} hidden={!expanded.has(event.id)}><EventDetails event={event}/></div>
    <Stack gap="xs" mt="md">{actionsFor(event)}
     {event.last_action&&<Text size="xs" c={event.last_action.success?'dimmed':'red'}>Последнее действие: {actionTitles[event.last_action.action]??event.last_action.action} · {sourceTitles[event.last_action.source]??event.last_action.source} · {dateText(event.last_action.createdAt)}{!event.last_action.success?' · Ошибка':''}</Text>}
     {!event.stateAvailable&&<Text size="xs" c="orange">Текущее состояние исключений и сроков недоступно. Обновите данные перед действием.</Text>}
    </Stack>
   </Card>):<Card withBorder radius="md" p="xl"><Stack align="center" gap="sm"><TbShieldCheck size={36}/><Title order={4}>{events.length?'По этим фильтрам событий нет':'Нарушений пока нет'}</Title><Text size="sm" c="dimmed" ta="center">{events.length?'Измените период, тип или поисковый запрос.':'Здесь появятся превышения лимитов, аномалии трафика и совпадения устройств.'}</Text>{events.length>0&&<Button h={44} variant="light" onClick={()=>{setSearch('');setKind('all');setStateFilter('all');setPeriod('all')}}>Сбросить фильтры</Button>}</Stack></Card>}
  </Stack></Tabs.Panel>
  <Tabs.Panel value="stats"><Stack gap="md"><Card withBorder radius="md" p="lg"><Title order={4} mb="md">Нарушения и трафик</Title>{summary?.live?<ReportDetails data={summary.live as unknown as Record<string,unknown>}/>:<><SimpleGrid cols={2}><div><Text size="xs" c="dimmed">Сохранено событий за сутки</Text><Title order={3}>{summary?.count24h??'—'}</Title></div><div><Text size="xs" c="dimmed">За неделю</Text><Title order={3}>{summary?.countWeek??'—'}</Title></div></SimpleGrid><Text size="sm" c="dimmed" mt="md">Подробная статистика появится после запуска Limiter.</Text></>}</Card>
   <Title order={4}>Ежедневные отчёты</Title>{events.filter(e=>e.event_type==='daily_report').map(event=><Card key={event.id} withBorder radius="md"><Text fw={600} mb="md">{dateText(event.created_at)}</Text><ReportDetails data={event.payload?.data??{}}/></Card>)}{!events.some(e=>e.event_type==='daily_report')&&<Text size="sm" c="dimmed">Отчётов пока нет. Ежедневный отчёт можно включить в настройках.</Text>}
  </Stack></Tabs.Panel>
  <Tabs.Panel value="actions"><Card withBorder radius="md" p="md"><Title order={4} mb="md">История действий</Title><Table.ScrollContainer minWidth={750}><Table striped verticalSpacing="sm"><Table.Thead><Table.Tr><Table.Th>Время</Table.Th><Table.Th>Пользователь</Table.Th><Table.Th>Действие</Table.Th><Table.Th>Источник</Table.Th><Table.Th>Результат</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{audits.map(row=><Table.Tr key={row.id}><Table.Td>{dateText(row.created_at)}</Table.Td><Table.Td>{row.username||row.user_id}</Table.Td><Table.Td>{actionTitles[row.action]??row.action}{row.minutes>0&&<Text size="xs" c="dimmed">На {row.minutes} мин.</Text>}</Table.Td><Table.Td>{sourceTitles[row.source]??row.source}</Table.Td><Table.Td><Badge variant="light" color={row.success?'teal':'red'}>{row.success?'Выполнено':'Ошибка'}</Badge>{row.message&&<Text size="xs" mt={4}>{row.message}</Text>}</Table.Td></Table.Tr>)}{!audits.length&&<Table.Tr><Table.Td colSpan={5}><Text c="dimmed" ta="center" py="xl">Действий пока нет</Text></Table.Td></Table.Tr>}</Table.Tbody></Table></Table.ScrollContainer></Card></Tabs.Panel>
  <Tabs.Panel value="ignored"><Stack gap="md"><Group justify="space-between"><div><Title order={4}>Исключения пользователей</Title><Text size="sm" c="dimmed">Общий список для панели и Telegram</Text></div><Button h={44} variant="default" onClick={()=>void refreshIgnored()}>Обновить список</Button></Group>{ignoredError&&<Alert color="red">{ignoredError}</Alert>}{ignored.map(user=><Card key={user.uuid} withBorder radius="md"><Group justify="space-between"><div><Text fw={600}>{user.username}</Text><Text size="sm" c="dimmed">{user.permanentIgnore?'Без ограничения срока':'До '+dateText(user.ignoredUntil)}</Text></div><Button h={44} variant="light" disabled={!status.ready} onClick={()=>openAction(user.uuid,user.username,'unignore')}>Убрать из исключений</Button></Group></Card>)}{!ignored.length&&!ignoredError&&<Card withBorder p="xl"><Text ta="center" c="dimmed">Пользователей в исключениях нет</Text></Card>}</Stack></Tabs.Panel>
  </Tabs>
  <Modal opened={draft!==null} onClose={()=>{if(!acting)setDraft(null)}} title={draft?actionTitles[draft.action]:''} centered closeOnClickOutside={!acting} closeOnEscape={!acting} withCloseButton={!acting}>
   {draft&&<Stack gap="md"><Text>Пользователь: <Text span fw={700}>{draft.username}</Text></Text>
    <Text size="sm" c="dimmed">{draft.action==='disable'?'Подписка останется отключённой, пока вы не включите её вручную.':draft.action==='disable_temp'?'Подписка будет отключена и включится автоматически после указанного срока.':draft.action==='drop'?'Активные подключения пользователя на всех доступных нодах будут сброшены. Пользователь сможет подключиться снова.':draft.action==='ignore_temp'?'Проверки этого пользователя будут пропущены до окончания срока.':draft.action==='ignore'?'Проверки будут пропускаться до удаления пользователя из исключений.':draft.action==='unignore'?'Пользователь снова будет участвовать в проверках Limiter.':'Подписка будет включена; срок временной блокировки будет отменён.'}</Text>
    {['disable_temp','ignore_temp'].includes(draft.action)&&<><Select label="Срок" value={duration} allowDeselect={false} onChange={v=>{setDuration(v??'1440');if(v!=='custom')setDraft({...draft,minutes:Number(v),requestId:crypto.randomUUID()})}} data={[{value:'15',label:'15 минут'},{value:'60',label:'1 час'},{value:'360',label:'6 часов'},{value:'1440',label:'1 день'},{value:'10080',label:'7 дней'},{value:'custom',label:'Другой срок'}]}/>{duration==='custom'&&<NumberInput label="Количество минут" min={1} max={525600} allowDecimal={false} value={draft.minutes} onChange={v=>setDraft({...draft,minutes:Number(v),requestId:crypto.randomUUID()})}/>}</>}
    {actionError&&<Alert color="red">{actionError}</Alert>}<Divider/><Group justify="end"><Button h={44} variant="default" disabled={acting} onClick={()=>setDraft(null)}>Отмена</Button><Button h={44} color={draft.action.startsWith('disable')?'red':'blue'} loading={acting} disabled={['disable_temp','ignore_temp'].includes(draft.action)&&(!Number.isInteger(draft.minutes)||draft.minutes<1)} onClick={()=>void confirmAction()}>{draft.action==='disable'?'Отключить навсегда':draft.action==='disable_temp'?'Отключить':draft.action==='drop'?'Сбросить подключения':'Подтвердить'}</Button></Group>
   </Stack>}
  </Modal>
 </Stack></Page>
}
