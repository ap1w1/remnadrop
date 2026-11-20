import {
    Accordion, Alert, Badge, Button, Card, Group, Loader, Select, SimpleGrid,
    Stack, Switch, Text, TextInput, ThemeIcon, Title
} from '@mantine/core'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
    TbArrowRight, TbBox, TbChevronRight, TbHierarchy3, TbPlugConnected,
    TbRefresh, TbSearch, TbServer2, TbWorld
} from 'react-icons/tb'

import { queryClient } from '@shared/api'
import { useGetConfigProfiles, useGetHosts, useGetNodes } from '@shared/api/hooks'
import { Page } from '@shared/ui'
import { nodeOptionLabel } from '@shared/utils/misc/node-option-label'

/** Read-only topology. All links are derived from existing Remnawave API relationships. */
export function NodeTopologyPage() {
    const nodesQuery = useGetNodes()
    const profilesQuery = useGetConfigProfiles()
    const hostsQuery = useGetHosts()
    const nodes = nodesQuery.data ?? []
    const profiles = profilesQuery.data?.configProfiles ?? []
    const hosts = hostsQuery.data ?? []
    const [selectedNode, setSelectedNode] = useState<string | null>(null)
    const [hostQuery, setHostQuery] = useState('')
    const [showDisabled, setShowDisabled] = useState(false)
    const [expandedInbounds, setExpandedInbounds] = useState<string[]>([])

    const node = nodes.find(item => item.uuid === selectedNode) ?? nodes[0]
    const profile = profiles.find(item => item.uuid === node?.configProfile.activeConfigProfileUuid)
    const inbounds = useMemo(() => node?.configProfile.activeInbounds ?? [], [node])
    const relevantHosts = useMemo(() => hosts.filter(host =>
        !!node && host.nodes.includes(node.uuid) &&
        (!!profile && host.inbound.configProfileUuid === profile.uuid)
    ), [hosts, node, profile])
    const hostVisible = (host: (typeof hosts)[number]) =>
        (showDisabled || (!host.isDisabled && !host.isHidden)) &&
        `${host.remark} ${host.address} ${host.port}`.toLowerCase().includes(hostQuery.trim().toLowerCase())
    const unmappedHosts = relevantHosts.filter(host =>
        !host.inbound.configProfileInboundUuid ||
        !inbounds.some(inbound => inbound.uuid === host.inbound.configProfileInboundUuid)
    ).filter(hostVisible)
    const loading = nodesQuery.isLoading || profilesQuery.isLoading || hostsQuery.isLoading
    const failed = nodesQuery.isError || profilesQuery.isError || hostsQuery.isError

    const nodeCard = node && <Card withBorder radius="md" p="lg" style={{height: '100%'}}>
        <Stack gap="sm">
            <Group gap="xs"><ThemeIcon color="blue" variant="light"><TbServer2 size={19}/></ThemeIcon><Text fw={700}>Нода</Text></Group>
            <Text fw={700} size="lg">{nodeOptionLabel(node)}</Text>
            <Group gap="xs"><Badge color={node.isConnected ? 'teal' : 'red'} variant="light">{node.isConnected ? 'Подключена' : 'Не подключена'}</Badge>{node.isDisabled && <Badge color="gray">Выключена</Badge>}</Group>
            <Text ff="monospace" size="sm" c="dimmed">{node.address}:{node.port ?? '—'}</Text>
            <Text size="xs" c="dimmed">Показывается фактический активный профиль и inbound, назначенные этой ноде.</Text>
            <Button component={Link} to="/dashboard/management/nodes" size="xs" variant="subtle" leftSection={<TbChevronRight size={14}/>}>Управление нодами</Button>
        </Stack>
    </Card>
    const profileCard = <Card withBorder radius="md" p="lg" style={{height: '100%'}}>
        <Stack gap="sm">
            <Group gap="xs"><ThemeIcon color="cyan" variant="light"><TbBox size={19}/></ThemeIcon><Text fw={700}>Профиль</Text></Group>
            {profile ? <><Text fw={700} size="lg">{profile.name}</Text><Badge variant="light" color="cyan">Активных inbound: {inbounds.length}</Badge><Text size="xs" c="dimmed">Показаны только inbound, назначенные выбранной ноде.</Text><Button size="xs" variant="subtle" component={Link} to="/dashboard/management/config-profiles" leftSection={<TbChevronRight size={14}/>}>Все профили</Button></>:
                <Alert color="yellow" title="Профиль не назначен">У этой ноды отсутствует активный профиль. Назначь его в настройках ноды.</Alert>}
        </Stack>
    </Card>
    const visibleForInbound = (uuid: string) => relevantHosts.filter(host => host.inbound.configProfileInboundUuid === uuid).filter(hostVisible)
    const effectiveExpanded = expandedInbounds.length ? expandedInbounds : []
    return <Page title="Схема связей"><Stack gap="lg">
        <Group justify="space-between" align="flex-start" wrap="wrap">
            <Group gap="sm"><ThemeIcon size={46} radius="md" variant="light" color="cyan"><TbHierarchy3 size={26}/></ThemeIcon><div><Title order={2}>Схема связей</Title><Text size="sm" c="dimmed">Нода → активный профиль → inbound → связанные хосты</Text></div></Group>
            <Button variant="light" leftSection={<TbRefresh size={17}/>} loading={nodesQuery.isFetching || profilesQuery.isFetching || hostsQuery.isFetching} onClick={() => void queryClient.invalidateQueries()}>Обновить данные</Button>
        </Group>
        <Card withBorder radius="md" p="lg"><SimpleGrid cols={{base:1,md:3}} spacing="md">
            <Select searchable clearable={false} label="Выберите ноду" placeholder="Нода" data={nodes.map(n=>({value:n.uuid,label:nodeOptionLabel(n)}))} value={node?.uuid ?? null} onChange={value=>{setSelectedNode(value);setExpandedInbounds([])}}/>
            <TextInput label="Поиск по хостам" leftSection={<TbSearch size={16}/>} placeholder="Название, IP, порт" value={hostQuery} onChange={e=>setHostQuery(e.currentTarget.value)}/>
            <Stack justify="center"><Switch label="Показывать скрытые и отключённые хосты" checked={showDisabled} onChange={e=>setShowDisabled(e.currentTarget.checked)}/></Stack>
        </SimpleGrid></Card>
        {failed && <Alert color="red" title="Данные недоступны">Не удалось загрузить связи. Проверьте доступ к API и права просмотра нод, профилей и хостов.</Alert>}
        {loading ? <Card withBorder radius="md" p="xl"><Group justify="center"><Loader size="sm"/><Text>Загружаем связи...</Text></Group></Card>
        : !node ? <Alert color="blue" title="Нод нет">Добавьте ноду, чтобы увидеть схему связей.</Alert>
        : <>
            <SimpleGrid cols={{base:1,md:2}} spacing="md">
                <div>{nodeCard}</div><div>{profileCard}</div>
            </SimpleGrid>
            <Card withBorder radius="md" p="lg">
                <Stack gap="md">
                    <Group justify="space-between" wrap="wrap"><Group gap="xs"><TbPlugConnected size={21}/><Title order={4}>Inbound и хосты</Title></Group><Group gap="xs"><Badge variant="light">{inbounds.length} inbound</Badge><Badge variant="light">{relevantHosts.length} хостов</Badge></Group></Group>
                    <Text size="xs" c="dimmed">Связи строятся из назначения inbound на ноде и привязки хостов к ноде и inbound. Раскрывайте элементы, чтобы увидеть соответствующие хосты.</Text>
                    <Group justify="flex-end"><Button size="xs" variant="subtle" onClick={()=>setExpandedInbounds(inbounds.map(item=>item.uuid))}>Развернуть все</Button><Button size="xs" variant="subtle" onClick={()=>setExpandedInbounds([])}>Свернуть все</Button></Group>
                    {!inbounds.length ? <Alert color="yellow">В активном профиле нет inbound, назначенных этой ноде.</Alert> :
                        <Accordion multiple variant="separated" radius="md" value={effectiveExpanded} onChange={setExpandedInbounds}>
                            {inbounds.map(inbound=>{
                                const matching = relevantHosts.filter(host=>host.inbound.configProfileInboundUuid===inbound.uuid)
                                const visible = visibleForInbound(inbound.uuid)
                                return <Accordion.Item key={inbound.uuid} value={inbound.uuid}>
                                    <Accordion.Control><Group gap="sm" wrap="wrap"><ThemeIcon variant="light" color="cyan"><TbPlugConnected size={18}/></ThemeIcon><Text fw={600} ff="monospace">{inbound.tag}</Text><Badge color="gray" variant="outline">{inbound.type}{inbound.network ? ` · ${inbound.network}` : ''}{inbound.port ? ` :${inbound.port}` : ''}</Badge><Badge color="blue" variant="light">{matching.length} хостов</Badge></Group></Accordion.Control>
                                    <Accordion.Panel><Stack gap="xs" pl="md" style={{borderLeft:'2px solid var(--mantine-color-default-border)'}}>
                                        <Group gap="xs"><TbArrowRight size={14} color="var(--mantine-primary-color-filled)"/><Text size="sm" c="dimmed">Хосты, связанные с этим inbound и нодой</Text></Group>
                                        {visible.map(host=><Card key={host.uuid} withBorder radius="sm" p="sm"><Group justify="space-between" gap="sm" wrap="wrap"><Group gap="xs"><ThemeIcon size="sm" variant="light" color="grape"><TbWorld size={14}/></ThemeIcon><Stack gap={0}><Text fw={600} size="sm">{host.remark}</Text><Text size="xs" c="dimmed" ff="monospace">{host.address}:{host.port}</Text></Stack></Group><Group gap="xs">{host.isHidden&&<Badge color="gray" size="xs">Скрыт</Badge>}{host.isDisabled&&<Badge color="red" size="xs">Отключён</Badge>}</Group></Group></Card>)}
                                        {!visible.length&&<Text size="sm" c="dimmed">{matching.length ? 'Хосты скрыты фильтрами' : 'Для этого inbound нет привязанных хостов'}</Text>}
                                    </Stack></Accordion.Panel>
                                </Accordion.Item>
                            })}
                        </Accordion>}
                    {unmappedHosts.length > 0 && <Alert color="orange" title="Хосты без активного inbound">{unmappedHosts.length} хостов привязаны к ноде, но их inbound отсутствует среди активных для неё. Это может быть ошибкой конфигурации.</Alert>}
                    <Group justify="flex-end"><Button variant="light" size="xs" component={Link} to="/dashboard/management/hosts">Открыть список хостов</Button></Group>
                </Stack>
            </Card>
        </>}
        <Text c="dimmed" size="xs">Это интерактивная схема существующих связей, не редактор конфигурации. Изменения выполняются в разделах «Ноды», «Профили» и «Хосты».</Text>
    </Stack></Page>
}
