import { ActionIcon, Accordion, Button, Card, Group, Select, SimpleGrid, Stack, Text, Textarea, TextInput } from '@mantine/core'
import { TbPlus, TbTrash } from 'react-icons/tb'
type Value=Record<string,unknown>
const obj=(value:unknown):Value=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Value:{}
const values=(value:unknown)=>Array.isArray(value)?value.filter(x=>typeof x==='string').join(', '):''
const parse=(value:string)=>value.split(/[\n,]+/).map(x=>x.trim()).filter(Boolean)
export function VisualRoutingFields({config,onChange}:{config:Value;onChange:(value:Value)=>void}) {
 const routing=obj(config.routing)
 const rules=Array.isArray(routing.rules)?routing.rules.map(x=>obj(x)):[]
 const outbounds=Array.isArray(config.outbounds)?config.outbounds.map(x=>obj(x)):[]
 const tags=outbounds.map(item=>item.tag).filter((item):item is string=>typeof item==='string')
 const setRules=(next:Value[])=>onChange({...config,routing:{...routing,rules:next}})
 const setRule=(index:number,changes:Value)=>setRules(rules.map((rule,i)=>i===index?{...rule,...changes}:rule))
 return <Stack gap="md">
  <Group justify="space-between">
   <div><Text fw={700}>Маршрутизация Xray</Text><Text size="xs" c="dimmed">Правила сохраняются в routing.rules без изменения других секций JSON</Text></div>
   <Button size="sm" variant="light" leftSection={<TbPlus size={16}/>}
    onClick={()=>setRules([...rules,{type:'field',outboundTag:tags[0]??'direct',domain:[]}])}>Добавить правило</Button>
  </Group>
  <Select label="Domain Strategy" allowDeselect={false} value={String(routing.domainStrategy??'AsIs')}
   data={['AsIs','IPIfNonMatch','IPOnDemand'].map(value=>({value,label:value}))}
   onChange={value=>onChange({...config,routing:{...routing,domainStrategy:value??'AsIs'}})}/>
  {rules.map((rule,index)=><Card withBorder p="md" radius="md" key={index}>
   <Stack gap="sm">
    <Group justify="space-between"><Text fw={650} size="sm">Правило {index+1}</Text>
     <ActionIcon color="red" variant="subtle" aria-label={'Удалить правило '+(index+1)}
      onClick={()=>setRules(rules.filter((_,i)=>i!==index))}><TbTrash size={17}/></ActionIcon>
    </Group>
    <SimpleGrid cols={{base:1,sm:2}}>
     <Select label="Outbound Tag" searchable clearable value={typeof rule.outboundTag==='string'?rule.outboundTag:null}
      data={tags.map(value=>({value,label:value}))} onChange={value=>setRule(index,{outboundTag:value??''})}/>
     <TextInput label="Порт или диапазон" placeholder="443, 80, 1000-2000" value={String(rule.port??'')}
      onChange={e=>setRule(index,{port:e.currentTarget.value})}/>
    </SimpleGrid>
    <Textarea autosize minRows={1} label="Домены" description="Через запятую или с новой строки: geosite:youtube, domain:example.org"
     value={values(rule.domain)} onChange={e=>setRule(index,{domain:parse(e.currentTarget.value)})}/>
    <Textarea autosize minRows={1} label="IP / GeoIP" description="geoip:ru, 1.2.3.4/32"
     value={values(rule.ip)} onChange={e=>setRule(index,{ip:parse(e.currentTarget.value)})}/>
    <Textarea autosize minRows={1} label="Inbound Tag" description="Опционально, можно несколько"
     value={values(rule.inboundTag)} onChange={e=>setRule(index,{inboundTag:parse(e.currentTarget.value)})}/>
    <Text size="xs" c="dimmed">Прочие свойства правила, включая network, protocol, attrs, balancerTag, сохраняются как есть.</Text>
   </Stack>
  </Card>)}
  {!rules.length&&<Text size="sm" c="dimmed">Правила маршрутизации отсутствуют. Весь остальной JSON сохраняется.</Text>}
 </Stack>
}
