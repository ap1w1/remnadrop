import { Alert, Badge, Box, Button, Card, Collapse, Group, Menu, MultiSelect, SegmentedControl, Select, SimpleGrid, Stack, Switch, Text, Tooltip } from '@mantine/core'
import { DateTimePicker } from '@mantine/dates'
import { LineChart } from '@mantine/charts'
import { useEffect, useState } from 'react'
import { instance } from '@shared/api/axios'
import { TbAlertCircleFilled, TbCalendar, TbChartLine, TbCircleCheckFilled, TbDownload, TbDotsVertical, TbSettings } from 'react-icons/tb'
import { nodeOptionLabel, type NodeOptionData } from '@shared/utils/misc/node-option-label'
import { useTranslation } from 'react-i18next'

type Row = { node_uuid: string; time: string; [key: string]: string | number | null }
type MetricEvent = {id:string;node_uuid:string;time:string;kind:'threshold'|'recovered'|'connected'|'disconnected';metric:string}
const eventLabel=(e:MetricEvent)=>({threshold:'Превышен порог',recovered:'Показатель восстановился',disconnected:'Нода отключилась',connected:'Нода подключилась'} as const)[e.kind]
const metricLabel=(metric:string)=>fields.find(f=>f.value===metric)?.label??metric

const fields = [
    ['online', 'Онлайн, пользователей'], ['rx', 'Входящий канал, байт/с'],
    ['tx', 'Исходящий канал, байт/с'], ['memory', 'Использование ОЗУ, %'],
    ['cpu', 'CPU, %'], ['load1', 'Средняя нагрузка за 1 минуту'],
    ['load5', 'Средняя нагрузка за 5 минут'], ['load15', 'Средняя нагрузка за 15 минут'],
    ['available', 'Доступность, %'], ['rxTotal', 'Получено с запуска, байт'], ['txTotal', 'Отправлено с запуска, байт']
].map(([value, label]) => ({ value, label }))
const localTime = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset()*60000).toISOString().slice(0,16).replace('T',' ') + ':00'
const parseLocal = (value: string) => new Date(value.replace(' ', 'T'))
export function NodeHistory() {
    const {i18n} = useTranslation()
    const [nodes, setNodes] = useState<{value: string; label: string}[]>([])
    const [selected, setSelected] = useState<string[]>([])
    const [from, setFrom] = useState(localTime(new Date(Date.now()-86400000)))
    const [to, setTo] = useState(localTime(new Date()))
    const [metric, setMetric] = useState<string | null>('online')
    const [rows, setRows] = useState<Row[]>([])
    const [events,setEvents]=useState<MetricEvent[]>([])
    const [retention,setRetention]=useState(90)
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const [live, setLive] = useState(false)
    const [bucket, setBucket] = useState(60)
    const [loaded, setLoaded] = useState(false)
    const [preset, setPreset] = useState('24h')
    const [calendarOpen,setCalendarOpen] = useState(false)
    const [draftFrom,setDraftFrom] = useState(from)
    const [draftTo,setDraftTo] = useState(to)
    const [notice,setNotice] = useState('')
    useEffect(() => { void instance.get('/api/nodes').then(r => {
        setNodes(r.data.response.map((n: NodeOptionData) => ({value:n.uuid,label:nodeOptionLabel(n)})))
    }).catch(() => setError('Не удалось загрузить список нод'))
        void instance.get('/api/monitoring/retention').then(r=>setRetention(r.data.response.days)).catch(()=>{}) }, [])
    useEffect(() => {
        let active = true
        const load = async () => {
            if (!selected.length) { setRows([]);setEvents([]); return }
            setBusy(true); setError('')
            try {
                const end = live ? new Date() : parseLocal(to)
                const result = await instance.get('/api/nodes/metrics/history', {params:{nodes:selected.join(','),from:parseLocal(from).toISOString(),to:end.toISOString()}})
                if (active) { setRows(result.data.response.rows); setBucket(result.data.response.bucketSeconds);setEvents(result.data.response.events??[]);setRetention(result.data.response.retentionDays??90); setLoaded(true) }
            } catch { if (active) setError(`Не удалось загрузить историю. Выберите период до ${retention} дней и не более 20 нод.`) }
            finally { if (active) setBusy(false) }
        }
        void load()
        const timer = live ? window.setInterval(() => void load(), 60000) : undefined
        return () => { active = false; if (timer) window.clearInterval(timer) }
    }, [selected, from, to, live])
    const points = new Map<string, Record<string, string | number | null>>()
    for (const row of rows) {
        const point = points.get(row.time) ?? {time:row.time}
        point[row.node_uuid] = row[metric ?? 'online']
        points.set(row.time,point)
    }
    const timeline=[...points.values()].sort((a,b)=>String(a.time).localeCompare(String(b.time)))
    const firstTime=timeline.length ? new Date(String(timeline[0].time)).getTime():0
    const lastTime=timeline.length ? new Date(String(timeline[timeline.length-1].time)).getTime():0
    const markers=events.filter(e=>selected.includes(e.node_uuid)).map(e=>{
        const t=new Date(e.time).getTime()
        const fraction=lastTime>firstTime ? (t-firstTime)/(lastTime-firstTime) : 0
        return {...e,fraction}
    }).filter(e=>Number.isFinite(e.fraction)&&e.fraction>=0&&e.fraction<=1)
    const selectPreset = (value:string) => {
        setPreset(value);setLive(false)
        if (value === 'custom') {setDraftFrom(from);setDraftTo(to);setCalendarOpen(true);return}
        setCalendarOpen(false)
        const hours:Record<string,number> = {'1h':1,'6h':6,'24h':24,'7d':168,'30d':720}
        const end=new Date(), start=new Date(end.getTime()-(hours[value]??24)*3600000)
        setFrom(localTime(start));setTo(localTime(end))
    }
    const applyDateRange = () => {
        const start=parseLocal(draftFrom).getTime(),end=parseLocal(draftTo).getTime()
        if (!Number.isFinite(start)||!Number.isFinite(end)||start>=end) {
            setError('Выберите корректный интервал: начало должно быть раньше окончания')
            return
        }
        if(end>Date.now()+60000){
            setError('Конец периода не может быть в будущем')
            return
        }
        if(end-start>retention*86400000){
            setError('Выбран слишком длинный период: не больше '+retention+' дней')
            return
        }
        setError('');setLive(false);setPreset('custom')
        setFrom(draftFrom);setTo(draftTo);setCalendarOpen(false)
    }
    const copyAgentToken = () => {
        if (selected.length!==1)return
        void instance.get('/api/nodes/'+selected[0]+'/metrics-agent/token').then(async r=>{
            await navigator.clipboard.writeText(r.data.response.token)
            setNotice('Токен CPU-агента скопирован. Укажите его в NODE_METRICS_TOKEN на выбранной ноде.')
        }).catch(()=>setError('Не удалось скопировать токен. Нужны права администратора и NODE_METRICS_SECRET на панели.'))
    }
    const exportCsv = () => {
        const keys = ['time','node_uuid',...fields.map(f=>f.value)]
        const csv = [keys.join(','), ...rows.map(row=>keys.map(key=>row[key] ?? '').join(','))].join('\r\n')
        const url = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8'}))
        const link = document.createElement('a'); link.href=url; link.download='node-metrics.csv'; link.click()
        window.setTimeout(()=>URL.revokeObjectURL(url),1000)
    }
    return <Card withBorder my="md" radius="lg" p="md"><Stack gap="sm">
        <Group justify="space-between" align="center" gap="xs" wrap="wrap">
            <Group gap="xs"><TbChartLine size={19}/><Text fw={700}>История метрик</Text><Badge variant="light" color="gray">{selected.length} нод</Badge></Group>
            <Group gap="xs">
                <Switch size="xs" label="Автообновление" checked={live} onChange={e=>setLive(e.currentTarget.checked)}/>
                <Tooltip label="Скачать данные в CSV"><Button size="compact-sm" variant="subtle" leftSection={<TbDownload size={16}/>} disabled={!rows.length||busy||!!error} onClick={exportCsv}>CSV</Button></Tooltip>
                <Menu position="bottom-end" shadow="md" withinPortal>
                    <Menu.Target><Button size="compact-sm" variant="subtle" leftSection={<TbDotsVertical size={15}/>}>Ещё</Button></Menu.Target>
                    <Menu.Dropdown>
                        <Menu.Label>Дополнительно</Menu.Label>
                        <Menu.Item leftSection={<TbSettings size={16}/>} disabled={selected.length!==1} onClick={copyAgentToken}>Копировать токен CPU-агента</Menu.Item>
                    </Menu.Dropdown>
                </Menu>
            </Group>
        </Group>

        <SimpleGrid cols={{base:1,md:2}} spacing="xs">
            <MultiSelect size="sm" label="Ноды" placeholder="Выберите ноды" data={nodes} value={selected} onChange={setSelected} maxValues={20} searchable clearable maxDropdownHeight={260} comboboxProps={{withinPortal:true}} />
            <Select size="sm" label="Показатель" data={fields} value={metric} onChange={setMetric} allowDeselect={false} searchable maxDropdownHeight={260} />
        </SimpleGrid>

        <Group justify="space-between" align="center" gap="xs" wrap="wrap">
            <Box style={{maxWidth:'100%',overflowX:'auto'}}>
                <SegmentedControl size="xs" value={preset} onChange={selectPreset}
                    data={[{value:'1h',label:'1 ч'},{value:'6h',label:'6 ч'},{value:'24h',label:'24 ч'},{value:'7d',label:'7 д'},{value:'30d',label:'30 д'},{value:'custom',label:'Свой'}]}/>
            </Box>
            <Button size="compact-sm" variant={calendarOpen?'light':'default'} leftSection={<TbCalendar size={16}/>} onClick={()=>{if(!calendarOpen){setDraftFrom(from);setDraftTo(to)}setCalendarOpen(v=>!v)}}>
                {preset==='custom'?'Свой период':'Календарь'}
            </Button>
        </Group>

        <Collapse in={calendarOpen}>
            <Card withBorder radius="md" padding="sm">
                <Stack gap="xs">
                    <SimpleGrid cols={{base:1,sm:2}} spacing="xs">
                        <DateTimePicker
                            size="sm" label="Начало периода" value={draftFrom} onChange={value=>{if(value)setDraftFrom(String(value))}}
                            dropdownType="modal" headerControlsOrder={['previous','next','level']} highlightToday
                            locale={i18n.language} valueFormat="DD.MM.YYYY HH:mm"
                            leftSection={<TbCalendar size={16}/>} modalProps={{centered:true}}
                            presets={[]} clearable={false}
                        />
                        <DateTimePicker
                            size="sm" label="Конец периода" value={draftTo} onChange={value=>{if(value)setDraftTo(String(value))}}
                            dropdownType="modal" headerControlsOrder={['previous','next','level']} highlightToday
                            locale={i18n.language} valueFormat="DD.MM.YYYY HH:mm"
                            leftSection={<TbCalendar size={16}/>} modalProps={{centered:true}}
                            presets={[]} clearable={false}
                        />
                    </SimpleGrid>
                    <Group justify="flex-end" gap="xs">
                        <Button size="xs" variant="subtle" onClick={()=>setCalendarOpen(false)}>Закрыть</Button>
                        <Button size="xs" onClick={applyDateRange}>Применить</Button>
                    </Group>
                </Stack>
            </Card>
        </Collapse>

        {error&&<Alert color="red" withCloseButton onClose={()=>setError('')}>{error}</Alert>}
        {notice&&<Alert color="teal" withCloseButton onClose={()=>setNotice('')}>{notice}</Alert>}
        <Text size="xs" c="dimmed">Хранение: {retention} дней · Шаг: {bucket/60} мин · CPU% требует агента на ноде · Счётчики трафика сбрасываются при рестарте ноды</Text>
        {busy ? <Text>Загрузка…</Text> : !selected.length ? <Text>Выберите ноды</Text> : loaded && !rows.length ? <Text>За выбранный период данных пока нет. Сбор начинается после установки обновления.</Text> : metric === 'cpu' && !rows.some(r => r.cpu !== null) ? <Text>Нет данных CPU% — установите агент на ноде</Text> : <Stack gap="xs">
            <Group justify="space-between" align="center"><Text fw={600} size="sm">{fields.find(f=>f.value===metric)?.label??metric}</Text><Badge variant="light">{markers.length} событий</Badge></Group>
            {!!markers.length && <Box role="group" aria-label="События на временной шкале" style={{height:36,position:'relative',borderBottom:'1px solid var(--mantine-color-default-border)',marginLeft:65,marginRight:18}}>
                {markers.map(e=><Tooltip key={e.id} multiline maw={260} label={new Date(e.time).toLocaleString('ru-RU')+' · '+(nodes.find(n=>n.value===e.node_uuid)?.label??e.node_uuid)+' · '+eventLabel(e)+' ('+metricLabel(e.metric)+')'} withArrow>
                    <Box role="img" pos="absolute" style={{left:(e.fraction*100)+'%',top:5,transform:'translateX(-50%)',zIndex:1}} aria-label={eventLabel(e)} tabIndex={0}>
                        {e.kind==='threshold'||e.kind==='disconnected'?<TbAlertCircleFilled size={20} color="var(--mantine-color-red-6)"/>:<TbCircleCheckFilled size={20} color="var(--mantine-color-teal-6)"/>}
                    </Box>
                </Tooltip>)}
            </Box>}
            <LineChart h={340} data={timeline} dataKey="time" series={selected.map((id,i)=>({name:id,label:nodes.find(n=>n.value===id)?.label ?? id,color:['cyan.6','violet.6','orange.6','green.6','red.6'][i%5]}))} connectNulls={false} withLegend withDots={false} curveType="linear" />
            <Group gap="xs" mt="xs"><Badge variant="light" color="red" leftSection={<TbAlertCircleFilled size={12}/>}>Падение / превышение</Badge><Badge variant="light" color="teal" leftSection={<TbCircleCheckFilled size={12}/>}>Восстановление</Badge><Text size="xs" c="dimmed">Маркеры соответствуют времени события; наведите для подробностей</Text></Group>
        </Stack>}
    </Stack></Card>
}
