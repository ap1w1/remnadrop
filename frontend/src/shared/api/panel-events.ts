import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { instance } from './axios'

export const EVENT_LABELS: Record<string, string> = {
    'node.offline': 'Нода недоступна',
    'node.online': 'Связь с нодой восстановлена',
    'automation.triggered': 'Запуск автоматизации',
    'automation.failed': 'Ошибка автоматизации',
    'billing.reminder': 'Оплата ноды',
    'ssl.expiring': 'Истечение SSL',
    'ssl.expired': 'SSL истёк',
    'metric.cpu': 'Загрузка ЦП',
    'metric.memory': 'Загрузка ОЗУ',
    'metric.online_drop': 'Падение онлайна',
    'metric.traffic_drop': 'Падение трафика'
}
export type PanelEvent = {
    id: string
    type: string
    severity: 'info' | 'warning' | 'error' | 'success'
    title: string
    message: string
    createdAt: string
    data: Record<string, unknown>
}
export type EventFeed = { items: PanelEvent[]; unread: number; latestId: string }
export type NotificationPreferences = {
    adminUuid: string
    browserEnabled: boolean
    eventTypes: string[]
}
export type Certificate = {
    id: string
    name: string
    domain: string
    nodeUuids: string[]
    nodeNames: string[]
    expiresOn: string
    reminderDays: number[]
    enabled: boolean
}
export const eventsKey = ['panel-events'] as const
export const preferencesKey = ['panel-notification-preferences'] as const
export const errorMessage = (error: unknown) => {
    const message = (
        error as { response?: { data?: { message?: string | string[] } }; message?: string }
    )?.response?.data?.message
    return Array.isArray(message)
        ? message.join(', ')
        : message || (error instanceof Error ? error.message : 'Не удалось выполнить действие')
}
export async function getEvents(
    params: Record<string, string | undefined> = {}
): Promise<EventFeed> {
    return (await instance.get('/api/panel-events', { params })).data.response
}
export const useEventFeed = () =>
    useQuery({ queryKey: eventsKey, queryFn: () => getEvents(), refetchInterval: 15000 })
export const useNotificationPreferences = () =>
    useQuery({
        queryKey: preferencesKey,
        queryFn: async (): Promise<NotificationPreferences> =>
            (await instance.get('/api/panel-events/preferences')).data.response
    })
export function useReadEvents() {
    const client = useQueryClient()
    return useMutation({
        mutationFn: (through: string) => instance.post('/api/panel-events/read', { through }),
        onSuccess: () => {
            void client.invalidateQueries({ queryKey: eventsKey })
        }
    })
}
