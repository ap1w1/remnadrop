import { ActionIcon, Accordion, Alert, Badge, Button, Card, Group, Select, SimpleGrid, Stack, Switch, Text, Textarea, TextInput } from '@mantine/core'
import { TbArrowDown, TbArrowUp, TbPlus, TbTrash } from 'react-icons/tb'
type Value=Record<string,unknown>
const obj=(value:unknown):Value=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Value:{}
const arr=(value:unknown):Value[]=>Array.isArray(value)?value.filter(x=>x&&typeof x==='object'&&!Array.isArray(x)):[]
const list=(value:unknown)=>Array.isArray(value)?value.filter(x=>typeof x==='string').join(', '):''
const split=(value:string)=>value.split(/[\n,]+/).map(x=>x.trim()).filter(Boolean)
const str=(v:unknown)=>typeof v==='string'?v:''
export function VisualRoutingFields({config,onChange}:{config:Value;onChange:(value:Value)=>void}) {
 const routing=obj(config.routing),rules=arr(routing.rules),balancers=arr(routing.balancers)
 const outbounds=arr(config.outbounds)
 const tags=outbounds.map(o=>str(o.tag)).filter(Boolean)
 const balancerTags=balancers.map(o=>str(o.tag)).filter(Boolean)
 const observatory=obj(config.observatory)
 const setRouting=(changes:Value)=>onChange({...config,routing:{...routing,...changes}})
 const setRules=(next:Value[])=>setRouting({rules:next})
 const setRule=(index:number,patch:Value)=>setRules(rules.map((rule,i)=>i===index?{...rule,...patch}:rule))
 const setBalancers=(next:Value[])=>setRouting({balancers:next})
 const setBalancer=(index:number,patch:Value)=>setBalancers(balancers.map((b,i)=>i===index?{...b,...patch}:b))
 const move=(index:number,delta:number)=>{
   const to=index+delta
   if(to<0||to>=rules.length)return
   const next=[...rules];[next[index],next[to]]=[next[to],next[index]]
   setRules(next)
 }
 const target=(rule:Value):'outbound'|'balancer'=>typeof rule.balancerTag==='string'?'balancer':'outbound'
 const setTarget=(index:number,kind:'outbound'|'balancer',tag:string)=>{
   const {outboundTag,balancerTag,...base}=rules[index]
   setRules(rules.map((rule,i)=>i===index?{...base,[kind==='balancer'?'balancerTag':'outboundTag']:tag}:rule))
 }
 const setObservatory=(patch:Value)=>onChange({...config,observatory:{...observatory,...patch}})
 return <Stack gap="lg">
  <Group justify="space-between" align="flex-end">
   <div><Text fw={700}>Маршрутизация Xray</Text><Text size="sm" c="dimmed">Первое совпадение выигрывает. Порядок правил можно изменить.</Text></div>
   <Button size="sm" variant="light" leftSection={<TbPlus size={16}/>}
    onClick={()=>setRules([...rules,{type:'field',outboundTag:tags[0]??'direct',domain:[]}])}>Правило</Button>
  </Group>
  <Select label="Стратегия доменов" allowDeselect={false} value={str(routing.domainStrategy)||'AsIs'}
   data={['AsIs','IPIfNonMatch','IPOnDemand'].map(value=>({value,label:value}))}
   onChange={value=>setRouting({domainStrategy:value??'AsIs'})}/>
  {rules.map((rule,index)=><Card withBorder p="md" radius="md" key={index}><Stack gap="sm">
   <Group justify="space-between"><Group gap="xs"><Badge variant="light">#{index+1}</Badge><Text fw={600}>{str(rule.ruleTag)||'Правило маршрутизации'}</Text></Group>
    <Group gap={4}>
     <ActionIcon variant="subtle" aria-label="Вверх" disabled={index===0} onClick={()=>move(index,-1)}><TbArrowUp size={16}/></ActionIcon>
     <ActionIcon variant="subtle" aria-label="Вниз" disabled={index===rules.length-1} onClick={()=>move(index,1)}><TbArrowDown size={16}/></ActionIcon>
     <ActionIcon color="red" variant="subtle" aria-label="Удалить правило" onClick={()=>setRules(rules.filter((_,i)=>i!==index))}><TbTrash size={16}/></ActionIcon>
    </Group>
   </Group>
   <SimpleGrid cols={{base:1,sm:2}}>
    <TextInput label="Rule Tag (имя правила)" value={str(rule.ruleTag)} placeholder="Например TORRENT_BY_DOMAIN"
     onChange={e=>setRule(index,{ruleTag:e.currentTarget.value})}/>
    <Select label="Направление" allowDeselect={false} value={target(rule)}
     data={[{value:'outbound',label:'Отдельный outbound'},{value:'balancer',label:'Балансировщик'}]}
     onChange={value=>setTarget(index,value==='balancer'?'balancer':'outbound',
       value==='balancer'?balancerTags[0]??'':tags[0]??'direct')}/>
    <Select label={target(rule)==='balancer'?'Balancer Tag':'Outbound Tag'}
     searchable clearable value={str(rule[target(rule)==='balancer'?'balancerTag':'outboundTag'])||null}
     data={(target(rule)==='balancer'?balancerTags:tags).map(value=>({value,label:value}))}
     onChange={value=>setTarget(index,target(rule),value??'')}/>
    <TextInput label="Порт / диапазоны" placeholder="443,80,6881-6889" value={str(rule.port)}
     onChange={e=>setRule(index,{port:e.currentTarget.value})}/>
    <Select label="Сеть" clearable value={str(rule.network)||null}
     data={[{value:'tcp',label:'TCP'},{value:'udp',label:'UDP'},{value:'tcp,udp',label:'TCP + UDP'}]}
     onChange={value=>setRule(index,{network:value??undefined})}/>
    <TextInput label="Source Port" value={str(rule.sourcePort)} placeholder="Необязательно"
     onChange={e=>setRule(index,{sourcePort:e.currentTarget.value})}/>
   </SimpleGrid>
   <Textarea autosize minRows={1} label="Домены и Geosite" description="geosite:youtube, domain:example.org, full:example.org"
    value={list(rule.domain)} onChange={e=>setRule(index,{domain:split(e.currentTarget.value)})}/>
   <Textarea autosize minRows={1} label="IP / GeoIP / CIDR" description="geoip:private, 192.0.2.0/24"
    value={list(rule.ip)} onChange={e=>setRule(index,{ip:split(e.currentTarget.value)})}/>
   <Accordion variant="contained" radius="md"><Accordion.Item value="extra"><Accordion.Control>Дополнительные условия</Accordion.Control>
    <Accordion.Panel><Stack gap="sm">
     <Textarea autosize minRows={1} label="Inbound Tags" value={list(rule.inboundTag)}
      onChange={e=>setRule(index,{inboundTag:split(e.currentTarget.value)})}/>
     <Textarea autosize minRows={1} label="Протоколы" description="Например: bittorrent" value={list(rule.protocol)}
      onChange={e=>setRule(index,{protocol:split(e.currentTarget.value)})}/>
     <Textarea autosize minRows={1} label="Пользователь / email" value={list(rule.user)}
      onChange={e=>setRule(index,{user:split(e.currentTarget.value)})}/>
     <Textarea autosize minRows={1} label="Source IP" value={list(rule.source)}
      onChange={e=>setRule(index,{source:split(e.currentTarget.value)})}/>
    </Stack></Accordion.Panel>
   </Accordion>
  </Stack></Card>)}
  {!rules.length&&<Text size="sm" c="dimmed">Правил пока нет. Добавьте первое правило.</Text>}
  <Group justify="space-between" align="flex-end">
   <div><Text fw={700}>Балансировщики</Text><Text size="sm" c="dimmed">Группы outbound, порядок и fallback. Используйте в правилах поле Balancer Tag.</Text></div>
   <Button size="sm" variant="light" leftSection={<TbPlus size={16}/>}
    onClick={()=>setBalancers([...balancers,{tag:'BALANCER-'+(balancers.length+1),selector:[tags[0]??'direct'],strategy:{type:'random'}}])}>Балансировщик</Button>
  </Group>
  {balancers.map((balancer,index)=><Card withBorder radius="md" p="md" key={index}><Stack gap="sm">
   <Group justify="space-between"><Text fw={600}>Балансировщик #{index+1}</Text>
    <ActionIcon color="red" variant="subtle" aria-label="Удалить балансировщик"
     onClick={()=>setBalancers(balancers.filter((_,i)=>i!==index))}><TbTrash size={16}/></ActionIcon></Group>
   <SimpleGrid cols={{base:1,sm:2}}>
    <TextInput label="Balancer Tag" value={str(balancer.tag)} onChange={e=>setBalancer(index,{tag:e.currentTarget.value})}/>
    <Select label="Стратегия" allowDeselect={false} value={str(obj(balancer.strategy).type)||'random'}
     data={[{value:'random',label:'Случайный'},{value:'roundRobin',label:'По очереди'},{value:'leastPing',label:'Минимальный пинг'},{value:'leastLoad',label:'Минимальная нагрузка'}]}
     onChange={value=>setBalancer(index,{strategy:{...obj(balancer.strategy),type:value??'random'}})}/>
    <Select label="Fallback outbound" clearable searchable value={str(balancer.fallbackTag)||null}
     data={tags.map(value=>({value,label:value}))} onChange={value=>setBalancer(index,{fallbackTag:value??undefined})}/>
   </SimpleGrid>
   <Textarea label="Selector — теги или префиксы outbound" autosize minRows={1}
    description="Через запятую, например USA-SPEED, NL-, FR-. Префиксы сопоставляются Xray."
    value={list(balancer.selector)} onChange={e=>setBalancer(index,{selector:split(e.currentTarget.value)})}/>
   {['leastPing','leastLoad'].includes(str(obj(balancer.strategy).type))&&<Alert color="yellow" variant="light">Для этого алгоритма нужен observatory / burstObservatory с настройками измерений ниже.</Alert>}
  </Stack></Card>)}
  <Accordion variant="contained"><Accordion.Item value="observatory"><Accordion.Control>Мониторинг для балансировщиков (observatory)</Accordion.Control>
   <Accordion.Panel><Stack gap="sm">
    <TextInput label="Probe URL" value={str(observatory.probeUrl)} placeholder="https://www.gstatic.com/generate_204"
     onChange={e=>setObservatory({probeUrl:e.currentTarget.value})}/>
    <SimpleGrid cols={{base:1,sm:2}}>
     <TextInput label="Probe Interval" placeholder="1m" value={str(observatory.probeInterval)}
      onChange={e=>setObservatory({probeInterval:e.currentTarget.value})}/>
     <Switch label="Параллельные проверки" checked={observatory.enableConcurrency===true}
      onChange={e=>setObservatory({enableConcurrency:e.currentTarget.checked})}/>
    </SimpleGrid>
    <Textarea label="Subject Selector" autosize minRows={1} value={list(observatory.subjectSelector)}
     onChange={e=>setObservatory({subjectSelector:split(e.currentTarget.value)})}/>
    <Text size="xs" c="dimmed">BurstObservatory и экспериментальные поля остаются в JSON без изменений.</Text>
   </Stack></Accordion.Panel></Accordion>
 </Stack>
}
