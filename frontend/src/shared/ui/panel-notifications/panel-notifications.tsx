import { useEffect, useState } from 'react'

import { instance } from '@shared/api/axios'
import { EVENTS_API, type EventSummary, type EventsResult, useNotificationPreferences } from '@shared/api/panel-events'
import { activateNotificationSession, notificationSupport, showPanelEvent, syncNotificationWorker } from '@shared/lib/panel-notifications'
import { useToken } from '@entities/auth'

// Mounted once in the authenticated layout. The worker deduplicates browser and push
// deliveries atomically, including across several open tabs.
export function PanelNotifications() {
    const preferences = useNotificationPreferences()
    const token = useToken()
    const [permission, setPermission] = useState(() => 'Notification' in window ? Notification.permission : 'denied')

    useEffect(() => {
        if (preferences.data?.adminUuid) activateNotificationSession(preferences.data.adminUuid, token)
    }, [preferences.data?.adminUuid, token])

    useEffect(() => {
        let status: PermissionStatus | undefined
        let active = true
        const check = () => { if ('Notification' in window) setPermission(Notification.permission) }
        window.addEventListener('focus', check)
        document.addEventListener('visibilitychange', check)
        void navigator.permissions?.query({ name: 'notifications' }).then(value => {
            if (!active) return
            status = value; status.addEventListener('change', check)
        }).catch(() => undefined)
        return () => { active = false; window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); status?.removeEventListener('change', check) }
    }, [])

    useEffect(() => {
        const settings = preferences.data
        if (!settings || notificationSupport()) return
        let active = true
        let polling = false
        let cursor: string | null = null
        const permitted = permission === 'granted'
        void syncNotificationWorker(settings, permitted && settings.browserEnabled).catch(() => undefined)
        if (!permitted || !settings.browserEnabled) return

        const poll = async () => {
            if (!active || polling) return
            polling = true
            try {
                if (cursor === null) {
                    const response = await instance.get<{ response: EventSummary }>(`${EVENTS_API}/summary`)
                    // An opening tab starts with new arrivals, never a replay of the journal.
                    cursor = response.data.response.latestSequence
                    return
                }
                for (let batch = 0; batch < 5 && active; batch += 1) {
                    const page: EventsResult = (await instance.get<{ response: EventsResult }>(EVENTS_API, { params: { after: cursor, limit: 50 } })).data.response
                    for (const event of page.items) {
                        if (!active) return
                        if (settings.eventTypes.includes(event.type)) await showPanelEvent(event, settings)
                        cursor = event.sequence
                    }
                    if (!page.nextCursor || !page.items.length) break
                }
            } catch {
                // Keep the cursor; a transient network failure is retried on the next poll.
            } finally { polling = false }
        }
        void poll()
        const timer = window.setInterval(() => void poll(), 15_000)
        return () => { active = false; clearInterval(timer) }
    }, [preferences.data, permission])

    return null
}
