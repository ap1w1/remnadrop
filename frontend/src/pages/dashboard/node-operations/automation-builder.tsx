import {
    ActionIcon, Alert, Badge, Button, Card, Checkbox, Divider, Drawer, Group, Loader,
    MultiSelect, NumberInput, Select, SimpleGrid, Stack, Stepper, Switch, Text, TextInput, Title,
} from '@mantine/core'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { TbArrowDown, TbArrowUp, TbCheck, TbPlayerPlay, TbPlus, TbShieldCheck, TbTrash } from 'react-icons/tb'
import { instance } from '@shared/api/axios'
import { nodeOptionLabel } from '@shared/utils/misc/node-option-label'
import {
    actionLabels, apiError, automationApi, freshAutomation, triggerLabels, triggerSummary,
    type AutomationAction, type AutomationHost, type AutomationInput, type AutomationNode,
    type AutomationPreview, type CloudflareAccount,
} from './automations.types'
import classes from './automations.module.css'

type DnsAction = Extract<AutomationAction, { type: 'cloudflare_dns' }>
type Zone = { id: string; name: string }
type DnsRecord = { id: string; name: string; type: string; content: string }

function DnsActionFields({ action, accounts, hasRotation, onChange }: {
    action: DnsAction; accounts: CloudflareAccount[]; hasRotation: boolean; onChange: (action: DnsAction) => void
}) {
    const [zones, setZones] = useState<Zone[]>([])
    const [records, setRecords] = useState<DnsRecord[]>([])
    const [zonesLoading, setZonesLoading] = useState(false), [recordsLoading, setRecordsLoading] = useState(false)
    const [error, setError] = useState('')
    useEffect(() => {
        const controller = new AbortController()
        setZones([]); setError(''); setZonesLoading(false)
        if (!action.accountId) return () => controller.abort()
        setZonesLoading(true)
        void instance.get('/api/cloudflare-dns/zones', { params: { accountId: action.accountId }, signal: controller.signal })
            .then(result => { if (!controller.signal.aborted) setZones(result.data.response) })
            .catch(error => { if (!controller.signal.aborted) setError(apiError(error, 'Не удалось загрузить домены аккаунта')) })
            .finally(() => { if (!controller.signal.aborted) setZonesLoading(false) })
        return () => controller.abort()
    }, [action.accountId])
    useEffect(() => {
        const controller = new AbortController()
        setRecords([]); setRecordsLoading(false)
        if (!action.accountId || !action.zoneId) return () => controller.abort()
        setRecordsLoading(true)
        void instance.get(`/api/cloudflare-dns/zones/${action.zoneId}/records`, { params: { accountId: action.accountId }, signal: controller.signal })
            .then(result => { if (!controller.signal.aborted) setRecords((result.data.response as DnsRecord[]).filter(record => ['A', 'AAAA'].includes(record.type))) })
            .catch(error => { if (!controller.signal.aborted) setError(apiError(error, 'Не удалось загрузить DNS-записи')) })
            .finally(() => { if (!controller.signal.aborted) setRecordsLoading(false) })
        return () => controller.abort()
    }, [action.accountId, action.zoneId])
    const selected = records.find(record => record.id === action.recordId)
    return <Stack gap="sm">
        {!accounts.length && <Alert color="blue" title="Подключите Cloudflare">
            <Text size="sm" mb="sm">Добавьте аккаунт, чтобы выбрать домен для автоматизации.</Text>
            <Button component={Link} to="/dashboard/tools/cloudflare-dns/settings" variant="light" size="sm">Добавить аккаунт</Button>
        </Alert>}
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select label="Аккаунт Cloudflare" placeholder="Выберите аккаунт" searchable data={accounts.map(account => ({ value: account.id, label: account.name }))}
                value={action.accountId || null} onChange={value => onChange({ ...action, accountId: value || '', zoneId: '', recordId: '', domain: undefined, expectedOldIp: undefined })} />
            <Select label="Домен" placeholder={zonesLoading ? 'Загрузка доменов…' : 'Выберите домен'} searchable disabled={!action.accountId || zonesLoading}
                rightSection={zonesLoading ? <Loader size="xs" /> : undefined} data={zones.map(zone => ({ value: zone.id, label: zone.name }))}
                value={action.zoneId || null} onChange={value => onChange({ ...action, zoneId: value || '', recordId: '', domain: undefined, expectedOldIp: undefined })} />
        </SimpleGrid>
        <Select label="DNS-запись" description="Выберите конкретную запись A или AAAA" searchable disabled={!action.zoneId || recordsLoading}
            placeholder={recordsLoading ? 'Загрузка записей…' : 'Выберите запись'} rightSection={recordsLoading ? <Loader size="xs" /> : undefined}
            data={records.map(record => ({ value: record.id, label: `${record.type} · ${record.name} → ${record.content}` }))}
            value={action.recordId || null} onChange={value => onChange({ ...action, recordId: value || '', domain: records.find(record => record.id === value)?.name, expectedOldIp: undefined })} />
        <Select label="Откуда взять новый IP" allowDeselect={false} value={action.ipSource}
            data={[{ value: 'static', label: 'Указать адрес' }, { value: 'rotated', label: 'Из предыдущего действия «Сменить IP ноды»', disabled: !hasRotation }]}
            onChange={value => onChange({ ...action, ipSource: value as DnsAction['ipSource'], expectedOldIp: undefined })} />
        {action.ipSource === 'static' ? <>
            <TextInput label="Новый IP" placeholder={selected?.type === 'AAAA' ? 'IPv6-адрес' : 'IPv4-адрес'} value={action.newIp || ''}
                onChange={event => onChange({ ...action, newIp: event.currentTarget.value.trim() })} />
            <Checkbox label="Менять только при совпадении старого IP" checked={action.expectedOldIp !== undefined}
                onChange={event => onChange({ ...action, expectedOldIp: event.currentTarget.checked ? selected?.content || '' : undefined })} />
            {action.expectedOldIp !== undefined && <TextInput label="Ожидаемый старый IP" value={action.expectedOldIp}
                onChange={event => onChange({ ...action, expectedOldIp: event.currentTarget.value.trim() })} />}
        </> : <Text size="sm" c="dimmed">Будет использован новый IP после успешной смены адреса ноды. Обновится только выбранная DNS-запись с совпадающим старым IP.</Text>}
        {error && <Alert color="red">{error}</Alert>}
    </Stack>
}


type DpiAction = Extract<AutomationAction, { type: 'dpi_check' }>
type DpiPop = { id: number; name?: string; city?: string; region?: string; operator?: string }
function DpiRegionFields({ action, onChange, dpiCostLimit }: {
    action: DpiAction; onChange: (action: DpiAction) => void; dpiCostLimit: number
}) {
    const [pops, setPops] = useState<DpiPop[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const specificPoints = action.pop_ids !== undefined
    useEffect(() => {
        if (!specificPoints) { setPops([]); return }
        const controller = new AbortController()
        setPops([]); setError(''); setLoading(true)
        void instance.get('/api/dpi-checker/pops', { params: { location: action.location }, signal: controller.signal })
            .then(response => {
                if (controller.signal.aborted) return
                const data = response.data.response
                setPops(Array.isArray(data) ? data : Array.isArray(data?.pops) ? data.pops : [])
            })
            .catch(cause => { if (!controller.signal.aborted) setError(apiError(cause, 'Не удалось получить региональные точки проверки')) })
            .finally(() => { if (!controller.signal.aborted) setLoading(false) })
        return () => controller.abort()
    }, [action.location, specificPoints])
    return <Stack gap="sm">
        <Select label="Страна и тип сети" searchable allowDeselect={false} value={action.location}
            data={[{ value: 'russia', label: 'Россия' }, { value: 'russia_mobile', label: 'Россия · мобильные сети' },
                { value: 'china', label: 'Китай' }, { value: 'iran', label: 'Иран' }, { value: 'turkmenistan', label: 'Туркменистан' }]}
            onChange={value => onChange({ ...action, location: value || 'russia', pop_ids: specificPoints ? [] : undefined })}/>
        <Switch label="Выбирать конкретные регионы и точки проверки"
            description="Отключено — сервис самостоятельно выбирает оптимальные точки; включено — выбирайте города, регионы и операторов из доступных PoP"
            checked={specificPoints} onChange={event => onChange({ ...action, pop_ids: event.currentTarget.checked ? [] : undefined })}/>
        {specificPoints && <MultiSelect label="Регионы и точки проверки (PoP)" searchable clearable
            placeholder={loading ? 'Загрузка регионов…' : 'Найти город, регион или оператора'} disabled={loading}
            maxValues={100} value={(action.pop_ids ?? []).map(String)}
            onChange={values => onChange({ ...action, pop_ids: values.map(Number) })}
            data={pops.map(pop => ({ value: String(pop.id), label: [pop.name, pop.city, pop.region, pop.operator]
                .filter(Boolean).filter((item, index, all) => all.indexOf(item) === index).join(' · ') || 'PoP ' + pop.id }))}/>}
        {error && <Alert color="red">{error}</Alert>}
        <Text size="xs" c="dimmed">Проверка платная, не более ${dpiCostLimit} USD за действие. Результат отображается в DPI Checker. Выбор PoP пока не задаёт автоматическое ветвление после проверки.</Text>
    </Stack>
}

export function AutomationPreviewView({ preview }: { preview: AutomationPreview }) {
    return <Stack gap="md">
        <Card withBorder radius="md" p="md">
            <Group gap="xs" mb="xs"><TbShieldCheck size={19} /><Text fw={600}>Проверка сценария</Text><Badge color={preview.valid ? 'teal' : 'red'} variant="light">{preview.valid ? 'Готов к запуску' : 'Нужно исправить'}</Badge></Group>
            <Text size="sm">{preview.trigger.reason}</Text>
            {preview.trigger.online !== null && <Text size="sm" c="dimmed">Онлайн: {preview.trigger.online} · исходный: {preview.trigger.baseline?.toFixed(0) ?? 'нет данных'}{preview.trigger.dropPercent !== null ? ` · падение ${preview.trigger.dropPercent.toFixed(1)}%` : ''}</Text>}
            {preview.trigger.nextRunAt && <Text size="sm" c="dimmed">Следующий запуск: {new Date(preview.trigger.nextRunAt).toLocaleString('ru-RU')}</Text>}
            {preview.trigger.confirmSeconds > 0 && <Text size="sm" c="dimmed">До подтверждения условия: {Math.ceil(preview.trigger.confirmSeconds / 60)} мин</Text>}
            {preview.trigger.cooldownSeconds > 0 && <Text size="sm" c="dimmed">Пауза автоматических запусков: ещё {Math.ceil(preview.trigger.cooldownSeconds / 60)} мин</Text>}
        </Card>
        {preview.actions.map(action => <Card key={action.index} withBorder radius="md" p="md">
            <Group gap="sm" align="flex-start" wrap="nowrap"><span className={classes.stepIndex}>{action.index + 1}</span><Stack gap={4} style={{ minWidth: 0 }}>
                <Text fw={600} size="sm">{action.title}</Text>
                <Text size="sm" className={classes.detailMessage}>{action.target || 'Выбранные объекты'}</Text>
                {action.warnings.map(warning => <Text key={warning} size="xs" c="dimmed">{warning}</Text>)}
                {action.error && <Text size="sm" c="red" role="alert">{action.error}</Text>}
            </Stack></Group>
        </Card>)}
        <Text size="xs" c="dimmed">Проверка не выполняет действия. При ошибке: {preview.failurePolicy === 'stop' ? 'остановить следующие действия' : 'продолжить остальные действия'}.</Text>
    </Stack>
}

function emptyAction(type: AutomationAction['type']): AutomationAction {
    if (type === 'cloudflare_dns') return { type, accountId: '', zoneId: '', recordId: '', ipSource: 'static', newIp: '' }
    if (type === 'webhook') return { type, url: '' }
    if (type === 'rotate_ip') return { type, updateCloudflare: false }
    if (type === 'dpi_check') return { type, hosts: [], location: 'russia' }
    return { type, hosts: [] }
}

export function AutomationBuilder({ opened, initial, initialStep = 0, editing, nodes, hosts, accounts, dpiCostLimit,
    onClose, onSave }: {
    opened: boolean; initial: AutomationInput | null; initialStep?: number; editing: boolean;
    nodes: AutomationNode[]; hosts: AutomationHost[]; accounts: CloudflareAccount[]; dpiCostLimit: number;
    onClose: () => void; onSave: (value: AutomationInput) => Promise<void>
}) {
    const [draft, setDraft] = useState<AutomationInput>(freshAutomation)
    const [step, setStep] = useState(0), [error, setError] = useState('')
    const [checking, setChecking] = useState(false), [saving, setSaving] = useState(false)
    const [preview, setPreview] = useState<AutomationPreview | null>(null)
    const [addType, setAddType] = useState<AutomationAction['type'] | null>(null)
    useEffect(() => {
        if (opened) { setDraft(structuredClone(initial ?? freshAutomation())); setStep(initialStep); setError(''); setPreview(null); setAddType(null) }
    }, [opened, initial, initialStep])
    const change = (value: Partial<AutomationInput>) => { setDraft(previous => ({ ...previous, ...value })); setPreview(null); setError('') }
    const setAction = (index: number, action: AutomationAction) => change({ actions: draft.actions.map((item, position) => position === index ? action : item) })
    const move = (index: number, delta: number) => {
        const actions = [...draft.actions]; [actions[index], actions[index + delta]] = [actions[index + delta], actions[index]]; change({ actions })
    }
    const requiresNode = ['online_drop', 'online_value', 'node_offline'].includes(draft.trigger_type) || draft.actions.some(action => ['rotate_ip', 'hide_hosts', 'show_hosts', 'dpi_check'].includes(action.type))
    const nodeHosts = hosts.filter(host => host.node_uuids.includes(draft.node_uuid ?? ''))
    const check = async () => {
        setChecking(true); setError(''); setPreview(null)
        try { setPreview((await instance.post(`${automationApi}/preview`, draft)).data.response); return true }
        catch (error) { setError(apiError(error, 'Не удалось проверить сценарий')); return false }
        finally { setChecking(false) }
    }
    const next = async () => {
        if (step === 0) {
            if (draft.name.trim().length < 2) { setError('Введите название правила: не меньше 2 символов'); return }
            if (requiresNode && !draft.node_uuid) { setError('Выберите ноду для этого сценария'); return }
            setError(''); setStep(1)
        } else { setStep(2); await check() }
    }
    const save = async () => {
        setSaving(true); setError('')
        try { await onSave(draft); onClose() } catch (error) { setError(apiError(error, 'Не удалось сохранить правило')) } finally { setSaving(false) }
    }
    return <Drawer opened={opened} onClose={onClose} title={<Text fw={700} size="lg">{editing ? 'Редактировать автоматизацию' : 'Новая автоматизация'}</Text>}
        position="right" size="xl" closeOnClickOutside={!saving} closeOnEscape={!saving} withCloseButton={!saving}>
        <Stack gap="lg">
            <Stepper active={step} size="sm" allowNextStepsSelect={false} onStepClick={value => { if (value < step) { setStep(value); setPreview(null); setError('') } }}>
                <Stepper.Step label="Условие" /><Stepper.Step label="Действия" /><Stepper.Step label="Проверка" />
            </Stepper>
            {error && <Alert color="red" role="alert">{error}</Alert>}
            {step === 0 && <Stack gap="md">
                <TextInput label="Название" placeholder="Например, резервный IP для Финляндии" maxLength={80} value={draft.name} onChange={event => change({ name: event.currentTarget.value })} required />
                <Select label="Когда запускать" allowDeselect={false} value={draft.trigger_type} data={Object.entries(triggerLabels).map(([value, label]) => ({ value, label }))}
                    onChange={value => change({ trigger_type: value as AutomationInput['trigger_type'], cooldown_minutes: value === 'interval' ? Math.min(draft.cooldown_minutes, draft.interval_minutes) : draft.cooldown_minutes })} />
                <Select label={requiresNode ? 'Нода' : 'Нода (если нужна для действий)'} required={requiresNode} clearable={!requiresNode} searchable
                    placeholder="Выберите ноду" data={nodes.map(node => ({ value: node.uuid, label: nodeOptionLabel(node) }))} value={draft.node_uuid}
                    onChange={value => change({ node_uuid: value, actions: draft.actions.map(action => 'hosts' in action ? { ...action, hosts: [] } : action) })} />
                {draft.trigger_type === 'online_value' && <SimpleGrid cols={{ base: 1, sm: 2 }}>
                    <Select label="Сравнение" allowDeselect={false} value={draft.online_operator} data={[{value:'gt',label:'Больше (>)'},{value:'lt',label:'Меньше (<)'},{value:'eq',label:'Равно (=)'}]} onChange={value=>change({online_operator: (value ?? 'lt') as AutomationInput['online_operator']})}/>
                    <NumberInput label="Количество пользователей онлайн" min={0} max={1000000} allowDecimal={false} value={draft.online_value} onChange={value=>change({online_value:Number(value)})}/>
                </SimpleGrid>}
                {draft.trigger_type === 'online_drop' && <>
                    <SimpleGrid cols={{ base: 1, sm: 2 }}>
                        <NumberInput label="Падение онлайна, %" min={1} max={100} allowDecimal={false} value={draft.drop_percent} onChange={value => change({ drop_percent: Number(value) })} />
                        <NumberInput label="Минимальный исходный онлайн" min={0} max={1000000} allowDecimal={false} value={draft.min_online} onChange={value => change({ min_online: Number(value) })} />
                    </SimpleGrid>
                    <Text size="sm" c="dimmed">Сравниваем с исходным онлайном за 5–30 минут до текущего замера. Нужны минимум 3 исходных замера. Подтверждённое отключение ноды тоже запускает это условие.</Text>
                </>}
                {['online_drop', 'online_value', 'node_offline'].includes(draft.trigger_type) && <>
                    <SimpleGrid cols={{ base: 1, sm: 2 }}>
                        <NumberInput label="Условие сохраняется, минут" min={1} max={1440} allowDecimal={false} value={draft.duration_minutes} onChange={value => change({ duration_minutes: Number(value) })} />
                        <NumberInput label="Пауза между запусками, минут" min={1} max={10080} allowDecimal={false} value={draft.cooldown_minutes} onChange={value => change({ cooldown_minutes: Number(value) })} />
                    </SimpleGrid>
                    <Text size="sm" c="dimmed">Пропуск метрик не считается отключением. Для запуска нужен свежий замер и подтверждение в течение выбранного времени.</Text>
                </>}
                {draft.trigger_type === 'interval' && <>
                    <NumberInput label="Повторять каждые, минут" min={5} max={525600} allowDecimal={false} value={draft.interval_minutes}
                        onChange={value => change({ interval_minutes: Number(value), cooldown_minutes: Math.min(draft.cooldown_minutes, Math.max(1, Number(value))) })} />
                    <Text size="sm" c="dimmed">Первый автоматический запуск — после указанного интервала. Ручной запуск начинает отсчёт интервала заново.</Text>
                </>}
                {draft.trigger_type === 'manual' && <Text size="sm" c="dimmed">Сохраните последовательность действий и запускайте её одной кнопкой, когда это нужно.</Text>}
            </Stack>}
            {step === 1 && <Stack gap="md">
                <div><Title order={4}>Что выполнить</Title><Text size="sm" c="dimmed" mt={4}>Действия выполняются сверху вниз. Порядок можно изменить стрелками.</Text></div>
                {draft.actions.map((action, index) => <Card key={index} withBorder radius="md" p="md">
                    <Stack gap="md">
                        <Group justify="space-between" gap="xs" wrap="nowrap">
                            <Group gap="sm" wrap="nowrap"><span className={classes.stepIndex}>{index + 1}</span><Text fw={600} size="sm">{actionLabels[action.type]}</Text></Group>
                            <Group gap={2} wrap="nowrap">
                                <ActionIcon size={44} variant="subtle" aria-label={`Поднять действие ${index + 1}`} disabled={index === 0} onClick={() => move(index, -1)}><TbArrowUp size={17} /></ActionIcon>
                                <ActionIcon size={44} variant="subtle" aria-label={`Опустить действие ${index + 1}`} disabled={index === draft.actions.length - 1} onClick={() => move(index, 1)}><TbArrowDown size={17} /></ActionIcon>
                                <ActionIcon size={44} variant="subtle" color="red" aria-label={`Удалить действие ${index + 1}`} onClick={() => change({ actions: draft.actions.filter((_, position) => position !== index) })}><TbTrash size={17} /></ActionIcon>
                            </Group>
                        </Group>
                        {action.type === 'cloudflare_dns' && <DnsActionFields action={action} accounts={accounts} hasRotation={draft.actions.slice(0, index).some(item => item.type === 'rotate_ip')} onChange={value => setAction(index, value)} />}
                        {'hosts' in action && <>
                            <MultiSelect label="Хосты" placeholder={draft.node_uuid ? 'Выберите хосты' : 'Сначала выберите ноду на шаге «Условие»'} disabled={!draft.node_uuid}
                                searchable maxValues={20} value={action.hosts} onChange={value => setAction(index, { ...action, hosts: value })}
                                data={nodeHosts.map(host => ({ value: host.uuid, label: `${host.remark}${host.node_uuids.length > 1 ? ' · общий хост' : ''}`, disabled: action.type !== 'dpi_check' && host.node_uuids.length > 1 }))} />
                            {action.type !== 'dpi_check' && <Text size="xs" c="dimmed">Общие хосты нескольких нод исключены, чтобы не менять доступность других нод.</Text>}
                        </>}
                        {action.type === 'dpi_check' && <DpiRegionFields action={action} dpiCostLimit={dpiCostLimit} onChange={value => setAction(index, value)} />}
                        {action.type === 'rotate_ip' && <>
                            <Text size="sm">Будет выбран доступный запасной IP из пула ноды. Связанные хосты переключатся на него.</Text>
                            {!draft.node_uuid && <Alert color="orange">Выберите ноду на шаге «Условие».</Alert>}
                            <Switch label="Обновлять DNS-привязки ноды в Cloudflare" description="Используются привязки из настроек Cloudflare. Для отдельного домена добавьте следом действие «Изменить IP домена»." checked={!!action.updateCloudflare} onChange={event => setAction(index, { ...action, updateCloudflare: event.currentTarget.checked })} />
                            <Text size="xs" c="dimmed">Для выбранного домена добавьте следующее действие «Изменить IP домена» и выберите источник «Из предыдущего действия».</Text>
                        </>}
                        {action.type === 'webhook' && <TextInput label="HTTPS-адрес" type="url" placeholder="https://example.com/webhook" value={action.url} onChange={event => setAction(index, { ...action, url: event.currentTarget.value.trim() })} />}
                    </Stack>
                </Card>)}
                {!draft.actions.length && <Card withBorder radius="md" p="xl"><Text ta="center" c="dimmed">Добавьте первое действие сценария</Text></Card>}
                <Group align="flex-end" grow>
                    <Select label="Добавить действие" placeholder="Выберите действие" value={addType} onChange={value => setAddType(value as AutomationAction['type'] | null)}
                        data={Object.entries(actionLabels).map(([value, label]) => ({ value, label, disabled: value === 'rotate_ip' && draft.actions.some(action => action.type === 'rotate_ip') }))} />
                    <Button h={44} variant="light" leftSection={<TbPlus size={17} />} disabled={!addType || draft.actions.length >= 8} onClick={() => { if (addType) { change({ actions: [...draft.actions, emptyAction(addType)] }); setAddType(null) } }}>Добавить</Button>
                </Group>
            </Stack>}
            {step === 2 && <Stack gap="md">
                <div><Title order={4}>{draft.name}</Title><Text size="sm" c="dimmed" mt={4}>{triggerSummary(draft)}{draft.node_uuid ? ` · ${nodes.find(node => node.uuid === draft.node_uuid)?.name || 'выбранная нода'}` : ''}</Text></div>
                <Select label="Если действие завершилось ошибкой" allowDeselect={false} value={draft.failure_policy}
                    data={[{ value: 'stop', label: 'Остановить следующие действия' }, { value: 'continue', label: 'Продолжить остальные действия' }]}
                    onChange={value => { setDraft(previous => ({ ...previous, failure_policy: value as AutomationInput['failure_policy'] })); setPreview(previous => previous ? { ...previous, failurePolicy: value || 'stop' } : null) }} />
                {draft.trigger_type !== 'manual' && <Switch label="Включить автоматические запуски" description="Выключенное правило сохраняется на паузе и доступно для ручного запуска"
                    checked={draft.enabled} onChange={event => { const enabled = event.currentTarget.checked; setDraft(previous => ({ ...previous, enabled })) }} />}
                <Divider />
                {checking ? <Group justify="center" py="lg"><Loader size="sm" /><Text size="sm">Проверяем условия и выбранные объекты…</Text></Group> : preview ? <AutomationPreviewView preview={preview} /> : <Button variant="light" leftSection={<TbShieldCheck size={18} />} onClick={() => void check()}>Повторить проверку</Button>}
            </Stack>}
            <Group className={classes.stickyFooter} justify="space-between">
                <Button variant="default" h={44} disabled={saving || checking} onClick={() => { if (step) { setStep(step - 1); setError(''); setPreview(null) } else onClose() }}>{step ? 'Назад' : 'Отмена'}</Button>
                {step < 2 ? <Button h={44} rightSection={<TbPlayerPlay size={17} />} loading={checking} disabled={step === 1 && !draft.actions.length} onClick={() => void next()}>{step === 0 ? 'К действиям' : 'Проверить сценарий'}</Button>
                    : <Button h={44} leftSection={<TbCheck size={18} />} loading={saving} disabled={checking || !preview?.valid} onClick={() => void save()}>{editing ? 'Сохранить изменения' : 'Создать правило'}</Button>}
            </Group>
        </Stack>
    </Drawer>
}
