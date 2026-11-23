import { Alert, Badge, Button, Card, Divider, Group, MultiSelect, Skeleton, Stack, Switch, Text, ThemeIcon, Title } from '@mantine/core'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { TbBell, TbDeviceMobile, TbSend } from 'react-icons/tb'

import { instance } from '@shared/api/axios'
import {
    apiError, EVENTS_API, eventQueryKeys, eventTypes, type NotificationPreferences,
    type PushConfig, useNotificationPreferences
} from '@shared/api/panel-events'
import {
    notificationSupport, notificationWorker, pushOwner, requestNotificationPermission,
    showPanelEvent, subscribePush, syncNotificationWorker, unsubscribePush
} from '@shared/lib/panel-notifications'

export function NotificationsCardWidget() {
    const client = useQueryClient()
    const preferences = useNotificationPreferences()
    const config = useQuery({ queryKey: eventQueryKeys.push, queryFn: async () =>
        (await instance.get<{ response: PushConfig }>(`${EVENTS_API}/push/config`)).data.response })
    const [selected, setSelected] = useState<string[]>([])
    const [dirty, setDirty] = useState(false)
    const [busy, setBusy] = useState<string | null>(null)
    const [subscribed, setSubscribed] = useState(false)
    const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => 'Notification' in window ? Notification.permission : 'unsupported')
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const owner = useRef('')
    const unsupported = notificationSupport()
    const pushSupported = !unsupported && 'PushManager' in window

    useEffect(() => {
        const value = preferences.data
        if (!value) return
        if (owner.current !== value.adminUuid || !dirty) { setSelected(value.eventTypes); owner.current = value.adminUuid }
    }, [preferences.data, dirty])

    useEffect(() => {
        let active = true
        const check = async () => {
            setPermission('Notification' in window ? Notification.permission : 'unsupported')
            try {
                const registration = await notificationWorker()
                const subscription = await registration?.pushManager?.getSubscription()
                if (active) setSubscribed(Boolean(subscription && pushOwner() === preferences.data?.adminUuid))
            } catch { if (active) setSubscribed(false) }
        }
        void check()
        window.addEventListener('focus', check)
        return () => { active = false; window.removeEventListener('focus', check) }
    }, [preferences.data?.adminUuid])

    useEffect(() => {
        if (location.hash === '#notifications') document.getElementById('notifications')?.scrollIntoView({ block: 'start' })
    }, [preferences.isPending])

    const save = async (patch: Partial<NotificationPreferences> = {}) => {
        if (!preferences.data) throw new Error('Настройки ещё загружаются.')
        const response = await instance.put<{ response: NotificationPreferences }>(`${EVENTS_API}/preferences`, {
            browserEnabled: preferences.data.browserEnabled,
            pushEnabled: preferences.data.pushEnabled,
            eventTypes: selected,
            ...patch
        })
        client.setQueryData(eventQueryKeys.preferences, response.data.response)
        setDirty(false)
        await syncNotificationWorker(response.data.response, permission === 'granted' && response.data.response.browserEnabled)
        return response.data.response
    }
    const run = async (kind: string, action: () => Promise<void>) => {
        setBusy(kind); setError(''); setNotice('')
        try { await action() }
        catch (err) { setError(apiError(err, err instanceof Error ? err.message : 'Не удалось изменить настройки. Повторите попытку.')) }
        finally { setPermission('Notification' in window ? Notification.permission : 'unsupported'); setBusy(null) }
    }
    const toggleBrowser = (enabled: boolean) => {
        // requestPermission is invoked synchronously from the user gesture.
        const grant = enabled ? requestNotificationPermission() : Promise.resolve()
        void run('browser', async () => { await grant; await save({ browserEnabled: enabled }); setNotice(enabled ? 'Уведомления для открытой панели включены.' : 'Уведомления для открытой панели выключены.') })
    }
    const togglePush = (enabled: boolean) => {
        const grant = enabled ? requestNotificationPermission() : Promise.resolve()
        void run('push', async () => {
            await grant
            if (enabled) {
                if (!preferences.data || !config.data?.enabled) throw new Error(config.data?.reason || 'Push пока недоступен. Повторите загрузку настроек.')
                const next = { ...preferences.data, eventTypes: selected, pushEnabled: true }
                await subscribePush(config.data.publicKey, next)
                try { await save({ pushEnabled: true }) }
                catch (err) { await unsubscribePush().catch(() => undefined); throw err }
                setSubscribed(true)
                setNotice('Push подключён на этом устройстве.')
            } else {
                await unsubscribePush().finally(() => setSubscribed(false))
                if (preferences.data) await syncNotificationWorker(preferences.data)
                setNotice('Push отключён на этом устройстве. Другие устройства сохраняют свои настройки.')
            }
        })
    }

    return <Card withBorder radius="md" p="lg" id="notifications" style={{ scrollMarginTop: 96 }}><Stack gap="lg">
        <Group gap="sm"><ThemeIcon size={42} radius="md" color="cyan" variant="light"><TbBell size={24} /></ThemeIcon><div><Title order={3}>Уведомления</Title><Text size="sm" c="dimmed">События панели в браузере и на устройствах</Text></div></Group>
        {preferences.isPending ? <Skeleton h={300} radius="md" /> : preferences.isError ? <Alert color="red" title="Не удалось загрузить настройки"><Button color="red" variant="light" onClick={() => void preferences.refetch()}>Повторить</Button></Alert> : <>
            {error && <Alert color="red" title="Не удалось применить настройку" withCloseButton onClose={() => setError('')}>{error}</Alert>}
            {notice && <Alert color="teal" withCloseButton onClose={() => setNotice('')}>{notice}</Alert>}
            {unsupported && <Alert color="blue">{unsupported}</Alert>}
            {permission === 'denied' && <Alert color="yellow">Браузер блокирует уведомления. Откройте настройки этого сайта и разрешите уведомления, затем вернитесь в панель.</Alert>}
            <Stack gap="sm"><Group justify="space-between"><Text fw={600}>В открытом браузере</Text><Badge variant="light" color={permission === 'granted' ? 'teal' : 'gray'}>{permission === 'granted' ? 'Разрешено' : permission === 'denied' ? 'Заблокировано' : 'Нужно разрешение'}</Badge></Group>
                <Switch label="Уведомлять, пока панель открыта" description="Браузер запросит разрешение при включении. События в журнале сохраняются независимо от этой настройки." checked={Boolean(preferences.data?.browserEnabled)} disabled={Boolean(busy || (!preferences.data?.browserEnabled && (unsupported || permission === 'denied')))} onChange={event => toggleBrowser(event.currentTarget.checked)} styles={{ body: { minHeight: 44, alignItems: 'center' } }} />
                {preferences.data?.browserEnabled && permission === 'default' && !unsupported && <Button h={44} variant="light" disabled={Boolean(busy)} onClick={() => toggleBrowser(true)}>Разрешить в этом браузере</Button>}
            </Stack>
            <Divider />
            <Stack gap="sm"><Group justify="space-between"><Group gap={6}><TbDeviceMobile size={20} /><Text fw={600}>Push на этом устройстве</Text></Group><Badge variant="light" color={subscribed && preferences.data?.pushEnabled ? 'teal' : 'gray'}>{subscribed && preferences.data?.pushEnabled ? 'Подключено' : 'Не подключено'}</Badge></Group>
                <Switch label="Получать события в фоне" description="Сообщения смогут приходить после закрытия вкладки. Подключение действует на этот браузер; при выходе из аккаунта оно отключается." checked={subscribed && Boolean(preferences.data?.pushEnabled)} disabled={Boolean(busy || (!subscribed && (!pushSupported || permission === 'denied' || config.isPending || !config.data?.enabled)))} onChange={event => togglePush(event.currentTarget.checked)} styles={{ body: { minHeight: 44, alignItems: 'center' } }} />
                {!pushSupported && !unsupported && <Text size="sm" c="dimmed">Push не поддерживается этим браузером.</Text>}
                {(config.isError || (config.data && !config.data.enabled)) && <Alert color="yellow"><Stack gap="xs"><Text size="sm">{config.data?.reason || 'Не удалось загрузить подключение push.'}</Text><Button variant="light" color="yellow" onClick={() => void config.refetch()}>Повторить</Button></Stack></Alert>}
            </Stack>
            <Divider />
            <MultiSelect label="О каких событиях уведомлять" description="Выбор применяется к браузерным и push-уведомлениям вашего аккаунта. В журнал попадают все типы." data={eventTypes} searchable clearable clearButtonProps={{ 'aria-label': 'Очистить типы' }} value={selected} onChange={value => { setSelected(value); setDirty(true) }} nothingFoundMessage="Тип не найден" disabled={Boolean(busy)} />
            {selected.length === 0 && <Text size="sm" c="yellow">Типы не выбраны — уведомления отправляться не будут.</Text>}
            <Group justify="space-between" wrap="wrap"><Button h={44} variant="subtle" leftSection={<TbSend size={17} />} disabled={Boolean(busy || permission !== 'granted' || !selected.length || !preferences.data?.browserEnabled)} onClick={() => void run('test', async () => {
                if (!preferences.data) return
                await showPanelEvent({ id: `test-${Date.now()}`, sequence: '0', type: selected[0], severity: 'info', title: 'RemnaDrop · уведомления работают', message: 'Так будут выглядеть важные события панели.', nodeUuid: null, nodeName: null, occurredAt: new Date().toISOString(), data: {} }, { ...preferences.data, eventTypes: selected })
                setNotice('Проверочное уведомление отправлено браузеру.')
            })}>Проверить</Button><Button h={44} loading={busy === 'save'} disabled={!dirty || Boolean(busy)} onClick={() => void run('save', async () => { await save(); setNotice('Типы событий сохранены.') })}>Сохранить типы</Button></Group>
        </>}
    </Stack></Card>
}
