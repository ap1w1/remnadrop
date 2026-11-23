import { ActionIcon, Alert, Badge, Button, Card, Group, NumberInput, PasswordInput, ScrollArea, Select, SimpleGrid, Stack, Switch, Tabs, Text, Textarea, TextInput, Title } from '@mantine/core'
import { useState } from 'react'
import { TbCopy, TbPlus, TbTrash } from 'react-icons/tb'
import { VisualInboundFields } from './visual-inbound-fields'
import { VisualOutboundFields, OUTBOUND_TEMPLATES, createOutboundTemplate } from './visual-outbound-fields'
import { VisualRoutingFields } from './visual-routing-fields'

type Value=Record<string,unknown>
type Props={config:Value;onChange:(next:Value)=>void}
const obj=(value:unknown):Value=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Value:{}
const items=(value:unknown):Value[]=>Array.isArray(value)?value.filter(x=>x&&typeof x==='object'&&!Array.isArray(x)):[]
const strings=(value:unknown)=>Array.isArray(value)?value.filter(x=>typeof x==='string').join(', '):''
const split=(value:string)=>value.split(/[\n,]+/).map(x=>x.trim()).filter(Boolean)
const text=(value:unknown)=>typeof value==='string'||typeof value==='number'?String(value):''
/** Apply edits to known keys only; everything else (including nested Xray extensions) survives. */
export function VisualConfigEditor({config,onChange}:Props){
 const inbounds=items(config.inbounds),outbounds=items(config.outbounds)
 const [outboundType,setOutboundType]=useState('freedom')
 const log=obj(config.log),dns=obj(config.dns)
 const logLevelKey=Object.hasOwn(log,'logLevel')?'logLevel':'loglevel'
 const setLog=(changes:Value)=>onChange({...config,log:{...log,...changes}})
 const setDns=(changes:Value)=>onChange({...config,dns:{...dns,...changes}})
 const patchInbound=(index:number,patch:Value)=>onChange({...config,inbounds:inbounds.map((item,i)=>i===index?{...item,...patch}:item)})
 const patchOutbound=(index:number,patch:Value)=>onChange({...config,outbounds:outbounds.map((item,i)=>i===index?{...item,...patch}:item)})
 const addInbound=(protocol:'vless'|'hysteria',salamander=false)=>{
   const num=inbounds.length+1
   const item:Value=protocol==='vless'
     ? {tag:'VLESS-'+num,listen:'0.0.0.0',port:443,protocol:'vless',
       settings:{clients:[],decryption:'none'},streamSettings:{network:'raw',security:'reality',realitySettings:{show:false,xver:0,target:'',privateKey:'',serverNames:[],shortIds:[]}}}
     : {tag:'HY2-'+num,listen:'0.0.0.0',port:443,protocol:'hysteria',
       settings:{clients:[],version:2},streamSettings:{network:'hysteria',security:'tls',
         tlsSettings:{alpn:['h3'],minVersion:'1.3',certificates:[]},hysteriaSettings:{version:2,udpIdleTimeout:60},
         ...(salamander?{finalmask:{udp:[{type:'salamander',settings:{password:'',packetSize:'512-1200'}}],quicParams:{debug:false,congestion:'bbr',maxIdleTimeout:120}}}:{})}}
   onChange({...config,inbounds:[...inbounds,item]})
 }
 return <ScrollArea style={{height:'100%',width:'100%'}} p="md">
  <Stack gap="lg">
   <div><Title order={4}>Визуальный редактор Xray</Title>
    <Text size="sm" c="dimmed">Полноценное управление inbound, outbound, логированием, DNS, маршрутизацией и балансировщиками. Редкие параметры доступны через JSON.</Text></div>
   <Alert color="blue" variant="light">Изменения сохраняются как исходный JSON без потери неизвестных полей. Серверная проверка Xray перед применением обязательна. Ключи и пароли не выводятся в подсказках.</Alert>
   <Tabs defaultValue="inbounds" keepMounted={false}>
    <Tabs.List mb="lg">
     <Tabs.Tab value="inbounds">Inbounds ({inbounds.length})</Tabs.Tab>
     <Tabs.Tab value="outbounds">Outbounds ({outbounds.length})</Tabs.Tab>
     <Tabs.Tab value="routing">Маршрутизация</Tabs.Tab>
     <Tabs.Tab value="general">Логи и DNS</Tabs.Tab>
    </Tabs.List>
    <Tabs.Panel value="inbounds"><Stack gap="md">
     <Group justify="space-between" gap="sm"><Text fw={700}>Входящие подключения</Text>
      <Group gap="xs"><Button size="sm" variant="light" leftSection={<TbPlus size={15}/>} onClick={()=>addInbound('vless')}>VLESS</Button>
       <Button size="sm" variant="light" onClick={()=>addInbound('hysteria')}>Hysteria2</Button>
       <Button size="sm" variant="light" onClick={()=>addInbound('hysteria',true)}>Hysteria2 + Salamander</Button></Group>
     </Group>
     {inbounds.map((inbound,index)=><Card key={index} withBorder radius="md" p="md">
      <Stack gap="sm"><Group justify="space-between"><Group gap="xs">
       <Text fw={650}>{text(inbound.tag)||'Inbound '+(index+1)}</Text>
       <Badge variant="light">{text(inbound.protocol)||'—'}</Badge></Group>
       <Group gap={4}><ActionIcon variant="subtle" aria-label="Клонировать inbound"
        onClick={()=>{const next=[...inbounds];next.splice(index+1,0,{...structuredClone(inbound),tag:text(inbound.tag)+'-copy'});onChange({...config,inbounds:next})}}><TbCopy size={16}/></ActionIcon>
        <ActionIcon variant="subtle" color="red" aria-label="Удалить inbound"
         onClick={()=>{if(window.confirm('Удалить inbound? Связанные ноды могут потерять доступ.'))onChange({...config,inbounds:inbounds.filter((_,i)=>i!==index)})}}><TbTrash size={16}/></ActionIcon></Group></Group>
       <SimpleGrid cols={{base:1,sm:2,lg:3}}>
        <TextInput label="Тег inbound" value={text(inbound.tag)} onChange={e=>patchInbound(index,{tag:e.currentTarget.value})}/>
        <TextInput label="Listen" value={text(inbound.listen)} onChange={e=>patchInbound(index,{listen:e.currentTarget.value})}/>
        <NumberInput label="Порт" min={1} max={65535} allowDecimal={false} value={typeof inbound.port==='number'?inbound.port:''}
         disabled={typeof inbound.port==='string'} onChange={v=>{if(typeof v==='number')patchInbound(index,{port:v})}}/>
       </SimpleGrid>
       <VisualInboundFields inbound={inbound} onChange={value=>patchInbound(index,value)}/>
      </Stack></Card>)}
     {!inbounds.length&&<Text c="dimmed" size="sm">Inbounds отсутствуют. Добавьте VLESS или Hysteria2.</Text>}
    </Stack></Tabs.Panel>
    <Tabs.Panel value="outbounds"><Stack gap="md">
     <Group align="flex-end" justify="space-between" wrap="wrap">
      <div><Text fw={700}>Исходящие подключения</Text><Text size="xs" c="dimmed">Freedom, BLOCK, локальные SOCKS/HTTP и VLESS на внешние серверы</Text></div>
      <Group gap="xs"><Select aria-label="Протокол нового outbound" value={outboundType} allowDeselect={false} w={230}
       data={OUTBOUND_TEMPLATES} onChange={v=>setOutboundType(v??'freedom')}/>
       <Button size="sm" leftSection={<TbPlus size={15}/>} onClick={()=>onChange({...config,outbounds:[...outbounds,createOutboundTemplate(outboundType,outbounds.length+1)]})}>Добавить outbound</Button></Group>
     </Group>
     {outbounds.map((outbound,index)=><Card withBorder radius="md" p="md" key={index}><Stack gap="sm">
       <Group justify="space-between"><Group gap="xs"><Text fw={650}>{text(outbound.tag)||'Outbound '+(index+1)}</Text><Badge variant="light">{text(outbound.protocol)}</Badge></Group>
        <Group gap={4}><ActionIcon variant="subtle" aria-label="Клонировать outbound" onClick={()=>{
         const next=[...outbounds];next.splice(index+1,0,{...structuredClone(outbound),tag:text(outbound.tag)+'-copy'});onChange({...config,outbounds:next})
        }}><TbCopy size={16}/></ActionIcon><ActionIcon color="red" variant="subtle" aria-label="Удалить outbound"
         onClick={()=>{if(window.confirm('Удалить outbound? Проверьте маршруты и балансировщики.'))onChange({...config,outbounds:outbounds.filter((_,i)=>i!==index)})}}><TbTrash size={16}/></ActionIcon></Group>
       </Group>
       <VisualOutboundFields outbound={outbound} onChange={value=>patchOutbound(index,value)}/>
     </Stack></Card>)}
    </Stack></Tabs.Panel>
    <Tabs.Panel value="routing"><VisualRoutingFields config={config} onChange={onChange}/></Tabs.Panel>
    <Tabs.Panel value="general"><Stack gap="md">
     <Card withBorder radius="md" p="md"><Stack gap="sm"><Text fw={650}>Логирование Xray</Text>
      <SimpleGrid cols={{base:1,sm:2}}>
       <TextInput label="Access log" placeholder="/var/log/remnanode/access.log" value={text(log.access)}
        onChange={e=>setLog({access:e.currentTarget.value})}/>
       <TextInput label="Error log" placeholder="/var/log/remnanode/error.log" value={text(log.error)}
        onChange={e=>setLog({error:e.currentTarget.value})}/>
       <Select label="Log Level" allowDeselect={false} value={text(log[logLevelKey])||'warning'}
        data={['debug','info','warning','error','none'].map(value=>({value,label:value}))}
        onChange={v=>setLog({[logLevelKey]:v??'warning'})}/>
       <Select label="Mask Address" allowDeselect={false} value={text(log.maskAddress)}
        data={[{value:'',label:'Без маскирования'},{value:'quarter',label:'Quarter'},{value:'half',label:'Half'},{value:'full',label:'Full'}]}
        onChange={v=>setLog({maskAddress:v??''})}/>
      </SimpleGrid>
      <Switch label="DNS Log" description="Записывать DNS-запросы в журнал Xray" checked={log.dnsLog===true}
       onChange={e=>setLog({dnsLog:e.currentTarget.checked})}/>
      <Text size="xs" c="dimmed">Ключ существующего файла остаётся loglevel или logLevel — как был в JSON. Новые поля не переименуют остальные свойства.</Text>
     </Stack></Card>
     <Card withBorder radius="md" p="md"><Stack gap="sm"><Text fw={650}>DNS Xray</Text>
      <Textarea label="DNS серверы" autosize minRows={2} value={Array.isArray(dns.servers)?dns.servers.map(server=>typeof server==='string'?server:JSON.stringify(server)).join('\n'):''}
       description="Каждый адрес на отдельной строке. Сложные серверы с JSON-объектами редактируйте в JSON режиме."
       onChange={e=>setDns({servers:e.currentTarget.value.split(/\n/).map(x=>x.trim()).filter(Boolean)})}/>
      <Select label="Query Strategy" allowDeselect={false} value={text(dns.queryStrategy)||'UseIP'}
       data={['UseIP','UseIPv4','UseIPv6'].map(value=>({value,label:value}))}
       onChange={v=>setDns({queryStrategy:v??'UseIP'})}/>
     </Stack></Card>
    </Stack></Tabs.Panel>
   </Tabs>
  </Stack>
 </ScrollArea>
}
