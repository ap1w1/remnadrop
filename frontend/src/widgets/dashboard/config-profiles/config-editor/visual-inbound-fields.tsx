import { Accordion, Alert, Checkbox, NumberInput, PasswordInput, Select, SimpleGrid, Stack, Switch, Text, TextInput, Textarea } from '@mantine/core'
import { CertificateDomainInput } from '@features/dashboard/config-profiles/certificate-expiry'

type Value=Record<string,unknown>
const obj=(v:unknown):Value=>v!==null && typeof v==='object' && !Array.isArray(v)?v as Value:{}
const arr=(v:unknown):Value[]=>Array.isArray(v)?v.filter(x=>x&&typeof x==='object'&&!Array.isArray(x)):[]
const list=(v:unknown)=>Array.isArray(v)?v.filter(x=>typeof x==='string').join(', '):''
const split=(v:string)=>v.split(/[\n,]+/).map(s=>s.trim()).filter(Boolean)
const value=(v:unknown)=>typeof v==='string'||typeof v==='number'?String(v):''

/** Lossless field editing: preserve every unedited Xray key, sibling and list element. */
export function VisualInboundFields({inbound,onChange}:{inbound:Value;onChange:(inbound:Value)=>void}) {
 const settings=obj(inbound.settings),stream=obj(inbound.streamSettings)
 const network=value(stream.network)||'raw',security=value(stream.security)||'none'
 const isHysteria=inbound.protocol==='hysteria'
 const update=(changes:Value)=>onChange({...inbound,...changes})
 const setSettings=(changes:Value)=>update({settings:{...settings,...changes}})
 const setStream=(changes:Value)=>update({streamSettings:{...stream,...changes}})
 const setNested=(key:string,changes:Value)=>setStream({[key]:{...obj(stream[key]),...changes}})
 const reality=obj(stream.realitySettings),tls=obj(stream.tlsSettings),sniff=obj(inbound.sniffing)
 const ws=obj(stream.wsSettings),sock=obj(stream.sockopt)
 const certs=arr(tls.certificates),cert=obj(certs[0])
 const mask=obj(stream.finalmask),udp=arr(mask.udp),salamander=udp.find(x=>x.type==='salamander')
 const salamanderSettings=obj(salamander?.settings)
 const hysteria=obj(stream.hysteriaSettings),masquerade=obj(hysteria.masquerade),quic=obj(mask.quicParams)
 const modifyCertificate=(patch:Value)=>setNested('tlsSettings',{certificates:[{...cert,...patch},...certs.slice(1)]})
 const modifySalamander=(enabled:boolean,patch:Value={})=>{
   const other=udp.filter(item=>item.type!=='salamander')
   const next=enabled?[{type:'salamander',settings:{...salamanderSettings,...patch}},...other]:other
   setStream({finalmask:{...mask,udp:next}})
 }
 const realityTargetKey=Object.hasOwn(reality,'target')?'target':'dest'
 return <Stack gap="md">
  <SimpleGrid cols={{base:1,sm:2}}>
   <Select label="Транспорт" searchable allowDeselect={false} value={network}
    data={['raw','tcp','ws','grpc','xhttp','httpupgrade','http','hysteria'].map(value=>({value,label:value==='raw'?'TCP (raw)':value}))}
    disabled={isHysteria}
    onChange={v=>setStream({network:v??'raw'})}/>
   <Select label="Безопасность" allowDeselect={false} value={security} disabled={isHysteria}
    data={[{value:'none',label:'Нет'},{value:'tls',label:'TLS'},{value:'reality',label:'REALITY'}]}
    onChange={v=>setStream({security:v??'none'})}/>
  </SimpleGrid>
  {isHysteria&&<Alert color="blue" variant="light">Hysteria2 использует UDP/QUIC и TLS. Для Salamander включите отдельную маскировку UDP ниже. На серверах с несколькими IP проверьте исходящий адрес UDP.</Alert>}
  {inbound.protocol==='vless'&&<Select label="VLESS: шифрование" allowDeselect={false}
   data={[{value:'none',label:'None (VLESS)'}]} value={value(settings.decryption)||'none'}
   onChange={v=>setSettings({decryption:v??'none'})}/>}
  {network==='ws'&&<>
   <SimpleGrid cols={{base:1,sm:2}}>
    <TextInput label="WebSocket path" value={value(ws.path)||'/'}
     onChange={e=>setNested('wsSettings',{path:e.currentTarget.value})}/>
    <CertificateDomainInput label="WebSocket Host" value={value(obj(ws.headers).Host)}
     onChange={e=>setNested('wsSettings',{headers:{...obj(ws.headers),Host:e.currentTarget.value}})}/>
   </SimpleGrid>
   <Switch label="Принимать PROXY Protocol внутри WebSocket" checked={ws.acceptProxyProtocol===true}
    onChange={e=>setNested('wsSettings',{acceptProxyProtocol:e.currentTarget.checked})}/>
  </>}
  {network==='xhttp'&&<SimpleGrid cols={{base:1,sm:2}}>
   <TextInput label="XHTTP path" value={value(obj(stream.xhttpSettings).path)||'/'}
    onChange={e=>setNested('xhttpSettings',{path:e.currentTarget.value})}/>
   <Select label="XHTTP mode" allowDeselect={false} value={value(obj(stream.xhttpSettings).mode)||'auto'}
    data={['auto','packet-up','stream-up','stream-one'].map(v=>({value:v,label:v}))}
    onChange={v=>setNested('xhttpSettings',{mode:v??'auto'})}/>
  </SimpleGrid>}
  {network==='grpc'&&<TextInput label="gRPC serviceName"
   value={value(obj(stream.grpcSettings).serviceName)}
   onChange={e=>setNested('grpcSettings',{serviceName:e.currentTarget.value})}/>}
  {network==='httpupgrade'&&<TextInput label="HTTPUpgrade path"
   value={value(obj(stream.httpupgradeSettings).path)||'/'}
   onChange={e=>setNested('httpupgradeSettings',{path:e.currentTarget.value})}/>}
  {security==='reality'&&<Accordion variant="contained" radius="md" defaultValue="reality"><Accordion.Item value="reality">
   <Accordion.Control>REALITY · параметры</Accordion.Control><Accordion.Panel><Stack gap="sm">
    <SimpleGrid cols={{base:1,sm:2}}>
     <CertificateDomainInput label="Target / Dest" placeholder="example.com:443" value={value(reality[realityTargetKey])}
      onChange={e=>setNested('realitySettings',{[realityTargetKey]:e.currentTarget.value})}/>
     <NumberInput label="Xver" min={0} max={2} allowDecimal={false} value={typeof reality.xver==='number'?reality.xver:0}
      onChange={v=>{if(typeof v==='number')setNested('realitySettings',{xver:v})}}/>
    </SimpleGrid>
    <CertificateDomainInput label="Server Names" description="Через запятую" value={list(reality.serverNames)}
     onChange={e=>setNested('realitySettings',{serverNames:split(e.currentTarget.value)})}/>
    <TextInput label="Short IDs" description="Через запятую" value={list(reality.shortIds)}
     onChange={e=>setNested('realitySettings',{shortIds:split(e.currentTarget.value)})}/>
    <PasswordInput label="Private Key" autoComplete="off" value={value(reality.privateKey)}
     onChange={e=>setNested('realitySettings',{privateKey:e.currentTarget.value})}/>
    <Switch label="Отладочный режим REALITY" checked={reality.show===true}
     onChange={e=>setNested('realitySettings',{show:e.currentTarget.checked})}/>
   </Stack></Accordion.Panel></Accordion.Item></Accordion>}
  {security==='tls'&&<Accordion variant="contained" radius="md" defaultValue="tls"><Accordion.Item value="tls">
   <Accordion.Control>TLS · сертификаты, SNI и ALPN</Accordion.Control><Accordion.Panel><Stack gap="sm">
    <SimpleGrid cols={{base:1,sm:2}}>
     <CertificateDomainInput label="SNI / ServerName" value={value(tls.serverName)}
      onChange={e=>setNested('tlsSettings',{serverName:e.currentTarget.value})}/>
     <Select label="Минимальная версия TLS" clearable data={['1.2','1.3'].map(v=>({value:v,label:'TLS '+v}))}
      value={value(tls.minVersion)||null} onChange={v=>setNested('tlsSettings',{minVersion:v??''})}/>
    </SimpleGrid>
    <TextInput label="ALPN" description="Например: h3, h2, http/1.1" value={list(tls.alpn)}
     onChange={e=>setNested('tlsSettings',{alpn:split(e.currentTarget.value)})}/>
    <CertificateDomainInput label="Путь к приватному ключу TLS" value={value(cert.keyFile)}
     placeholder="/etc/letsencrypt/live/example.com/privkey.pem"
     onChange={e=>modifyCertificate({keyFile:e.currentTarget.value})}/>
    <CertificateDomainInput label="Путь к сертификату TLS" value={value(cert.certificateFile)}
     placeholder="/etc/letsencrypt/live/example.com/fullchain.pem"
     onChange={e=>modifyCertificate({certificateFile:e.currentTarget.value})}/>
    {certs.length>1&&<Text size="xs" c="dimmed">Дополнительные сертификаты сохранены ({certs.length-1}); для редактирования используйте JSON.</Text>}
   </Stack></Accordion.Panel></Accordion.Item></Accordion>}
  {isHysteria&&<Accordion defaultValue="hysteria" radius="md" variant="contained"><Accordion.Item value="hysteria">
   <Accordion.Control>Hysteria2 · QUIC, Salamander и маскировка</Accordion.Control><Accordion.Panel><Stack gap="sm">
    <SimpleGrid cols={{base:1,sm:2}}>
     <NumberInput label="Hysteria версия" value={2} disabled/>
     <NumberInput label="UDP idle timeout, с" min={5} max={3600} allowDecimal={false}
      value={typeof hysteria.udpIdleTimeout==='number'?hysteria.udpIdleTimeout:60}
      onChange={v=>{if(typeof v==='number')setNested('hysteriaSettings',{udpIdleTimeout:v,version:2})}}/>
    </SimpleGrid>
    <Switch label="Включить Salamander (UDP finalmask)" checked={!!salamander}
     onChange={e=>modifySalamander(e.currentTarget.checked)}/>
    {!!salamander&&<>
     <PasswordInput label="Salamander password" autoComplete="new-password"
      value={value(salamanderSettings.password)}
      onChange={e=>modifySalamander(true,{password:e.currentTarget.value})}/>
     <TextInput label="Размер пакета UDP" placeholder="512-1200"
      value={value(salamanderSettings.packetSize)}
      onChange={e=>modifySalamander(true,{packetSize:e.currentTarget.value})}/>
    </>}
    <SimpleGrid cols={{base:1,sm:2}}>
     <Select label="QUIC Congestion" allowDeselect={false} value={value(quic.congestion)||'bbr'}
      data={['bbr','cubic','reno'].map(v=>({value:v,label:v}))}
      onChange={v=>setStream({finalmask:{...mask,quicParams:{...quic,congestion:v??'bbr'}}})}/>
     <NumberInput label="QUIC max idle timeout, с" min={0} max={3600} allowDecimal={false}
      value={typeof quic.maxIdleTimeout==='number'?quic.maxIdleTimeout:120}
      onChange={v=>{if(typeof v==='number')setStream({finalmask:{...mask,quicParams:{...quic,maxIdleTimeout:v}}})}}/>
     <NumberInput label="QUIC keepalive, с" min={0} max={3600} allowDecimal={false}
      value={typeof quic.keepAlivePeriod==='number'?quic.keepAlivePeriod:10}
      onChange={v=>{if(typeof v==='number')setStream({finalmask:{...mask,quicParams:{...quic,keepAlivePeriod:v}}})}}/>
    </SimpleGrid>
    <Switch label="QUIC debug" checked={quic.debug===true}
     onChange={e=>setStream({finalmask:{...mask,quicParams:{...quic,debug:e.currentTarget.checked}}})}/>
    <Select label="Masquerade mode" allowDeselect={false} value={value(masquerade.type)||'none'}
     data={[{value:'none',label:'Отключено'},{value:'proxy',label:'Proxy'},{value:'string',label:'Строка'}]}
     onChange={v=>setNested('hysteriaSettings',{masquerade:{...masquerade,type:v??'none'}})}/>
    {masquerade.type==='proxy'&&<TextInput label="Masquerade URL" value={value(masquerade.url)}
     onChange={e=>setNested('hysteriaSettings',{masquerade:{...masquerade,url:e.currentTarget.value}})}/>}
   </Stack></Accordion.Panel></Accordion.Item></Accordion>}
  <Accordion variant="contained" radius="md"><Accordion.Item value="advanced"><Accordion.Control>Sniffing и SOCKOPT</Accordion.Control>
   <Accordion.Panel><Stack gap="sm">
    <Checkbox label="Sniffing" checked={sniff.enabled===true}
     onChange={e=>update({sniffing:{...sniff,enabled:e.currentTarget.checked}})}/>
    <Checkbox label="Sniffing только для маршрутизации" checked={sniff.routeOnly===true}
     onChange={e=>update({sniffing:{...sniff,routeOnly:e.currentTarget.checked}})}/>
    <Textarea label="DestOverride" autosize minRows={1} value={list(sniff.destOverride)}
     onChange={e=>update({sniffing:{...sniff,destOverride:split(e.currentTarget.value)}})}/>
    <Switch label="SOCKOPT: acceptProxyProtocol" checked={sock.acceptProxyProtocol===true}
     onChange={e=>setNested('sockopt',{acceptProxyProtocol:e.currentTarget.checked})}/>
    <TextInput label="Trusted X-Forwarded-For" description="Имена доверенных заголовков через запятую"
     value={list(sock.trustedXForwardedFor)}
     onChange={e=>setNested('sockopt',{trustedXForwardedFor:split(e.currentTarget.value)})}/>
   </Stack></Accordion.Panel></Accordion.Item></Accordion>
 </Stack>
}
