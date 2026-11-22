import { Anchor, Badge, Card, Divider, Group, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core'
import { TbExternalLink } from 'react-icons/tb'
import type { ReactNode } from 'react'
import { bytes, dateText, obj, rows, type LimiterEvent } from './types'

function Metric({label,value}:{label:string;value:ReactNode}){return <div><Text size="xs" c="dimmed">{label}</Text><Text fw={600} size="sm" mt={3}>{value}</Text></div>}
export function ReportDetails({data}:{data:Record<string,unknown>}){
 const stats=obj(data.violations),traffic=obj(data.heavyTraffic)
 const top=rows(stats.Top),heavy=rows(traffic.Rows??traffic.Top)
 return <Stack gap="md">
  <SimpleGrid cols={{base:2,sm:3}}><Metric label="Нарушений за 24 часа" value={String(stats.Count24h??'—')}/><Metric label="За 7 дней" value={String(stats.CountWeek??'—')}/><Metric label="Пользователей с высоким трафиком" value={String(traffic.Total??heavy.length)}/></SimpleGrid>
  {top.length>0&&<><Title order={5}>Частые нарушения за неделю</Title><Table><Table.Thead><Table.Tr><Table.Th>Пользователь</Table.Th><Table.Th>Нарушений</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{top.map((row,i)=><Table.Tr key={i}><Table.Td>{String(row.Username||row.UserID||'—')}</Table.Td><Table.Td>{String(row.Count??'—')}</Table.Td></Table.Tr>)}</Table.Tbody></Table></>}
  {heavy.length>0&&<><Title order={5}>Высокий трафик</Title><Table.ScrollContainer minWidth={480}><Table><Table.Thead><Table.Tr><Table.Th>Пользователь</Table.Th><Table.Th>За неделю</Table.Th><Table.Th>Дней выше порога</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{heavy.map((row,i)=><Table.Tr key={i}><Table.Td>{String(row.Name??row.Username??obj(row.User).username??row.UserID??'—')}</Table.Td><Table.Td>{bytes(row.Week??row.WeekTotal??row.Bytes)}</Table.Td><Table.Td>{String(row.Days??row.HeavyDays??'—')}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer></>}
 </Stack>
}

export function EventDetails({event}:{event:LimiterEvent}){
 const payload=event.payload??{},data=payload.data??{},evidence=payload.evidence
 const isIp=['violation_detected','soft_violation_detected'].includes(event.event_type)
 const isTraffic=event.event_type.startsWith('traffic_')
 const accounts=rows(data.Accounts)
 return <Stack gap="md" pt="md">
  <Divider/>
  <Group justify="space-between" gap="sm">
   <Text size="sm" c="dimmed">ID {event.user_id??'—'} · {dateText(event.occurred_at??event.created_at)}</Text>
   {event.subscriptionUrl&&<Anchor href={event.subscriptionUrl} target="_blank" rel="noopener noreferrer" size="sm" style={{minHeight:44,display:'inline-flex',alignItems:'center',gap:6}}>Открыть подписку <TbExternalLink size={16}/></Anchor>}
  </Group>
  {isIp&&<>
   <SimpleGrid cols={{base:2,sm:3,lg:6}} spacing="md">
    <Metric label="Лимит устройств" value={event.device_limit}/>
    <Metric label="Уникальные IP" value={event.unique_ip_count??'—'}/>
    <Metric label="IP на нодах" value={event.connection_count??'—'}/>
    <Metric label="После группировки" value={event.observed_count}/>
    <Metric label="Превышение" value={'+'+Math.max(0,event.observed_count-event.device_limit)}/>
    <Metric label="Нарушений за 24 часа" value={event.violations_24h??'—'}/>
   </SimpleGrid>
   {payload.violation?.effective_limit!==undefined&&<Text size="xs" c="dimmed">Порог с учётом допуска: {payload.violation.effective_limit} · Подсетей: {payload.violation.subnet_count??'—'} · Групп ASN: {payload.violation.asn_group_count??'—'}</Text>}
   <Title order={5}>IP-адреса и ноды</Title>
   {event.ips.length?<Table.ScrollContainer minWidth={580}><Table striped verticalSpacing="sm"><Table.Thead><Table.Tr><Table.Th>IP</Table.Th><Table.Th>Провайдер</Table.Th><Table.Th>Нода</Table.Th><Table.Th>Последняя активность</Table.Th></Table.Tr></Table.Thead><Table.Tbody>
    {event.ips.map((ip,i)=><Table.Tr key={ip.ip+'-'+i}><Table.Td><Text size="sm" ff="monospace">{ip.ip}</Text></Table.Td><Table.Td><Text size="sm">{ip.asn_org||'—'}</Text>{Boolean(ip.asn)&&<Text size="xs" c="dimmed">AS{ip.asn}</Text>}</Table.Td>
     <Table.Td><Stack gap={4}>{(ip.nodes?.length?ip.nodes:[ip]).map((node,j)=><Text key={j} size="sm">{node.node_name||node.node_uuid||'—'}</Text>)}</Stack></Table.Td>
     <Table.Td><Stack gap={4}>{(ip.nodes?.length?ip.nodes:[ip]).map((node,j)=><Text key={j} size="xs" c="dimmed">{dateText(node.last_seen)}</Text>)}</Stack></Table.Td></Table.Tr>)}
   </Table.Tbody></Table></Table.ScrollContainer>:<Text size="sm" c="dimmed">Для этого события IP-адреса не сохранены.</Text>}
  </>}
  {isTraffic&&<>
   <SimpleGrid cols={{base:2,sm:4}}><Metric label="Объём за сутки" value={bytes(data.Bytes)}/><Metric label="Обычный объём" value={bytes(data.Norm)}/><Metric label="Превышение нормы" value={data.Ratio!==undefined?Number(data.Ratio).toFixed(1)+'×':'—'}/><Metric label="Объём за неделю" value={bytes(data.WeekTotal)}/></SimpleGrid>
   <Text size="sm" c="dimmed">{event.event_type==='traffic_heavy'?`${data.HeavyDays??'—'} дней выше порога ${bytes(data.HeavyBytes)} за ${data.HeavyWindow??7} дней`:`Норма рассчитана за ${data.NormDays??'—'} дней`} · Нарушений за 24 часа: {String(data.Violations??'—')}</Text>
   <Table.ScrollContainer minWidth={360}><Table><Table.Thead><Table.Tr><Table.Th>Нода</Table.Th><Table.Th>Трафик</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{rows(data.Nodes).map((node,i)=><Table.Tr key={i}><Table.Td>{String(node.Name??'—')}</Table.Td><Table.Td>{bytes(node.Bytes)}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>
   {Array.isArray(data.History)&&data.History.length>0&&<><Title order={5}>История суточного трафика</Title><Group>{data.History.map((value,i)=><Card key={i} p="xs" withBorder><Text size="xs" c="dimmed">День {i+1}</Text><Text size="sm">{bytes(value)}</Text></Card>)}</Group></>}
  </>}
  {event.event_type==='shared_hwid'&&<>
   <SimpleGrid cols={{base:1,sm:3}}><Metric label="Устройство" value={String(data.Device??'—')}/><Metric label="Приложение" value={String(data.App??'—')}/><Metric label="Создан аккаунт" value={dateText(String(data.Created??''))}/></SimpleGrid>
   <Text size="xs" ff="monospace" style={{overflowWrap:'anywhere'}}>HWID: {String(data.HWID??'—')}</Text>
   <Title order={5}>Аккаунты с этим устройством</Title><Table.ScrollContainer minWidth={650}><Table striped><Table.Thead><Table.Tr><Table.Th>Пользователь</Table.Th><Table.Th>Статус</Table.Th><Table.Th>Сквады</Table.Th><Table.Th>Первое / последнее появление</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{accounts.map((account,i)=><Table.Tr key={i}><Table.Td>{String(account.Username??account.UserID??'—')}</Table.Td><Table.Td>{account.Deleted?'Аккаунт удалён':String(account.Status??'—')}{Boolean(account.DeviceRemoved)&&<Text size="xs" c="dimmed">Устройство удалено</Text>}</Table.Td><Table.Td>{Array.isArray(account.Squads)?account.Squads.join(', '):'—'}</Table.Td><Table.Td><Text size="xs">{dateText(String(account.Created??''))}</Text><Text size="xs">{dateText(String(account.Seen??''))}</Text></Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>
   {Number(data.Hidden)>0&&<Text size="xs" c="dimmed">Ещё совпадений: {String(data.Hidden)}</Text>}
  </>}
  {evidence?.Fetches&&<>
   <Title order={5}>Обращения к подписке</Title><Text size="xs" c="dimmed">Запросов: {evidence.Fetches.Total} · Уникальных IP: {evidence.Fetches.IPs} · Провайдеров: {evidence.Fetches.ASNs} · Приложений: {evidence.Fetches.Apps}</Text>
   <Table.ScrollContainer minWidth={540}><Table striped><Table.Thead><Table.Tr><Table.Th>IP</Table.Th><Table.Th>Провайдер</Table.Th><Table.Th>Приложение</Table.Th><Table.Th>Запросов</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{evidence.Fetches.Rows.map((row,i)=><Table.Tr key={i}><Table.Td><Group gap="xs"><Text size="sm" ff="monospace">{row.IP}</Text>{row.Online&&<Badge size="xs" color="teal">Онлайн</Badge>}</Group></Table.Td><Table.Td>{row.Org||'—'}</Table.Td><Table.Td>{row.Apps?.join(', ')||'—'}</Table.Td><Table.Td>{row.Count}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>
  </>}
  {!!evidence?.Devices?.Items.length&&<>
   <Title order={5}>Устройства HWID</Title><Table><Table.Thead><Table.Tr><Table.Th>Устройство</Table.Th><Table.Th>Приложение</Table.Th><Table.Th>Последнее появление</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{evidence.Devices.Items.map((device,i)=><Table.Tr key={i}><Table.Td>{device.Name||'—'}</Table.Td><Table.Td>{device.App||'—'}</Table.Td><Table.Td>{dateText(device.Seen)}</Table.Td></Table.Tr>)}</Table.Tbody></Table>
  </>}
  {event.event_type==='daily_report'&&<ReportDetails data={data}/>}
  {event.event_type==='update_available'&&<><Text size="sm">Текущая версия: {String(data.current??'—')} · Доступна: {String(data.latest??'—')}</Text>{typeof data.url==='string'&&data.url.startsWith('https://github.com/syvlech/remnawave-limiter/')&&<Anchor target="_blank" rel="noopener noreferrer" href={data.url}>Посмотреть изменения</Anchor>}</>}
 </Stack>
}
