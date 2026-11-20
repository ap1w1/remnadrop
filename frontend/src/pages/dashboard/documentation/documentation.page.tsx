import { Accordion, Badge, Button, Card, CopyButton, Divider, Group, SegmentedControl, Select, SimpleGrid, Stack, Tabs, Text, TextInput, Title, Tooltip } from '@mantine/core'
import { CodeHighlight } from '@mantine/code-highlight'
import { useMemo, useState } from 'react'
import { TbBook2, TbCheck, TbCode, TbCopy, TbSearch, TbWebhook } from 'react-icons/tb'
import { Page } from '@shared/ui'
import catalog from './catalog.generated.json'

type ApiEndpoint={method:string;path:string;summary:string;category:string;origin:string}
const methods=['ALL','GET','POST','PUT','PATCH','DELETE'] as const
const colors:Record<string,string>={GET:'teal',POST:'blue',PUT:'orange',PATCH:'yellow',DELETE:'red'}
const sampleWebhook={
  scope:'node',event:'node.connection_lost',timestamp:'2026-11-20T12:00:00.000Z',
  data:{uuid:'00000000-0000-0000-0000-000000000000',name:'Example node'},meta:{}
}
const sampleQuota={id:'00000000-0000-0000-0000-000000000000',event:'LOCATION_TRAFFIC_EXHAUSTED',
  occurredAt:'2026-11-20T12:00:00.000Z',data:{user:{uuid:'user-uuid'},location:{uuid:'node-uuid',nodeUuids:['node-uuid']},traffic:{usedBytes:'104857600',limitBytes:'104857600',remainingBytes:'0'}}}
const sampleMetric={id:'00000000-0000-0000-0000-000000000000',event:'NODE_METRIC_THRESHOLD',occurredAt:'2026-11-20T12:00:00.000Z',data:{nodeUuid:'node-uuid',metric:'online_drop',value:45,threshold:30}}
const sampleAutomation={event:'NODE_AUTOMATION_TRIGGERED',nodeUuid:'node-uuid',ruleId:'rule-uuid',executionId:'execution-uuid'}
const infoFor=(event:string)=>event.startsWith('LOCATION_')?'Квота трафика по подписке и ноде':event.startsWith('NODE_METRIC_')?'Детектор мониторинга':event==='NODE_AUTOMATION_TRIGGERED'?'Автоматизация ноды':'Стандартный вебхук Remnawave'
const webhookSample=(event:string)=>event.startsWith('LOCATION_')?{...sampleQuota,event}:event.startsWith('NODE_METRIC_')?{...sampleMetric,event}:event==='NODE_AUTOMATION_TRIGGERED'?sampleAutomation:{...sampleWebhook,event,scope:event.split('.')[0]}
function CopyValue({value,label}:{value:string;label?:string}){return <CopyButton value={value}>{({copied,copy})=><Tooltip label={copied?'Скопировано':'Копировать'}><Button size="compact-xs" variant="subtle" color={copied?'teal':'gray'} leftSection={copied?<TbCheck size={13}/>:<TbCopy size={13}/>} onClick={copy}>{label??'Копировать'}</Button></Tooltip>}</CopyButton>}
export function DocumentationPage(){
  const [search,setSearch]=useState(''),[method,setMethod]=useState<string>('ALL'),[category,setCategory]=useState<string|null>('all'),[webhookQuery,setWebhookQuery]=useState('')
  const endpoints=catalog.endpoints as ApiEndpoint[]
  const categories=useMemo(()=>[...new Set(endpoints.map(e=>e.category))].sort(),[endpoints])
  const visible=useMemo(()=>endpoints.filter(e=>(method==='ALL'||e.method===method)&&(category==='all'||e.category===category)&&`${e.method} ${e.path} ${e.summary} ${e.category}`.toLowerCase().includes(search.toLowerCase())),[endpoints,method,category,search])
  const hooks=catalog.webhooks.filter(s=>s.toLowerCase().includes(webhookQuery.toLowerCase()))
  return <Page title="Документация"><Stack gap="lg">
    <Group align="center" gap="sm"><TbBook2 size={30} color="var(--mantine-primary-color-filled)"/><div><Title order={2}>Документация API</Title><Text c="dimmed" size="sm">Маршруты форка, методы запросов и исходящие вебхуки</Text></div></Group>
    <SimpleGrid cols={{base:1,sm:3}} spacing="md"><Card withBorder radius="md" p="md"><Text c="dimmed" size="sm">Маршруты API</Text><Title order={2}>{endpoints.length}</Title></Card><Card withBorder radius="md" p="md"><Text c="dimmed" size="sm">Группы методов</Text><Title order={2}>{categories.length}</Title></Card><Card withBorder radius="md" p="md"><Text c="dimmed" size="sm">Исходящие события</Text><Title order={2}>{catalog.webhooks.length}</Title></Card></SimpleGrid>
    <Tabs defaultValue="api" variant="outline" keepMounted={false}><Tabs.List><Tabs.Tab value="api" leftSection={<TbCode size={16}/>}>API-запросы</Tabs.Tab><Tabs.Tab value="webhooks" leftSection={<TbWebhook size={16}/>}>Вебхуки</Tabs.Tab></Tabs.List>
    <Tabs.Panel value="api" pt="lg"><Stack gap="md">
       <Text size="sm" c="dimmed">Список сформирован из контрактов и контроллеров именно этого форка. Для точных DTO, параметров, кодов ответов и полных схем откройте штатный Swagger/Scalar, если он включён через IS_DOCS_ENABLED. Авторизация зависит от метода (JWT, API-токен, публичный доступ).</Text>
       <SimpleGrid cols={{base:1,md:2}}><TextInput leftSection={<TbSearch size={16}/>} label="Поиск по API" placeholder="Путь, метод или описание" value={search} onChange={e=>setSearch(e.currentTarget.value)}/><Select label="Раздел" searchable clearable={false} value={category} onChange={setCategory} data={[{value:'all',label:'Все разделы'},...categories.map(c=>({value:c,label:c}))]}/></SimpleGrid>
       <Group justify="space-between" wrap="wrap"><SegmentedControl size="xs" data={methods.map(m=>({value:m,label:m==='ALL'?'Все':m}))} value={method} onChange={setMethod}/><Text size="sm" c="dimmed">Найдено: {visible.length}</Text></Group>
       <Accordion variant="separated" radius="md" multiple>{visible.map((e,i)=><Accordion.Item key={`${e.method}-${e.path}-${i}`} value={`${e.method}-${e.path}-${i}`}>
           <Accordion.Control><Group wrap="nowrap" gap="sm"><Badge color={colors[e.method]??'gray'} variant="light" miw={60}>{e.method}</Badge><Stack gap={2} style={{minWidth:0}}><Text size="sm" fw={600} ff="monospace" style={{overflowWrap:'anywhere'}}>{e.path}</Text><Text size="xs" c="dimmed">{e.summary}</Text></Stack></Group></Accordion.Control>
           <Accordion.Panel><Stack gap="xs"><Group justify="space-between"><Badge variant="outline">{e.category}</Badge><CopyValue value={e.path}/></Group><Text size="sm" c="dimmed">Пример HTTP-запроса (параметры пути замените на реальные значения):</Text>
            <CodeHighlight language="bash" code={`curl -X ${e.method} "https://YOUR_PANEL${e.path}" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"`}/><Text size="xs" c="dimmed">Для методов с телом требуется JSON по DTO контракта; здесь не выполняются запросы и не раскрываются ключи.</Text></Stack></Accordion.Panel>
       </Accordion.Item>)}</Accordion>
       {!visible.length&&<Card withBorder radius="md" p="xl"><Text c="dimmed" ta="center">Совпадений нет. Измените фильтры.</Text></Card>}
    </Stack></Tabs.Panel>
    <Tabs.Panel value="webhooks" pt="lg"><Stack gap="md"><Text size="sm" c="dimmed">События вебхуков взяты из констант Remnawave и дополнительных обработчиков форка. Список отражает типы событий, а не гарантию доставки: часть событий требует включённых уведомлений, URL и секрета. Приведённые JSON-объекты — сокращённые примеры структуры.</Text>
      <TextInput leftSection={<TbSearch size={16}/>} label="Поиск по событиям" placeholder="user.*, node.*, LOCATION_..." value={webhookQuery} onChange={e=>setWebhookQuery(e.currentTarget.value)}/>
      <Accordion variant="separated" radius="md" multiple>{hooks.map((name,i)=><Accordion.Item key={name} value={`${name}-${i}`}><Accordion.Control><Group gap="sm" wrap="nowrap"><Badge color="violet" variant="light">EVENT</Badge><Stack gap={2}><Text ff="monospace" size="sm" fw={600}>{name}</Text><Text size="xs" c="dimmed">{infoFor(name)}</Text></Stack></Group></Accordion.Control><Accordion.Panel><Stack><Group justify="space-between"><Text size="sm">Пример JSON</Text><CopyValue value={JSON.stringify(webhookSample(name),null,2)}/></Group><CodeHighlight language="json" code={JSON.stringify(webhookSample(name),null,2)}/><Divider/><Text size="xs" c="dimmed">Стандартные события используют поля scope/event/timestamp/data/meta; служебные события мониторинга и автоматизаций имеют собственный формат. Поля зависят от типа события.</Text></Stack></Accordion.Panel></Accordion.Item>)}</Accordion>
    </Stack></Tabs.Panel></Tabs>
  </Stack></Page>
}
