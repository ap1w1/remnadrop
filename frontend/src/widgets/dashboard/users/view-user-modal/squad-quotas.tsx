import { Alert, Badge, Button, Card, Group, NumberInput, Progress, Select, Stack, Table, Text, TextInput } from '@mantine/core'
import { useEffect, useState } from 'react'
import { instance } from '@shared/api/axios'

type Quota = { node_uuid: string; limit_bytes: string | null; used_bytes: string; blocked: boolean; period_days: number | null; threshold_percent: number }
const gib=1073741824n
function bytesLabel(raw:string|null){if(raw===null)return 'Безлимит';const value=BigInt(raw);return `${(Number(value / (gib/1000n))/1000).toLocaleString('ru-RU',{maximumFractionDigits:2})} ГиБ`}
function percent(q:Quota){if(q.limit_bytes===null)return 0;const max=BigInt(q.limit_bytes);if(max===0n)return 100;return Math.min(100,Number(BigInt(q.used_bytes)*100n/max))}
export function SquadQuotas({ userUuid }: { userUuid: string }) {
 const [quotas,setQuotas]=useState<Quota[]>([]),[nodes,setNodes]=useState<{value:string;label:string}[]>([]),[selected,setSelected]=useState<string|null>(null)
 const [limit,setLimit]=useState(''),[unit,setUnit]=useState('gib'),[days,setDays]=useState<string|number>(''),[threshold,setThreshold]=useState<string|number>(80)
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[legacy,setLegacy]=useState<string[]>([])
 const url=`/api/users/${userUuid}/node-quotas`
 const load=async()=>{const [q,s]=await Promise.all([instance.get(url),instance.get('/api/nodes')]);setQuotas(q.data.response);setLegacy((q.data.legacyNeedsReview??[]).map((x:{name:string})=>x.name));setNodes(s.data.response.map((x:{uuid:string;name:string})=>({value:x.uuid,label:x.name})))}
 useEffect(()=>{void load().catch(()=>setError('Не удалось загрузить лимиты'))},[userUuid])
 const act=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await fn();await load()}catch(e:unknown){const detail=e as {response?:{data?:{message?:string}}};setError(detail.response?.data?.message||'Операция не выполнена')}finally{setBusy(false)}}
 const select=(value:string|null)=>{setSelected(value);const q=quotas.find(x=>x.node_uuid===value);setUnit('gib');const current=q?.limit_bytes;if(current==null)setLimit('');else if(BigInt(current)===0n)setLimit('0');else setLimit((Number(BigInt(current)*100n/gib)/100).toString());setDays(q?.period_days??'');setThreshold(q?.threshold_percent??80)}
 const toBytes=()=>{if(limit==='')return null;if(!/^\d+(\.\d{1,3})?$/.test(limit))throw new Error('Укажите положительное число с точностью до 3 знаков');const [whole,decimal='']=limit.split('.');const scale=unit==='gib'?gib:unit==='mib'?1048576n:1n;return (BigInt(whole)*scale+BigInt(decimal.padEnd(3,'0'))*scale/1000n).toString()}
 const save=()=>void act(async()=>{if(!selected)return;const limitBytes=toBytes();await instance.put(`${url}/${selected}`,{limitBytes,periodDays:days===''?null:Number(days),thresholdPercent:Number(threshold)})})
 return <Card withBorder radius="md"><Stack gap="md">
   <Group justify="space-between"><div><Text fw={600}>Индивидуальные лимиты по нодам</Text><Text c="dimmed" size="xs">Лимиты применяются к одной подписке (пользователю) отдельно на каждой ноде. Выберите ноду для редактирования.</Text></div></Group>
   {legacy.length>0&&<Alert color="yellow">Лимиты старых сквадов требуют ручного распределения по нодам: {legacy.join(', ')}. Значения сохранены.</Alert>}
   {error&&<Alert color="red">{error}</Alert>}
   <Select label="Нода" searchable placeholder="Выберите ноду" data={nodes} value={selected} onChange={select}/>
   <Group align="end" grow wrap="nowrap"><TextInput label="Объём трафика" description="Пусто — безлимит; 0 — запретить доступ к ноде" placeholder="Например, 80" value={limit} onChange={e=>setLimit(e.currentTarget.value)}/><Select label="Единицы" data={[{value:'gib',label:'ГиБ'},{value:'mib',label:'МиБ'},{value:'b',label:'Байты'}]} value={unit} onChange={v=>setUnit(v??'gib')} allowDeselect={false} w={100}/></Group>
   <Group align="end" grow><NumberInput label="Сброс каждые N дней" description="Пусто — только ручной сброс" min={1} max={366} allowDecimal={false} value={days} onChange={setDays}/><NumberInput label="Предупредить при расходе, %" min={1} max={99} allowDecimal={false} value={threshold} onChange={setThreshold}/></Group>
   <Group justify="end"><Button loading={busy} disabled={!selected||threshold===''||(limit!==''&&!/^\d+(\.\d{1,3})?$/.test(limit))} onClick={save}>Сохранить лимит ноды</Button></Group>
   <Table.ScrollContainer minWidth={530}><Table highlightOnHover><Table.Thead><Table.Tr><Table.Th>Нода</Table.Th><Table.Th>Использовано / лимит</Table.Th><Table.Th>Доступ</Table.Th><Table.Th>Действие</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{quotas.map(q=><Table.Tr key={q.node_uuid}><Table.Td>{nodes.find(n=>n.value===q.node_uuid)?.label??q.node_uuid}</Table.Td><Table.Td><Text size="xs">{bytesLabel(q.used_bytes)} / {bytesLabel(q.limit_bytes)}</Text><Progress value={percent(q)} size="xs" color={q.blocked?'red':'cyan'} mt={5}/></Table.Td><Table.Td><Badge color={q.blocked?'red':'teal'} variant="light">{q.blocked?'Заблокировано':'Доступен'}</Badge></Table.Td><Table.Td><Button variant="light" size="compact-sm" disabled={busy} onClick={()=>{if(window.confirm('Сбросить расход на этой ноде?'))void act(()=>instance.post(`${url}/${q.node_uuid}/reset`))}}>Сбросить</Button></Table.Td></Table.Tr>)}{!quotas.length&&<Table.Tr><Table.Td colSpan={4}><Text c="dimmed" ta="center" py="lg">Индивидуальные лимиты ещё не назначены</Text></Table.Td></Table.Tr>}</Table.Tbody></Table></Table.ScrollContainer>
 </Stack></Card>
}
