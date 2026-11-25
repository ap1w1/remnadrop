export type CloudflareAccount = {
    id: string; name: string; source: 'stored' | 'environment'; configured: boolean;
    zoneCount: number; lastSyncedAt: string | null; lastError: string | null; updatedAt: string;
}
export type CloudflareZone = {
    id: string; name: string; status: string; accountId: string; accountName: string;
    cloudflareAccountId?: string | null; cloudflareAccountName?: string | null;
}
export type CloudflareHostLink = { hostUuid: string; hostName: string; nodeUuid: string; nodeName: string }
export type CloudflareRecord = {
    id: string; accountId: string; accountName: string; zoneId: string; zoneName: string;
    name: string; type: string; content: string; proxied?: boolean; ttl: number; linkedHosts: CloudflareHostLink[];
}
export type CloudflareBinding = { account_id: string; domain: string; zone_id: string; auto_sync: boolean }
export type CloudflareHistory = {
    id: string; account_id: string | null; account_name: string | null; record_name: string;
    old_ip: string | null; new_ip: string | null; source: string; status: string; message: string; created_at: string;
}
export type CloudflareData = {
    accounts: CloudflareAccount[]; zones: CloudflareZone[]; records: CloudflareRecord[]; bindings: CloudflareBinding[];
    accountErrors: { accountId: string; accountName: string; message: string }[];
    zoneErrors: { accountId: string; accountName: string; zoneId: string; zoneName: string; message: string }[];
}
export const CLOUDFLARE_API = '/api/cloudflare-dns'
export const CLOUDFLARE_PAGE = '/dashboard/tools/cloudflare-dns'
export const cloudflareError = (error: unknown) => {
    const response = error as { response?: { data?: { message?: string | string[] } } }
    return String(response.response?.data?.message ?? (error instanceof Error ? error.message : 'Не удалось выполнить запрос'))
}
export const cloudflareTime = (time: string | null) => time ? new Date(time).toLocaleString('ru-RU') : 'Ещё не обновлялся'
export const recordKey = (record: { accountId: string; zoneId: string; id: string }) => `${record.accountId}:${record.zoneId}:${record.id}`
export const automationLink = (record: CloudflareRecord) => '/dashboard/management/automations?' + new URLSearchParams({
    accountId: record.accountId, zoneId: record.zoneId, recordId: record.id,
}).toString()
