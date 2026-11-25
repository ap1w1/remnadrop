import { Alert, Badge, Button, Card, Group, Menu, MultiSelect, Progress, Select, Stack, Text, TextInput } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import { instance } from '@shared/api/axios'
import { queryClient } from '@shared/api'
import { usersQueryKeys } from '@shared/api/hooks'
import { nodeOptionLabel, type NodeOptionData } from '@shared/utils/misc/node-option-label'

type QuotaGroup={id:string;name:string;node_uuids:string[];limit_bytes:string;used_bytes:string;blocked:boolean;threshold_percent:number}
const gib=1073741824n
const mib=1048576n
function bytesLabel(raw:string){
    const value=BigInt(raw)
    const units=['Б','КиБ','МиБ','ГиБ','ТиБ']
    let divisor=1n,unit=0
    while(unit<units.length-1&&value>=divisor*1024n){divisor*=1024n;unit++}
    const displayed=Number((value*100n+divisor/2n)/divisor)/100
    return displayed.toLocaleString('ru-RU',{maximumFractionDigits:2})+' '+units[unit]
}
function inputFor(raw:string|null):{value:string;unit:string}{
    if(raw===null)return {value:'',unit:'gib'}
    const bytes=BigInt(raw)
    for(const [unit,scale] of [['gib',gib],['mib',mib]] as const){
        const thousandths=bytes*1000n/scale
        if(thousandths*scale/1000n===bytes){
            const fraction=(thousandths%1000n).toString().padStart(3,'0').replace(/0+$/,'')
            return {value:(thousandths/1000n).toString()+(fraction?'.'+fraction:''),unit}
        }
    }
    return {value:raw,unit:'b'}
}
function percent(group:QuotaGroup){const limit=BigInt(group.limit_bytes);return limit===0n?100:Math.min(100,Number(BigInt(group.used_bytes)*100n/limit))}
function validAmount(value:string,unit:string){return /^\d+(\.\d{1,3})?$/.test(value)&&(unit!=='b'||!value.includes('.')||/\.0{1,3}$/.test(value))}
function getError(error:unknown){const response=error as {response?:{data?:{message?:string}}};return response.response?.data?.message||'Не удалось выполнить действие'}
function countLabel(count:number){return `${count} ${count%10===1&&count%100!==11?'нода':count%10>=2&&count%10<=4&&(count%100<12||count%100>14)?'ноды':'нод'}`}

export function SquadQuotas({userUuid}:{userUuid:string}){
    const [groups,setGroups]=useState<QuotaGroup[]>([])
    const [nodes,setNodes]=useState<{value:string;label:string}[]>([])
    const [formId,setFormId]=useState<string|null>(null)
    const [name,setName]=useState('')
    const [members,setMembers]=useState<string[]>([])
    const [limit,setLimit]=useState('')
    const [unit,setUnit]=useState('gib')
    const [pendingSync,setPendingSync]=useState(false)
    const [error,setError]=useState(''),[success,setSuccess]=useState('')
    const [busy,setBusy]=useState(false),[legacy,setLegacy]=useState<string[]>([])
    const latestLoad=useRef(0)
    const url='/api/users/'+userUuid+'/node-quotas'
    const load=async()=>{
        const request=++latestLoad.current
        const [groupResponse,nodeResponse,statusResponse,quotaResponse]=await Promise.all([
            instance.get(url+'/groups'),instance.get('/api/nodes'),instance.get(url+'/status'),instance.get(url)
        ])
        if(request!==latestLoad.current)return
        setGroups(groupResponse.data.response)
        setNodes(nodeResponse.data.response.map((node:NodeOptionData)=>({value:node.uuid,label:nodeOptionLabel(node)})))
        setPendingSync(statusResponse.data.response.pendingSync)
        setLegacy((quotaResponse.data.legacyNeedsReview??[]).map((item:{name:string})=>item.name))
    }
    useEffect(()=>{
        void load().catch(e=>setError(getError(e)))
        const timer=window.setInterval(()=>{void load().catch(()=>{})},30000)
        return ()=>window.clearInterval(timer)
    },[userUuid])
    const act=async(task:()=>Promise<unknown>,message:string)=>{
        setBusy(true);setError('');setSuccess('')
        try{
            await task()
            await load()
            await queryClient.invalidateQueries({queryKey:usersQueryKeys.getUserAccessibleNodes({uuid:userUuid}).queryKey})
            setSuccess(message)
            return true
        }catch(e){setError(getError(e));return false}
        finally{setBusy(false)}
    }
    const openForm=(group?:QuotaGroup)=>{
        setFormId(group?.id??'new')
        setName(group?.name??'')
        setMembers(group?.node_uuids??[])
        const input=inputFor(group?.limit_bytes??null)
        setLimit(input.value);setUnit(input.unit)
        setError('');setSuccess('')
    }
    const toBytes=()=>{
        if(!validAmount(limit,unit))throw Error('Введите объём с точностью до 3 знаков; байты должны быть целыми')
        const [whole,fraction='']=limit.split('.')
        const scale=unit==='gib'?gib:unit==='mib'?mib:1n
        const bytes=BigInt(whole)*scale+BigInt(fraction.padEnd(3,'0'))*scale/1000n
        if(bytes>9223372036854775807n)throw Error('Слишком большой лимит')
        return bytes.toString()
    }
    const save=()=>{
        if(!formId||!name.trim()||!members.length||!validAmount(limit,unit))return
        try{
            const body={name:name.trim(),nodeUuids:members,limitBytes:toBytes()}
            const task=formId==='new'?()=>instance.post(url+'/groups',body):()=>instance.put(url+'/groups/'+formId,body)
            void act(task,'Группа сохранена').then(saved=>{if(saved)setFormId(null)})
        }catch(e){setError(String(e))}
    }
    const reset=(group:QuotaGroup)=>{
        if(!window.confirm('Сбросить расход всех нод группы?'))return
        void act(()=>instance.post(url+'/groups/'+group.id+'/reset'),'Расход группы сброшен')
    }
    const remove=(group:QuotaGroup)=>{
        if(!window.confirm('Удалить группу и её лимит? Расход каждой ноды сохранится.'))return
        void act(()=>instance.delete(url+'/groups/'+group.id),'Группа удалена')
    }
    const assigned=new Set(groups.flatMap(group=>group.node_uuids))
    const options=nodes.filter(node=>!assigned.has(node.value)||groups.find(group=>group.id===formId)?.node_uuids.includes(node.value))
    return <Stack gap="sm" data-testid="node-quotas">
        <Group justify="space-between" align="center" gap="xs" wrap="wrap"><Text fw={700}>Группы лимитов нод</Text><Button size="xs" variant="light" disabled={!nodes.some(node=>!assigned.has(node.value))||busy} onClick={()=>openForm()}>+ Группа</Button></Group>
        {legacy.length>0&&<Text c="yellow" size="xs">Старые лимиты сквадов требуют проверки: {legacy.join(', ')}</Text>}
        {pendingSync&&<Text c="yellow" size="xs">Синхронизация доступа с нодой ожидается.</Text>}
        {error&&<Alert color="red" withCloseButton onClose={()=>setError('')} py="xs">{error}</Alert>}
        {success&&<Alert color="teal" withCloseButton onClose={()=>setSuccess('')} py="xs">{success}</Alert>}
        {formId&&<Card withBorder radius="md" p="sm"><Stack gap="xs">
            <TextInput label="Название группы" placeholder="Например, США" value={name} maxLength={80} onChange={event=>setName(event.currentTarget.value)}/>
            <MultiSelect searchable label="Ноды группы" placeholder="Выберите одну или несколько нод" data={options} value={members} onChange={setMembers} maxValues={20}/>
            <Group grow align="end" gap="xs"><TextInput label="Лимит группы" value={limit} onChange={event=>setLimit(event.currentTarget.value)}/><Select label="Единицы" data={[{value:'gib',label:'ГиБ'},{value:'mib',label:'МиБ'},{value:'b',label:'Байты'}]} value={unit} onChange={value=>setUnit(value??'gib')} allowDeselect={false}/></Group>
            <Text size="xs" c="dimmed">Расход выбранных нод общий для группы. 0 — заблокировать доступ.</Text>
            <Group justify="flex-end"><Button variant="subtle" size="xs" disabled={busy} onClick={()=>setFormId(null)}>Отмена</Button><Button size="xs" loading={busy} disabled={!name.trim()||!members.length||!validAmount(limit,unit)} onClick={save}>Сохранить группу</Button></Group>
        </Stack></Card>}
        {groups.map(group=><Card withBorder radius="md" p="sm" key={group.id} data-testid="node-quota-group"><Stack gap="xs">
            <Group justify="space-between" gap="xs" wrap="wrap"><Text size="sm" fw={600}>{group.name}</Text><Badge color={group.blocked?'red':'violet'} variant="light" size="xs">{group.blocked?'Заблокировано':countLabel(group.node_uuids.length)}</Badge></Group>
            <Text size="xs" c="dimmed" style={{overflowWrap:'anywhere'}}>{group.node_uuids.map(id=>nodes.find(node=>node.value===id)?.label??id).join(' · ')}</Text>
            <Text size="sm">{bytesLabel(group.used_bytes)} / {bytesLabel(group.limit_bytes)}</Text><Progress value={percent(group)} color={group.blocked?'red':'violet'} size="xs"/>
            <Group gap="xs"><Button variant="light" size="compact-xs" disabled={busy} onClick={()=>openForm(group)}>Изменить</Button><Menu position="bottom-end" withinPortal><Menu.Target><Button variant="subtle" size="compact-xs" disabled={busy} aria-label="Действия с группой">Ещё</Button></Menu.Target><Menu.Dropdown><Menu.Item onClick={()=>reset(group)}>Сбросить расход</Menu.Item><Menu.Item color="red" onClick={()=>remove(group)}>Удалить группу</Menu.Item></Menu.Dropdown></Menu></Group>
        </Stack></Card>)}
        {!groups.length&&<Text ta="center" c="dimmed" size="sm" py="sm">Групп пока нет. Создайте группу для одной или нескольких нод.</Text>}
    </Stack>
}
