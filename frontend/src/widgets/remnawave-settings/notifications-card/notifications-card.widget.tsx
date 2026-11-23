import {
    Alert,
    Badge,
    Button,
    Checkbox,
    Group,
    Loader,
    Paper,
    Stack,
    Switch,
    Text
} from '@mantine/core'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { TbBell, TbDeviceMobile } from 'react-icons/tb'

import { instance } from '@shared/api/axios'
import {
    EVENT_LABELS,
    errorMessage,
    getEvents,
    preferencesKey,
    useNotificationPreferences
} from '@shared/api/panel-events'
import {
    notificationWorker,
    notificationsSupported,
    pushSupported,
    requestNotificationPermission,
    subscribePush,
    unsubscribePush
} from '@shared/notifications/browser-notifications'

export function NotificationsCardWidget() {
    const prefs = useNotificationPreferences()
    const client = useQueryClient()
    const config = useQuery({
        queryKey: ['panel-push-config'],
        queryFn: async (): Promise<{ enabled: boolean; publicKey: string | null }> =>
            (await instance.get('/api/panel-events/push/config')).data.response
    })
    const [types, setTypes] = useState<string[]>([])
    const [push, setPush] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')
    const [permission, setPermission] = useState(
        'Notification' in window ? Notification.permission : 'default'
    )
    useEffect(() => {
        if (prefs.data) setTypes(prefs.data.eventTypes)
    }, [prefs.data])
    useEffect(() => {
        if (pushSupported() && prefs.data)
            void navigator.serviceWorker
                .getRegistration('/')
                .then(async (registration) => {
                    setPush(
                        localStorage.getItem('remnadrop-push-owner') === prefs.data!.adminUuid &&
                            !!(await registration?.pushManager.getSubscription())
                    )
                })
                .catch(() => {})
    }, [prefs.data])
    const act = async (task: () => Promise<void>) => {
        setBusy(true)
        setError('')
        setSuccess('')
        try {
            await task()
        } catch (e) {
            setError(errorMessage(e))
        } finally {
            setBusy(false)
            if ('Notification' in window) setPermission(Notification.permission)
        }
    }
    const save = async (browserEnabled: boolean) => {
        await instance.put('/api/panel-events/preferences', { browserEnabled, eventTypes: types })
        await client.invalidateQueries({ queryKey: preferencesKey })
    }
    return (
        <Paper withBorder p="lg" radius="md">
            <Stack gap="md">
                <Group>
                    <TbBell size={24} />
                    <Text fw={600} size="lg">
                        Уведомления
                    </Text>
                </Group>
                <Text c="dimmed" size="sm">
                    Все события сохраняются в журнале. Здесь можно выбрать, о чём браузер будет
                    уведомлять отдельно.
                </Text>
                {prefs.isLoading ? (
                    <Loader size="sm" />
                ) : prefs.isError ? (
                    <Alert color="red">{errorMessage(prefs.error)}</Alert>
                ) : (
                    <>
                        {!notificationsSupported() && (
                            <Alert color="yellow">
                                Для уведомлений нужен браузер с поддержкой уведомлений и защищённое
                                соединение HTTPS.
                            </Alert>
                        )}
                        {permission === 'denied' && (
                            <Alert color="yellow">
                                Браузер блокирует уведомления. Разрешите их в настройках этого
                                сайта.
                            </Alert>
                        )}
                        <Switch
                            label="Уведомления при открытой панели"
                            description="При включении браузер запросит разрешение"
                            checked={!!prefs.data?.browserEnabled && permission === 'granted'}
                            disabled={busy || !notificationsSupported()}
                            onChange={(event) => {
                                const enabled = event.currentTarget.checked
                                void act(async () => {
                                    if (enabled) {
                                        await requestNotificationPermission()
                                        await notificationWorker()
                                        const feed = await getEvents()
                                        localStorage.setItem(
                                            `remnadrop-events-cursor:${prefs.data!.adminUuid}`,
                                            feed.latestId
                                        )
                                    }
                                    await save(enabled)
                                    setSuccess(
                                        enabled ? 'Уведомления включены' : 'Уведомления выключены'
                                    )
                                })
                            }}
                        />
                        <Paper withBorder p="md" radius="md">
                            <Stack gap="sm">
                                <Group justify="space-between">
                                    <Group gap="xs">
                                        <TbDeviceMobile size={20} />
                                        <Text fw={600}>Push-уведомления</Text>
                                    </Group>
                                    <Badge color={push ? 'teal' : 'gray'}>
                                        {push ? 'Включены' : 'Выключены'}
                                    </Badge>
                                </Group>
                                <Text size="sm" c="dimmed">
                                    Доставка на это устройство, даже когда вкладка панели закрыта.
                                </Text>
                                {config.isError ? (
                                    <Alert color="red">{errorMessage(config.error)}</Alert>
                                ) : (
                                    !config.isLoading &&
                                    !config.data?.enabled && (
                                        <Text size="sm" c="orange">
                                            Администратору сервера нужно настроить Web Push. После
                                            настройки здесь появится возможность подключения.
                                        </Text>
                                    )
                                )}
                                {!pushSupported() && (
                                    <Text size="sm" c="dimmed">
                                        Web Push недоступен в этом браузере. На iPhone и iPad
                                        откройте панель с домашнего экрана.
                                    </Text>
                                )}
                                <Button
                                    variant={push ? 'default' : 'light'}
                                    disabled={
                                        busy || !pushSupported() || (!push && !config.data?.enabled)
                                    }
                                    onClick={() =>
                                        void act(async () => {
                                            if (push) {
                                                await unsubscribePush()
                                                setPush(false)
                                            } else {
                                                await requestNotificationPermission()
                                                await save(prefs.data!.browserEnabled)
                                                await subscribePush(
                                                    config.data!.publicKey!,
                                                    prefs.data!.adminUuid
                                                )
                                                setPush(true)
                                            }
                                            setSuccess(
                                                push
                                                    ? 'Push отключены на этом устройстве'
                                                    : 'Устройство подключено'
                                            )
                                        })
                                    }
                                >
                                    {push
                                        ? 'Отключить на этом устройстве'
                                        : 'Включить на этом устройстве'}
                                </Button>
                            </Stack>
                        </Paper>
                        <Checkbox.Group
                            label="Типы уведомлений"
                            description="Выбор применяется к уведомлениям браузера и push"
                            value={types}
                            onChange={setTypes}
                        >
                            <Stack gap="sm" mt="sm">
                                {Object.entries(EVENT_LABELS).map(([value, label]) => (
                                    <Checkbox
                                        key={value}
                                        value={value}
                                        label={label}
                                        disabled={busy}
                                    />
                                ))}
                            </Stack>
                        </Checkbox.Group>
                        <Button
                            loading={busy}
                            onClick={() =>
                                void act(async () => {
                                    await save(prefs.data!.browserEnabled)
                                    setSuccess('Настройки сохранены')
                                })
                            }
                        >
                            Сохранить типы событий
                        </Button>
                    </>
                )}
                {error && (
                    <Alert color="red" title="Не удалось сохранить">
                        {error}
                    </Alert>
                )}
                {success && <Alert color="teal">{success}</Alert>}
            </Stack>
        </Paper>
    )
}
