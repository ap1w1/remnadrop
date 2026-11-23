import { instance } from '@shared/api/axios'
import { EventFeed, NotificationPreferences } from '@shared/api/panel-events'

export const notificationsSupported = () =>
    window.isSecureContext && 'Notification' in window && 'serviceWorker' in navigator
export const pushSupported = () => notificationsSupported() && 'PushManager' in window
export async function notificationWorker() {
    await navigator.serviceWorker.register('/notifications-sw.js', { scope: '/' })
    return navigator.serviceWorker.ready
}
export async function requestNotificationPermission() {
    if (!notificationsSupported())
        throw new Error('Уведомления доступны в поддерживаемом браузере по HTTPS')
    const permission = await Notification.requestPermission()
    if (permission !== 'granted')
        throw new Error(
            permission === 'denied'
                ? 'Уведомления заблокированы. Разрешите их в настройках сайта в браузере.'
                : 'Разрешение на уведомления не получено'
        )
}
export async function subscribePush(publicKey: string, admin: string) {
    const registration = await notificationWorker()
    const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
        c.charCodeAt(0)
    )
    let subscription = await registration.pushManager.getSubscription()
    const previousKey = subscription?.options.applicationServerKey
    if (subscription && previousKey && new Uint8Array(previousKey).toString() !== key.toString()) {
        await subscription.unsubscribe()
        subscription = null
    }
    const newlyCreated = !subscription
    subscription ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key
    })
    try {
        await instance.post('/api/panel-events/push/subscription', subscription.toJSON())
        localStorage.setItem('remnadrop-push-owner', admin)
    } catch (error) {
        if (newlyCreated) await subscription.unsubscribe()
        throw error
    }
}
export async function unsubscribePush() {
    if (!pushSupported()) return
    const registration = await navigator.serviceWorker.getRegistration('/')
    const subscription = await registration?.pushManager.getSubscription()
    if (subscription) {
        try {
            await instance.post(
                '/api/panel-events/push/unsubscribe',
                { endpoint: subscription.endpoint },
                { timeout: 5000 }
            )
        } finally {
            await subscription.unsubscribe()
            localStorage.removeItem('remnadrop-push-owner')
        }
    }
    localStorage.removeItem('remnadrop-push-owner')
}

export async function showNewEvents(feed: EventFeed, prefs: NotificationPreferences) {
    const cursorKey = `remnadrop-events-cursor:${prefs.adminUuid}`
    const deliver = async () => {
        const previous = localStorage.getItem(cursorKey)
        if (previous && BigInt(previous) >= BigInt(feed.latestId)) return
        // Never replay old history on initial login or when enabling notifications.
        localStorage.setItem(cursorKey, feed.latestId)
        if (
            !previous ||
            !prefs.browserEnabled ||
            !notificationsSupported() ||
            Notification.permission !== 'granted'
        )
            return
        const registration = await notificationWorker()
        if (
            localStorage.getItem('remnadrop-push-owner') === prefs.adminUuid &&
            (await registration.pushManager?.getSubscription())
        )
            return
        const items = feed.items.filter(
            (event) => BigInt(event.id) > BigInt(previous) && prefs.eventTypes.includes(event.type)
        )
        for (const event of items.reverse()) {
            await registration.showNotification(event.title, {
                body: event.message,
                tag: `panel-event-${event.id}`,
                data: { url: '/dashboard/events' }
            })
        }
    }
    if (navigator.locks) await navigator.locks.request('remnadrop-event-notifications', deliver)
    else await deliver()
}
