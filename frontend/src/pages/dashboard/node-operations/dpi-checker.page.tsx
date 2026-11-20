import { Alert, Badge, Button, Card, Divider, Group, MultiSelect, NumberFormatter, PasswordInput, Progress, Select, SimpleGrid, Stack, Switch, Table, Text, Title, Tooltip } from '@mantine/core'
import { useCallback, useEffect, useState } from 'react'
import { TbBrandTelegram, TbCheck, TbCoin, TbKey, TbPlayerPlay, TbRefresh, TbShieldSearch } from 'react-icons/tb'
import { instance } from '@shared/api/axios'
import { Page } from '@shared/ui'
import { DpiCheckerLogo } from '@shared/ui/logos/dpi-checker-logo'

type Setting = { configured: boolean; source: string; updatedAt: string|null }
type Host = { uuid: string; remark: string; isDisabled: boolean; isHidden: boolean }
type Job = { id: string; remote_id: number|null; location: string; host_uuids: string[]; status: string; progress_done: number; progress_total: number; estimated_cost: number|null; actual_cost: number|null; error?: string|null; created_at: string; results?: Array<{host?:string;pop_name?:string;connected?:boolean;latency_ms?:number|null;error?:string}> }
type Pop = { id: number; name?: string; city?: string; region?: string; operator?: string }
const regions=[{value:'russia',label:'Россия'},{value:'russia_mobile',label:'Россия — мобильные сети'},{value:'china',label:'Китай'},{value:'iran',label:'Иран'},{value:'turkmenistan',label:'Туркменистан'}]
const nameFor=(value:string)=>regions.find(r=>r.value===value)?.label??value
const statusFor=(value:string)=>({prepared:'Ожидает подтверждения',pending:'В очереди',running:'Выполняется',completed:'Завершена',failed:'Ошибка',cancelled:'Отменена'} as Record<string,string>)[value]??value
function getError(e:unknown){const err=e as {response?:{data?:{message?:string}}};return err.response?.data?.message??'Не удалось выполнить запрос к серверу'}
export function DpiCheckerPage(){
 const [settings,setSettings]=useState<Setting|null>(null),[balance,setBalance]=useState<number|null>(null),[apiKey,setApiKey]=useState('')
 const [hosts,setHosts]=useState<Host[]>([]),[selected,setSelected]=useState<string[]>([]),[location,setLocation]=useState<string|null>('russia'),[optimal,setOptimal]=useState(true)
 const [pops,setPops]=useState<Pop[]>([]),[popIds,setPopIds]=useState<string[]>([]),[jobs,setJobs]=useState<Job[]>([]),[details,setDetails]=useState<Job|null>(null)
 const [busy,setBusy]=useState(false),[keyBusy,setKeyBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const refresh=useCallback(async()=>{
   const [configuration,history]=await Promise.all([instance.get('/api/dpi-checker/settings'),instance.get('/api/dpi-checker/checks')])
   setSettings(configuration.data.response as Setting);setJobs(history.data.response as Job[])
   if(configuration.data.response.configured){try{const account=await instance.get('/api/dpi-checker/profile');setBalance(account.data.response.balance==null?null:Number(account.data.response.balance))}catch{setBalance(null)}}else setBalance(null)
 },[])
 useEffect(()=>{let mounted=true;void Promise.all([refresh(),instance.get('/api/hosts')]).then(([,r])=>{if(mounted)setHosts(r.data.response)}).catch(e=>{if(mounted)setError(getError(e))});return()=>{mounted=false}},[refresh])
 useEffect(()=>{const timer=window.setInterval(()=>void refresh().catch(()=>{}),15000);return()=>window.clearInterval(timer)},[refresh])
 useEffect(()=>{if(optimal||!location)return;let active=true;void instance.get('/api/dpi-checker/pops',{params:{location}}).then(r=>{if(active){const data=r.data.response;setPops(Array.isArray(data)?data:Array.isArray(data?.pops)?data.pops:[]);setPopIds([])}}).catch(e=>{if(active)setError(getError(e))});return()=>{active=false}},[location,optimal])
 const saveKey=async()=>{setKeyBusy(true);setError('');try{await instance.put('/api/dpi-checker/settings',{apiKey});setApiKey('');await refresh();setNotice('API-ключ успешно проверен и сохранён на сервере.')}catch(e){setError(getError(e))}finally{setKeyBusy(false)}}
 const runCheck=async()=>{
   if(!selected.length||!location||busy)return
   setBusy(true);setError('')
   let preparedId:string|null=null
   try{
     const prepared=await instance.post('/api/dpi-checker/checks/prepare',{hosts:selected,location,...(!optimal?{pop_ids:popIds.map(Number)}:{})})
     preparedId=prepared.data.response.id as string
     if(prepared.data.response.estimate?.affordable===false)throw new Error('Недостаточно средств на балансе DPI Checker')
     await instance.post('/api/dpi-checker/checks/'+preparedId+'/start')
     setNotice('Проверка запущена. Результаты и стоимость появятся в истории.')
     await refresh()
   }catch(e){
     if(preparedId){try{await instance.delete('/api/dpi-checker/checks/'+preparedId)}catch{/* Queued jobs are cleared by the scheduler. */}}
     setError(e instanceof Error&&e.message.startsWith('Недостаточно')?e.message:getError(e))
   }finally{setBusy(false)}
 }
 const openDetails=async(id:string)=>{setError('');try{const res=await instance.get(`/api/dpi-checker/checks/${id}`);setDetails(res.data.response)}catch(e){setError(getError(e))}}
 const cancel=async(id:string)=>{try{await instance.delete(`/api/dpi-checker/checks/${id}`);;await refresh()}catch(e){setError(getError(e))}}
 const pct=(j:Job)=>j.progress_total>0?Math.min(100,Math.round(100*j.progress_done/j.progress_total)):(j.status==='completed'?100:0)
 return <Page title="DPI Checker"><Stack gap="lg">
    <Group justify="space-between" align="center"><Group gap="sm"><DpiCheckerLogo width={34} height={34} style={{color:'var(--mantine-color-cyan-5)'}}/><div><Title order={2}>DPI Checker</Title><Text size="sm" c="dimmed">Проверка доступности VLESS-хостов из выбранных регионов</Text></div></Group><Group gap="xs"><Button component="a" href="https://t.me/dpi_checker_robot?start=p453722" target="_blank" rel="noopener noreferrer" variant="light" leftSection={<TbBrandTelegram size={17}/>}>Перейти в бот</Button><Button variant="light" leftSection={<TbRefresh size={16}/>} onClick={()=>void refresh().catch(e=>setError(getError(e)))}>Обновить</Button></Group></Group>
    {error&&<Alert color="red" title="Ошибка" withCloseButton onClose={()=>setError('')}>{error}</Alert>}
    {notice&&<Alert color="teal" title="Готово" withCloseButton onClose={()=>setNotice('')}>{notice}</Alert>}
    <SimpleGrid cols={{base:1,md:2}} spacing="md">
      <Card withBorder radius="md" padding="lg"><Stack gap="md"><Group justify="space-between"><Group gap="xs"><TbKey size={20}/><Text fw={600}>Подключение к API</Text></Group><Badge color={settings?.configured?'teal':'gray'} variant="light">{settings?.configured?'Подключено':'Не настроено'}</Badge></Group>
        <PasswordInput label="API-ключ DPI Checker" placeholder={settings?.configured?'Введите новый ключ для замены':'Введите X-API-Key'} value={apiKey} onChange={e=>setApiKey(e.currentTarget.value)} description="Ключ хранится в зашифрованном виде на сервере и никогда не возвращается в браузер." autoComplete="off"/>
        <Group justify="space-between"><Text c="dimmed" size="xs">{settings?.source==='stored'?'Источник: настройки панели':settings?.source==='environment'?'Источник: переменная окружения':'Нет сохранённого ключа'}</Text><Button size="sm" loading={keyBusy} disabled={!apiKey.trim()} onClick={()=>void saveKey()} leftSection={<TbCheck size={15}/>}>Проверить и сохранить</Button></Group>
      </Stack></Card>
      <Card withBorder radius="md" padding="lg"><Stack gap="md"><Group gap="xs"><TbCoin size={20}/><Text fw={600}>Баланс DPI Checker</Text></Group><Title order={1} c={balance===null?'dimmed':undefined}>
        {balance===null?'—':<NumberFormatter value={balance} decimalScale={2} fixedDecimalScale thousandSeparator=" " prefix="$"/>}
      </Title><Text c="dimmed" size="sm">{balance===null?'Не удалось получить баланс. Проверьте ключ и подключение.':'Актуальный баланс аккаунта по данным API /profile'}</Text><Text size="xs" c="dimmed">Проверки платные. Стоимость рассчитывается автоматически при запуске.</Text></Stack></Card>
    </SimpleGrid>
    <Card withBorder radius="md" padding="lg"><Stack gap="md"><Group gap="xs"><TbShieldSearch size={20}/><Title order={4}>Новая проверка</Title></Group>
      <MultiSelect searchable clearable label="Хосты для проверки" description="Будет создана временная учётная запись с VLESS-ключами выбранных хостов." placeholder="Выберите хосты" data={hosts.filter(h=>!h.isDisabled&&!h.isHidden).map(h=>({value:h.uuid,label:h.remark}))} value={selected} onChange={value=>{setSelected(value);}} maxValues={20} />
      <SimpleGrid cols={{base:1,sm:2}}><Select label="Регион" data={regions} value={location} onChange={value=>{setLocation(value);}} allowDeselect={false}/><Stack justify="center"><Switch label="Оптимальные точки проверки" description="Если выключить, можно выбрать конкретные PoP." checked={optimal} onChange={e=>{setOptimal(e.currentTarget.checked);}}/></Stack></SimpleGrid>
      {!optimal&&<MultiSelect label="Точки присутствия (PoP)" searchable data={pops.map(p=>({value:String(p.id),label:[p.name??p.city??p.region??`PoP ${p.id}`,p.operator].filter(Boolean).join(' · ')}))} value={popIds} onChange={v=>{setPopIds(v);}} placeholder="Выберите точки" />}
      <Group justify="end"><Button leftSection={<TbPlayerPlay size={17}/>} onClick={()=>void runCheck()} loading={busy} disabled={!settings?.configured||!location||!selected.length||(!optimal&&!popIds.length)}>Запустить проверку</Button></Group>
      <Text size="xs" c="dimmed">Проверка платная: расчёт стоимости выполняется автоматически перед запуском без отдельного подтверждения. Итоговая сумма доступна в истории.</Text>
    </Stack></Card>}
    </Stack></Card>
    <Card withBorder radius="md" padding="lg"><Group justify="space-between" mb="md"><Title order={4}>Последние проверки</Title><Text size="sm" c="dimmed">Автообновление каждые 15 секунд</Text></Group><Table.ScrollContainer minWidth={700}><Table highlightOnHover verticalSpacing="sm"><Table.Thead><Table.Tr><Table.Th>Дата</Table.Th><Table.Th>Регион</Table.Th><Table.Th>Хосты</Table.Th><Table.Th>Статус / прогресс</Table.Th><Table.Th>Стоимость</Table.Th><Table.Th>Результаты</Table.Th></Table.Tr></Table.Thead><Table.Tbody>
    {jobs.map(j=><Table.Tr key={j.id}><Table.Td><Text size="sm">{new Date(j.created_at).toLocaleString('ru-RU')}</Text></Table.Td><Table.Td>{nameFor(j.location)}</Table.Td><Table.Td>{j.host_uuids.length}</Table.Td><Table.Td><Stack gap={5}><Badge color={j.status==='completed'?'teal':j.status==='failed'?'red':'blue'} variant="light">{statusFor(j.status)}</Badge><Progress value={pct(j)} color={j.status==='failed'?'red':'cyan'} size="sm"/><Text c="dimmed" size="xs">{j.progress_done} / {j.progress_total}</Text></Stack></Table.Td><Table.Td>${Number(j.actual_cost??j.estimated_cost??0).toFixed(2)}</Table.Td><Table.Td><Group gap="xs"><Button variant="subtle" size="compact-sm" onClick={()=>void openDetails(j.id)}>Подробнее</Button>{['prepared','pending'].includes(j.status)&&<Button variant="subtle" color="red" size="compact-sm" onClick={()=>void cancel(j.id)}>Отменить</Button>}</Group></Table.Td></Table.Tr>)}
    {!jobs.length&&<Table.Tr><Table.Td colSpan={6}><Text c="dimmed" ta="center" py="lg">Проверок пока нет</Text></Table.Td></Table.Tr>}
    </Table.Tbody></Table></Table.ScrollContainer></Card>
    {details&&<Card withBorder radius="md" padding="lg"><Group justify="space-between"><Title order={4}>Результаты проверки</Title><Button variant="subtle" size="compact-sm" onClick={()=>setDetails(null)}>Закрыть</Button></Group><Divider my="md"/><Text size="sm" c="dimmed" mb="md">ID {details.remote_id??details.id}. Проверки из нескольких точек могут давать разные результаты.</Text>
     {details.error&&<Alert color="red">{details.error}</Alert>}
     <Table.ScrollContainer minWidth={500}><Table><Table.Thead><Table.Tr><Table.Th>Хост</Table.Th><Table.Th>Точка проверки</Table.Th><Table.Th>Доступ</Table.Th><Table.Th>Задержка</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{(details.results??[]).map((r,i)=><Table.Tr key={i}><Table.Td>{r.host??'—'}</Table.Td><Table.Td>{r.pop_name??'—'}</Table.Td><Table.Td><Tooltip label={r.error??''} disabled={!r.error}><Badge color={r.connected?'teal':'red'}>{r.connected?'Доступен':'Нет соединения'}</Badge></Tooltip></Table.Td><Table.Td>{r.latency_ms==null?'—':`${r.latency_ms} мс`}</Table.Td></Table.Tr>)}{!details.results?.length&&<Table.Tr><Table.Td colSpan={4}><Text c="dimmed">Результаты пока не получены</Text></Table.Td></Table.Tr>}</Table.Tbody></Table></Table.ScrollContainer>
    </Card>}
 </Stack></Page>
}
