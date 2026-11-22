export type DpiRegionSelection = {location:string;pop_ids?:number[]}
export type AutomationAction = (
    | { type: 'dpi_check'; hosts: string[]; location: string; pop_ids?: number[];
        locations?: DpiRegionSelection[]; gate?: {minUnavailableRegions:number; timeoutMinutes:number} }
    | { type: 'hide_hosts' | 'show_hosts'; hosts: string[] }
    | { type: 'rotate_ip'; updateCloudflare?: boolean }
    | { type: 'webhook'; url: string }
    | { type: 'cloudflare_dns'; accountId: string; zoneId: string; recordId: string;
        ipSource: 'static' | 'rotated'; newIp?: string; expectedOldIp?: string; domain?: string }
) & {when?:'always'|'dpi_unavailable'|'dpi_available'|'dpi_unknown'}

export type AutomationInput = {
    name: string; node_uuid: string | null; enabled: boolean;
    trigger_type: 'online_drop' | 'online_value' | 'node_offline' | 'interval' | 'manual';
    online_operator: 'gt' | 'lt' | 'eq'; online_value: number;
    drop_percent: number; min_online: number; duration_minutes: number;
    cooldown_minutes: number; interval_minutes: number; failure_policy: 'stop' | 'continue';
    actions: AutomationAction[]
}
export type AutomationRule = AutomationInput & {
    id: string; node_name: string | null; pending_since: string | null; last_run_at: string | null;
    created_at: string; updated_at: string; revision: number;
    active_execution_id: string | null; execution_lease_until: string | null;
    last_status: string | null; last_finished_at: string | null
}
export type AutomationHost = { uuid: string; remark: string; address: string; is_hidden: boolean; node_uuids: string[] }
export type AutomationNode = { uuid: string; name: string; address?: string | null; countryCode?: string | null }
export type CloudflareAccount = { id: string; name: string }
export type ExecutionDetail = {
    index?: number; type: string; title?: string; success: boolean; status?: string;
    message: string; startedAt?: string; finishedAt?: string; outcome?:'unavailable'|'available'|'unknown'
}
export type AutomationExecution = {
    id: string; rule_id: string | null; name: string; node_name: string | null; source: string;
    status: string; started_at: string; finished_at: string | null; details: ExecutionDetail[];
    trigger_snapshot?: { reason?: string; online?: number | null; baseline?: number | null; dropPercent?: number | null }
}
export type AutomationPreview = {
    valid: boolean; readOnly: boolean; failurePolicy: string;
    trigger: { matched: boolean; ready: boolean; reason: string; online: number | null;
        baseline: number | null; dropPercent: number | null; nextRunAt: string | null;
        confirmSeconds: number; cooldownSeconds: number }
    actions: { index: number; type: string; title: string; target: string; warnings: string[]; error?: string }[]
}

export const automationApi = '/api/node-automations'
export const actionLabels: Record<AutomationAction['type'], string> = {
    dpi_check: 'Проверить доступность', rotate_ip: 'Сменить IP ноды', cloudflare_dns: 'Изменить IP домена',
    hide_hosts: 'Скрыть хосты', show_hosts: 'Показать хосты', webhook: 'Отправить вебхук'
}
export const triggerLabels: Record<AutomationInput['trigger_type'], string> = {
    online_drop: 'Падение онлайна', online_value: 'Онлайн: больше, меньше или равен', node_offline: 'Нода недоступна', interval: 'По интервалу', manual: 'Вручную'
}
export const executionStatuses: Record<string, { label: string; color: string }> = {
    running: { label: 'Выполняется', color: 'blue' }, waiting_dpi: {label:'Ожидание DPI', color:'violet'}, completed: { label: 'Успешно', color: 'teal' },
    partial_failure: { label: 'Частично выполнено', color: 'orange' }, failed: { label: 'Ошибка', color: 'red' }
}
export const freshAutomation = (): AutomationInput => ({
    name: '', node_uuid: null, enabled: false, trigger_type: 'online_drop', online_operator: 'lt', online_value: 10, drop_percent: 50,
    min_online: 5, duration_minutes: 5, cooldown_minutes: 60, interval_minutes: 60,
    failure_policy: 'stop', actions: []
})
export function triggerSummary(rule: AutomationInput) {
    if (rule.trigger_type === 'manual') return 'По нажатию «Запустить»'
    if (rule.trigger_type === 'online_value') return `Онлайн ${rule.online_operator === 'gt' ? '>' : rule.online_operator === 'eq' ? '=' : '<'} ${rule.online_value}`
    if (rule.trigger_type === 'interval') return `Каждые ${rule.interval_minutes} мин`
    if (rule.trigger_type === 'node_offline') return `Недоступна ${rule.duration_minutes} мин`
    return `Онлайн упал на ${rule.drop_percent}% за ${rule.duration_minutes} мин`
}
export function actionSummary(action: AutomationAction) {
    if (action.type === 'cloudflare_dns') return `${action.domain || 'DNS-запись'} → ${action.ipSource === 'rotated' ? 'новый IP ноды' : action.newIp || 'новый IP'}`
    if (action.type === 'dpi_check') return `DPI · ${action.hosts.length} хостов · ${action.locations?.length ?? 1} стран${action.gate ? ` · недоступно в ${action.gate.minUnavailableRegions}+ регионах` : ''}`
    if ('hosts' in action) return `${actionLabels[action.type]} · ${action.hosts.length}`
    if (action.type === 'webhook') { try { return `Вебхук · ${new URL(action.url).hostname}` } catch { return 'Вебхук' } }
    return actionLabels[action.type]
}
export function apiError(error: unknown, fallback: string) {
    const message = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message
    return Array.isArray(message) ? message.join('. ') : message || fallback
}
export function displayDate(value?: string | null) {
    return value ? new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Ещё не запускалось'
}
