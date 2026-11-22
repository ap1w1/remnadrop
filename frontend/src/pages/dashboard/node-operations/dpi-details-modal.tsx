import { Alert, Badge, Button, Code, Group, Modal, ScrollArea, Stack, Table, Text, Title } from '@mantine/core'
import { useState } from 'react'
import { nodeOptionLabel, type NodeOptionData } from '@shared/utils/misc/node-option-label'

export type DpiHostChoice={uuid:string;remark:string;address:string;isDisabled:boolean;isHidden:boolean;inboundUuid:string|null;nodeUuids:string[]}
export type DpiJobResult={id:string;remote_id:number|null;location:string;host_uuids:string[];status:string;
  progress_done:number;progress_total:number;estimated_cost:number|null;actual_cost:number|null;
  error?:string|null;created_at:string;results?:Array<Record<string,unknown>>;remote_response?:Record<string,unknown>|null}

function safeText(value:unknown):string{
  if(typeof value!=='string' && typeof value!=='number') return '—'
  const text=String(value)
  // Never render a VLESS/VMess/Hysteria credential (even in the human-readable table).
  return /(?:vless|vmess|trojan|hysteria2?):\/\//i.test(text)?'Ключ скрыт':text.slice(0,250)
}
export function DpiDetailsModal({job,hosts,nodes,onClose}:{job:DpiJobResult|null;hosts:DpiHostChoice[];nodes:NodeOptionData[];onClose:()=>void}) {
  const [rawVisible,setRawVisible]=useState(false)
  const selectedHosts=hosts.filter(host=>job?.host_uuids.includes(host.uuid))
  const results=Array.isArray(job?.results)?job.results:[]
  const fullResponse=job?{id:job.id,remote_id:job.remote_id,status:job.status,location:job.location,
    progress:{done:job.progress_done,total:job.progress_total},estimated_cost:job.estimated_cost,
    actual_cost:job.actual_cost,error:job.error,host_uuids:job.host_uuids,
    upstream_response:job.remote_response??{results,notice:'Ответ сервиса не сохранён для старой проверки'}}:null
  return <Modal opened={!!job} onClose={()=>{setRawVisible(false);onClose()}} title={<Title order={4}>Результаты DPI Checker</Title>}
    centered size="xl" scrollAreaComponent={ScrollArea.Autosize} keepMounted={false}>
    <Stack gap="md">
      <Text c="dimmed" size="sm">Проверка #{job?.remote_id??job?.id??'—'} · {job?.status??'—'} · {job?.progress_done??0}/{job?.progress_total??0} измерений</Text>
      {job?.error&&<Alert color="red">{job.error}</Alert>}
      <Text fw={600}>Выбранные хосты</Text>
      <Table.ScrollContainer minWidth={550}><Table striped highlightOnHover>
        <Table.Thead><Table.Tr><Table.Th>Нода</Table.Th><Table.Th>Хост</Table.Th><Table.Th>IP / адрес</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{selectedHosts.map(host=><Table.Tr key={host.uuid}>
          <Table.Td>{host.nodeUuids.map(id=>nodes.find(n=>n.uuid===id)).filter((n):n is NodeOptionData=>!!n).map(nodeOptionLabel).join(', ')||'—'}</Table.Td>
          <Table.Td>{host.remark}{host.isHidden?' · скрыт':''}</Table.Td>
          <Table.Td>{host.address}</Table.Td>
        </Table.Tr>)}{!selectedHosts.length&&<Table.Tr><Table.Td colSpan={3}>Метаданные хостов недоступны</Table.Td></Table.Tr>}</Table.Tbody>
      </Table></Table.ScrollContainer>
      <Group justify="space-between"><Text fw={600}>Измерения по регионам и операторам</Text><Badge variant="light">{results.length} результатов</Badge></Group>
      <Table.ScrollContainer minWidth={640}><Table striped>
        <Table.Thead><Table.Tr><Table.Th>Хост</Table.Th><Table.Th>Регион / PoP</Table.Th><Table.Th>Доступность</Table.Th><Table.Th>Задержка</Table.Th><Table.Th>Ошибка</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{results.map((result,index)=>{
          const host=typeof result.host_uuid==='string'?selectedHosts.find(h=>h.uuid===result.host_uuid):
            typeof result.host_index==='number'?selectedHosts[result.host_index]:selectedHosts.length===1?selectedHosts[0]:undefined
          const connected=result.connected
          return <Table.Tr key={index}><Table.Td>{host?.remark??(typeof result.host_index==='number'?selectedHosts[result.host_index]?.remark:'Хост не определён')??'—'}</Table.Td>
            <Table.Td>{safeText(result.pop_name??result.region??result.pop_id)}</Table.Td>
            <Table.Td><Badge color={connected===true?'teal':connected===false?'red':'gray'}>{connected===true?'Доступен':connected===false?'Недоступен':'Нет данных'}</Badge></Table.Td>
            <Table.Td>{result.latency_ms==null?'—':safeText(result.latency_ms)+' мс'}</Table.Td>
            <Table.Td><Text size="sm">{safeText(result.error)}</Text></Table.Td></Table.Tr>
        })}{!results.length&&<Table.Tr><Table.Td colSpan={5}><Text c="dimmed" ta="center">Результаты ещё не получены</Text></Table.Td></Table.Tr>}</Table.Tbody>
      </Table></Table.ScrollContainer>
      <Button variant="light" onClick={()=>setRawVisible(value=>!value)}>{rawVisible?'Скрыть JSON ответа':'Открыть JSON ответа (без ключей)'}</Button>
      {rawVisible&&<ScrollArea.Autosize mah={380} type="auto"><Code block style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(fullResponse,null,2)}</Code></ScrollArea.Autosize>}
    </Stack>
  </Modal>
}
