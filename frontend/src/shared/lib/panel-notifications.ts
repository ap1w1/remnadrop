import { instance } from '@shared/api/axios'
import { EVENTS_API, type NotificationPreferences, type PanelEvent } from '@shared/api/panel-events'

const WORKER_URL = '/remnadrop-notifications-sw.js'
const PUSH_OWNER_KEY = 'remnadrop-push-owner'
const SESSION_KEY = 'remnadrop-notification-session'
let sessionGeneration = 0
let sessionOwner: string | null = null
let sessionEpoch = ''
let sessionCredential = ''

function storedSession(): { epoch: string; owner: string | null } | null {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') } catch { return null }
}
function storedCredential(): string {
    try { return JSON.parse(localStorage.getItem('sessionStore') || 'null')?.state?.token || '' } catch { return '' }
}
function writeSession(owner: string | null) {
    const value = { epoch: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`, owner }
    localStorage.setItem(SESSION_KEY, JSON.stringify(value))
    return value
}

export function activateNotificationSession(adminUuid: string, credential: string) {
    if (notificationSupport() || !credential || credential !== storedCredential()) return
    // Existing tabs never adopt a new login epoch just because they rerender.
    if (sessionOwner === adminUuid && sessionCredential === credential) return
    const shared = storedSession()
    const next = shared?.owner === adminUuid ? shared : writeSession(adminUuid)
    sessionGeneration += 1; sessionOwner = adminUuid; sessionCredential = credential; sessionEpoch = next.epoch
}

const currentSession = (generation: number, adminUuid: string) => generation === sessionGeneration && sessionOwner === adminUuid &&
    sessionCredential === storedCredential() && storedSession()?.epoch === sessionEpoch && storedSession()?.owner === adminUuid

export function pushOwner(): string | null {
    try { return localStorage.getItem(PUSH_OWNER_KEY) } catch { return null }
}

export function notificationSupport(): string | null {
    if (!window.isSecureContext) return 'Для уведомлений откройте панель по HTTPS.'
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        return 'Этот браузер не поддерживает уведомления. На iPhone и iPad добавьте панель на экран «Домой» и откройте её оттуда.'
    }
    return null
}

export async function notificationWorker(register = false, current: () => boolean = () => true): Promise<ServiceWorkerRegistration | undefined> {
    if (notificationSupport()) return undefined
    const existing = await navigator.serviceWorker.getRegistration('/')
    if (!current()) return undefined
    const candidate = existing?.active || existing?.waiting || existing?.installing
    const own = candidate?.scriptURL === new URL(WORKER_URL, location.origin).href
    const registration = own ? existing : register ? await navigator.serviceWorker.register(WORKER_URL, { scope: '/' }) : undefined
    if (!current()) return undefined
    if (!registration) return undefined
    if (!registration.active) {
        const worker = registration.installing || registration.waiting
        if (worker) await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(() => reject(new Error('Не удалось запустить службу уведомлений. Повторите попытку.')), 15_000)
            const check = () => {
                if (worker.state === 'activated') { clearTimeout(timer); worker.removeEventListener('statechange', check); resolve() }
                else if (worker.state === 'redundant') { clearTimeout(timer); worker.removeEventListener('statechange', check); reject(new Error('Служба уведомлений недоступна.')) }
            }
            worker.addEventListener('statechange', check)
            check()
        })
    }
    return current() ? registration : undefined
}

async function messageWorker(registration: ServiceWorkerRegistration, message: unknown): Promise<void> {
    const worker = registration.active
    if (!worker) throw new Error('Служба уведомлений ещё запускается. Повторите попытку.')
    await new Promise<void>((resolve, reject) => {
        const channel = new MessageChannel()
        const timer = window.setTimeout(() => { channel.port1.close(); reject(new Error('Служба уведомлений не ответила.')) }, 5_000)
        channel.port1.onmessage = () => { clearTimeout(timer); channel.port1.close(); resolve() }
        worker.postMessage(message, [channel.port2])
    })
}

export async function syncNotificationWorker(preferences: NotificationPreferences, register = false) {
    const generation = sessionGeneration
    const current = () => currentSession(generation, preferences.adminUuid)
    if (!current()) return undefined
    const registration = await notificationWorker(register, current)
    if (!current()) return undefined
    if (registration) await messageWorker(registration, { type: 'settings', epoch: sessionEpoch, preferences: {
        ...preferences,
        browserEnabled: preferences.browserEnabled && Notification.permission === 'granted',
        // Server preferences gate push delivery; this flag represents this device's subscription.
        pushEnabled: pushOwner() === preferences.adminUuid && Notification.permission === 'granted'
    } })
    return current() ? registration : undefined
}

export async function requestNotificationPermission(): Promise<void> {
    const unsupported = notificationSupport()
    if (unsupported) throw new Error(unsupported)
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') throw new Error(permission === 'denied'
        ? 'Уведомления заблокированы. Разрешите их в настройках сайта в браузере.'
        : 'Разрешение не выдано. Можно включить уведомления позже.')
}

export async function subscribePush(publicKey: string, preferences: NotificationPreferences) {
    const generation = sessionGeneration
    const current = () => currentSession(generation, preferences.adminUuid)
    if (!('PushManager' in window)) throw new Error('Push не поддерживается в этом браузере.')
    const registration = await syncNotificationWorker({ ...preferences, pushEnabled: true }, true)
    if (!registration) throw new Error('Не удалось запустить push-уведомления.')
    const raw = atob(publicKey.replace(/-/g, '+').replace(/_/g, '/'))
    const key = Uint8Array.from(raw, character => character.charCodeAt(0))
    let existing = await registration.pushManager.getSubscription()
    if (!current()) throw new Error('Сеанс завершён. Войдите в аккаунт повторно.')
    if (existing && pushOwner() !== preferences.adminUuid) {
        await existing.unsubscribe()
        existing = null
    }
    if (!current()) throw new Error('Сеанс завершён. Войдите в аккаунт повторно.')
    const subscription = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    try {
        if (!current()) throw new Error('Сеанс завершён. Войдите в аккаунт повторно.')
        await instance.post(`${EVENTS_API}/push/subscriptions`, subscription.toJSON())
        if (!current()) throw new Error('Сеанс завершён. Войдите в аккаунт повторно.')
        localStorage.setItem(PUSH_OWNER_KEY, preferences.adminUuid)
        await syncNotificationWorker({ ...preferences, pushEnabled: true })
        if (!current()) throw new Error('Сеанс завершён. Войдите в аккаунт повторно.')
    } catch (error) {
        if (current()) localStorage.removeItem(PUSH_OWNER_KEY)
        await subscription.unsubscribe().catch(() => undefined)
        throw error
    }
    return subscription
}

export async function unsubscribePush(deleteRemote = true) {
    const generation = sessionGeneration
    localStorage.removeItem(PUSH_OWNER_KEY)
    const registration = await notificationWorker()
    if (generation !== sessionGeneration) return
    const subscription = await registration?.pushManager?.getSubscription()
    if (generation !== sessionGeneration) return
    if (!subscription) return
    // Removing the browser subscription stops delivery even if the API is temporarily unavailable.
    const endpoint = subscription.endpoint
    await subscription.unsubscribe()
    if (deleteRemote && generation === sessionGeneration) await instance.delete(`${EVENTS_API}/push/subscriptions`, { data: { endpoint }, timeout: 2_000 })
}

export async function stopPanelNotifications(deleteRemote = true) {
    // Suspend synchronously, before any awaited browser API. A slow pending poll
    // or subscription cannot restore an earlier account after this point.
    const generation = ++sessionGeneration
    sessionOwner = null
    try {
        // An old tab's expired session must not disable a newer login in another tab.
        if (sessionEpoch && storedSession()?.epoch !== sessionEpoch) return
        if (sessionCredential && storedCredential() && sessionCredential !== storedCredential()) return
        const revokedEpoch = sessionEpoch || storedSession()?.epoch
        const stopped = writeSession(null)
        sessionEpoch = stopped.epoch
        localStorage.removeItem(PUSH_OWNER_KEY)
        const current = () => generation === sessionGeneration && storedSession()?.epoch === stopped.epoch
        const registration = await notificationWorker()
        if (!current()) return
        if (registration) await messageWorker(registration, { type: 'logout', epoch: revokedEpoch }).catch(() => undefined)
        if (!current()) return
        await unsubscribePush(deleteRemote).catch(() => undefined)
    } catch {
        // An unavailable notification service must never block signing out.
    }
}

export async function showPanelEvent(event: PanelEvent, preferences: NotificationPreferences) {
    const generation = sessionGeneration
    const registration = await syncNotificationWorker(preferences, true)
    if (!currentSession(generation, preferences.adminUuid)) return
    registration?.active?.postMessage({ type: 'show-event', epoch: sessionEpoch, event: { ...event, adminUuid: preferences.adminUuid } })
}
