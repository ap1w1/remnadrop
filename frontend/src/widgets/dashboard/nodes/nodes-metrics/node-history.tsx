import { Alert, Badge, Box, Button, Card, Group, MultiSelect, SegmentedControl, Select, Stack, Text, TextInput, Tooltip } from '@mantine/core'
import { LineChart } from '@mantine/charts'
import { useEffect, useState } from 'react'
import { instance } from '@shared/api/axios'
import { TbAlertCircleFilled, TbCircleCheckFilled } from 'react-icons/tb'
import { nodeOptionLabel, type NodeOptionData } from '@shared/utils/misc/node-option-label'

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
const localTime = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset()*60000).toISOString().slice(0,16)
export function NodeHistory() {
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
                const end = live ? new Date() : new Date(to)
                const result = await instance.get('/api/nodes/metrics/history', {params:{nodes:selected.join(','),from:new Date(from).toISOString(),to:end.toISOString()}})
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
        const hours:Record<string,number> = {'1h':1,'6h':6,'24h':24,'7d':168,'30d':720}
        if (value === 'custom') return
        const end=new Date(), start=new Date(end.getTime()-(hours[value]??24)*3600000)
        setFrom(localTime(start));setTo(localTime(end))
    }
    const exportCsv = () => {
        const keys = ['time','node_uuid',...fields.map(f=>f.value)]
        const csv = [keys.join(','), ...rows.map(row=>keys.map(key=>row[key] ?? '').join(','))].join('\r\n')
        const url = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8'}))
        const link = document.createElement('a'); link.href=url; link.download='node-metrics.csv'; link.click()
        window.setTimeout(()=>URL.revokeObjectURL(url),1000)
    }
    return <Card withBorder my="md"><Stack>
        <Text fw={600}>История метрик</Text>
        <MultiSelect label="Ноды" description="Каждая выбранная нода — отдельная линия графика" data={nodes} value={selected} onChange={setSelected} maxValues={20} searchable clearable />
        <SegmentedControl fullWidth value={preset} onChange={selectPreset} data={[{value:'1h',label:'1 час'},{value:'6h',label:'6 часов'},{value:'24h',label:'24 часа'},{value:'7d',label:'7 дней'},{value:'30d',label:'30 дней'},{value:'custom',label:'Свой период'}]} />
        <Group grow><TextInput type="datetime-local" label="С" value={from} onChange={e=>{setFrom(e.currentTarget.value);setPreset('custom')}} />
        <TextInput type="datetime-local" label="По" value={to} disabled={live} onChange={e=>{setTo(e.currentTarget.value);setPreset('custom')}} /></Group>
        <Select label="Показатель" data={fields} value={metric} onChange={setMetric} allowDeselect={false} />
        <Group><Button variant={live ? 'filled' : 'light'} onClick={()=>setLive(!live)}>{live ? 'Автообновление включено' : 'Обновлять каждую минуту'}</Button>
        <Button variant="light" disabled={!rows.length || busy || !!error} onClick={exportCsv}>Скачать CSV</Button></Group>
        <Button variant="subtle" disabled={selected.length !== 1} onClick={() => {
            void instance.get(`/api/nodes/${selected[0]}/metrics-agent/token`).then(async r => {
                await navigator.clipboard.writeText(r.data.response.token)
                window.alert('Токен агента скопирован. Укажите его в NODE_METRICS_TOKEN на выбранной ноде.')
            }).catch(() => setError('Не удалось скопировать токен. Нужны права администратора и NODE_METRICS_SECRET на панели.'))
        }}>Скопировать токен CPU-агента выбранной ноды</Button>
        {error && <Alert color="red">{error}</Alert>}
        <Text size="sm" c="dimmed">Хранение: {retention} дней. Шаг графика: {bucket/60} мин. Значения усредняются внутри интервала. CPU% требует установки агента на ноде. Счётчики трафика обнуляются при перезапуске ноды.</Text>
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
