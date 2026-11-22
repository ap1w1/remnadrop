import { Alert, Badge, Button, Card, Divider, Group, Modal, MultiSelect, NumberInput, PasswordInput, Select, SimpleGrid, Skeleton, Stack, Switch, Tabs, Text, TextInput, Title } from '@mantine/core'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { TbArrowLeft, TbSettings } from 'react-icons/tb'
import { instance } from '@shared/api/axios'
import { Page } from '@shared/ui'
import { nodeOptionLabel, type NodeOptionData } from '@shared/utils/misc/node-option-label'
import { defaultConfig, errMessage, limiterApi as api, limiterPath, type Credentials, type Settings } from './types'

export function LimiterSettingsPage(){
 const [settings,setSettings]=useState<Settings>(defaultConfig),[saved,setSaved]=useState<Settings>(defaultConfig),[nodes,setNodes]=useState<NodeOptionData[]>([])
 const [credentials,setCredentials]=useState<Credentials>({configured:false,telegramConfigured:false,maxmindConfigured:false,telegramChatId:'',telegramAdminIds:'',sharedHwidSquadUuids:[]})
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[credentialsBusy,setCredentialsBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [confirm,setConfirm]=useState<'auto'|'remove'|'defaults'|null>(null)
 const [runtimeItems,setRuntimeItems]=useState<Array<{Key:string;Title:string;Display:string;Overridden:boolean}>>([]),[resetKey,setResetKey]=useState<string|null>(null),[resetBusy,setResetBusy]=useState(false)
 const [telegramToken,setTelegramToken]=useState(''),[telegramChat,setTelegramChat]=useState(''),[telegramAdmins,setTelegramAdmins]=useState('')
 const [maxmindKey,setMaxmindKey]=useState(''),[hwidSquads,setHwidSquads]=useState(''),[ipText,setIpText]=useState('')
 const apply=(config:Settings)=>{setSettings(config);setSaved(config);setIpText(config.ignoredIps.join(', '))}
 const applyCredentials=(value:Credentials)=>{setCredentials(value);setTelegramChat(value.telegramChatId);setTelegramAdmins(value.telegramAdminIds);setHwidSquads(value.sharedHwidSquadUuids.join(', '));setTelegramToken('');setMaxmindKey('')}
 useEffect(()=>{void Promise.all([instance.get(api+'/settings'),instance.get(api+'/credentials'),instance.get('/api/nodes')]).then(([a,b,c])=>{apply(a.data.response);applyCredentials(b.data.response);setNodes(c.data.response)}).catch(e=>setError(errMessage(e))).finally(()=>setLoading(false))},[])
 useEffect(()=>{void instance.get(api+'/settings/runtime').then(result=>setRuntimeItems(result.data.response)).catch(()=>{})},[])
 const change=<K extends keyof Settings>(key:K,value:Settings[K])=>setSettings(config=>({...config,[key]:value}))
 const dirty=JSON.stringify(settings)!==JSON.stringify(saved)||ipText!==saved.ignoredIps.join(', ')
 const save=async(confirmed=false)=>{
  if(!confirmed&&settings.enabled&&settings.mode==='auto'&&(!saved.enabled||saved.mode!=='auto')){setConfirm('auto');return}
  setBusy(true);setError('')
  try{const {lastScanAt,lastError,engineVersion,...config}=settings;const result=await instance.put(api+'/settings',{...config,ignoredIps:ipText.split(/[,\s]+/).filter(Boolean)});apply(result.data.response);setConfirm(null);setNotice('Настройки сохранены. Проверка применит изменения автоматически.')}
  catch(e){setError(errMessage(e));setConfirm(null)}finally{setBusy(false)}
 }
 const saveCredentials=async()=>{
  setCredentialsBusy(true);setError('')
  try{const result=await instance.put(api+'/credentials',{telegramBotToken:telegramToken,telegramChatId:telegramChat,telegramAdminIds:telegramAdmins,maxmindLicenseKey:maxmindKey,sharedHwidSquadUuids:hwidSquads.split(/[,\s]+/).filter(Boolean)});applyCredentials(result.data.response);setNotice('Настройки уведомлений и анализа устройств сохранены.')}
  catch(e){setError(errMessage(e))}finally{setCredentialsBusy(false)}
 }
 const removeCredentials=async()=>{setCredentialsBusy(true);setError('');try{const result=await instance.delete(api+'/credentials');applyCredentials(result.data.response);setConfirm(null);setNotice('Telegram и MaxMind отключены. История событий сохранена.')}catch(e){setError(errMessage(e))}finally{setCredentialsBusy(false)}}
 const resetSetting=async()=>{if(!resetKey)return;setResetBusy(true);setError('');try{const result=await instance.post(api+'/settings/reset',{key:resetKey});apply(result.data.response.settings);setRuntimeItems(result.data.response.items);setNotice('Выбранная настройка сброшена к значению по умолчанию в панели и Telegram.')}catch(e){setError(errMessage(e))}finally{setResetBusy(false)}}
 const number=(key:keyof Settings,label:string,min:number,max:number,description?:string,decimal=false)=><NumberInput label={label} description={description} min={min} max={max} allowDecimal={decimal} value={settings[key] as number} onChange={value=>change(key,Number(value) as never)}/>
 const toggle=(key:keyof Settings,label:string,description?:string)=><Switch label={label} description={description} checked={settings[key] as boolean} onChange={e=>change(key,e.currentTarget.checked as never)} styles={{body:{minHeight:44,alignItems:'center'},label:{cursor:'pointer'}}/>
 return <Page title="Настройки Limiter"><Stack gap="lg">
  <Group justify="space-between" align="flex-start"><Group gap="sm"><TbSettings size={28}/><div><Title order={2}>Настройки Limiter</Title><Text size="sm" c="dimmed">Правила проверки, исключения и уведомления</Text></div></Group><Button h={44} component={Link} to={limiterPath} variant="light" leftSection={<TbArrowLeft size={18}/>}>К событиям</Button></Group>
  {error&&<Alert color="red" title="Не удалось сохранить" withCloseButton onClose={()=>setError('')}>{error}</Alert>}{notice&&<Alert color="teal" withCloseButton onClose={()=>setNotice('')}>{notice}</Alert>}
  {loading?<Skeleton h={400} radius="md"/>:<>
   <Card withBorder radius="md" p="lg"><Group justify="space-between" align="center"><div><Text fw={600}>Проверка пользователей</Text><Text size="sm" c="dimmed">События появятся на основной странице Limiter.</Text></div><Switch checked={settings.enabled} label={settings.enabled?'Включена':'Выключена'} onChange={e=>change('enabled',e.currentTarget.checked)} styles={{body:{minHeight:44,alignItems:'center'}}}/></Group></Card>
   <Tabs defaultValue="rules"><Tabs.List mb="md"><Tabs.Tab value="rules" mih={44}>Лимиты</Tabs.Tab><Tabs.Tab value="traffic" mih={44}>Трафик и HWID</Tabs.Tab><Tabs.Tab value="exceptions" mih={44}>Исключения</Tabs.Tab><Tabs.Tab value="notifications" mih={44}>Уведомления</Tabs.Tab></Tabs.List>
    <Tabs.Panel value="rules"><Stack gap="md"><Card withBorder radius="md" p="lg"><Stack gap="md"><Title order={4}>Реакция на нарушение</Title>
     <SimpleGrid cols={{base:1,sm:2}}><Select label="Режим" allowDeselect={false} value={settings.mode} onChange={v=>change('mode',v==='auto'?'auto':'manual')} data={[{value:'manual',label:'Ручной — действие выбирает администратор'},{value:'auto',label:'Автоматический — отключать по правилам'}]}/>
      {number('defaultDeviceLimit','Лимит устройств по умолчанию',0,2147483647,'0 — не ограничивать, если у пользователя не указан лимит.')}
      {number('autoRestoreMinutes','Срок автоматической блокировки, минут',0,525600,'0 — до ручного включения подписки.')}
      {number('ignoreDurationMinutes','Срок игнорирования по умолчанию, минут',0,525600,'Для кнопок Telegram и быстрого выбора срока. 0 — постоянное исключение.')}
     </SimpleGrid>
     {settings.mode==='auto'&&<Alert color="orange">После достижения порога повторений Limiter отключает подписку. Временная блокировка заканчивается автоматически, пока проверка включена.</Alert>}
     {toggle('softWarnings','Показывать мягкие предупреждения','События о превышении лимита в пределах допуска, без блокировки.')}
    </Stack></Card>
    <Card withBorder radius="md" p="lg"><Stack gap="md"><Title order={4}>Подсчёт устройств</Title><SimpleGrid cols={{base:1,sm:2,lg:3}}>
     {number('checkIntervalSeconds','Интервал проверки, секунд',1,31536000)}{number('activeWindowSeconds','Окно активности IP, секунд',1,31536000)}{number('userCacheTtlSeconds','Обновлять данные пользователя, секунд',1,31536000)}
     {number('tolerance','Допустимое превышение, устройств',0,2147483647)}{number('toleranceMultiplier','Допуск относительно лимита',0,100,'Множитель. 0 — использовать только фиксированный допуск.',true)}
    </SimpleGrid><Divider/><SimpleGrid cols={{base:1,sm:2}}>{toggle('subnetGrouping','Объединять IP одной подсети')}{toggle('asnGrouping','Объединять IP одного провайдера','Для определения провайдера настройте ключ MaxMind.')}</SimpleGrid>
    {settings.subnetGrouping&&number('subnetPrefixV4','Префикс подсети IPv4',8,32,'Например, /24 объединяет адреса одной сети.')}
    </Stack></Card>
    <Card withBorder radius="md" p="lg"><Stack gap="md"><Title order={4}>Повторные нарушения</Title><SimpleGrid cols={{base:1,sm:3}}>{number('violationThreshold','Повторений до действия',1,2147483647)}{number('thresholdWindowSeconds','Окно подсчёта, секунд',1,31536000)}{number('cooldownSeconds','Пауза между нарушениями, секунд',1,31536000)}</SimpleGrid><Text size="xs" c="dimmed">Окно подсчёта должно вмещать нужное число повторений с учётом паузы и интервала проверки.</Text></Stack></Card>
    </Stack></Tabs.Panel>
    <Tabs.Panel value="traffic"><Stack gap="md"><Card withBorder radius="md" p="lg"><Stack gap="md"><Title order={4}>Аномальный трафик</Title>{toggle('trafficMonitor','Выявлять всплески и высокий расход трафика')}
     <SimpleGrid cols={{base:1,sm:2}}>{number('trafficSpikeFactor','Всплеск относительно обычного объёма',1.5,100,'Во сколько раз расход должен превысить норму.',true)}{number('trafficSpikeMinGb','Минимальный объём всплеска, ГиБ',1,1000000)}{number('trafficHeavyGb','Высокий расход за сутки, ГиБ',0,1000000)}{number('trafficHeavyDays','Дней выше порога за неделю',1,7)}</SimpleGrid>
     <MultiSelect label="Исключить ноды из анализа трафика" searchable clearable value={settings.trafficIgnoredNodes} onChange={v=>change('trafficIgnoredNodes',v)} data={nodes.map(n=>({value:n.uuid,label:nodeOptionLabel(n)}))}/>
    </Stack></Card>
    <Card withBorder radius="md" p="lg"><Stack gap="md"><Title order={4}>Общие устройства и повторные триалы</Title>{toggle('sharedHwidMonitor','Выявлять один HWID у разных аккаунтов')}{number('sharedHwidHistoryDays','История совпадений, дней',0,365,'0 — учитывать только текущие устройства.')}
     <TextInput label="Проверять только эти сквады" description="UUID через запятую. Пусто — проверять всех пользователей." value={hwidSquads} onChange={e=>setHwidSquads(e.currentTarget.value)}/>
     <Group justify="end"><Button h={44} variant="light" loading={credentialsBusy} onClick={()=>void saveCredentials()}>Сохранить сквады</Button></Group>
    </Stack></Card></Stack></Tabs.Panel>
    <Tabs.Panel value="exceptions"><Card withBorder radius="md" p="lg"><Stack gap="md"><Title order={4}>Исключения из проверки лимитов</Title>
     <MultiSelect label="Ноды" searchable clearable value={settings.ignoredNodes} onChange={v=>change('ignoredNodes',v)} data={nodes.map(n=>({value:n.uuid,label:nodeOptionLabel(n)}))}/>
     <TextInput label="IP-адреса и подсети" description="IPv4, IPv6 или CIDR через запятую. Например: 192.0.2.10, 2001:db8::/32" value={ipText} onChange={e=>setIpText(e.currentTarget.value)}/>
     <Divider/><Text size="sm">Исключения пользователей добавляются из события. На вкладке «Исключения» видно, когда закончится срок игнорирования.</Text><Group><Button h={44} component={Link} to={limiterPath} variant="light">Перейти к событиям</Button></Group>
    </Stack></Card></Tabs.Panel>
    <Tabs.Panel value="notifications"><Stack gap="md"><Card withBorder radius="md" p="lg"><Stack gap="md"><Title order={4}>Отчёты и журнал</Title>{toggle('dailyReport','Сохранять ежедневный отчёт')}{toggle('updateCheck','Проверять новые версии Limiter')}<Select label="Подробность журнала" allowDeselect={false} value={settings.logLevel} onChange={v=>change('logLevel',v??'info')} data={[{value:'error',label:'Только ошибки'},{value:'warn',label:'Предупреждения'},{value:'info',label:'Обычная'},{value:'debug',label:'Подробная'},{value:'trace',label:'Максимальная'}]}/></Stack></Card>
     <Card withBorder radius="md" p="lg"><Stack gap="md"><Group justify="space-between"><Title order={4}>Telegram</Title><Badge variant="light" color={credentials.telegramConfigured?'teal':'gray'}>{credentials.telegramConfigured?'Подключён':'Не подключён'}</Badge></Group><Text size="sm" c="dimmed">Необязательно. Получайте события и управляйте пользователями также из бота.</Text>
      <PasswordInput label="Токен бота" autoComplete="new-password" placeholder={credentials.telegramConfigured?'Сохранён · оставьте пустым, чтобы не менять':'Токен от BotFather'} value={telegramToken} onChange={e=>setTelegramToken(e.currentTarget.value)}/>
      <SimpleGrid cols={{base:1,sm:2}}><TextInput label="Chat ID" value={telegramChat} onChange={e=>setTelegramChat(e.currentTarget.value)} placeholder="-1001234567890"/><TextInput label="ID администраторов" description="Telegram ID через запятую" value={telegramAdmins} onChange={e=>setTelegramAdmins(e.currentTarget.value)}/></SimpleGrid>
      <Divider/><Group justify="space-between"><Title order={5}>Определение провайдера</Title><Badge variant="light" color={credentials.maxmindConfigured?'teal':'gray'}>{credentials.maxmindConfigured?'Настроено':'Не настроено'}</Badge></Group><PasswordInput label="Лицензионный ключ MaxMind" autoComplete="new-password" description="Нужен для группировки по ASN и названий провайдеров." placeholder={credentials.maxmindConfigured?'Сохранён · оставьте пустым, чтобы не менять':'Необязательно'} value={maxmindKey} onChange={e=>setMaxmindKey(e.currentTarget.value)}/>
      <Group justify="space-between">{credentials.configured?<Button h={44} color="red" variant="subtle" onClick={()=>setConfirm('remove')}>Отключить Telegram и MaxMind</Button>:<span/>}<Button h={44} loading={credentialsBusy} onClick={()=>void saveCredentials()}>Сохранить подключения</Button></Group>
     </Stack></Card>
    </Stack></Tabs.Panel>
   </Tabs>
   <Card withBorder radius="md" p="lg"><details><summary style={{minHeight:44,cursor:'pointer',fontWeight:600}}>Сброс отдельной настройки</summary><Stack gap="sm" mt="sm"><Text size="sm" c="dimmed">Возвращает выбранное значение по умолчанию сразу. Остальные настройки сохраняются.</Text>{runtimeItems.length?<><Select label="Настройка" searchable value={resetKey} onChange={setResetKey} data={runtimeItems.map(item=>({value:item.Key,label:item.Title+' · '+item.Display}))}/><Group><Button h={44} variant="light" loading={resetBusy} disabled={!resetKey||dirty||!runtimeItems.find(item=>item.Key===resetKey)?.Overridden} onClick={()=>void resetSetting()}>Сбросить это значение</Button>{dirty&&<Text size="xs" c="dimmed">Сначала сохраните или отмените изменения формы.</Text>}</Group></>:<Text size="sm" c="dimmed">Включите Limiter, чтобы сбрасывать отдельные настройки.</Text>}</Stack></details></Card>
   <Card withBorder radius="md" p="md"><Group justify="space-between" wrap="wrap"><Group gap="xs"><Badge color={dirty?'yellow':'gray'} variant="light">{dirty?'Есть изменения':'Сохранено'}</Badge><Button h={44} variant="subtle" color="gray" disabled={busy} onClick={()=>setConfirm('defaults')}>Значения по умолчанию</Button></Group><Group gap="xs"><Button h={44} variant="default" disabled={!dirty||busy} onClick={()=>apply(saved)}>Отменить изменения</Button><Button h={44} loading={busy} disabled={!dirty} onClick={()=>void save()}>Сохранить настройки</Button></Group></Group></Card>
  </>}
  <Modal opened={confirm!==null} centered onClose={()=>{if(!busy&&!credentialsBusy)setConfirm(null)}} title={confirm==='auto'?'Включить автоматическое отключение?':confirm==='remove'?'Отключить подключения?':'Восстановить значения по умолчанию?'}>
   <Stack gap="md"><Text size="sm">{confirm==='auto'?'При повторных нарушениях подписки будут отключаться по выбранным правилам. Проверьте срок блокировки и допуски.':confirm==='remove'?'Уведомления в Telegram прекратятся, ключ MaxMind и список сквадов будут удалены. Настройки проверки пользователей сохранятся.':'Значения в форме будут заменены стандартными. Проверка останется в текущем состоянии. Изменения применятся после сохранения.'}</Text><Group justify="end"><Button h={44} variant="default" disabled={busy||credentialsBusy} onClick={()=>setConfirm(null)}>Отмена</Button><Button h={44} color={confirm==='auto'||confirm==='remove'?'red':'blue'} loading={busy||credentialsBusy} onClick={()=>{if(confirm==='auto')void save(true);else if(confirm==='remove')void removeCredentials();else{setSettings({...defaultConfig,enabled:settings.enabled,ignoredUsers:settings.ignoredUsers});setIpText('');setConfirm(null)}}}>{confirm==='auto'?'Включить':confirm==='remove'?'Отключить':'Восстановить'}</Button></Group></Stack>
  </Modal>
 </Stack></Page>
}
