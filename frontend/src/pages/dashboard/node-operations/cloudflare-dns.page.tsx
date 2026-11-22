import { Alert, Badge, Button, Card, Group, Modal, PasswordInput, Select, SimpleGrid, Stack, Switch, Table, Text, TextInput, Title, Tooltip } from '@mantine/core'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { TbCloud, TbEdit, TbLink, TbRefresh, TbTrash } from 'react-icons/tb'
import { instance } from '@shared/api/axios'
import { Page } from '@shared/ui'

type Zone={id:string;name:string;status:string}
type HostLink={hostUuid:string;hostName:string;nodeUuid:string;nodeName:string}
type RecordItem={id:string;zoneId:string;zoneName:string;name:string;type:string;content:string;proxied?:boolean;ttl:number;linkedHosts:HostLink[]}
type Binding={domain:string;zone_id:string;auto_sync:boolean}
type Explicit={zone_id:string;record_id:string;host_uuid:string}
type HostOption={uuid:string;remark:string;address:string}
type History={id:string;record_name:string;old_ip:string|null;new_ip:string|null;source:string;status:string;message:string;created_at:string}
type Status={configured:boolean;source:string;updatedAt:string|null}
type Data={zones:Zone[];records:RecordItem[];bindings:Binding[];status:Status}
const empty:Data={zones:[],records:[],bindings:[],status:{configured:false,source:'none',updatedAt:null}}
const api='/api/cloudflare-dns'
const msg=(e:unknown)=>{const a=e as {response?:{data?:{message?:string|string[]}}};return String(a.response?.data?.message??(e instanceof Error?e.message:'Ошибка Cloudflare DNS'))}
export function CloudflareDnsPage(){
  const [data,setData]=useState<Data>(empty)
  const [history,setHistory]=useState<History[]>([])
  const [hostOptions,setHostOptions]=useState<HostOption[]>([]),[explicitLinks,setExplicitLinks]=useState<Explicit[]>([])
  const [token,setToken]=useState('')
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [search,setSearch]=useState(''),[zone,setZone]=useState<string|null>(null),[manualZoneId,setManualZoneId]=useState(''),[autoSync,setAutoSync]=useState(false)
  const [edit,setEdit]=useState<RecordItem|null>(null),[linkRecord,setLinkRecord]=useState<RecordItem|null>(null),[newHost,setNewHost]=useState<string|null>(null),[nodeUuid,setNodeUuid]=useState<string|null>(null),[ip,setIp]=useState('')
  const refresh=useCallback(async()=>{
    const [a,b,c,d]=await Promise.all([instance.get(api+'/overview'),instance.get(api+'/events'),instance.get(api+'/links'),instance.get('/api/hosts')])
    setData(a.data.response as Data);setHistory(b.data.response as History[])
    setExplicitLinks(c.data.response as Explicit[]);setHostOptions(d.data.response as HostOption[])
  },[])
  useEffect(()=>{void refresh().catch(e=>setError(msg(e))).finally(()=>setLoading(false))},[refresh])
  const binding=data.bindings.find(x=>x.domain===zone)
  const chooseZone=(name:string|null)=>{
    setZone(name);const z=data.zones.find(x=>x.name===name)
    const saved=data.bindings.find(x=>x.domain===name)
    setManualZoneId(saved?.zone_id??z?.id??'');setAutoSync(saved?.auto_sync??false)
  }
  const saveToken=async()=>{
    setBusy(true);setError('')
    try{await instance.put(api+'/settings',{apiToken:token.trim()});setToken('');await refresh();setNotice('Cloudflare API Token сохранён и проверен.')}
    catch(e){setError(msg(e))}finally{setBusy(false)}
  }
  const saveZone=async()=>{
    if(!zone)return;setBusy(true);setError('')
    try{await instance.put(api+'/zones',{domain:zone,zoneId:manualZoneId.trim(),autoSync});await refresh();setNotice('Zone ID и автоматическая синхронизация сохранены.')}
    catch(e){setError(msg(e))}finally{setBusy(false)}
  }
  const linkHost=async()=>{
    if(!linkRecord||!newHost)return
    setBusy(true);setError('')
    try{
      await instance.put(api+'/links',{zoneId:linkRecord.zoneId,recordId:linkRecord.id,hostUuid:newHost})
      setNewHost(null);await refresh();setNotice('Привязка DNS-записи к хосту сохранена.')
    }catch(e){setError(msg(e))}finally{setBusy(false)}
  }
  const unlinkHost=async(record:RecordItem,hostUuid:string)=>{
    if(!window.confirm('Удалить явную привязку записи к хосту?'))return
    setBusy(true);setError('')
    try{
      await instance.delete(api+'/links/'+record.zoneId+'/'+record.id+'/'+hostUuid)
      await refresh()
    }catch(e){setError(msg(e))}finally{setBusy(false)}
  }
  const replace=async()=>{
    if(!edit||!nodeUuid||!ip)return
    setBusy(true);setError('')
    try{
      await instance.post(api+'/replace-ip',{zoneId:edit.zoneId,recordId:edit.id,nodeUuid,expectedOldIp:edit.content,newIp:ip.trim()})
      setEdit(null);setIp('');await refresh();setNotice('IP записи изменён. Операция записана в журнал.')
    }catch(e){setError(msg(e))}finally{setBusy(false)}
  }
  const rows=useMemo(()=>data.records.filter(r=>(!zone||r.zoneName===zone||!zone)&&
    [r.name,r.content,r.zoneName,...r.linkedHosts.flatMap(h=>[h.hostName,h.nodeName])].join(' ').toLowerCase().includes(search.toLowerCase())),[data.records,zone,search])
  return <Page title="Cloudflare DNS"><Stack gap="md">
    <Group justify="space-between" align="center" wrap="wrap">
      <Group gap="sm"><TbCloud size={30}/><div><Title order={2}>Cloudflare DNS</Title>
        <Text c="dimmed" size="sm">Домены, поддомены, записи DNS и связи с хостами RemnaDrop</Text></div></Group>
      <Button variant="light" leftSection={<TbRefresh size={17}/>} loading={busy||loading} onClick={()=>void refresh().catch(e=>setError(msg(e)))}>Обновить</Button>
    </Group>
    {error&&<Alert color="red" withCloseButton onClose={()=>setError('')}>{error}</Alert>}
    {notice&&<Alert color="teal" withCloseButton onClose={()=>setNotice('')}>{notice}</Alert>}
    <SimpleGrid cols={{base:1,md:2}} spacing="sm">
      <Card withBorder radius="md" p="md"><Stack gap="xs">
        <Group justify="space-between"><Text fw={600}>Подключение Cloudflare</Text>
          <Badge color={data.status.configured?'teal':'gray'} variant="light">{data.status.configured?'Подключено':'Не настроено'}</Badge></Group>
        <PasswordInput label="API Token" placeholder={data.status.configured?'Введите новый токен для замены':'Cloudflare API Token'}
          description="Нужны права Zone Read, DNS Read и DNS Edit для выбранных зон. Токен шифруется на сервере." value={token} onChange={e=>setToken(e.currentTarget.value)} autoComplete="off"/>
        <Group justify="space-between"><Text size="xs" c="dimmed">Источник: {data.status.source==='stored'?'зашифровано в БД':data.status.source==='environment'?'переменная окружения':'не задан'}</Text>
          <Button size="xs" disabled={!token.trim()} loading={busy} onClick={()=>void saveToken()}>Проверить и сохранить</Button></Group>
      </Stack></Card>
      <Card withBorder radius="md" p="md"><Stack gap="sm">
        <Group justify="space-between"><Text fw={600}>Настройка домена</Text><Badge variant="light">{data.zones.length} зон</Badge></Group>
        <Select searchable label="Домен Cloudflare" placeholder="Выберите зону" data={data.zones.map(z=>({value:z.name,label:z.name}))} value={zone} onChange={chooseZone}/>
        <TextInput label="Zone ID (редактируемый)" placeholder="32 символа" value={manualZoneId} onChange={e=>setManualZoneId(e.currentTarget.value)}
          description="При сохранении проверяется, что ID действительно принадлежит выбранному домену."/>
        <Switch label="Автоматически менять IP этой зоны после ротации" checked={autoSync} onChange={e=>setAutoSync(e.currentTarget.checked)}
          description="Дополнительно включается в действии «Сменить IP» автоматизации. Меняются только записи, связанные с хостами нужной ноды."/>
        <Group justify="end"><Button size="xs" disabled={!zone||!/^[0-9a-f]{32}$/i.test(manualZoneId)} loading={busy} onClick={()=>void saveZone()}>Сохранить настройки зоны</Button></Group>
        {binding&&<Text size="xs" c="dimmed">Сохранённая зона: {binding.zone_id}</Text>}
      </Stack></Card>
    </SimpleGrid>
    <SimpleGrid cols={{base:1,sm:3}} spacing="xs">
      <Card withBorder p="sm"><Text c="dimmed" size="xs">DNS-записей A / AAAA / CNAME</Text><Title order={3}>{data.records.length}</Title></Card>
      <Card withBorder p="sm"><Text c="dimmed" size="xs">Связаны с хостами</Text><Title order={3}>{data.records.filter(x=>x.linkedHosts.length).length}</Title></Card>
      <Card withBorder p="sm"><Text c="dimmed" size="xs">Зоны с автосинхронизацией</Text><Title order={3}>{data.bindings.filter(x=>x.auto_sync).length}</Title></Card>
    </SimpleGrid>
    <Card withBorder radius="md" p="sm"><Stack gap="sm">
      <Group justify="space-between"><Title order={4}>DNS-записи и связи</Title><TextInput size="xs" placeholder="Домен, IP, нода..." value={search} onChange={e=>setSearch(e.currentTarget.value)}/></Group>
      <Table.ScrollContainer minWidth={850}><Table highlightOnHover verticalSpacing="xs">
        <Table.Thead><Table.Tr><Table.Th>Домен / поддомен</Table.Th><Table.Th>Тип</Table.Th><Table.Th>Значение</Table.Th><Table.Th>Связанные хосты и ноды</Table.Th><Table.Th>Cloudflare</Table.Th><Table.Th/></Table.Tr></Table.Thead>
        <Table.Tbody>{rows.slice(0,350).map(r=><Table.Tr key={r.zoneId+':'+r.id}>
          <Table.Td><Text fw={600} size="sm">{r.name}</Text><Text c="dimmed" size="xs">{r.zoneName}</Text></Table.Td>
          <Table.Td><Badge size="sm" variant="light">{r.type}</Badge></Table.Td>
          <Table.Td><Text size="xs" ff="monospace">{r.content}</Text></Table.Td>
          <Table.Td>{r.linkedHosts.length?<Stack gap={2}>
            {[...new Map(r.linkedHosts.map(h=>[h.hostUuid+':'+h.nodeUuid,h])).values()].map(h=><Text key={h.hostUuid+':'+h.nodeUuid} size="xs">{h.hostName} · <Text span c="dimmed">{h.nodeName}</Text></Text>)}
          </Stack>:<Text size="xs" c="dimmed">Не привязан</Text>}</Table.Td>
          <Table.Td><Badge color={r.proxied?'orange':'gray'} variant="light">{r.proxied?'Proxy':'DNS only'}</Badge></Table.Td>
          <Table.Td><Group gap={4} wrap="nowrap">
            <Tooltip label="Привязать DNS-запись к хосту вручную"><Button variant="subtle" size="compact-xs" onClick={()=>{setLinkRecord(r);setNewHost(null)}}><TbLink size={15}/></Button></Tooltip>
            {['A','AAAA'].includes(r.type)&&r.linkedHosts.length>0&&
            <Tooltip label="Изменить только текущий IP этой DNS-записи">
              <Button variant="subtle" size="compact-xs" leftSection={<TbEdit size={14}/>} onClick={()=>{
                setEdit(r);setNodeUuid(r.linkedHosts[0]?.nodeUuid??null);setIp('')
              }}>IP</Button></Tooltip>}
            </Group></Table.Td>
        </Table.Tr>)}
          {!rows.length&&<Table.Tr><Table.Td colSpan={6}><Text ta="center" c="dimmed" py="md">{loading?'Загрузка DNS…':'Записей нет или токен не подключён'}</Text></Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table></Table.ScrollContainer>
      {rows.length>350&&<Text size="xs" c="dimmed">Показаны первые 350 записей. Сузьте поиск.</Text>}
    </Stack></Card>
    <Card withBorder radius="md" p="md"><Stack gap="xs"><Title order={4}>Журнал операций</Title>
      <Table.ScrollContainer minWidth={650}><Table verticalSpacing="xs"><Table.Thead><Table.Tr>
        <Table.Th>Дата</Table.Th><Table.Th>Домен</Table.Th><Table.Th>Изменение</Table.Th><Table.Th>Источник</Table.Th><Table.Th>Статус</Table.Th>
      </Table.Tr></Table.Thead><Table.Tbody>{history.slice(0,100).map(e=><Table.Tr key={e.id}>
        <Table.Td><Text size="xs">{new Date(e.created_at).toLocaleString('ru-RU')}</Text></Table.Td>
        <Table.Td><Text size="xs">{e.record_name}</Text></Table.Td>
        <Table.Td><Text ff="monospace" size="xs">{e.old_ip??'—'} → {e.new_ip??'—'}</Text></Table.Td>
        <Table.Td><Text size="xs">{e.source}</Text></Table.Td>
        <Table.Td><Tooltip label={e.message??''}><Badge color={e.status==='updated'?'teal':'red'}>{e.status}</Badge></Tooltip></Table.Td>
      </Table.Tr>)}
      {!history.length&&<Table.Tr><Table.Td colSpan={5}><Text size="sm" c="dimmed" ta="center" py="md">Операций пока не было</Text></Table.Td></Table.Tr>}
      </Table.Tbody></Table></Table.ScrollContainer>
    </Stack></Card>
    <Text size="xs" c="dimmed">Автозамена работает только для A-записей, чей старый IP совпадает с текущим значением Cloudflare, а имя домена связано с хостом указанной ноды. Поддерживаются цепочки CNAME. Вебхуки и API настраиваются отдельно.</Text>
    <Modal opened={!!linkRecord} onClose={()=>setLinkRecord(null)} title="Привязки DNS-записи к хостам" centered>
      {linkRecord&&<Stack gap="sm">
        <Text size="sm" fw={600}>{linkRecord.name}</Text>
        <Text size="xs" c="dimmed">Укажите хост Remnawave, если поле «Адрес» содержит IP и автоматическое сопоставление по домену невозможно. Для смены IP используются только связанные хосты.</Text>
        <Select searchable label="Добавить связь с хостом" placeholder="Найти хост по названию" value={newHost} onChange={setNewHost}
          data={hostOptions.map(h=>({value:h.uuid,label:h.remark+' · '+h.address}))}/>
        <Group justify="end"><Button size="xs" loading={busy} disabled={!newHost} onClick={()=>void linkHost()}>Связать с хостом</Button></Group>
        <Text size="sm" fw={600}>Явные привязки</Text>
        {explicitLinks.filter(x=>x.zone_id===linkRecord.zoneId&&x.record_id===linkRecord.id).map(item=>
          <Group justify="space-between" key={item.host_uuid}>
            <Text size="sm">{hostOptions.find(h=>h.uuid===item.host_uuid)?.remark??item.host_uuid}</Text>
            <Button size="compact-xs" variant="subtle" color="red" disabled={busy} onClick={()=>void unlinkHost(linkRecord,item.host_uuid)}><TbTrash size={15}/></Button>
          </Group>
        )}
        {!explicitLinks.some(x=>x.zone_id===linkRecord.zoneId&&x.record_id===linkRecord.id)&&
          <Text size="xs" c="dimmed">Явных привязок нет. Доменные связи определяются автоматически.</Text>}
      </Stack>}
    </Modal>
    <Modal opened={!!edit} onClose={()=>setEdit(null)} title="Замена IP в Cloudflare DNS" centered>
      <Stack gap="md">{edit&&<>
        <Alert color="yellow" title="Проверьте изменение">Управляющий запрос заменит только поле content одной записи. Если старый IP в Cloudflare уже изменился, операция не выполнится.</Alert>
        <Text size="sm">Домен: <b>{edit.name}</b> · {edit.type}</Text>
        <TextInput label="Текущий IP (ожидаемый)" readOnly value={edit.content}/>
        <Select searchable label="Нода" data={[...new Map(edit.linkedHosts.map(h=>[h.nodeUuid,{value:h.nodeUuid,label:h.nodeName}])).values()]}
          value={nodeUuid} onChange={setNodeUuid}/>
        <TextInput label="Новый IP" placeholder={edit.type==='A'?'IPv4':'IPv6'} value={ip} onChange={e=>setIp(e.currentTarget.value)}/>
        <Group justify="end"><Button variant="default" onClick={()=>setEdit(null)}>Отмена</Button>
          <Button loading={busy} disabled={!ip||!nodeUuid||ip===edit.content} onClick={()=>void replace()}>Изменить IP</Button></Group>
      </>}</Stack>
    </Modal>
  </Stack></Page>
}
