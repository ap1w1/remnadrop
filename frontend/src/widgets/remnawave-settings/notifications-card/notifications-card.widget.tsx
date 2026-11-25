import { Alert, Button, Checkbox, Collapse, Group, Loader, MultiSelect, Paper, SimpleGrid, Stack, Switch, Text } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { TbBell } from 'react-icons/tb'

import { instance } from '@shared/api/axios'
import { EVENT_LABELS, errorMessage, getEvents, preferencesKey, useNotificationPreferences } from '@shared/api/panel-events'
import { notificationsSupported, requestNotificationPermission } from '@shared/notifications/browser-notifications'
import { useGetNodes } from '@shared/api/hooks'
import { nodeOptionLabel } from '@shared/utils/misc/node-option-label'

export function NotificationsCardWidget() {
    const prefs = useNotificationPreferences()
    const nodes = useGetNodes()
    const client = useQueryClient()
    const [types, setTypes] = useState<string[]>([])
    const [excludedNodes, setExcludedNodes] = useState<string[]>([])
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')
    const [showTypes, setShowTypes] = useState(false)
    const [permission, setPermission] = useState('Notification' in window ? Notification.permission : 'default')
    useEffect(() => { if (prefs.data) { setTypes(prefs.data.eventTypes); setExcludedNodes(prefs.data.excludedNodeUuids ?? []) } }, [prefs.data])
    const save = async (browserEnabled: boolean) => {
        await instance.put('/api/panel-events/preferences', { browserEnabled, eventTypes: types, excludedNodeUuids: excludedNodes })
        await client.invalidateQueries({ queryKey: preferencesKey })
    }
    const act = async (task: () => Promise<void>) => {
        setBusy(true); setError(''); setSuccess('')
        try { await task() } catch (e) { setError(errorMessage(e)) }
        finally { setBusy(false); if ('Notification' in window) setPermission(Notification.permission) }
    }
    return <Paper withBorder p="md" radius="md" data-testid="notification-settings-card"><Stack gap="sm">
        <Group gap="xs"><TbBell size={22}/><Text fw={600} size="lg">Уведомления</Text></Group>
        <Text size="sm" c="dimmed">События сохраняются в журнале. Браузер сообщит о выбранных типах, пока панель открыта.</Text>
        {prefs.isLoading ? <Loader size="sm"/> : prefs.isError ? <Alert color="red">{errorMessage(prefs.error)}</Alert> : <>
            {!notificationsSupported() && <Alert color="yellow">Нужны HTTPS и поддержка уведомлений в браузере.</Alert>}
            {permission === 'denied' && <Alert color="yellow">Разрешите уведомления в настройках этого сайта в браузере.</Alert>}
            <Switch label="Уведомления в браузере" description="Разрешение запрашивается после включения" checked={!!prefs.data?.browserEnabled && permission === 'granted'} disabled={busy || !notificationsSupported()} onChange={event => {
                const enabled = event.currentTarget.checked
                void act(async () => {
                    if (enabled) {
                        await requestNotificationPermission()
                        const feed = await getEvents()
                        localStorage.setItem(`remnadrop-events-cursor:${prefs.data!.adminUuid}`, feed.latestId)
                    }
                    await save(enabled)
                    setSuccess(enabled ? 'Уведомления включены' : 'Уведомления выключены')
                })
            }}/>
            <Button variant="subtle" size="compact-sm" justify="space-between" aria-expanded={showTypes} onClick={() => setShowTypes(value => !value)}>
                Типы уведомлений · {types.length} из {Object.keys(EVENT_LABELS).length}
            </Button>
            <Collapse expanded={showTypes}>
                <Stack gap="sm">
                    <Checkbox.Group label="Типы уведомлений" value={types} onChange={setTypes}>
                        <SimpleGrid cols={{base:1,sm:2}} spacing="xs" mt="sm">{Object.entries(EVENT_LABELS).map(([value,label]) => <Checkbox key={value} value={value} label={label} disabled={busy}/>)}</SimpleGrid>
                    </Checkbox.Group>
                    <MultiSelect label="Исключить ноды" description="События остаются в журнале, но браузер не показывает уведомления для выбранных нод" placeholder="Выберите ноды" searchable clearable
                        data={(nodes.data??[]).map(node=>({value:node.uuid,label:nodeOptionLabel(node)}))}
                        value={excludedNodes} onChange={setExcludedNodes} disabled={busy} maxDropdownHeight={260}/>
                    <Group justify="flex-end"><Button loading={busy} onClick={() => void act(async () => { await save(!!prefs.data?.browserEnabled); setSuccess('Настройки сохранены'); setShowTypes(false) })}>Сохранить</Button></Group>
                </Stack>
            </Collapse>
        </>}
        {error && <Alert color="red">{error}</Alert>}
        {success && <Alert color="teal">{success}</Alert>}
    </Stack></Paper>
}
