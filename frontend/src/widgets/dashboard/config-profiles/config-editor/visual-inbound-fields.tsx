import { Accordion, Alert, Checkbox, Group, NumberInput, PasswordInput, Select, SimpleGrid, Stack, Switch, Text, TextInput, Textarea } from '@mantine/core'

type Value=Record<string,unknown>
const obj=(v:unknown):Value=>v!==null && typeof v==='object' && !Array.isArray(v)?v as Value:{}
const list=(v:unknown)=>Array.isArray(v)?v.filter(item=>typeof item==='string').join(', '):''
const split=(v:string)=>v.split(/[\n,]+/).map(s=>s.trim()).filter(Boolean)

/** Edits only known paths and retains every unrelated Xray property. */
export function VisualInboundFields({inbound,onChange}:{inbound:Value;onChange:(inbound:Value)=>void}) {
 const settings=obj(inbound.settings),stream=obj(inbound.streamSettings)
 const network=String(stream.network??'tcp'),security=String(stream.security??'none')
 const update=(changes:Value)=>onChange({...inbound,...changes})
 const setSettings=(changes:Value)=>update({settings:{...settings,...changes}})
 const setStream=(changes:Value)=>update({streamSettings:{...stream,...changes}})
 const setNested=(key:string,changes:Value)=>setStream({[key]:{...obj(stream[key]),...changes}})
 const reality=obj(stream.realitySettings),tls=obj(stream.tlsSettings),sniff=obj(inbound.sniffing)
 return <Stack gap="sm">
  <SimpleGrid cols={{base:1,sm:2}}>
   <Select label="Транспорт" searchable allowDeselect={false} value={network}
    data={['tcp','ws','grpc','xhttp','httpupgrade','http'].map(value=>({value,label:value}))}
    onChange={value=>setStream({network:value??'tcp'})}/>
   <Select label="Безопасность" allowDeselect={false} value={security}
    data={[{value:'none',label:'Нет'},{value:'tls',label:'TLS'},{value:'reality',label:'REALITY'}]}
    onChange={value=>setStream({security:value??'none'})}/>
  </SimpleGrid>
  {inbound.protocol==='vless'&&<Select label="VLESS: шифрование" allowDeselect={false}
   data={[{value:'none',label:'None (VLESS)'}]} value={String(settings.decryption??'none')}
   onChange={value=>setSettings({decryption:value??'none'})}/>}
  {network==='ws'&&<SimpleGrid cols={{base:1,sm:2}}>
   <TextInput label="WebSocket path" value={String(obj(stream.wsSettings).path??'/')}
    onChange={e=>setNested('wsSettings',{path:e.currentTarget.value})}/>
   <TextInput label="WebSocket Host" value={String(obj(obj(stream.wsSettings).headers).Host??'')}
    onChange={e=>setNested('wsSettings',{headers:{...obj(obj(stream.wsSettings).headers),Host:e.currentTarget.value}})}/>
  </SimpleGrid>}
  {network==='xhttp'&&<SimpleGrid cols={{base:1,sm:2}}>
   <TextInput label="XHTTP path" value={String(obj(stream.xhttpSettings).path??'/')}
    onChange={e=>setNested('xhttpSettings',{path:e.currentTarget.value})}/>
   <Select label="XHTTP mode" allowDeselect={false} value={String(obj(stream.xhttpSettings).mode??'auto')}
    data={['auto','packet-up','stream-up','stream-one'].map(value=>({value,label:value}))}
    onChange={value=>setNested('xhttpSettings',{mode:value??'auto'})}/>
  </SimpleGrid>}
  {network==='grpc'&&<TextInput label="gRPC serviceName"
   value={String(obj(stream.grpcSettings).serviceName??'')}
   onChange={e=>setNested('grpcSettings',{serviceName:e.currentTarget.value})}/>}
  {network==='httpupgrade'&&<TextInput label="HTTPUpgrade path"
   value={String(obj(stream.httpupgradeSettings).path??'/')}
   onChange={e=>setNested('httpupgradeSettings',{path:e.currentTarget.value})}/>}
  {security==='reality'&&<Accordion variant="contained" radius="md" defaultValue="reality"><Accordion.Item value="reality">
   <Accordion.Control>REALITY · параметры</Accordion.Control><Accordion.Panel><Stack gap="sm">
    <SimpleGrid cols={{base:1,sm:2}}>
     <TextInput label="Dest" placeholder="example.com:443" value={String(reality.dest??'')}
      onChange={e=>setNested('realitySettings',{dest:e.currentTarget.value})}/>
     <NumberInput label="Xver" min={0} max={2} allowDecimal={false} value={typeof reality.xver==='number'?reality.xver:0}
      onChange={value=>{if(typeof value==='number')setNested('realitySettings',{xver:value})}}/>
    </SimpleGrid>
    <TextInput label="Server Names" description="Через запятую" value={list(reality.serverNames)}
     onChange={e=>setNested('realitySettings',{serverNames:split(e.currentTarget.value)})}/>
    <TextInput label="Short IDs" description="Через запятую; пустой shortId тоже разрешён через JSON"
     value={list(reality.shortIds)} onChange={e=>setNested('realitySettings',{shortIds:split(e.currentTarget.value)})}/>
    <PasswordInput label="Private Key" autoComplete="off" value={String(reality.privateKey??'')}
     onChange={e=>setNested('realitySettings',{privateKey:e.currentTarget.value})}/>
    <Switch label="Показывать отладочную информацию" checked={reality.show===true}
     onChange={e=>setNested('realitySettings',{show:e.currentTarget.checked})}/>
   </Stack></Accordion.Panel></Accordion.Item></Accordion>}
  {security==='tls'&&<Accordion variant="contained" radius="md" defaultValue="tls"><Accordion.Item value="tls">
   <Accordion.Control>TLS · параметры</Accordion.Control><Accordion.Panel><Stack gap="sm">
    <TextInput label="SNI / ServerName" value={String(tls.serverName??'')}
     onChange={e=>setNested('tlsSettings',{serverName:e.currentTarget.value})}/>
    <TextInput label="ALPN" description="Через запятую" value={list(tls.alpn)}
     onChange={e=>setNested('tlsSettings',{alpn:split(e.currentTarget.value)})}/>
    <Alert color="blue">Пути к сертификатам и дополнительные расширения TLS редактируются в JSON. Настройки сохраняются.</Alert>
   </Stack></Accordion.Panel></Accordion.Item></Accordion>}
  <Accordion variant="contained" radius="md"><Accordion.Item value="advanced"><Accordion.Control>Sniffing и расширенные настройки</Accordion.Control>
   <Accordion.Panel><Stack gap="sm">
    <Checkbox label="Определять протокол соединения (sniffing)" checked={sniff.enabled===true}
     onChange={e=>update({sniffing:{...sniff,enabled:e.currentTarget.checked}})}/>
    <Textarea label="DestOverride" description="Например: http, tls, quic" autosize minRows={1}
     value={list(sniff.destOverride)} onChange={e=>update({sniffing:{...sniff,destOverride:split(e.currentTarget.value)}})}/>
    <Text size="xs" c="dimmed">Дополнительные поля Xray, fallback, mux и экспериментальные параметры остаются в исходном JSON.</Text>
   </Stack></Accordion.Panel></Accordion.Item></Accordion>
 </Stack>
}
