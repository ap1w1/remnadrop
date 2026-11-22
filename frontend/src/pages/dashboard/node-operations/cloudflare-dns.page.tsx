import { Accordion, ActionIcon, Alert, Badge, Button, Card, Divider, Group, Menu, Modal, Pagination, PasswordInput, Select, SimpleGrid, Skeleton, Stack, Switch, Table, Tabs, Text, TextInput, ThemeIcon, Title, Tooltip } from '@mantine/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { TbArrowLeft, TbBolt, TbCloud, TbDots, TbEdit, TbHistory, TbLink, TbPlus, TbRefresh, TbSearch, TbSettings, TbTrash, TbWorld } from 'react-icons/tb'
import { instance } from '@shared/api/axios'
import { Page } from '@shared/ui'
import { automationLink, CLOUDFLARE_API as api, CLOUDFLARE_PAGE as pageUrl, cloudflareError as message, cloudflareTime as time, recordKey } from './cloudflare-dns.types'
import type { CloudflareAccount, CloudflareBinding, CloudflareData, CloudflareHistory, CloudflareRecord, CloudflareZone } from './cloudflare-dns.types'

const empty: CloudflareData = { accounts: [], zones: [], records: [], bindings: [], accountErrors: [], zoneErrors: [] }
type Host = { uuid: string; remark: string; address: string }
type Explicit = { account_id: string; zone_id: string; record_id: string; host_uuid: string }

function Heading({ settings = false, loading = false, refresh }: { settings?: boolean; loading?: boolean; refresh?: () => void }) {
    return <Group justify="space-between" align="center" wrap="wrap">
        <Group gap="sm"><ThemeIcon variant="light" color="orange" size={44} radius="md"><TbCloud size={26}/></ThemeIcon>
            <div><Title order={2}>{settings ? 'Настройки Cloudflare' : 'Cloudflare DNS'}</Title>
                <Text c="dimmed" size="sm">{settings ? 'Аккаунты и синхронизация доменов' : 'Домены и DNS-записи всех подключённых аккаунтов'}</Text></div></Group>
        <Group gap="xs">
            {refresh && <Button h={44} variant="default" leftSection={<TbRefresh size={18}/>} loading={loading} onClick={refresh}>Обновить</Button>}
            <Button h={44} component={Link} to={settings ? pageUrl : pageUrl + '/settings'} variant="light"
                leftSection={settings ? <TbArrowLeft size={18}/> : <TbSettings size={18}/>}>
                {settings ? 'К доменам' : 'Настройки'}
            </Button>
        </Group>
    </Group>
}

function RecordActions({ record, edit, link }: { record: CloudflareRecord; edit: (record: CloudflareRecord) => void; link: (record: CloudflareRecord) => void }) {
    const addressRecord = record.type === 'A' || record.type === 'AAAA'
    return <Group gap={4} wrap="nowrap">
        {addressRecord && <Button h={44} size="xs" variant="light" leftSection={<TbEdit size={16}/>} onClick={() => edit(record)}>Изменить IP</Button>}
        <Menu withinPortal position="bottom-end"><Menu.Target>
            <ActionIcon variant="subtle" size={44} aria-label={'Действия с ' + record.name}><TbDots size={20}/></ActionIcon>
        </Menu.Target><Menu.Dropdown>
            {addressRecord && <Menu.Item component={Link} to={automationLink(record)} leftSection={<TbBolt size={16}/>}>Создать автоматизацию</Menu.Item>}
            <Menu.Item leftSection={<TbLink size={16}/>} onClick={() => link(record)}>Связи с хостами</Menu.Item>
        </Menu.Dropdown></Menu>
    </Group>
}

function RecordList({ records, edit, link }: { records: CloudflareRecord[]; edit: (record: CloudflareRecord) => void; link: (record: CloudflareRecord) => void }) {
    const [page, setPage] = useState(1)
    const pages = Math.max(1, Math.ceil(records.length / 20))
    useEffect(() => setPage(1), [records.length])
    const visible = records.slice((Math.min(page, pages) - 1) * 20, Math.min(page, pages) * 20)
    if (!records.length) return <Text c="dimmed" ta="center" py="lg">Записей по этому фильтру нет</Text>
    return <Stack gap="sm">
        <Table.ScrollContainer minWidth={730} visibleFrom="sm"><Table highlightOnHover verticalSpacing="sm">
            <Table.Thead><Table.Tr><Table.Th>Запись</Table.Th><Table.Th>Тип</Table.Th><Table.Th>IP / значение</Table.Th><Table.Th>Режим</Table.Th><Table.Th>Действия</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{visible.map(record => <Table.Tr key={recordKey(record)}>
                <Table.Td><Text fw={600} size="sm" style={{ overflowWrap: 'anywhere' }}>{record.name}</Text>
                    {!!record.linkedHosts?.length && <Text size="xs" c="dimmed">{[...new Set(record.linkedHosts.map(host => host.nodeName))].join(', ')}</Text>}
                </Table.Td>
                <Table.Td><Badge variant="light" color={record.type === 'A' || record.type === 'AAAA' ? 'blue' : 'gray'}>{record.type}</Badge></Table.Td>
                <Table.Td maw={340}><Text size="sm" ff="monospace" style={{ overflowWrap: 'anywhere' }}>{record.content}</Text><Text c="dimmed" size="xs">TTL: {record.ttl === 1 ? 'авто' : `${record.ttl} сек.`}</Text></Table.Td>
                <Table.Td><Badge variant="dot" color={record.proxied ? 'orange' : 'gray'}>{record.proxied ? 'Proxy' : 'DNS only'}</Badge></Table.Td>
                <Table.Td><RecordActions record={record} edit={edit} link={link}/></Table.Td>
            </Table.Tr>)}</Table.Tbody>
        </Table></Table.ScrollContainer>
        <Stack hiddenFrom="sm" gap="xs">{visible.map(record => <Card key={recordKey(record)} withBorder radius="md" p="sm">
            <Stack gap="xs"><Group justify="space-between"><Badge variant="light">{record.type}</Badge><Badge variant="dot" color={record.proxied ? 'orange' : 'gray'}>{record.proxied ? 'Proxy' : 'DNS only'}</Badge></Group>
                <Text fw={600} size="sm" style={{ overflowWrap: 'anywhere' }}>{record.name}</Text>
                <Text size="sm" ff="monospace" style={{ overflowWrap: 'anywhere' }}>{record.content}</Text>
                {!!record.linkedHosts?.length && <Text size="xs" c="dimmed">{[...new Set(record.linkedHosts.map(host => host.nodeName))].join(', ')}</Text>}
                <Group justify="space-between"><Text size="xs" c="dimmed">TTL {record.ttl === 1 ? 'авто' : record.ttl + ' сек.'}</Text><RecordActions record={record} edit={edit} link={link}/></Group>
            </Stack>
        </Card>)}</Stack>
        {pages > 1 && <Group justify="space-between"><Text c="dimmed" size="xs">Всего записей: {records.length}</Text><Pagination value={page} onChange={setPage} total={pages} size="sm"/></Group>}
    </Stack>
}

function History({ history, accountId }: { history: CloudflareHistory[]; accountId: string | null }) {
    const [page, setPage] = useState(1)
    const rows = history.filter(row => !accountId || row.account_id === accountId)
    const pages = Math.max(1, Math.ceil(rows.length / 25))
    useEffect(() => setPage(1), [accountId])
    if (!rows.length) return <Card withBorder radius="md" p="xl"><Stack align="center" gap="xs"><TbHistory size={32}/><Text fw={600}>Изменений пока нет</Text><Text size="sm" c="dimmed" ta="center">Здесь появятся ручные изменения IP и результаты автоматизаций.</Text></Stack></Card>
    return <Card withBorder radius="md" p="md"><Stack gap="md"><Text c="dimmed" size="sm">Последние 200 операций</Text>
        <Table.ScrollContainer minWidth={720}><Table highlightOnHover verticalSpacing="sm"><Table.Thead><Table.Tr>
            <Table.Th>Время</Table.Th><Table.Th>Домен и аккаунт</Table.Th><Table.Th>Изменение IP</Table.Th><Table.Th>Источник</Table.Th><Table.Th>Результат</Table.Th>
        </Table.Tr></Table.Thead><Table.Tbody>{rows.slice((page - 1) * 25, page * 25).map(event => <Table.Tr key={event.id}>
            <Table.Td><Text size="xs">{time(event.created_at)}</Text></Table.Td>
            <Table.Td><Text size="sm" fw={500}>{event.record_name}</Text><Text c="dimmed" size="xs">{event.account_name ?? 'Аккаунт удалён'}</Text></Table.Td>
            <Table.Td><Text ff="monospace" size="xs">{event.old_ip ?? '—'}</Text><Text ff="monospace" size="xs" c={event.status === 'updated' ? 'teal' : undefined}>→ {event.new_ip ?? '—'}</Text></Table.Td>
            <Table.Td><Text size="xs">{({ manual: 'Вручную', automation: 'Автоматизация', ip_rotation: 'Смена IP ноды' } as Record<string, string>)[event.source] ?? event.source}</Text></Table.Td>
            <Table.Td><Tooltip label={event.message || ''}><Badge variant="light" color={event.status === 'updated' ? 'teal' : 'red'}>{event.status === 'updated' ? 'Изменён' : 'Ошибка'}</Badge></Tooltip></Table.Td>
        </Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>
        {pages > 1 && <Group justify="end"><Pagination value={page} onChange={setPage} total={pages}/></Group>}
    </Stack></Card>
}

export function CloudflareDnsPage() {
    const [data, setData] = useState<CloudflareData>(empty), [history, setHistory] = useState<CloudflareHistory[]>([])
    const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
    const [accountId, setAccountId] = useState<string | null>(null), [search, setSearch] = useState(''), [type, setType] = useState<string | null>(null), [page, setPage] = useState(1)
    const [edit, setEdit] = useState<CloudflareRecord | null>(null), [newIp, setNewIp] = useState(''), [dialogError, setDialogError] = useState('')
    const [linkRecord, setLinkRecord] = useState<CloudflareRecord | null>(null), [hosts, setHosts] = useState<Host[]>([]), [links, setLinks] = useState<Explicit[]>([]), [newHost, setNewHost] = useState<string | null>(null)
    const refresh = useCallback(async () => {
        setLoading(true); setError('')
        try {
            const [overview, events] = await Promise.all([instance.get(api + '/overview'), instance.get(api + '/events')])
            setData(overview.data.response as CloudflareData); setHistory(events.data.response as CloudflareHistory[])
        } catch (e) { setError(message(e)) } finally { setLoading(false) }
    }, [])
    useEffect(() => { void refresh() }, [refresh])
    useEffect(() => setPage(1), [accountId, search, type])
    const query = search.trim().toLowerCase()
    const recordsFor = (zone: CloudflareZone) => data.records.filter(record => record.accountId === zone.accountId && record.zoneId === zone.id
        && (!type || record.type === type) && (!query || zone.name.includes(query) || [record.name, record.content, ...(record.linkedHosts ?? []).flatMap(host => [host.hostName, host.nodeName])].join(' ').toLowerCase().includes(query)))
    const filteredZones = useMemo(() => data.zones.filter(zone => (!accountId || zone.accountId === accountId)
        && ((!query && !type) || recordsFor(zone).length > 0 || (!type && zone.name.includes(query)))), [data, accountId, query, type])
    const pages = Math.max(1, Math.ceil(filteredZones.length / 20))
    const visibleZones = filteredZones.slice((Math.min(page, pages) - 1) * 20, Math.min(page, pages) * 20)
    const types = [...new Set(data.records.map(record => record.type))].sort()
    const beginEdit = (record: CloudflareRecord) => { setEdit(record); setNewIp(''); setDialogError('') }
    const replace = async () => {
        if (!edit) return
        setBusy(true); setDialogError('')
        try {
            const result = await instance.post(api + '/records/replace-ip', { accountId: edit.accountId, zoneId: edit.zoneId, recordId: edit.id, expectedOldIp: edit.content, newIp: newIp.trim() })
            setEdit(null); setNotice(result.data.response.auditRecorded === false ? 'IP изменён, но журнал не удалось сохранить. Проверьте состояние сервера.' : `IP записи ${edit.name} изменён`)
            await refresh()
        } catch (e) { setDialogError(message(e)) } finally { setBusy(false) }
    }
    const loadLinks = async () => {
        const [a, b] = await Promise.all([instance.get(api + '/links'), instance.get('/api/hosts')])
        setLinks(a.data.response as Explicit[]); setHosts(b.data.response as Host[])
    }
    const beginLinks = (record: CloudflareRecord) => {
        setLinkRecord(record); setNewHost(null); setDialogError(''); setBusy(true)
        void loadLinks().catch(e => setDialogError(message(e))).finally(() => setBusy(false))
    }
    const changeLink = async (hostUuid: string, remove = false) => {
        if (!linkRecord) return
        setBusy(true); setDialogError('')
        try {
            if (remove) await instance.delete(`${api}/links/${linkRecord.zoneId}/${linkRecord.id}/${hostUuid}`, { params: { accountId: linkRecord.accountId } })
            else await instance.put(api + '/links', { accountId: linkRecord.accountId, zoneId: linkRecord.zoneId, recordId: linkRecord.id, hostUuid })
            await loadLinks(); await refresh(); setNewHost(null)
        } catch (e) { setDialogError(message(e)) } finally { setBusy(false) }
    }
    return <Page title="Cloudflare DNS"><Stack gap="lg">
        <Heading loading={loading} refresh={() => void refresh()}/>
        {error && <Alert color="red" title="Не удалось обновить данные" withCloseButton onClose={() => setError('')}>{error}</Alert>}
        {notice && <Alert color="teal" withCloseButton onClose={() => setNotice('')}>{notice}</Alert>}
        {!!(data.accountErrors.length + data.zoneErrors.length) && <Alert color="yellow" title="Часть доменов недоступна"><Stack gap={4}>
            {data.accountErrors.map(item => <Text key={item.accountId} size="sm">{item.accountName}: {item.message}</Text>)}
            {data.zoneErrors.map(item => <Text key={item.accountId + item.zoneId} size="sm">{item.accountName} · {item.zoneName}: {item.message}</Text>)}
        </Stack></Alert>}
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
            {[['Аккаунты', data.accounts.length], ['Домены', data.zones.length], ['DNS-записи', data.records.length], ['Адресные записи', data.records.filter(record => ['A', 'AAAA'].includes(record.type)).length]].map(([label, value]) =>
                <Card key={label} withBorder radius="md" p="md"><Text size="xs" c="dimmed">{label}</Text><Title order={3}>{value}</Title></Card>)}
        </SimpleGrid>
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
            <TextInput size="md" label="Поиск" placeholder="Домен, IP или нода" leftSection={<TbSearch size={17}/>} value={search} onChange={event => setSearch(event.currentTarget.value)}/>
            <Select size="md" label="Аккаунт" placeholder="Все аккаунты" clearable searchable value={accountId} onChange={setAccountId} data={data.accounts.map(account => ({ value: account.id, label: account.name }))}/>
            <Select size="md" label="Тип записи" placeholder="Все типы" clearable value={type} onChange={setType} data={types}/>
        </SimpleGrid>
        <Tabs defaultValue="domains"><Tabs.List mb="md">
            <Tabs.Tab value="domains" h={44} leftSection={<TbWorld size={17}/>}>Домены и записи</Tabs.Tab>
            <Tabs.Tab value="history" h={44} leftSection={<TbHistory size={17}/>}>Журнал изменений</Tabs.Tab>
        </Tabs.List>
            <Tabs.Panel value="domains"><Stack gap="lg">
                {loading && !data.accounts.length ? <Stack>{[1, 2, 3].map(key => <Skeleton key={key} height={85} radius="md"/>)}</Stack> : !data.accounts.length ?
                    <Card withBorder radius="md" p="xl"><Stack align="center" gap="sm"><ThemeIcon size={60} radius="xl" variant="light" color="orange"><TbCloud size={32}/></ThemeIcon>
                        <Title order={3}>Подключите первый аккаунт</Title><Text ta="center" c="dimmed" maw={440}>Добавьте API-токен в настройках, чтобы увидеть домены и управлять их IP-адресами.</Text>
                        <Button h={44} component={Link} to={pageUrl + '/settings'} leftSection={<TbPlus size={18}/>}>Подключить Cloudflare</Button>
                    </Stack></Card> : !filteredZones.length ? <Card withBorder radius="md" p="xl"><Text ta="center" fw={600}>Домены не найдены</Text><Text ta="center" c="dimmed" size="sm" mt="xs">Измените фильтры или проверьте доступ токенов к нужным зонам.</Text></Card> :
                    data.accounts.filter(account => visibleZones.some(zone => zone.accountId === account.id)).map(account => <Stack gap="sm" key={account.id}>
                        <Group justify="space-between"><Group gap="xs"><TbCloud size={19}/><Text fw={600}>{account.name}</Text><Badge variant="light" color="gray">{filteredZones.filter(zone => zone.accountId === account.id).length}</Badge></Group>
                            <Text c="dimmed" size="xs">Обновлён: {time(account.lastSyncedAt)}</Text></Group>
                        <Accordion multiple variant="separated" radius="md">{visibleZones.filter(zone => zone.accountId === account.id).map(zone => {
                            const records = recordsFor(zone), zoneError = data.zoneErrors.find(item => item.accountId === zone.accountId && item.zoneId === zone.id)
                            return <Accordion.Item key={zone.id} value={zone.id}>
                                <Accordion.Control icon={<TbWorld size={20}/>}><Group justify="space-between" gap="xs" pr="sm"><div><Text fw={600} style={{ overflowWrap: 'anywhere' }}>{zone.name}</Text>
                                    {zone.cloudflareAccountName && zone.cloudflareAccountName !== account.name && <Text c="dimmed" size="xs">{zone.cloudflareAccountName}</Text>}</div>
                                    <Group gap="xs"><Badge variant="light" color={zoneError ? 'yellow' : zone.status === 'active' ? 'teal' : 'gray'}>{zoneError ? 'Ошибка загрузки' : zone.status === 'active' ? 'Активен' : zone.status}</Badge><Text c="dimmed" size="xs">Записей: {records.length}</Text></Group>
                                </Group></Accordion.Control>
                                <Accordion.Panel>{zoneError ? <Alert color="yellow">{zoneError.message}</Alert> : <RecordList records={records} edit={beginEdit} link={beginLinks}/>}</Accordion.Panel>
                            </Accordion.Item>
                        })}</Accordion>
                    </Stack>)}
                {pages > 1 && <Group justify="space-between"><Text size="sm" c="dimmed">Найдено доменов: {filteredZones.length}</Text><Pagination total={pages} value={page} onChange={setPage}/></Group>}
            </Stack></Tabs.Panel>
            <Tabs.Panel value="history"><History history={history} accountId={accountId}/></Tabs.Panel>
        </Tabs>
        <Modal opened={!!edit} onClose={() => !busy && setEdit(null)} title="Изменить IP DNS-записи" centered>
            {edit && <form onSubmit={event => { event.preventDefault(); void replace() }}><Stack gap="md">
                <div><Text fw={600} style={{ overflowWrap: 'anywhere' }}>{edit.name}</Text><Text size="sm" c="dimmed">{edit.accountName} · {edit.type}</Text></div>
                <TextInput size="md" label="Текущий IP" value={edit.content} readOnly/>
                <TextInput size="md" label="Новый IP" placeholder={edit.type === 'A' ? 'IPv4-адрес' : 'IPv6-адрес'} value={newIp} onChange={event => setNewIp(event.currentTarget.value)} autoFocus required autoComplete="off"/>
                <Text size="xs" c="dimmed">TTL и режим проксирования сохранятся.</Text>
                {dialogError && <Alert color="red">{dialogError}</Alert>}
                <Group justify="end"><Button h={44} variant="default" disabled={busy} onClick={() => setEdit(null)}>Отмена</Button><Button h={44} type="submit" loading={busy} disabled={!newIp.trim() || newIp.trim() === edit.content}>Сохранить IP</Button></Group>
            </Stack></form>}
        </Modal>
        <Modal opened={!!linkRecord} onClose={() => !busy && setLinkRecord(null)} title="Связи DNS-записи с хостами" centered>
            {linkRecord && <Stack gap="md"><div><Text fw={600}>{linkRecord.name}</Text><Text size="sm" c="dimmed">{linkRecord.accountName}</Text></div>
                <Text size="sm" c="dimmed">Связи используются при автоматической смене IP ноды.</Text>
                {dialogError && <Alert color="red">{dialogError}</Alert>}
                <Select size="md" searchable label="Добавить хост" placeholder="Найти по названию или адресу" value={newHost} onChange={setNewHost} data={hosts.map(host => ({ value: host.uuid, label: host.remark + ' · ' + host.address }))}/>
                <Button h={44} loading={busy} disabled={!newHost} onClick={() => newHost && void changeLink(newHost)}>Добавить связь</Button>
                <Divider label="Явные привязки"/>
                {links.filter(link => link.account_id === linkRecord.accountId && link.zone_id === linkRecord.zoneId && link.record_id === linkRecord.id).map(link =>
                    <Group justify="space-between" key={link.host_uuid}><Text size="sm">{hosts.find(host => host.uuid === link.host_uuid)?.remark ?? link.host_uuid}</Text>
                        <ActionIcon size={44} color="red" variant="subtle" aria-label="Удалить связь с хостом" disabled={busy} onClick={() => void changeLink(link.host_uuid, true)}><TbTrash size={18}/></ActionIcon>
                    </Group>)}
                {!links.some(link => link.account_id === linkRecord.accountId && link.zone_id === linkRecord.zoneId && link.record_id === linkRecord.id) && <Text size="sm" c="dimmed">Явных привязок нет</Text>}
            </Stack>}
        </Modal>
    </Stack></Page>
}

export function CloudflareDnsSettingsPage() {
    const [accounts, setAccounts] = useState<CloudflareAccount[]>([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false)
    const [error, setError] = useState(''), [notice, setNotice] = useState(''), [dialogError, setDialogError] = useState('')
    const [editing, setEditing] = useState<CloudflareAccount | 'new' | null>(null), [name, setName] = useState(''), [token, setToken] = useState(''), [deleting, setDeleting] = useState<CloudflareAccount | null>(null)
    const [accountId, setAccountId] = useState<string | null>(null), [zones, setZones] = useState<CloudflareZone[]>([]), [bindings, setBindings] = useState<CloudflareBinding[]>([]), [zonesLoading, setZonesLoading] = useState(false)
    const zonesRequest = useRef(0)
    const load = useCallback(async () => { const response = await instance.get(api + '/accounts'); setAccounts(response.data.response as CloudflareAccount[]) }, [])
    useEffect(() => { void load().catch(e => setError(message(e))).finally(() => setLoading(false)) }, [load])
    const beginEdit = (account: CloudflareAccount | 'new') => { setEditing(account); setName(account === 'new' ? '' : account.name); setToken(''); setDialogError('') }
    const save = async () => {
        if (!editing) return
        setBusy(true); setDialogError('')
        try {
            const response = editing === 'new'
                ? await instance.post(api + '/accounts', { name: name.trim(), apiToken: token.trim() })
                : await instance.put(api + '/accounts/' + editing.id, { name: name.trim(), ...(token.trim() ? { apiToken: token.trim() } : {}) })
            const saved = response.data.response as CloudflareAccount
            setAccounts(current => current.some(account => account.id === saved.id) ? current.map(account => account.id === saved.id ? saved : account) : [...current, saved])
            setEditing(null); setToken(''); setNotice(editing === 'new' ? 'Аккаунт подключён. Домены доступны в списке.' : 'Аккаунт обновлён')
            if (accountId) await loadZones(accountId)
        } catch (e) { setDialogError(message(e)) } finally { setBusy(false) }
    }
    const remove = async () => {
        if (!deleting) return
        setBusy(true); setDialogError('')
        try {
            await instance.delete(api + '/accounts/' + deleting.id)
            if (accountId === deleting.id) { setAccountId(null); setZones([]) }
            setAccounts(current => current.filter(account => account.id !== deleting.id))
            setDeleting(null); setNotice('Аккаунт отключён')
        } catch (e) { setDialogError(message(e)) } finally { setBusy(false) }
    }
    const loadZones = async (id: string) => {
        const request = ++zonesRequest.current
        setZonesLoading(true); setError('')
        try {
            const [found, links] = await Promise.all([instance.get(api + '/zones', { params: { accountId: id } }), instance.get(api + '/bindings')])
            if (request === zonesRequest.current) { setZones(found.data.response as CloudflareZone[]); setBindings(links.data.response as CloudflareBinding[]) }
        } catch (e) { if (request === zonesRequest.current) { setError(message(e)); setZones([]) } }
        finally { if (request === zonesRequest.current) setZonesLoading(false) }
    }
    const changeAccount = (id: string | null) => { zonesRequest.current++; setAccountId(id); setZones([]); if (id) void loadZones(id); else setZonesLoading(false) }
    const toggleSync = async (zone: CloudflareZone, enabled: boolean) => {
        setBusy(true); setError('')
        try {
            const response = await instance.put(api + '/zones', { accountId: zone.accountId, domain: zone.name, zoneId: zone.id, autoSync: enabled })
            setBindings(response.data.response as CloudflareBinding[])
        } catch (e) { setError(message(e)) } finally { setBusy(false) }
    }
    return <Page title="Настройки Cloudflare"><Stack gap="lg">
        <Heading settings/>
        {error && <Alert color="red" withCloseButton onClose={() => setError('')}>{error}</Alert>}
        {notice && <Alert color="teal" withCloseButton onClose={() => setNotice('')}>{notice}</Alert>}
        <Card withBorder radius="md" p="lg"><Stack gap="md"><Group justify="space-between"><div><Title order={3}>Аккаунты Cloudflare</Title><Text c="dimmed" size="sm">Подключайте аккаунты отдельными API-токенами.</Text></div>
            <Button h={44} leftSection={<TbPlus size={18}/>} onClick={() => beginEdit('new')}>Добавить аккаунт</Button></Group>
            {loading ? <Skeleton height={100} radius="md"/> : !accounts.length ? <Text c="dimmed" py="lg" ta="center">Подключённых аккаунтов пока нет</Text> : <Stack gap="sm">{accounts.map(account =>
                <Card key={account.id} withBorder radius="md" p="md"><Group justify="space-between" align="start"><Group gap="sm"><ThemeIcon size={42} radius="md" color="orange" variant="light"><TbCloud size={23}/></ThemeIcon>
                    <div><Group gap="xs"><Text fw={600}>{account.name}</Text><Badge color={account.lastError || !account.configured ? 'yellow' : 'teal'} variant="light">{account.lastError || !account.configured ? 'Проверьте доступ' : 'Подключён'}</Badge></Group>
                        <Text c="dimmed" size="sm">Доменов: {account.zoneCount} · {time(account.lastSyncedAt)}</Text>
                        {account.lastError && <Text c="orange" size="sm" mt={4}>{account.lastError}</Text>}</div></Group>
                    <Group gap="xs"><Button h={44} size="xs" variant="default" leftSection={<TbEdit size={16}/>} onClick={() => beginEdit(account)}>Изменить</Button>
                        <ActionIcon variant="subtle" color="red" size={44} aria-label={'Отключить аккаунт ' + account.name} onClick={() => { setDeleting(account); setDialogError('') }}><TbTrash size={18}/></ActionIcon></Group>
                </Group></Card>)}</Stack>}
        </Stack></Card>
        <Accordion variant="separated" radius="md"><Accordion.Item value="node-sync"><Accordion.Control icon={<TbLink size={20}/>}><Text fw={600}>Синхронизация с IP нод</Text><Text c="dimmed" size="sm">Домены для существующих правил смены IP</Text></Accordion.Control><Accordion.Panel>
            <Stack gap="md"><Text size="sm" c="dimmed">Выберите домены, которые должны обновляться вместе с IP связанной ноды. В автоматизации включите обновление Cloudflare в действии «Сменить IP». Для изменения конкретной записи используйте действие «Изменить IP домена».</Text>
                <Select size="md" label="Аккаунт" placeholder="Выберите аккаунт" value={accountId} onChange={changeAccount} searchable data={accounts.map(account => ({ value: account.id, label: account.name }))}/>
                {zonesLoading ? <Skeleton height={100} radius="md"/> : zones.map(zone => <Card key={zone.id} withBorder radius="md" p="sm"><Switch
                    label={zone.name} checked={bindings.some(binding => binding.account_id === zone.accountId && binding.zone_id === zone.id && binding.auto_sync)}
                    styles={{ root: { minHeight: 44, display: 'flex', alignItems: 'center' } }} disabled={busy} onChange={event => void toggleSync(zone, event.currentTarget.checked)}/></Card>)}
                {accountId && !zonesLoading && !zones.length && <Text size="sm" c="dimmed">Доступных доменов нет</Text>}
            </Stack>
        </Accordion.Panel></Accordion.Item></Accordion>
        <Modal opened={!!editing} onClose={() => { if (!busy) { setEditing(null); setToken('') } }} title={editing === 'new' ? 'Подключить аккаунт Cloudflare' : 'Изменить аккаунт'} centered>
            <form onSubmit={event => { event.preventDefault(); void save() }}><Stack gap="md">
                <TextInput size="md" label="Название аккаунта" placeholder="Например, Основные домены" value={name} maxLength={100} onChange={event => setName(event.currentTarget.value)} required autoFocus/>
                <PasswordInput size="md" label="API-токен" maxLength={512} placeholder={editing === 'new' ? 'Вставьте токен Cloudflare' : 'Оставьте пустым, чтобы сохранить текущий'} value={token} onChange={event => setToken(event.currentTarget.value)} autoComplete="new-password" required={editing === 'new'}
                    description="Разрешения: Zone Read, DNS Read и DNS Edit для нужных доменов."/>
                {dialogError && <Alert color="red">{dialogError}</Alert>}
                <Group justify="end"><Button h={44} variant="default" disabled={busy} onClick={() => { setEditing(null); setToken('') }}>Отмена</Button><Button h={44} type="submit" loading={busy} disabled={!name.trim() || (editing === 'new' && !token.trim())}>{editing === 'new' ? 'Проверить и подключить' : 'Сохранить'}</Button></Group>
            </Stack></form>
        </Modal>
        <Modal opened={!!deleting} onClose={() => !busy && setDeleting(null)} title="Отключить аккаунт?" centered><Stack gap="md">
            <Text>Аккаунт <b>{deleting?.name}</b> исчезнет из панели вместе с настройками синхронизации и связями с хостами. DNS-записи в Cloudflare сохранятся.</Text>
            <Text size="sm" c="dimmed">Сначала отключите автоматизации, использующие этот аккаунт.</Text>
            {dialogError && <Alert color="red">{dialogError}</Alert>}
            <Group justify="end"><Button h={44} variant="default" disabled={busy} onClick={() => setDeleting(null)}>Отмена</Button><Button h={44} color="red" loading={busy} onClick={() => void remove()}>Отключить аккаунт</Button></Group>
        </Stack></Modal>
    </Stack></Page>
}
