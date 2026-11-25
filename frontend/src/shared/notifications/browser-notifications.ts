import { EventFeed, NotificationPreferences } from '@shared/api/panel-events'

export const notificationsSupported = () => window.isSecureContext && 'Notification' in window

let legacyWorkerChecked = false

function removeLegacyPushWorker() {
    if (legacyWorkerChecked || !('serviceWorker' in navigator)) return
    legacyWorkerChecked = true
    void navigator.serviceWorker.getRegistrations().then(registrations => Promise.all(
        registrations.filter(registration => {
            const script = registration.active?.scriptURL ?? registration.waiting?.scriptURL ?? registration.installing?.scriptURL
            return script && new URL(script).pathname === '/notifications-sw.js'
        }).map(registration => registration.unregister()),
    )).catch(() => undefined)
}

export async function requestNotificationPermission() {
    if (!notificationsSupported()) throw new Error('Уведомления доступны в поддерживаемом браузере по HTTPS')
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') throw new Error('Разрешите уведомления в настройках сайта')
}

export async function showNewEvents(feed: EventFeed, prefs: NotificationPreferences) {
    removeLegacyPushWorker()
    const cursorKey = `remnadrop-events-cursor:${prefs.adminUuid}`
    const deliver = () => {
        const previous = localStorage.getItem(cursorKey)
        if (previous && BigInt(previous) >= BigInt(feed.latestId)) return
        localStorage.setItem(cursorKey, feed.latestId)
        if (!previous || !prefs.browserEnabled || !notificationsSupported() || Notification.permission !== 'granted') return
        const items = feed.items.filter(event => {
            if (BigInt(event.id) <= BigInt(previous) || !prefs.eventTypes.includes(event.type)) return false
            const related = Array.isArray(event.data?.nodeUuids)
                ? event.data.nodeUuids.filter((id): id is string => typeof id === 'string')
                : event.nodeUuid ? [event.nodeUuid] : []
            return !related.length || related.some(id => !prefs.excludedNodeUuids.includes(id))
        })
        for (const event of items.reverse()) {
            const notification = new Notification(event.title, { body: event.message, tag: `panel-event-${event.id}` })
            notification.onclick = () => { window.focus(); window.location.assign('/dashboard/events'); notification.close() }
        }
    }
    if (navigator.locks) await navigator.locks.request('remnadrop-event-notifications', deliver)
    else deliver()
}
