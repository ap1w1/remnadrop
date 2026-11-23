import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { instance } from './axios'

export const EVENTS_PATH = '/dashboard/events'
export const SSL_PATH = '/dashboard/management/ssl-certificates'
export const EVENTS_API = '/api/panel-events'
export const SSL_API = '/api/ssl-certificates'

export const eventTypes = [
    { value: 'node.connection_lost', label: 'Нода недоступна' },
    { value: 'node.connection_restored', label: 'Нода восстановлена' },
    { value: 'automation.triggered', label: 'Запуск автоматизации' },
    { value: 'automation.failed', label: 'Ошибка автоматизации' },
    { value: 'billing.payment_due', label: 'Оплата ноды' },
    { value: 'ssl.expiring', label: 'Скоро истечёт SSL' },
    { value: 'ssl.expired', label: 'SSL истёк' },
    { value: 'node.cpu_high', label: 'Перегрузка ЦП' },
    { value: 'node.cpu_recovered', label: 'ЦП в норме' },
    { value: 'node.memory_high', label: 'Перегрузка ОЗУ' },
    { value: 'node.memory_recovered', label: 'ОЗУ в норме' },
    { value: 'node.online_drop', label: 'Снижение онлайна' },
    { value: 'node.online_recovered', label: 'Онлайн восстановлен' },
    { value: 'node.traffic_drop', label: 'Снижение трафика' },
    { value: 'node.traffic_recovered', label: 'Трафик восстановлен' }
]

export interface PanelEvent {
    id: string
    sequence: string
    type: string
    severity: 'info' | 'warning' | 'critical'
    title: string
    message: string
    nodeUuid: string | null
    nodeName: string | null
    occurredAt: string
    data: Record<string, unknown>
    isRead?: boolean
}

export interface EventSummary { unreadCount: number; latestSequence: string }
export interface EventsResult extends EventSummary { items: PanelEvent[]; nextCursor: string | null }
export interface NotificationPreferences {
    adminUuid: string
    browserEnabled: boolean
    pushEnabled: boolean
    eventTypes: string[]
}

export interface PushConfig { enabled: boolean; publicKey: string; reason?: string }
export interface CertificateInput {
    name: string
    domains: string[]
    nodeUuids: string[]
    expiresAt: string
    reminderDays: number[]
    enabled: boolean
}
export interface Certificate extends CertificateInput {
    id: string
    nodes: { uuid: string; name: string }[]
    daysRemaining: number
    status: 'valid' | 'expiring' | 'expired' | 'disabled'
    createdAt: string
    updatedAt: string
}

export const eventQueryKeys = {
    all: ['panel-events'] as const,
    summary: ['panel-events', 'summary'] as const,
    preferences: ['panel-events', 'preferences'] as const,
    push: ['panel-events', 'push'] as const
}

export function apiError(error: unknown, fallback: string): string {
    const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message
    return typeof message === 'string' ? message : Array.isArray(message) ? message.join('. ') : fallback
}

export function useEventSummary() {
    return useQuery({
        queryKey: eventQueryKeys.summary,
        queryFn: async () => (await instance.get<{ response: EventSummary }>(`${EVENTS_API}/summary`)).data.response,
        refetchInterval: 15_000,
        staleTime: 5_000
    })
}

export function useNotificationPreferences() {
    return useQuery({
        queryKey: eventQueryKeys.preferences,
        queryFn: async () => (await instance.get<{ response: NotificationPreferences }>(`${EVENTS_API}/preferences`)).data.response,
        staleTime: 30_000,
        refetchInterval: 30_000
    })
}

export function useMarkEventsRead() {
    const client = useQueryClient()
    return useMutation({
        mutationFn: async (throughSequence: string) =>
            (await instance.post(`${EVENTS_API}/read`, { throughSequence })).data.response,
        onSuccess: async () => { await client.invalidateQueries({ queryKey: eventQueryKeys.all }) }
    })
}

export const eventDate = (value: string) => new Date(value).toLocaleString('ru-RU', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
})
