/* No network/cache interception: this worker only handles panel notifications. */
self.addEventListener('push', event => {
    let data
    try { data = event.data.json() } catch { return }
    if (!data || typeof data.title !== 'string') return
    event.waitUntil(self.registration.showNotification(data.title, {
        body: data.body || '', tag: `panel-event-${data.id}`, data: { url: '/dashboard/events' }
    }))
})
self.addEventListener('notificationclick', event => {
    event.notification.close()
    event.waitUntil((async () => {
        const url = new URL('/dashboard/events', self.location.origin).href
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        for (const client of windows) {
            if (new URL(client.url).origin === self.location.origin) {
                await client.navigate(url)
                return client.focus()
            }
        }
        return self.clients.openWindow(url)
    })())
})
