import {
    Accordion, ActionIcon, Alert, Badge, Button, Card, Divider, Group, Loader, Menu, Modal,
    Select, SimpleGrid, Skeleton, Stack, Switch, Tabs, Text, TextInput, ThemeIcon, Title, UnstyledButton,
} from '@mantine/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import {
    TbArrowRight, TbBolt, TbCheck, TbClock, TbCloud, TbCopy, TbDots, TbEdit, TbHistory,
    TbPlayerPlay, TbPlus, TbRefresh, TbRoute, TbSearch, TbShieldCheck, TbTrash,
} from 'react-icons/tb'
import { Page } from '@shared/ui'
import { nodeOptionLabel } from '@shared/utils/misc/node-option-label'
import { instance } from '@shared/api/axios'
import { AutomationBuilder, AutomationPreviewView } from './automation-builder'
import {
    actionLabels, actionSummary, apiError, automationApi, displayDate, executionStatuses,
    freshAutomation, triggerSummary, type AutomationExecution, type AutomationHost,
    type AutomationInput, type AutomationNode, type AutomationPreview, type AutomationRule, type CloudflareAccount,
} from './automations.types'
import classes from './automations.module.css'

const PAGE_SIZE = 50
const templates = [
    { id: 'offline', title: 'Резервный IP', description: 'Переключить недоступную ноду на запасной адрес', icon: TbRoute },
    { id: 'diagnostic', title: 'Проверка при падении', description: 'Проверить доступность хостов при снижении онлайна', icon: TbShieldCheck },
    { id: 'dns', title: 'IP домена', description: 'Изменить выбранную DNS-запись Cloudflare', icon: TbCloud },
] as const

function statusBadge(status?: string | null) {
    const state = executionStatuses[status ?? '']
    return state ? <Badge color={state.color} variant="light">{state.label}</Badge> : <Text size="xs" c="dimmed">Не запускалось</Text>
}

function toInput(rule: AutomationRule): AutomationInput {
    return {
        name: rule.name, node_uuid: rule.node_uuid, enabled: rule.enabled,
        trigger_type: rule.trigger_type || 'online_drop', drop_percent: rule.drop_percent,
        min_online: rule.min_online, duration_minutes: rule.duration_minutes, cooldown_minutes: rule.cooldown_minutes,
        interval_minutes: rule.interval_minutes || 60, failure_policy: rule.failure_policy || 'continue', actions: rule.actions,
    }
}

export function AutomationsPage() {
    const [rules, setRules] = useState<AutomationRule[]>([]), [nodes, setNodes] = useState<AutomationNode[]>([])
    const [hosts, setHosts] = useState<AutomationHost[]>([]), [accounts, setAccounts] = useState<CloudflareAccount[]>([])
    const [dpiCostLimit, setDpiCostLimit] = useState(1), [loading, setLoading] = useState(true)
    const [error, setError] = useState(''), [message, setMessage] = useState(''), [busyId, setBusyId] = useState<string | null>(null)
    const [tab, setTab] = useState<string | null>('rules'), [search, setSearch] = useState('')
    const [stateFilter, setStateFilter] = useState<string | null>('all'), [nodeFilter, setNodeFilter] = useState<string | null>(null)
    const [builderOpen, setBuilderOpen] = useState(false), [draft, setDraft] = useState<AutomationInput | null>(null)
    const [editingId, setEditingId] = useState<string | null>(null), [initialStep, setInitialStep] = useState(0)
    const [deleteRule, setDeleteRule] = useState<AutomationRule | null>(null)
    const [runRule, setRunRule] = useState<AutomationRule | null>(null), [runPreview, setRunPreview] = useState<AutomationPreview | null>(null)
    const [previewLoading, setPreviewLoading] = useState(false), [previewError, setPreviewError] = useState('')
    const [executions, setExecutions] = useState<AutomationExecution[]>([]), [historyLoading, setHistoryLoading] = useState(false)
    const [historyStatus, setHistoryStatus] = useState<string | null>(null), [historyRule, setHistoryRule] = useState<string | null>(null)
    const [historyMore, setHistoryMore] = useState(false), [historyError, setHistoryError] = useState('')
    const [params, setParams] = useSearchParams()
    const handledQuery = useRef(''), historyRequest = useRef(0), previewRequest = useRef(0)

    const loadRules = useCallback(async () => {
        const result = await instance.get(automationApi)
        setRules(result.data.response)
    }, [])
    const loadHistory = useCallback(async (cursor?: string, filters?: { ruleId: string | null; status: string | null }) => {
        const request = ++historyRequest.current
        setHistoryLoading(true); setHistoryError('')
        try {
            const result = await instance.get(`${automationApi}/executions`, { params: { ruleId: (filters ? filters.ruleId : historyRule) || undefined, status: (filters ? filters.status : historyStatus) || undefined, limit: PAGE_SIZE, cursor } })
            if (request !== historyRequest.current) return
            const rows = result.data.response as AutomationExecution[]
            setExecutions(previous => cursor ? [...previous, ...rows.filter(row => !previous.some(item => item.id === row.id))] : rows)
            setHistoryMore(rows.length === PAGE_SIZE)
        } catch (error) { if (request === historyRequest.current) setHistoryError(apiError(error, 'Не удалось загрузить журнал')) }
        finally { if (request === historyRequest.current) setHistoryLoading(false) }
    }, [historyRule, historyStatus])

    useEffect(() => {
        let active = true
        void Promise.all([instance.get(automationApi), instance.get(`${automationApi}/options`), instance.get('/api/cloudflare-dns/accounts')])
            .then(([r, o, a]) => {
                if (!active) return
                setRules(r.data.response); setNodes(o.data.response.nodes); setHosts(o.data.response.hosts)
                setDpiCostLimit(o.data.response.dpiCostLimitUsd); setAccounts(a.data.response)
            }).catch(error => { if (active) setError(apiError(error, 'Не удалось загрузить автоматизации')) })
            .finally(() => { if (active) setLoading(false) })
        return () => { active = false }
    }, [])
    useEffect(() => { void loadHistory(); return () => { historyRequest.current += 1 } }, [loadHistory])
    useEffect(() => {
        const timer = setInterval(() => {
            void loadRules().catch(() => undefined)
            if (tab === 'history' && executions.some(execution => execution.status === 'running') && executions.length <= PAGE_SIZE) void loadHistory()
        }, 15000)
        return () => clearInterval(timer)
    }, [loadRules, loadHistory, tab, executions])
    useEffect(() => {
        const query = params.toString()
        if (loading || !query || handledQuery.current === query) return
        const accountId = params.get('accountId'), zoneId = params.get('zoneId'), recordId = params.get('recordId')
        if (!accountId || !zoneId || !recordId) return
        handledQuery.current = query
        setDraft({ ...freshAutomation(), name: 'Изменение IP домена', trigger_type: 'manual', actions: [{ type: 'cloudflare_dns', accountId, zoneId, recordId, ipSource: 'static', newIp: '' }] })
        setEditingId(null); setInitialStep(1); setBuilderOpen(true); setParams({}, { replace: true })
    }, [loading, params, setParams])

    const refresh = async () => {
        setError('')
        try {
            const [options, accountData] = await Promise.all([instance.get(`${automationApi}/options`), instance.get('/api/cloudflare-dns/accounts'), loadRules(), loadHistory()])
            setNodes(options.data.response.nodes); setHosts(options.data.response.hosts); setDpiCostLimit(options.data.response.dpiCostLimitUsd); setAccounts(accountData.data.response)
        } catch (error) { setError(apiError(error, 'Не удалось обновить данные')) }
    }
    const openBuilder = (rule?: AutomationRule, template?: typeof templates[number]['id']) => {
        const initial = rule ? toInput(rule) : freshAutomation()
        if (template === 'offline') Object.assign(initial, { name: 'Резервный IP ноды', trigger_type: 'node_offline', actions: [{ type: 'rotate_ip', updateCloudflare: false }] })
        if (template === 'diagnostic') Object.assign(initial, { name: 'Проверка при падении онлайна', actions: [{ type: 'dpi_check', hosts: [], location: 'russia' }] })
        if (template === 'dns') Object.assign(initial, { name: 'Изменение IP домена', trigger_type: 'manual', actions: [{ type: 'cloudflare_dns', accountId: '', zoneId: '', recordId: '', ipSource: 'static', newIp: '' }] })
        setDraft(initial); setEditingId(rule?.id ?? null); setInitialStep(0); setBuilderOpen(true)
    }
    const save = async (value: AutomationInput) => {
        if (editingId) await instance.put(`${automationApi}/${editingId}`, value)
        else await instance.post(automationApi, value)
        await loadRules(); setMessage(editingId ? 'Изменения сохранены' : 'Правило создано')
    }
    const mutate = async (id: string, action: () => Promise<unknown>, success: string) => {
        setBusyId(id); setError(''); setMessage('')
        try { await action(); await loadRules(); setMessage(success) }
        catch (error) { setError(apiError(error, 'Не удалось выполнить действие')) }
        finally { setBusyId(null) }
    }
    const openRun = async (rule: AutomationRule) => {
        const request = ++previewRequest.current
        setRunRule(rule); setRunPreview(null); setPreviewError(''); setPreviewLoading(true)
        try {
            const result = await instance.post(`${automationApi}/${rule.id}/preview`)
            if (request === previewRequest.current) setRunPreview(result.data.response)
        } catch (error) { if (request === previewRequest.current) setPreviewError(apiError(error, 'Не удалось проверить сценарий')) }
        finally { if (request === previewRequest.current) setPreviewLoading(false) }
    }
    const executeNow = async () => {
        if (!runRule) return
        setBusyId(runRule.id); setPreviewError('')
        try {
            await instance.post(`${automationApi}/${runRule.id}/run`, { confirmed: true, expectedRevision: runRule.revision, expectedUpdatedAt: runRule.updated_at })
            setRunRule(null); setTab('history'); setHistoryRule(runRule.id); setHistoryStatus(null)
            setMessage('Выполнение запущено. Результаты действий появятся в журнале.')
            await Promise.all([loadRules(), loadHistory(undefined, { ruleId: runRule.id, status: null })])
        } catch (error) { setPreviewError(apiError(error, 'Не удалось запустить правило')) }
        finally { setBusyId(null) }
    }

    const visibleRules = useMemo(() => rules.filter(rule => {
        const needle = search.trim().toLocaleLowerCase('ru-RU')
        const matchesSearch = !needle || [rule.name, rule.node_name || '', ...rule.actions.map(actionSummary)].join(' ').toLocaleLowerCase('ru-RU').includes(needle)
        return matchesSearch && (!nodeFilter || rule.node_uuid === nodeFilter) &&
            (stateFilter === 'all' || (stateFilter === 'enabled' && rule.enabled && rule.trigger_type !== 'manual') ||
                (stateFilter === 'paused' && !rule.enabled && rule.trigger_type !== 'manual') || (stateFilter === 'manual' && rule.trigger_type === 'manual'))
    }), [rules, search, nodeFilter, stateFilter])
    const activeCount = rules.filter(rule => rule.enabled && rule.trigger_type !== 'manual').length
    const errorsCount = rules.filter(rule => ['failed', 'partial_failure'].includes(rule.last_status || '')).length

    return <Page title="Автоматизации"><Stack gap="lg">
        <div className={classes.header}>
            <Group gap="sm" wrap="nowrap" align="flex-start"><ThemeIcon size={48} radius="md" variant="light"><TbRoute size={27} /></ThemeIcon><div>
                <Title order={2}>Автоматизации</Title><Text size="sm" c="dimmed" mt={4}>Условия, действия и результат каждого запуска</Text>
            </div></Group>
            <Group gap="sm"><Button variant="default" h={44} leftSection={<TbRefresh size={18} />} onClick={() => void refresh()}>Обновить</Button>
                <Button h={44} leftSection={<TbPlus size={18} />} onClick={() => openBuilder()}>Создать правило</Button></Group>
        </div>
        {error && <Alert color="red" role="alert" withCloseButton onClose={() => setError('')}>{error}</Alert>}
        {message && <Alert color="teal" icon={<TbCheck size={18} />} role="status" withCloseButton onClose={() => setMessage('')}>{message}</Alert>}
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
            {[['Всего правил', rules.length, TbRoute, 'blue'], ['Автоматически включено', activeCount, TbBolt, 'teal'], ['Правила с последней ошибкой', errorsCount, TbHistory, errorsCount ? 'orange' : 'gray']].map(([label, count, Icon, color]) => {
                const MetricIcon = Icon as typeof TbRoute
                return <Card key={String(label)} withBorder radius="md" p="md"><Group justify="space-between"><div><Text size="sm" c="dimmed">{String(label)}</Text><Text size="xl" fw={700} mt={4}>{loading ? '—' : Number(count)}</Text></div><ThemeIcon color={String(color)} variant="light" size={42} radius="md"><MetricIcon size={22} /></ThemeIcon></Group></Card>
            })}
        </SimpleGrid>
        <Tabs value={tab} onChange={setTab}>
            <Tabs.List><Tabs.Tab value="rules" leftSection={<TbRoute size={18} />} h={44}>Правила</Tabs.Tab><Tabs.Tab value="history" leftSection={<TbHistory size={18} />} h={44}>Журнал запусков</Tabs.Tab></Tabs.List>
            <Tabs.Panel value="rules" pt="lg"><Stack gap="md">
                <div className={classes.toolbar}>
                    <TextInput aria-label="Поиск правил" placeholder="Найти правило, ноду или домен" leftSection={<TbSearch size={18} />} value={search} onChange={event => setSearch(event.currentTarget.value)} />
                    <Select aria-label="Состояние правил" allowDeselect={false} value={stateFilter} onChange={setStateFilter} data={[{ value: 'all', label: 'Все состояния' }, { value: 'enabled', label: 'Включены' }, { value: 'paused', label: 'На паузе' }, { value: 'manual', label: 'Ручные' }]} />
                    <Select aria-label="Фильтр по ноде" searchable clearable placeholder="Все ноды" value={nodeFilter} onChange={setNodeFilter} data={nodes.map(node => ({ value: node.uuid, label: nodeOptionLabel(node) }))} />
                </div>
                {loading ? [0, 1].map(key => <Skeleton key={key} height={160} radius="md" />) : !rules.length ? <Card withBorder radius="md" p="xl"><Stack align="center" gap="sm">
                    <ThemeIcon variant="light" size={56} radius="xl"><TbRoute size={28} /></ThemeIcon><Title order={4}>Соберите первый сценарий</Title>
                    <Text c="dimmed" size="sm" ta="center" maw={440}>Выберите условие, добавьте действия и проверьте сценарий перед включением.</Text>
                    <Button mt="sm" h={44} leftSection={<TbPlus size={18} />} onClick={() => openBuilder()}>Новая автоматизация</Button>
                </Stack></Card> : !visibleRules.length ? <Card withBorder radius="md" p="xl"><Text ta="center" c="dimmed">По выбранным фильтрам правил нет</Text><Group justify="center" mt="md"><Button variant="light" onClick={() => { setSearch(''); setStateFilter('all'); setNodeFilter(null) }}>Сбросить фильтры</Button></Group></Card> : visibleRules.map(rule => {
                    const running = !!rule.active_execution_id && !!rule.execution_lease_until && new Date(rule.execution_lease_until).getTime() > Date.now()
                    return <Card key={rule.id} withBorder radius="md" p="lg" className={`${classes.rule} ${!rule.enabled ? classes.paused : ''}`}>
                        <div className={classes.ruleBody}>
                            <div><Group gap="sm"><Text fw={700}>{rule.name}</Text>
                                <Badge variant="light" color={running ? 'blue' : rule.trigger_type === 'manual' ? 'violet' : rule.enabled ? 'teal' : 'gray'}>{running ? 'Выполняется' : rule.trigger_type === 'manual' ? 'Ручное правило' : rule.enabled ? 'Включено' : 'На паузе'}</Badge>
                                {rule.pending_since && !running && rule.enabled && <Badge variant="light" color="orange">Подтверждение условия</Badge>}</Group>
                                <Text size="sm" c="dimmed" mt={6}>{triggerSummary(rule)}{rule.node_name ? ` · ${rule.node_name}` : ''}</Text>
                            </div>
                            <Group gap="xs" wrap="wrap">
                                {rule.trigger_type !== 'manual' && <Switch aria-label={`Включить правило ${rule.name}`} label={rule.enabled ? 'Вкл.' : 'Пауза'} checked={rule.enabled} disabled={busyId === rule.id}
                                    onChange={() => void mutate(rule.id, () => instance.put(`${automationApi}/${rule.id}/enabled`, { enabled: !rule.enabled }), rule.enabled ? 'Автоматические запуски приостановлены' : 'Автоматические запуски включены')} />}
                                <Button h={44} size="sm" variant="light" leftSection={<TbPlayerPlay size={17} />} disabled={running || busyId === rule.id} onClick={() => void openRun(rule)}>Запустить</Button>
                                <ActionIcon h={44} w={44} variant="subtle" aria-label={`Редактировать ${rule.name}`} disabled={running} onClick={() => openBuilder(rule)}><TbEdit size={19} /></ActionIcon>
                                <Menu position="bottom-end" withinPortal><Menu.Target><ActionIcon h={44} w={44} variant="subtle" aria-label={`Действия с правилом ${rule.name}`}><TbDots size={20} /></ActionIcon></Menu.Target>
                                    <Menu.Dropdown>
                                        <Menu.Item leftSection={<TbCopy size={17} />} disabled={busyId === rule.id} onClick={() => void mutate(rule.id, () => instance.post(`${automationApi}/${rule.id}/duplicate`), 'Копия создана на паузе')}>Создать копию</Menu.Item>
                                        <Menu.Item leftSection={<TbHistory size={17} />} onClick={() => { setHistoryRule(rule.id); setHistoryStatus(null); setTab('history') }}>Журнал правила</Menu.Item>
                                        <Menu.Divider /><Menu.Item leftSection={<TbTrash size={17} />} color="red" disabled={running} onClick={() => setDeleteRule(rule)}>Удалить правило</Menu.Item>
                                    </Menu.Dropdown>
                                </Menu>
                            </Group>
                        </div>
                        <div className={classes.pipeline}>{rule.actions.map((action, index) => <Group key={index} gap={8} wrap="nowrap"><div className={classes.step}><span className={classes.stepIndex}>{index + 1}</span>{actionSummary(action)}</div>{index < rule.actions.length - 1 && <TbArrowRight size={16} color="var(--mantine-color-dimmed)" aria-hidden />}</Group>)}</div>
                        <Divider my="md" /><Group justify="space-between" gap="sm"><Group gap="xs"><TbClock size={15} /><Text size="xs" c="dimmed">Последний запуск: {displayDate(rule.last_run_at)}</Text>{statusBadge(rule.last_status)}</Group>
                            <Text size="xs" c="dimmed">При ошибке: {rule.failure_policy === 'stop' ? 'остановить сценарий' : 'продолжить'}</Text></Group>
                    </Card>
                })}
                <div><Text size="sm" fw={600} mt="md" mb="sm">Начать с шаблона</Text><SimpleGrid cols={{ base: 1, sm: 3 }}>{templates.map(template => <UnstyledButton key={template.id} className={classes.template} onClick={() => openBuilder(undefined, template.id)}>
                    <Group gap="sm" mb="xs"><template.icon size={21} /><Text fw={600} size="sm">{template.title}</Text></Group><Text size="xs" c="dimmed">{template.description}</Text>
                </UnstyledButton>)}</SimpleGrid></div>
            </Stack></Tabs.Panel>
            <Tabs.Panel value="history" pt="lg"><Stack gap="md">
                <Group justify="space-between"><div><Title order={4}>Журнал запусков</Title><Text size="sm" c="dimmed">Результат каждого действия, включая ручные запуски</Text></div><Button variant="default" h={44} loading={historyLoading} leftSection={<TbRefresh size={17} />} onClick={() => void loadHistory()}>Обновить журнал</Button></Group>
                <SimpleGrid cols={{ base: 1, sm: 2 }}><Select searchable clearable aria-label="Правило в журнале" placeholder="Все правила" value={historyRule} onChange={setHistoryRule} data={rules.map(rule => ({ value: rule.id, label: rule.name }))} />
                    <Select clearable aria-label="Результат запуска" placeholder="Все результаты" value={historyStatus} onChange={setHistoryStatus} data={Object.entries(executionStatuses).map(([value, status]) => ({ value, label: status.label }))} /></SimpleGrid>
                {historyError && <Alert color="red" role="alert">{historyError}</Alert>}
                {historyLoading && !executions.length ? <Skeleton height={160} radius="md" /> : !executions.length ? <Card withBorder radius="md" p="xl"><Stack align="center" gap="xs"><TbHistory size={28} /><Text fw={600}>Запусков пока нет</Text><Text c="dimmed" size="sm" ta="center">После выполнения правила здесь появятся его действия и результаты.</Text></Stack></Card>
                    : <Accordion variant="separated" radius="md">{executions.map(execution => <Accordion.Item key={execution.id} value={execution.id}>
                        <Accordion.Control><Group justify="space-between" gap="sm" pr="sm"><div><Group gap="sm"><Text fw={600} size="sm">{execution.name}</Text>{!execution.rule_id && <Badge size="xs" color="gray">Правило удалено</Badge>}</Group><Text size="xs" c="dimmed" mt={4}>{displayDate(execution.started_at)} · {execution.source === 'manual' ? 'Вручную' : 'Автоматически'}{execution.node_name ? ` · ${execution.node_name}` : ''}</Text></div>{statusBadge(execution.status)}</Group></Accordion.Control>
                        <Accordion.Panel><Stack gap="sm">
                            {execution.trigger_snapshot?.reason && <Text size="sm" c="dimmed">Условие: {execution.trigger_snapshot.reason}</Text>}
                            {(Array.isArray(execution.details) ? execution.details : []).map((detail, index) => <Card key={index} withBorder radius="md" p="sm"><Group wrap="nowrap" align="flex-start" gap="sm"><span className={classes.stepIndex}>{index + 1}</span><div style={{ minWidth: 0 }}>
                                <Group gap="sm"><Text size="sm" fw={600}>{detail.title || actionLabels[detail.type as keyof typeof actionLabels] || 'Действие'}</Text><Badge size="xs" color={detail.status === 'skipped' ? 'gray' : detail.success ? 'teal' : 'red'}>{detail.status === 'skipped' ? 'Пропущено' : detail.success ? 'Выполнено' : 'Ошибка'}</Badge></Group>
                                <Text size="sm" mt={4} className={classes.detailMessage}>{detail.message}</Text>
                            </div></Group></Card>)}
                            {!execution.details?.length && <Text size="sm" c="dimmed">Первое действие ещё выполняется</Text>}
                            {execution.finished_at && <Text size="xs" c="dimmed">Завершено: {displayDate(execution.finished_at)}</Text>}
                        </Stack></Accordion.Panel>
                    </Accordion.Item>)}</Accordion>}
                {historyMore && <Group justify="center"><Button variant="light" h={44} loading={historyLoading} onClick={() => void loadHistory(executions.at(-1)?.id)}>Показать ещё</Button></Group>}
            </Stack></Tabs.Panel>
        </Tabs>

        <AutomationBuilder opened={builderOpen} initial={draft} initialStep={initialStep} editing={!!editingId} nodes={nodes} hosts={hosts} accounts={accounts} dpiCostLimit={dpiCostLimit} onClose={() => setBuilderOpen(false)} onSave={save} />
        <Modal opened={!!runRule} onClose={() => { previewRequest.current += 1; setRunRule(null) }} title="Запустить правило сейчас?" size="lg" centered closeOnClickOutside={!busyId} closeOnEscape={!busyId}>
            <Stack gap="md"><Text fw={600}>{runRule?.name}</Text><Alert color="orange">Действия выполнятся сразу, независимо от условия запуска и паузы правила. Изменения IP и доступности хостов вступят в силу.</Alert>
                {previewError && <Alert color="red" role="alert">{previewError}</Alert>}
                {previewLoading ? <Group justify="center" py="md"><Loader size="sm" /><Text size="sm">Проверяем сценарий…</Text></Group> : runPreview ? <AutomationPreviewView preview={runPreview} /> : null}
                <Group justify="flex-end"><Button variant="default" h={44} disabled={!!busyId} onClick={() => { previewRequest.current += 1; setRunRule(null) }}>Отмена</Button>
                    <Button color="orange" h={44} leftSection={<TbPlayerPlay size={18} />} loading={!!busyId} disabled={previewLoading || !runPreview?.valid} onClick={() => void executeNow()}>Выполнить действия</Button></Group>
            </Stack>
        </Modal>
        <Modal opened={!!deleteRule} onClose={() => setDeleteRule(null)} title="Удалить правило?" centered><Stack>
            <Text>Правило «{deleteRule?.name}» будет удалено. История его выполнений сохранится.</Text>
            <Group justify="flex-end"><Button variant="default" h={44} onClick={() => setDeleteRule(null)}>Отмена</Button><Button color="red" h={44} onClick={() => { if (deleteRule) { const rule = deleteRule; setDeleteRule(null); void mutate(rule.id, () => instance.delete(`${automationApi}/${rule.id}`), 'Правило удалено, история сохранена') } }}>Удалить</Button></Group>
        </Stack></Modal>
    </Stack></Page>
}
