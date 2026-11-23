import { Accordion, Alert, Button, Group, NumberInput, PasswordInput, Select, SimpleGrid, Stack, Switch, Text, TextInput } from '@mantine/core'
import { CertificateDomainInput } from '@features/dashboard/config-profiles/certificate-expiry'
import { useMemo } from 'react'

type Value=Record<string,unknown>
const obj=(value:unknown):Value=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Value:{}
const array=(value:unknown):Value[]=>Array.isArray(value)?value.filter(v=>v&&typeof v==='object'&&!Array.isArray(v)):[]
const asText=(value:unknown)=>typeof value==='string'||typeof value==='number'?String(value):''
const editFirst=(value:unknown,patch:Value)=>{const current=array(value),head=obj(current[0]);return [{...head,...patch},...current.slice(1)]}
export const OUTBOUND_TEMPLATES=[
    {value:'freedom',label:'Прямое соединение (Freedom)'},
    {value:'blackhole',label:'Блокировать (Blackhole)'},
    {value:'socks',label:'SOCKS5-прокси'},
    {value:'http',label:'HTTP-прокси'},
    {value:'vless',label:'VLESS-клиент / Reality / TLS'}
]
export function createOutboundTemplate(protocol:string,number:number):Value{
 const tag=protocol.toUpperCase()+'-'+number
 if(protocol==='freedom')return {tag,protocol,settings:{domainStrategy:'UseIPv4'}}
 if(protocol==='blackhole')return {tag,protocol}
 if(protocol==='socks'||protocol==='http')return {tag,protocol,settings:{address:'127.0.0.1',port:1080}}
 if(protocol==='vless')return {tag,protocol,settings:{vnext:[{address:'example.com',port:443,users:[{id:'',encryption:'none'}]}]},
   streamSettings:{network:'raw',security:'reality',realitySettings:{serverName:'',shortId:'',fingerprint:'chrome',publicKey:'',spiderX:'/'}}}
 return {tag,protocol}
}
export function VisualOutboundFields({outbound,onChange}:{outbound:Value;onChange:(v:Value)=>void}){
 const settings=obj(outbound.settings),stream=obj(outbound.streamSettings),sock=obj(stream.sockopt)
 const vnext=array(settings.vnext),remote=obj(vnext[0]),users=array(remote.users),user=obj(users[0])
 const reality=obj(stream.realitySettings),tls=obj(stream.tlsSettings)
 const protocol=String(outbound.protocol??'')
 const setSettings=(changes:Value)=>onChange({...outbound,settings:{...settings,...changes}})
 const setStream=(changes:Value)=>onChange({...outbound,streamSettings:{...stream,...changes}})
 const setRemote=(changes:Value)=>setSettings({vnext:editFirst(settings.vnext,changes)})
 const setUser=(changes:Value)=>setRemote({users:editFirst(remote.users,changes)})
 const setReality=(changes:Value)=>setStream({realitySettings:{...reality,...changes}})
 const setSock=(changes:Value)=>setStream({sockopt:{...sock,...changes}})
 const publicKeyName=Object.hasOwn(reality,'password')?'password':Object.hasOwn(reality,'publicKey')?'publicKey':'publicKey'
 const data=useMemo(()=>[{value:'raw',label:'TCP / RAW'},{value:'ws',label:'WebSocket'},{value:'xhttp',label:'XHTTP'},
   {value:'grpc',label:'gRPC'},{value:'httpupgrade',label:'HTTPUpgrade'}],[])
 return <Accordion variant="contained" radius="md">
  <Accordion.Item value="configure"><Accordion.Control>Параметры подключения</Accordion.Control>
   <Accordion.Panel><Stack gap="sm">
    <TextInput label="Tag" value={asText(outbound.tag)} onChange={event=>onChange({...outbound,tag:event.currentTarget.value})}/>
    {protocol==='freedom'&&<>
     <Select label="Domain Strategy" allowDeselect={false} value={asText(settings.domainStrategy)||'UseIPv4'}
      data={['AsIs','UseIP','UseIPv4','UseIPv6'].map(v=>({value:v,label:v}))}
      onChange={value=>setSettings({domainStrategy:value??'UseIPv4'})}/>
     <TextInput label="Исходный IP (sendThrough)" value={asText(outbound.sendThrough)}
      placeholder="Не указывать — выбрать автоматически" onChange={event=>onChange({...outbound,sendThrough:event.currentTarget.value})}/>
    </>}
    {(protocol==='socks'||protocol==='http')&&<SimpleGrid cols={{base:1,sm:2}}>
     <CertificateDomainInput label="Адрес прокси" value={asText(settings.address)} onChange={event=>setSettings({address:event.currentTarget.value})}/>
     <NumberInput label="Порт прокси" min={1} max={65535} allowDecimal={false}
      value={typeof settings.port==='number'?settings.port:1080}
      onChange={value=>{if(typeof value==='number')setSettings({port:value})}}/>
    </SimpleGrid>}
    {protocol==='vless'&&<>
     <SimpleGrid cols={{base:1,sm:2}}>
      <CertificateDomainInput label="VLESS сервер / IP" value={asText(remote.address)}
       onChange={event=>setRemote({address:event.currentTarget.value})}/>
      <NumberInput label="Порт удалённого сервера" min={1} max={65535} allowDecimal={false}
       value={typeof remote.port==='number'?remote.port:443}
       onChange={value=>{if(typeof value==='number')setRemote({port:value})}}/>
     </SimpleGrid>
     <PasswordInput label="UUID VLESS-клиента" value={asText(user.id)} autoComplete="off"
      onChange={event=>setUser({id:event.currentTarget.value})}/>
     <SimpleGrid cols={{base:1,sm:2}}>
      <Select label="Поток VLESS" allowDeselect={false} data={[{value:'',label:'Без flow'}, {value:'xtls-rprx-vision',label:'XTLS Vision'}]}
       value={asText(user.flow)} onChange={value=>setUser({flow:value??''})}/>
      <Select label="Транспорт" allowDeselect={false} value={asText(stream.network)||'raw'}
       data={data} onChange={value=>setStream({network:value??'raw'})}/>
      <Select label="Защита" allowDeselect={false} value={asText(stream.security)||'none'}
       data={['none','tls','reality'].map(value=>({value,label:value.toUpperCase()}))}
       onChange={value=>setStream({security:value??'none'})}/>
     </SimpleGrid>
     {stream.network==='ws'&&<TextInput label="WebSocket path"
      value={asText(obj(stream.wsSettings).path)}
      onChange={event=>setStream({wsSettings:{...obj(stream.wsSettings),path:event.currentTarget.value}})}/>}
     {stream.network==='xhttp'&&<TextInput label="XHTTP path"
      value={asText(obj(stream.xhttpSettings).path)}
      onChange={event=>setStream({xhttpSettings:{...obj(stream.xhttpSettings),path:event.currentTarget.value}})}/>}
     {stream.security==='reality'&&<Stack gap="sm">
      <CertificateDomainInput label="REALITY SNI" value={asText(reality.serverName)} onChange={event=>setReality({serverName:event.currentTarget.value})}/>
      <PasswordInput label="REALITY Public Key / Password" value={asText(reality[publicKeyName])}
       autoComplete="off" onChange={event=>setReality({[publicKeyName]:event.currentTarget.value})}/>
      <SimpleGrid cols={{base:1,sm:2}}>
       <TextInput label="Short ID" value={asText(reality.shortId)} onChange={event=>setReality({shortId:event.currentTarget.value})}/>
       <Select label="Fingerprint" allowDeselect={false} value={asText(reality.fingerprint)||'chrome'}
        data={['chrome','firefox','safari','ios','edge','random'].map(value=>({value,label:value}))}
        onChange={value=>setReality({fingerprint:value??'chrome'})}/>
      </SimpleGrid>
     </Stack>}
     {stream.security==='tls'&&<CertificateDomainInput label="TLS ServerName" value={asText(tls.serverName)}
      onChange={event=>setStream({tlsSettings:{...tls,serverName:event.currentTarget.value}})}/>}
    </>}
    {protocol==='blackhole'&&<Text size="sm" c="dimmed">Исходящее направление BLOCK: соединение отклоняется, дополнительные параметры не требуются.</Text>}
    {protocol!=='blackhole'&&<TextInput label="Сетевой интерфейс (WARP, eth0…)"
     value={asText(sock.interface)} onChange={event=>setSock({interface:event.currentTarget.value})}/>}
    {protocol==='vless'&&<Alert color="blue" variant="light">В VLESS outbound можно редактировать первый сервер и первую учётную запись. Остальные адреса, пользователи и расширенные поля сохраняются в исходном JSON.</Alert>}
   </Stack></Accordion.Panel>
  </Accordion.Item>
 </Accordion>
}
