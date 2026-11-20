import { Alert, Badge, Button, Card, Group, NumberInput, Progress, Select, SimpleGrid, Stack, Table, Text, TextInput } from '@mantine/core'
import { useEffect, useState } from 'react'
import { instance } from '@shared/api/axios'
import { nodeOptionLabel, type NodeOptionData } from '@shared/utils/misc/node-option-label'

type Quota={node_uuid:string;limit_bytes:string|null;used_bytes:string;blocked:boolean;period_days:number|null;threshold_percent:number}
type Policy={mode:'legacy'|'shared';periodDays:number|null;resetAt:string|null;thresholdPercent:number}
const gib=1073741824n
function bytesLabel(raw:string|null){if(raw===null)return 'Безлимит';const v=BigInt(raw);return (Number(v*100n/gib)/100).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ГиБ'}
function percent(q:Quota){if(q.limit_bytes===null)return 0;const max=BigInt(q.limit_bytes);return max===0n?100:Math.min(100,Number(BigInt(q.used_bytes)*100n/max))}
function getError(e:unknown){const x=e as {response?:{data?:{message?:string}}};return x.response?.data?.message||'Не удалось выполнить действие'}

export function SquadQuotas({userUuid}:{userUuid:string}){
    const [quotas,setQuotas]=useState<Quota[]>([])
    const [nodes,setNodes]=useState<{value:string;label:string}[]>([])
    const [selected,setSelected]=useState<string|null>(null)
    const [limit,setLimit]=useState('')
    const [unit,setUnit]=useState('gib')
    const [days,setDays]=useState<number|string>(30)
    const [threshold,setThreshold]=useState<number|string>(80)
    const [policy,setPolicy]=useState<Policy>({mode:'legacy',periodDays:null,resetAt:null,thresholdPercent:80})
    const [pendingSync,setPendingSync]=useState(false)
    const [error,setError]=useState(''),[success,setSuccess]=useState('')
    const [busy,setBusy]=useState(false),[legacy,setLegacy]=useState<string[]>([])
    const url='/api/users/'+userUuid+'/node-quotas'
    const load=async()=>{
        const [q,n,p,st]=await Promise.all([
            instance.get(url),
            instance.get('/api/nodes'),
            instance.get(url+'/settings'),
            instance.get(url+'/status')
        ])
        setQuotas(q.data.response)
        setLegacy((q.data.legacyNeedsReview??[]).map((x:{name:string})=>x.name))
        setNodes(n.data.response.map((node:NodeOptionData)=>({value:node.uuid,label:nodeOptionLabel(node)})))
        const current=p.data.response as Policy
        setPolicy(current)
        setDays(current.mode==='shared'?(current.periodDays??''):30)
        setThreshold(current.thresholdPercent)
        setPendingSync(st.data.response.pendingSync)
    }
    useEffect(()=>{void load().catch(e=>setError(getError(e)))},[userUuid])
    const act=async(task:()=>Promise<unknown>,message:string)=>{
        setBusy(true);setError('');setSuccess('')
        try{await task();await load();setSuccess(message)}
        catch(e){setError(getError(e))}
        finally{setBusy(false)}
    }
    const selectNode=(id:string|null)=>{
        setSelected(id)
        setUnit('gib')
        const q=quotas.find(x=>x.node_uuid===id)
        setLimit(q?.limit_bytes===null||!q?'':(Number(BigInt(q.limit_bytes)*1000n/gib)/1000).toString())
    }
    const toBytes=()=>{
        if(limit==='')return null
        if(!/^\d+(\.\d{1,3})?$/.test(limit))throw Error('Введите объём с точностью до 3 знаков')
        const [whole,fraction='']=limit.split('.')
        const scale=unit==='gib'?gib:unit==='mib'?1048576n:1n
        const bytes=BigInt(whole)*scale+BigInt(fraction.padEnd(3,'0'))*scale/1000n
        if(bytes>9223372036854775807n)throw Error('Слишком большой лимит')
        return bytes.toString()
    }
    const saveNode=()=>{
        if(!selected)return
        try{
            const bytes=toBytes()
            void act(()=>instance.put(url+'/'+selected,{limitBytes:bytes,periodDays:null}),'Лимит ноды сохранён; синхронизация доступа может занять немного времени')
        }catch(e){setError(String(e))}
    }
    const savePolicy=()=>void act(
        ()=>instance.put(url+'/settings',{periodDays:days===''?null:Number(days),thresholdPercent:Number(threshold)}),
        'Единые настройки сохранены. Использованный трафик не обнулён.'
    )
    const resetAll=()=>{
        if(!window.confirm('Сбросить расход на всех нодах подписки? Действие нельзя отменить.'))return
        void act(()=>instance.post(url+'/reset-all'),'Счётчики всех нод сброшены')
    }
    const current=quotas.find(q=>q.node_uuid===selected)
    return <Card withBorder radius="lg" p="lg"><Stack gap="md">
        <div><Text fw={700} size="lg">Лимиты по нодам</Text><Text size="sm" c="dimmed">Ограничения относятся к пользователю во всех сквадах. Превышение лимита блокирует доступ только к соответствующей ноде.</Text></div>
        {legacy.length>0&&<Alert color="yellow" title="Наследованные лимиты">Лимиты старых сквадов требуют ручной проверки: {legacy.join(', ')}. Старые значения не удалены.</Alert>}
        {policy.mode==='legacy'&&<Alert color="blue" title="Режим совместимости">Существующие лимиты не изменены. Чтобы использовать общий сброс и предупреждение, сохраните настройки подписки ниже.</Alert>}
        {pendingSync&&<Alert color="yellow" title="Синхронизация в очереди">Панель применит изменения к нодам при следующем проходе планировщика. Возможна небольшая задержка.</Alert>}
        {error&&<Alert color="red" withCloseButton onClose={()=>setError('')}>{error}</Alert>}
        {success&&<Alert color="teal" withCloseButton onClose={()=>setSuccess('')}>{success}</Alert>}
        <Card withBorder radius="md" padding="md"><Stack gap="sm">
            <Group justify="space-between"><Text fw={700}>Общие настройки подписки</Text><Badge color={policy.mode==='shared'?'teal':'gray'} variant="light">{policy.mode==='shared'?'Единые':'Исходные'}</Badge></Group>
            <Text size="xs" c="dimmed">Общий период сброса и одинаковый процент уведомления применяются ко всем нодам пользователя. Объём трафика у каждой ноды свой.</Text>
            <SimpleGrid cols={{base:1,sm:2}} spacing="sm">
                <NumberInput label="Сброс каждые N дней" description="Пусто — ручной сброс" value={days} onChange={setDays} min={1} max={366} allowDecimal={false}/>
                <NumberInput label="Предупреждение при расходе, %" value={threshold} onChange={setThreshold} min={1} max={99} allowDecimal={false}/>
            </SimpleGrid>
            {policy.mode==='shared'&&<Text size="xs" c="dimmed">Следующий сброс: {policy.resetAt?new Date(policy.resetAt).toLocaleString('ru-RU'):'только вручную'}</Text>}
            <Group justify="flex-end" gap="xs">
                <Button size="sm" variant="light" color="orange" disabled={busy||policy.mode!=='shared'} onClick={resetAll}>Сбросить все ноды</Button>
                <Button size="sm" loading={busy} disabled={threshold===''||Number(threshold)<1||Number(threshold)>99||(days!==''&&(Number(days)<1||Number(days)>366))} onClick={savePolicy}>Сохранить общие настройки</Button>
            </Group>
        </Stack></Card>
        <Text fw={700}>Индивидуальные значения</Text>
        <Select searchable label="Нода" placeholder="Выберите ноду" data={nodes} value={selected} onChange={selectNode}/>
        {current&&<Group gap="xs"><Badge color={current.blocked?'red':'teal'}>{current.blocked?'Заблокировано':'Доступно'}</Badge><Text size="xs" c="dimmed">Расход: {bytesLabel(current.used_bytes)} · Лимит: {bytesLabel(current.limit_bytes)}</Text></Group>}
        <Group grow align="end" wrap="nowrap">
            <TextInput label="Объём" description="Пусто — безлимит, 0 — запрет доступа" placeholder="Например, 80" value={limit} onChange={e=>setLimit(e.currentTarget.value)}/>
            <Select label="Единицы" w={110} data={[{value:'gib',label:'ГиБ'},{value:'mib',label:'МиБ'},{value:'b',label:'Байты'}]} value={unit} onChange={v=>setUnit(v??'gib')} allowDeselect={false}/>
        </Group>
        <Group justify="flex-end"><Button size="sm" disabled={!selected||busy||policy.mode!=='shared'||(limit!==''&&!/^\d+(\.\d{1,3})?$/.test(limit))} loading={busy} onClick={saveNode}>Сохранить лимит ноды</Button></Group>
        <Table.ScrollContainer minWidth={550}><Table highlightOnHover>
            <Table.Thead><Table.Tr><Table.Th>Нода</Table.Th><Table.Th>Расход / лимит</Table.Th><Table.Th>Доступ</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{quotas.map(q=><Table.Tr key={q.node_uuid}>
                <Table.Td><Text size="sm">{nodes.find(n=>n.value===q.node_uuid)?.label??q.node_uuid}</Text></Table.Td>
                <Table.Td><Text size="xs">{bytesLabel(q.used_bytes)} / {bytesLabel(q.limit_bytes)}</Text><Progress value={percent(q)} color={q.blocked?'red':'cyan'} size="xs" mt={5}/></Table.Td>
                <Table.Td><Badge color={q.blocked?'red':'teal'} variant="light">{q.blocked?'Заблокировано':'Доступно'}</Badge></Table.Td>
            </Table.Tr>)}{!quotas.length&&<Table.Tr><Table.Td colSpan={3}><Text ta="center" c="dimmed" py="md">Лимиты ещё не заданы</Text></Table.Td></Table.Tr>}</Table.Tbody>
        </Table></Table.ScrollContainer>
    </Stack></Card>
}
