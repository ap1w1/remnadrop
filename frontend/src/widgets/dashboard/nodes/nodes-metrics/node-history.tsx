import { Alert, Badge, Box, Button, Card, Collapse, Group, Menu, MultiSelect, SegmentedControl, Select, SimpleGrid, Stack, Switch, Text, Tooltip } from '@mantine/core'
import { DatePickerInput, TimeInput, type DatesRangeValue } from '@mantine/dates'
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
    ['online', 'Онлайн, пользователей'], ['rx', 'Входящий трафик'],
    ['tx', 'Исходящий трафик'], ['memory', 'ОЗУ занято, %'],
    ['memoryUsed', 'ОЗУ занято'], ['memoryTotal', 'ОЗУ всего'],
    ['cpu', 'Нагрузка CPU, % от ядер'], ['load1', 'Очередь задач за 1 мин'],
    ['load5', 'Очередь задач за 5 мин'], ['load15', 'Очередь задач за 15 мин'],
    ['available', 'Доступность, %'], ['rxTotal', 'Получено с запуска'], ['txTotal', 'Отправлено с запуска']
].map(([value, label]) => ({ value, label }))
const byteMetrics=new Set(['rx','tx','rxTotal','txTotal','memoryUsed','memoryTotal'])
const rateMetrics=new Set(['rx','tx'])
const units=['Б','КиБ','МиБ','ГиБ','ТиБ']
const zoneOptions=[{value:Intl.DateTimeFormat().resolvedOptions().timeZone,label:'Часовой пояс браузера'},
    {value:'UTC',label:'UTC'},...((Intl as unknown as {supportedValuesOf?: (key:string)=>string[]}).supportedValuesOf?.('timeZone')??[])
        .filter(zone=>zone!==Intl.DateTimeFormat().resolvedOptions().timeZone&&zone!=='UTC')
        .map(zone=>({value:zone,label:zone}))]
export const formatMonitoringTime=(value:string,zone:string)=>new Intl.DateTimeFormat('ru-RU',{
    timeZone:zone,year:'2-digit',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
}).format(new Date(value))
const localTime = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset()*60000).toISOString().slice(0,16).replace('T',' ') + ':00'
const parseLocal = (value: string) => new Date(value.replace(' ', 'T'))
export function NodeHistory({timeZone,onTimeZoneChange}:{timeZone:string;onTimeZoneChange:(zone:string)=>void}) {
    const {i18n} = useTranslation()
    const [nodes, setNodes] = useState<{value: string; label: string}[]>([])
    const [selected, setSelected] = useState<string[]>([])
    const [from, setFrom] = useState(localTime(new Date(Date.now()-86400000)))
    const [to, setTo] = useState(localTime(new Date()))
    const [metrics, setMetrics] = useState<string[]>(['online'])
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
    const [draftRange,setDraftRange] = useState<DatesRangeValue>([from.slice(0,10),to.slice(0,10)])
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
            } catch { if (active) setError(`Не удалось загрузить историю. Выберите период до ${retention} дней и не более 200 нод.`) }
            finally { if (active) setBusy(false) }
        }
        void load()
        const timer = live ? window.setInterval(() => void load(), 60000) : undefined
        return () => { active = false; if (timer) window.clearInterval(timer) }
    }, [selected, from, to, live])
    const scales=new Map(metrics.map(metric=>{
        if(!byteMetrics.has(metric))return [metric,{divisor:1,unit:''}] as const
        const maximum=rows.reduce((max,row)=>Math.max(max,Number(row[metric]??0)),0)
        const level=Math.min(4,Math.max(0,Math.floor(Math.log(Math.max(1,maximum))/Math.log(1024))))
        return [metric,{divisor:1024**level,unit:units[level]+(rateMetrics.has(metric)?'/с':'')}] as const
    }))
    const labelFor=(metric:string)=>`${fields.find(f=>f.value===metric)?.label??metric}${scales.get(metric)?.unit?' · '+scales.get(metric)!.unit:''}`
    const points = new Map<string, Record<string, string | number | null>>()
    for (const row of rows) {
        const point = points.get(row.time) ?? {time:row.time}
        for (const metric of metrics) {
            const raw=row[metric]
            point[`${row.node_uuid}:${metric}`] = typeof raw==='number'
                ? Number((raw/(scales.get(metric)?.divisor??1)).toFixed(metric==='online'?0:2)) : null
        }
        points.set(row.time,point)
    }
    const timeline=[...points.values()].sort((a,b)=>String(a.time).localeCompare(String(b.time)))
    const chartData=timeline.map(point=>({...point,time:formatMonitoringTime(String(point.time),timeZone)}))
    const firstTime=timeline.length ? new Date(String(timeline[0].time)).getTime():0
    const lastTime=timeline.length ? new Date(String(timeline[timeline.length-1].time)).getTime():0
    const markers=events.filter(e=>selected.includes(e.node_uuid)).map(e=>{
        const t=new Date(e.time).getTime()
        const fraction=lastTime>firstTime ? (t-firstTime)/(lastTime-firstTime) : 0
        return {...e,fraction}
    }).filter(e=>Number.isFinite(e.fraction)&&e.fraction>=0&&e.fraction<=1)
    const seriesColors=['cyan.6','violet.6','orange.6','green.6','red.6','pink.6','yellow.6']
    const plottedValues=timeline.flatMap(point=>selected.flatMap(id=>metrics.map(metric=>point[`${id}:${metric}`])))
    const chartMax=plottedValues.reduce<number>((max,value)=>typeof value==='number'?Math.max(max,value):max,1)
    const referenceLines=markers.slice(0,80).flatMap(event=>{
        const point=timeline.reduce<(typeof timeline)[number]|null>((closest,candidate)=>
            !closest||Math.abs(new Date(String(candidate.time)).getTime()-new Date(event.time).getTime())<
                Math.abs(new Date(String(closest.time)).getTime()-new Date(event.time).getTime())?candidate:closest,null)
        const value=point?.[`${event.node_uuid}:${metrics[0]}`]
        if(!point||typeof value!=='number')return []
        const x=formatMonitoringTime(String(point.time),timeZone)
        return [{segment:[{x,y:chartMax},{x,y:value}] as const,color:seriesColors[selected.indexOf(event.node_uuid)%seriesColors.length],strokeDasharray:'3 4'}]
    })
    const selectPreset = (value:string) => {
        setPreset(value);setLive(false)
        if (value === 'custom') {setDraftFrom(from);setDraftTo(to);setDraftRange([from.slice(0,10),to.slice(0,10)]);setCalendarOpen(true);return}
        setCalendarOpen(false)
        const hours:Record<string,number> = {'1h':1,'6h':6,'24h':24,'7d':168,'30d':720}
        const end=new Date(), start=new Date(end.getTime()-(hours[value]??24)*3600000)
        setFrom(localTime(start));setTo(localTime(end))
    }
    const applyDateRange = () => {
        const selectedFrom=draftRange[0]?`${draftRange[0]} ${draftFrom.slice(11)}`:''
        const selectedTo=draftRange[1]?`${draftRange[1]} ${draftTo.slice(11)}`:''
        const start=parseLocal(selectedFrom).getTime(),end=parseLocal(selectedTo).getTime()
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
        setFrom(selectedFrom);setTo(selectedTo);setCalendarOpen(false)
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

        <Card withBorder radius="md" p="sm">
          <SimpleGrid cols={{base:1,md:2}} spacing="sm">
            <Stack gap={4}><MultiSelect size="sm" label="Ноды" placeholder="Выберите ноды" data={nodes} value={selected} onChange={setSelected} searchable clearable maxDropdownHeight={260} comboboxProps={{withinPortal:true}} />
              <Group gap="xs"><Button size="compact-xs" variant="subtle" onClick={()=>setSelected(nodes.map(node=>node.value))}>Выбрать все</Button><Button size="compact-xs" variant="subtle" onClick={()=>setSelected([])}>Сбросить</Button></Group>
            </Stack>
            <MultiSelect size="sm" label="Показатели на графике" data={fields} value={metrics} onChange={value => setMetrics(value.length ? value : ['online'])} searchable maxDropdownHeight={260} />
          </SimpleGrid>
        </Card>

        <Card withBorder radius="md" p="sm"><Stack gap="xs">
          <Group justify="space-between" align="center" gap="xs" wrap="wrap">
            <Box style={{maxWidth:'100%',overflowX:'auto'}}>
                <SegmentedControl size="xs" value={preset} onChange={selectPreset}
                    data={[{value:'1h',label:'1 ч'},{value:'6h',label:'6 ч'},{value:'24h',label:'24 ч'},{value:'7d',label:'7 д'},{value:'30d',label:'30 д'},{value:'custom',label:'Свой'}]}/>
            </Box>
            <Group gap="xs"><Select size="xs" aria-label="Часовой пояс графика" searchable data={zoneOptions} value={timeZone} onChange={value=>{if(value)onTimeZoneChange(value)}} w={220}/>
            <Button size="compact-sm" variant={calendarOpen?'light':'default'} leftSection={<TbCalendar size={16}/>} onClick={()=>{if(!calendarOpen){setDraftFrom(from);setDraftTo(to);setDraftRange([from.slice(0,10),to.slice(0,10)])}setCalendarOpen(v=>!v)}}>
                {preset==='custom'?'Свой период':'Календарь'}
            </Button></Group>
          </Group>

          <Collapse expanded={calendarOpen}>
                <Group gap="sm" align="end" wrap="wrap">
                    <DatePickerInput type="range" size="sm" label="Период" value={draftRange} onChange={setDraftRange} w={280}
                        leftSection={<TbCalendar size={16}/>} valueFormat="DD.MM.YYYY" locale={i18n.language}
                        highlightToday numberOfColumns={1} clearable={false} />
                    <TimeInput size="sm" label="Начало" value={draftFrom.slice(11,16)} onChange={event=>setDraftFrom(`${draftFrom.slice(0,10)} ${event.currentTarget.value}:00`)} w={115}/>
                    <TimeInput size="sm" label="Конец" value={draftTo.slice(11,16)} onChange={event=>setDraftTo(`${draftTo.slice(0,10)} ${event.currentTarget.value}:00`)} w={115}/>
                    <Button size="sm" variant="subtle" onClick={()=>setCalendarOpen(false)}>Закрыть</Button>
                    <Button size="sm" onClick={applyDateRange}>Применить</Button>
                </Group>
          </Collapse>
        </Stack></Card>

        {error&&<Alert color="red" withCloseButton onClose={()=>setError('')}>{error}</Alert>}
        {notice&&<Alert color="teal" withCloseButton onClose={()=>setNotice('')}>{notice}</Alert>}
        <Text size="xs" c="dimmed">Хранение: {retention} дней · Шаг: {bucket/60} мин · Время: {timeZone} · CPU без агента оценивается по очереди задач на ядро · Сетевые счётчики сбрасываются при перезапуске ноды</Text>
        {busy ? <Text>Загрузка…</Text> : !selected.length ? <Text>Выберите ноды</Text> : loaded && !rows.length ? <Text>За выбранный период данных пока нет. Сбор начинается после установки обновления.</Text> : <Stack gap="xs">
            <Group justify="space-between" align="center"><Text fw={600} size="sm">{metrics.map(labelFor).join(', ')}</Text><Badge variant="light">{markers.length} событий</Badge></Group>
            {!!markers.length && <Box role="group" aria-label="События на временной шкале" style={{height:36,position:'relative',borderBottom:'1px solid var(--mantine-color-default-border)',marginLeft:65,marginRight:18}}>
                {markers.map(e=><Tooltip key={e.id} multiline maw={260} label={formatMonitoringTime(e.time,timeZone)+' · '+(nodes.find(n=>n.value===e.node_uuid)?.label??e.node_uuid)+' · '+eventLabel(e)+' ('+metricLabel(e.metric)+')'} withArrow>
                    <Box role="img" pos="absolute" style={{left:(e.fraction*100)+'%',top:5,transform:'translateX(-50%)',zIndex:1}} aria-label={eventLabel(e)} tabIndex={0}>
                        {e.kind==='threshold'||e.kind==='disconnected'?<TbAlertCircleFilled size={20} color="var(--mantine-color-red-6)"/>:<TbCircleCheckFilled size={20} color="var(--mantine-color-teal-6)"/>}
                    </Box>
                </Tooltip>)}
            </Box>}
            <LineChart h={420} data={chartData} dataKey="time" referenceLines={referenceLines}
                series={selected.flatMap((id,i)=>metrics.map((metric,j)=>({
                    name:`${id}:${metric}`,
                    label:`${nodes.find(n=>n.value===id)?.label??id} · ${labelFor(metric)}`,
                    color:seriesColors[(i*metrics.length+j)%seriesColors.length]
                })))}
                connectNulls={false} withLegend={selected.length*metrics.length<=12} withDots={false} curveType="linear"
                tooltipProps={{contentStyle:{maxHeight:320,overflowY:'auto',maxWidth:500}}}
                xAxisProps={{minTickGap:45,interval:'preserveStartEnd'}}
                valueFormatter={value=>Number(value).toLocaleString('ru-RU',{maximumFractionDigits:2})}
                yAxisProps={{allowDecimals:!(metrics.length===1&&metrics[0]==='online'),tickFormatter:value=>Number(value).toLocaleString('ru-RU',{maximumFractionDigits:2})}} />
            <Group gap="xs" mt="xs"><Badge variant="light" color="red" leftSection={<TbAlertCircleFilled size={12}/>}>Падение / превышение</Badge><Badge variant="light" color="teal" leftSection={<TbCircleCheckFilled size={12}/>}>Восстановление</Badge><Text size="xs" c="dimmed">Маркеры соответствуют времени события; наведите для подробностей</Text></Group>
        </Stack>}
    </Stack></Card>
}
