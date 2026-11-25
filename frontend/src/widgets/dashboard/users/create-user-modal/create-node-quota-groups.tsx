import { ActionIcon, Button, Card, Group, MultiSelect, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core'
import { TbTrash } from 'react-icons/tb'

import { nodeOptionLabel, type NodeOptionData } from '@shared/utils/misc/node-option-label'

export type NodeQuotaDraft = { id: string; name: string; nodeUuids: string[]; amount: string; unit: 'gib'|'mib' }
export type NodeQuotaGroupInput = {name:string;nodeUuids:string[];limitBytes:string}
const units = {gib:1073741824n,mib:1048576n}

export function parseNodeQuotaGroups(drafts: NodeQuotaDraft[]): {groups: NodeQuotaGroupInput[]; error: string} {
    const names = new Set<string>(), nodes = new Set<string>()
    const groups: NodeQuotaGroupInput[] = []
    for (const [index, draft] of drafts.entries()) {
        const name=draft.name.trim(),amount=draft.amount.trim().replace(',','.')
        if(!name||name.length>80)return {groups:[],error:`Группа ${index+1}: укажите название до 80 символов`}
        if(names.has(name.toLowerCase()))return {groups:[],error:'Названия групп должны отличаться'}
        names.add(name.toLowerCase())
        if(!draft.nodeUuids.length||draft.nodeUuids.length>20)return {groups:[],error:`Группа ${index+1}: выберите от 1 до 20 нод`}
        for(const nodeUuid of draft.nodeUuids){
            if(nodes.has(nodeUuid))return {groups:[],error:'Нода может входить только в одну группу'}
            nodes.add(nodeUuid)
        }
        if(!/^\d+(\.\d{1,3})?$/.test(amount))return {groups:[],error:`Группа ${index+1}: укажите лимит с точностью до 3 знаков`}
        const [whole,fraction='']=amount.split('.')
        const scale=units[draft.unit]
        const bytes=BigInt(whole)*scale+BigInt(fraction.padEnd(3,'0'))*scale/1000n
        if(bytes>9223372036854775807n)return {groups:[],error:`Группа ${index+1}: лимит слишком большой`}
        groups.push({name,nodeUuids:draft.nodeUuids,limitBytes:bytes.toString()})
    }
    return {groups,error:''}
}

export function CreateNodeQuotaGroups({value,onChange,nodes,error}:{value:NodeQuotaDraft[];onChange:(drafts:NodeQuotaDraft[])=>void;nodes:NodeOptionData[];error:string}) {
    const update=(id:string,change:Partial<NodeQuotaDraft>)=>onChange(value.map(group=>group.id===id?{...group,...change}:group))
    return <Stack gap="sm" data-testid="create-node-quotas">
        <Group justify="space-between" align="center" wrap="wrap"><div><Text fw={600} size="sm">Группы лимитов нод</Text><Text c="dimmed" size="xs">Одна группа может включать одну или несколько нод с общим лимитом.</Text></div>
            <Button size="compact-sm" variant="light" disabled={value.length>=50||nodes.length===0} onClick={()=>onChange([...value,{id:Math.random().toString(36).slice(2),name:'',nodeUuids:[],amount:'',unit:'gib'}])}>+ Группа</Button></Group>
        {value.map((group,index)=>{
            const assigned=new Set(value.filter(item=>item.id!==group.id).flatMap(item=>item.nodeUuids))
            return <Card key={group.id} withBorder radius="md" p="sm"><Stack gap="xs">
                <Group justify="space-between"><Text fw={600} size="xs">Группа {index+1}</Text><ActionIcon variant="subtle" color="red" aria-label={`Удалить группу ${index+1}`} onClick={()=>onChange(value.filter(item=>item.id!==group.id))}><TbTrash size={16}/></ActionIcon></Group>
                <TextInput label="Название группы" placeholder="Например, США" value={group.name} maxLength={80} onChange={event=>update(group.id,{name:event.currentTarget.value})}/>
                <MultiSelect label="Ноды группы" placeholder="Выберите ноды" searchable data={nodes.filter(node=>!assigned.has(node.uuid)).map(node=>({value:node.uuid,label:nodeOptionLabel(node)}))} value={group.nodeUuids} maxValues={20} onChange={nodeUuids=>update(group.id,{nodeUuids})}/>
                <SimpleGrid cols={{base:1,sm:2}} style={{alignItems:'end'}}><TextInput label="Общий лимит" placeholder="10" inputMode="decimal" value={group.amount} onChange={event=>update(group.id,{amount:event.currentTarget.value})}/><Select label="Единицы" allowDeselect={false} value={group.unit} data={[{value:'gib',label:'ГиБ'},{value:'mib',label:'МиБ'}]} onChange={unit=>update(group.id,{unit:unit==='mib'?'mib':'gib'})}/></SimpleGrid>
            </Stack></Card>
        })}
        {error&&<Text c="red" size="xs">{error}</Text>}
    </Stack>
}
