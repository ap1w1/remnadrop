/* Notification-only worker: no fetch handler and no cached panel or API responses. */
const DATABASE = 'remnadrop-notifications-v1'
const EVENTS_URL = '/dashboard/events'
let settingsQueue = Promise.resolve()
function enqueue(action) {
    settingsQueue = settingsQueue.catch(() => undefined).then(action)
    return settingsQueue
}

function database() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE, 1)
        request.onupgradeneeded = () => {
            request.result.createObjectStore('settings')
            request.result.createObjectStore('seen', { keyPath: 'key' })
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

async function saveSettings(settings, epoch) {
    const db = await database()
    await new Promise((resolve, reject) => {
        const transaction = db.transaction('settings', 'readwrite')
        const store = transaction.objectStore('settings')
        const revoked = store.get(`revoked:${epoch}`)
        revoked.onsuccess = () => { if (!revoked.result) store.put({ ...settings, epoch }, 'current') }
        transaction.oncomplete = resolve
        transaction.onerror = () => reject(transaction.error)
    })
    db.close()
}

async function revokeSession(epoch) {
    const db = await database()
    let owner = null
    await new Promise((resolve, reject) => {
        const transaction = db.transaction('settings', 'readwrite')
        const store = transaction.objectStore('settings')
        if (epoch) store.put(true, `revoked:${epoch}`)
        const current = store.get('current')
        current.onsuccess = () => {
            if (!current.result || current.result.epoch === epoch) {
                owner = current.result?.adminUuid || null
                store.put(null, 'current')
            }
        }
        transaction.oncomplete = resolve
        transaction.onerror = () => reject(transaction.error)
    })
    db.close()
    return owner
}

async function claimEvent(event, channel, epoch) {
    const db = await database()
    const accepted = await new Promise((resolve, reject) => {
        let claimed = false
        const transaction = db.transaction(['settings', 'seen'], 'readwrite')
        const settingsRequest = transaction.objectStore('settings').get('current')
        settingsRequest.onsuccess = () => {
            const settings = settingsRequest.result
            if (!settings || settings.adminUuid !== event.adminUuid ||
                (channel === 'browser' && settings.epoch !== epoch) ||
                !settings[channel === 'push' ? 'pushEnabled' : 'browserEnabled'] ||
                (channel === 'browser' && !settings.eventTypes.includes(event.type))) return
            const store = transaction.objectStore('seen')
            const key = `${event.adminUuid}:${event.id}`
            const seen = store.get(key)
            seen.onsuccess = () => {
                if (seen.result) return
                store.put({ key, createdAt: Date.now() })
                claimed = true
                // A week's worth of IDs prevents duplicate push/poll deliveries after restarts.
                const cursor = store.openCursor()
                cursor.onsuccess = () => {
                    const entry = cursor.result
                    if (!entry) return
                    if (entry.value.createdAt < Date.now() - 7 * 86400000) entry.delete()
                    entry.continue()
                }
            }
        }
        transaction.oncomplete = () => resolve(claimed)
        transaction.onerror = () => reject(transaction.error)
    })
    db.close()
    return accepted
}

async function deliver(event, channel, epoch) {
    if (!event || typeof event.id !== 'string' || typeof event.adminUuid !== 'string' ||
        typeof event.type !== 'string' || typeof event.title !== 'string') return
    if (!await claimEvent(event, channel, epoch)) return
    await self.registration.showNotification(event.title.slice(0, 160), {
        body: String(event.message || '').slice(0, 600),
        icon: '/favicons/favicon-192x192.png',
        tag: `remnadrop:${event.adminUuid}:${event.id}`,
        data: { url: EVENTS_URL, id: event.id, adminUuid: event.adminUuid }
    })
}

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
self.addEventListener('message', event => {
    const message = event.data || {}
    if (message.type === 'settings') {
        const preferences = message.preferences
        if (!preferences || typeof message.epoch !== 'string' || typeof preferences.adminUuid !== 'string' || !Array.isArray(preferences.eventTypes)) return
        event.waitUntil(enqueue(() => saveSettings({
            adminUuid: preferences.adminUuid,
            browserEnabled: preferences.browserEnabled === true,
            pushEnabled: preferences.pushEnabled === true,
            eventTypes: preferences.eventTypes.filter(value => typeof value === 'string')
        }, message.epoch).then(() => event.ports[0]?.postMessage({ ok: true }))))
    } else if (message.type === 'logout') {
        event.waitUntil(enqueue(() => revokeSession(message.epoch).then(async owner => {
            const notifications = await self.registration.getNotifications()
            notifications.filter(notification => notification.data?.adminUuid === owner).forEach(notification => notification.close())
            event.ports[0]?.postMessage({ ok: true })
        })))
    } else if (message.type === 'show-event') {
        event.waitUntil(enqueue(() => deliver(message.event, 'browser', message.epoch)))
    }
})
self.addEventListener('push', event => {
    let payload
    try { payload = event.data?.json() } catch { return }
    event.waitUntil(enqueue(() => deliver(payload, 'push')))
})
self.addEventListener('notificationclick', event => {
    event.notification.close()
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        const current = windows.find(client => new URL(client.url).origin === self.location.origin)
        if (current) {
            await current.navigate(EVENTS_URL)
            await current.focus()
        } else {
            await self.clients.openWindow(EVENTS_URL)
        }
    })())
})
