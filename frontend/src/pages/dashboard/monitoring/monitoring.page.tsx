import { Alert, Badge, Button, Card, Checkbox, Divider, Group, NumberInput, Select, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { TbActivityHeartbeat, TbSettings } from 'react-icons/tb'
import { instance } from '@shared/api/axios'
import { nodeOptionLabel, type NodeOptionData } from '@shared/utils/misc/node-option-label'
import { Page } from '@shared/ui'
import { NodeHistory, formatMonitoringTime } from '@widgets/dashboard/nodes/nodes-metrics/node-history'

type Rule={enabled:boolean;onlineDropPercent:number|null;trafficDropPercent:number|null;cpuPercent:number|null;memoryPercent:number|null;baselineMinutes:number;consecutiveSamples:number;minOnline:number;minTraffic:number}
const defaults:Rule={enabled:false,onlineDropPercent:30,trafficDropPercent:50,cpuPercent:90,memoryPercent:90,baselineMinutes:10,consecutiveSamples:2,minOnline:5,minTraffic:1024}
function Heading({settings=false}:{settings?:boolean}){
    return <Group justify="space-between" align="center" mb="lg" wrap="wrap">
        <Group gap="sm"><TbActivityHeartbeat size={30} color="var(--mantine-primary-color-filled)"/><div>
            <Title order={2}>{settings?'Настройки мониторинга':'Мониторинг нод'}</Title>
            <Text c="dimmed" size="sm">{settings?'Пороги, наследование правил и подтверждение событий':'Онлайн, нагрузка, каналы и журнал событий нод'}</Text>
        </div></Group>
        {settings
            ? <Button component={Link} to="/dashboard/management/monitoring" variant="light" leftSection={<TbActivityHeartbeat size={18}/>}>К просмотру</Button>
            : <Button component={Link} to="/dashboard/management/monitoring/settings" variant="light" leftSection={<TbSettings size={18}/>}>Настройки</Button>}
    </Group>
}
export function MonitoringPage(){
    const [timeZone,setTimeZone]=useState(()=>localStorage.getItem('remnadrop-monitoring-timezone')||Intl.DateTimeFormat().resolvedOptions().timeZone)
    const [alerts,setAlerts]=useState<{id:string;name:string;metric:string;active:boolean;value:number;threshold:number;created_at:string}[]>([])
    const [error,setError]=useState('')
    useEffect(()=>{let active=true;const load=()=>void instance.get('/api/monitoring/alerts').then(r=>{if(active){setAlerts(r.data.response);setError('')}}).catch(()=>{if(active)setError('Не удалось загрузить события детектора')});load();const timer=setInterval(load,60000);return()=>{active=false;clearInterval(timer)}},[])
    return <Page title="Мониторинг"><Heading/><NodeHistory timeZone={timeZone} onTimeZoneChange={zone=>{setTimeZone(zone);localStorage.setItem('remnadrop-monitoring-timezone',zone)}}/>
        <Card withBorder radius="md" p="lg"><Group justify="space-between" mb="md"><Title order={4}>События и восстановления</Title><Badge variant="light">Последние 100</Badge></Group>{error&&<Alert color="red">{error}</Alert>}
        {!alerts.length?<Text>Событий пока нет</Text>:<Table.ScrollContainer minWidth={600}><Table><Table.Thead><Table.Tr>{['Время','Нода','Показатель','Состояние','Значение / порог'].map(x=><Table.Th key={x}>{x}</Table.Th>)}</Table.Tr></Table.Thead><Table.Tbody>{alerts.map(a=><Table.Tr key={a.id}><Table.Td>{formatMonitoringTime(a.created_at,timeZone)}</Table.Td><Table.Td>{a.name}</Table.Td><Table.Td>{({online_drop:'Падение онлайна, %',traffic_drop:'Падение трафика, %',cpu:'Нагрузка CPU, % от ядер',memory:'ОЗУ занято, %'} as Record<string,string>)[a.metric]??a.metric}</Table.Td><Table.Td>{a.active?'Порог превышен':'Восстановление'}</Table.Td><Table.Td>{a.value.toLocaleString('ru-RU',{maximumFractionDigits:2})} / {a.threshold.toLocaleString('ru-RU',{maximumFractionDigits:2})}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>}</Card>
    </Page>
}
export function MonitoringSettingsPage(){
    const [nodes,setNodes]=useState<{value:string;label:string}[]>([]),[scope,setScope]=useState<string|null>('global')
    const [rules,setRules]=useState<{scope:string;settings:Rule}[]>([]),[rule,setRule]=useState<Rule>(defaults)
    const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
    const [retention,setRetention]=useState<number|string>(90),[retentionBusy,setRetentionBusy]=useState(false)
    const load=async()=>{const [r,n,settings]=await Promise.all([instance.get('/api/monitoring/settings'),instance.get('/api/nodes'),instance.get('/api/monitoring/retention')]);setRules(r.data.response.rules);setNodes(n.data.response.map((x:NodeOptionData)=>({value:x.uuid,label:nodeOptionLabel(x)})));setRetention(settings.data.response.days)}
    useEffect(()=>{void load().catch(()=>setError('Не удалось загрузить настройки'))},[])
    useEffect(()=>{setRule(rules.find(r=>r.scope===scope)?.settings??rules.find(r=>r.scope==='global')?.settings??defaults);setMessage('')},[scope,rules])
    const act=async(reset=false)=>{setBusy(true);setError('');try{if(reset)await instance.delete(`/api/monitoring/settings/${scope}`);else await instance.put(`/api/monitoring/settings/${scope}`,rule);await load();setMessage(reset?'Восстановлено наследование общих настроек':'Настройки сохранены')}catch{setError('Не удалось сохранить настройки. Проверьте диапазоны значений.')}finally{setBusy(false)}}
    const saveRetention=async()=>{setRetentionBusy(true);setError('');try{const result=await instance.put('/api/monitoring/retention',{days:Number(retention)});setRetention(result.data.response.days);setMessage('Срок хранения сохранён. Устаревшие данные удалятся при очередном сборе.')}catch{setError('Не удалось сохранить срок хранения (1–365 дней)')}finally{setRetentionBusy(false)}}
    const fields:[keyof Omit<Rule,'enabled'>,string,number,number,boolean][]=[['onlineDropPercent','Падение онлайна, %',1,100,true],['trafficDropPercent','Падение входящего + исходящего трафика, %',1,100,true],['cpuPercent','CPU выше, %',1,100,true],['memoryPercent','ОЗУ выше, %',1,100,true],['baselineMinutes','Сравнивать со средним за предыдущие минуты',3,60,false],['consecutiveSamples','Подтверждение: последовательных минут',1,10,false],['minOnline','Минимальный исходный онлайн',1,10000000,false],['minTraffic','Минимальный исходный трафик, байт/с',1,1000000000000,false]]
    return <Page title="Настройки мониторинга"><Heading settings/><Card withBorder radius="md" p="lg"><Stack gap="md"><Title order={4}>Детектор падений</Title><Text size="sm" c="dimmed">Настройки наследуются всеми нодами. Для отдельной ноды можно сохранить переопределение.</Text><Divider/>
        <Select label="Область настройки" data={[{value:'global',label:'Все ноды — общие настройки'},...nodes]} value={scope} onChange={setScope} searchable allowDeselect={false}/>
        {scope!=='global'&&!rules.some(r=>r.scope===scope)&&<Text c="dimmed">Нода наследует общие настройки. Сохранение создаст индивидуальное правило.</Text>}
        <Checkbox label="Включить детектор" checked={rule.enabled} onChange={e=>setRule({...rule,enabled:e.currentTarget.checked})}/>
        <Text size="sm">Пустой порог отключает соответствующий детект. Падения сравниваются со средним значением выбранного окна; нужны минимум 3 предыдущих замера. Нагрузка CPU без агента оценивается по средней очереди задач относительно числа ядер; точный процент даёт агент. Пропуски данных не считаются нулём.</Text>
        <SimpleGrid cols={{base:1,sm:2}}>{fields.map(([key,label,min,max,nullable])=><NumberInput key={key} label={label} min={min} max={max} allowDecimal={false} value={rule[key]??''} onChange={value=>setRule({...rule,[key]:value===''&&nullable?null:Number(value)})}/>)}</SimpleGrid>
        {error&&<Alert color="red">{error}</Alert>}{message&&<Alert color="green">{message}</Alert>}
        <Group><Button loading={busy} onClick={()=>void act()}>Сохранить</Button>{scope!=='global'&&<Button variant="light" disabled={busy} onClick={()=>void act(true)}>Использовать общие настройки</Button>}</Group>
    </Stack></Card>
    <Card withBorder radius="md" p="lg" mt="lg"><Stack gap="md"><Title order={4}>Хранение истории мониторинга</Title><Text size="sm" c="dimmed">Общая настройка для всех нод: графики, журнал событий и восстановления. Удаление выполняется сборщиком метрик. Минимум 1 день, максимум 365 дней.</Text><NumberInput label="Хранить историю (дней)" min={1} max={365} allowDecimal={false} value={retention} onChange={setRetention} w={220}/><Group><Button loading={retentionBusy} disabled={!Number.isInteger(Number(retention))||Number(retention)<1||Number(retention)>365} onClick={()=>void saveRetention()}>Сохранить срок хранения</Button></Group></Stack></Card>
    </Page>
}
