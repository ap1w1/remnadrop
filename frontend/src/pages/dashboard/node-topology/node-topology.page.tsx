import { Alert, Badge, Button, Card, Group, Loader, MultiSelect, Stack, Switch, Text, TextInput, ThemeIcon, Title } from '@mantine/core'
import { useMemo, useState } from 'react'
import { TbHierarchy3, TbRefresh, TbSearch } from 'react-icons/tb'
import { queryClient } from '@shared/api'
import { useGetConfigProfiles, useGetHosts, useGetNodes } from '@shared/api/hooks'
import { Page } from '@shared/ui'
import { nodeOptionLabel } from '@shared/utils/misc/node-option-label'
import { TopologyCanvas, type GraphVertex, type GraphEdge } from './topology-canvas'

/** Read-only graph computed from the original Remnawave node/profile/inbound/host API. */
export function NodeTopologyPage() {
    const nodesQuery=useGetNodes()
    const profilesQuery=useGetConfigProfiles()
    const hostsQuery=useGetHosts()
    const nodes=nodesQuery.data??[]
    const profiles=profilesQuery.data?.configProfiles??[]
    const hosts=hostsQuery.data??[]

    // null represents "all nodes", not an unselected first node.
    const [selection,setSelection]=useState<string[]|null>(null)
    const [query,setQuery]=useState('')
    const [includeDisabled,setIncludeDisabled]=useState(false)

    const visibleNodes=useMemo(()=>nodes.filter(n=>selection===null||selection.includes(n.uuid)),[nodes,selection])
    const graph=useMemo(()=>{
        const vertices:GraphVertex[]=[]
        const edges:GraphEdge[]=[]
        const seen=new Set<string>(),seenEdges=new Set<string>()
        const inboundIds=new Set<string>()
        const add=(v:GraphVertex)=>{if(!seen.has(v.id)){seen.add(v.id);vertices.push(v)}}
        const link=(from:string,to:string)=>{const id=from+'>'+to;if(!seenEdges.has(id)){seenEdges.add(id);edges.push({from,to})}}
        const chosen=new Set(visibleNodes.map(n=>n.uuid))
        for(const node of visibleNodes){
            if(!includeDisabled&&node.isDisabled)continue
            const nodeId='node:'+node.uuid
            add({id:nodeId,kind:'node',label:nodeOptionLabel(node),detail:node.address+':'+(node.port??''),disabled:node.isDisabled})
            const profileUuid=node.configProfile.activeConfigProfileUuid
            const profile=profiles.find(p=>p.uuid===profileUuid)
            if(!profileUuid)continue
            const profileId='profile:'+profileUuid
            add({id:profileId,kind:'profile',label:profile?.name??'Профиль',detail:profileUuid})
            link(nodeId,profileId)
            for(const inbound of node.configProfile.activeInbounds??[]){
                const id='inbound:'+inbound.uuid
                inboundIds.add(inbound.uuid)
                add({id,kind:'inbound',label:inbound.tag,detail:inbound.type+(inbound.port?' :'+inbound.port:'')})
                link(profileId,id)
            }
        }
        const search=query.trim().toLowerCase()
        const matchingHosts=hosts.filter(host=>
            (includeDisabled||(!host.isDisabled&&!host.isHidden))
            && host.nodes.some(id=>chosen.has(id))
            && (!search||[host.remark,host.address,String(host.port)].join(' ').toLowerCase().includes(search)))
        // Do not silently drop hosts whose inbound is currently absent from the active profile.
        for(const host of matchingHosts){
            const id='host:'+host.uuid
            add({id,kind:'host',label:host.remark||host.address,detail:host.address+':'+host.port,disabled:host.isDisabled})
            const inboundId=host.inbound.configProfileInboundUuid
            if(inboundId&&inboundIds.has(inboundId)){
                link('inbound:'+inboundId,id)
            }else{
                for(const nodeUuid of host.nodes){
                    if(chosen.has(nodeUuid)&&seen.has('node:'+nodeUuid))link('node:'+nodeUuid,id)
                }
            }
        }
        const hasMore=vertices.length>350
        if(hasMore){
            const shown=vertices.slice(0,350)
            const ids=new Set(shown.map(x=>x.id))
            return {vertices:shown,edges:edges.filter(e=>ids.has(e.from)&&ids.has(e.to)),hasMore,hosts:matchingHosts.length}
        }
        return {vertices,edges,hasMore,hosts:matchingHosts.length}
    },[visibleNodes,profiles,hosts,includeDisabled,query])

    const loading=nodesQuery.isLoading||profilesQuery.isLoading||hostsQuery.isLoading
    const failed=nodesQuery.isError||profilesQuery.isError||hostsQuery.isError
    return <Page title="Схема связей"><Stack gap="md">
        <Group justify="space-between" align="center" wrap="wrap">
            <Group gap="sm"><ThemeIcon size={42} radius="md" variant="light" color="cyan"><TbHierarchy3 size={23}/></ThemeIcon>
                <div><Title order={2}>Схема связей</Title><Text c="dimmed" size="sm">Ноды → профили → inbound → хосты</Text></div>
            </Group>
            <Button variant="subtle" size="sm" leftSection={<TbRefresh size={16}/>} loading={nodesQuery.isFetching||profilesQuery.isFetching||hostsQuery.isFetching} onClick={()=>void queryClient.invalidateQueries()}>Обновить</Button>
        </Group>
        <Card withBorder radius="md" p="sm"><Stack gap="xs">
            <Group gap="xs" wrap="wrap" align="end">
                <MultiSelect style={{flex:'2 1 280px'}} size="sm" label="Ноды" placeholder="Выберите одну или несколько" searchable clearable
                    data={nodes.map(n=>({value:n.uuid,label:nodeOptionLabel(n)}))}
                    value={selection??nodes.map(n=>n.uuid)} onChange={setSelection} maxDropdownHeight={300}/>
                <Button variant="light" size="sm" onClick={()=>setSelection(null)}>Выбрать все</Button>
                <Button variant="subtle" size="sm" onClick={()=>setSelection([])}>Снять выбор</Button>
            </Group>
            <Group gap="sm" align="center" wrap="wrap">
                <TextInput size="sm" style={{flex:'1 1 220px'}} placeholder="Найти хост по названию, IP или порту" aria-label="Поиск хостов" leftSection={<TbSearch size={15}/>} value={query} onChange={e=>setQuery(e.currentTarget.value)}/>
                <Switch size="sm" checked={includeDisabled} onChange={e=>setIncludeDisabled(e.currentTarget.checked)} label="Скрытые и отключённые"/>
                <Badge variant="light" color="gray">{visibleNodes.length} нод · {graph.hosts} хостов</Badge>
            </Group>
        </Stack></Card>
        {failed&&<Alert color="red">Не удалось загрузить ноды, профили или хосты. Проверьте API и права доступа.</Alert>}
        {loading?<Card withBorder p="xl"><Group justify="center"><Loader size="sm"/>Загрузка связей...</Group></Card>:
        !visibleNodes.length?<Alert color="blue">Выберите хотя бы одну ноду.</Alert>:
        <TopologyCanvas vertices={graph.vertices} edges={graph.edges}/>}
        {graph.hasMore&&<Alert color="yellow">Показаны первые 350 элементов. Сузьте список нод или выполните поиск по хостам.</Alert>}
        <Text size="xs" c="dimmed">Все данные берутся из конфигурации панели. Хосты без активного inbound соединяются непосредственно с соответствующей нодой, поэтому не исчезают из схемы. Перемещение карточек не меняет конфигурацию.</Text>
    </Stack></Page>
}
