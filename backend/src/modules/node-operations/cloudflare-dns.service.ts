import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '@common/database/prisma.service';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { ForkWebhooksService } from '@modules/squad-quotas/fork-webhooks.service';

type Zone = { id: string; name: string; status: string; account?: { id: string; name: string } };
type DnsRecord = { id: string; zone_id?: string; name: string; type: string; content: string; proxied?: boolean; ttl: number };
type AccountRow = {
    id: string; name: string; credential_source: 'stored' | 'environment';
    iv: Uint8Array | null; tag: Uint8Array | null; ciphertext: Uint8Array | null;
    zone_count: number; last_synced_at: Date | null; last_error: string | null; updated_at: Date;
};
type Binding = { account_id: string; domain: string; zone_id: string; auto_sync: boolean };
type Link = {
    hostUuid: string; hostName: string; nodeUuid: string; nodeName: string; names: string[];
    recordRefs: { accountId: string; zoneId: string; recordId: string }[];
};
export type CloudflareRecordTarget = { accountId: string; zoneId: string; recordId: string };
export type CloudflareRecordChange = CloudflareRecordTarget & { newIp: string; expectedOldIp?: string };
type ApiPayload<T> = { success: boolean; result: T; result_info?: { total_pages?: number; total_count?: number; page?: number } };
const LEGACY_ACCOUNT = '00000000-0000-4000-8000-000000000001';
const hex32 = /^[0-9a-f]{32}$/i;
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const domainPattern = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;
const canonical = (value: string) => value.trim().toLowerCase().replace(/\.$/, '');
function namesFor(value: string): string[] {
    return value.split(/[,;\s]+/).map(v => v.replace(/^https?:\/\//, '').split('/')[0].split(':')[0])
        .map(canonical).filter(v => domainPattern.test(v));
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить запрос Cloudflare';

@Injectable()
export class CloudflareDnsService {
    private readonly logger = new Logger(CloudflareDnsService.name);
    constructor(private readonly db: PrismaService, private readonly forkWebhooks: ForkWebhooksService) {}

    private encryptionKey() {
        const secret = process.env.CLOUDFLARE_DNS_ENCRYPTION_KEY ?? process.env.APP_SECRET ?? process.env.JWT_AUTH_SECRET;
        if (!secret || secret.length < 32 || secret === 'change_me')
            throw new ServiceUnavailableException('Не настроен постоянный ключ шифрования Cloudflare');
        return createHash('sha256').update('remnadrop-cloudflare-dns-v1\0').update(secret).digest();
    }
    private encrypt(token: string) {
        const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
        const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
        return { iv, ciphertext, tag: cipher.getAuthTag() };
    }
    private accountId(value: string) {
        if (typeof value !== 'string' || !uuid.test(value)) throw new BadRequestException('Некорректный аккаунт Cloudflare');
        return value.toLowerCase();
    }
    private targetIds(input: CloudflareRecordTarget) {
        if (!input || !hex32.test(input.zoneId) || !hex32.test(input.recordId))
            throw new BadRequestException('Некорректный домен или DNS-запись');
        return { accountId: this.accountId(input.accountId), zoneId: input.zoneId.toLowerCase(), recordId: input.recordId.toLowerCase() };
    }
    private tokenValue(token: string) {
        if (typeof token !== 'string' || token.length < 20 || token.length > 512 || /\s/.test(token))
            throw new BadRequestException('Некорректный API-токен Cloudflare');
        return token;
    }
    private accountName(name: string) {
        if (typeof name !== 'string' || !name.trim() || name.trim().length > 100 || /[\x00-\x1f]/.test(name))
            throw new BadRequestException('Название аккаунта должно содержать от 1 до 100 символов');
        return name.trim();
    }
    private async persistEnvironmentAccount(account: AccountRow) {
        if (account.credential_source !== 'environment') return;
        await this.db.$executeRaw`INSERT INTO cf_dns_accounts(id,name,credential_source)
            VALUES(${LEGACY_ACCOUNT}::uuid,'Основной аккаунт','environment') ON CONFLICT(id) DO NOTHING`;
    }
    private async accountRows() {
        const accounts = await this.db.$queryRaw<AccountRow[]>`SELECT id,name,credential_source,iv,tag,ciphertext,zone_count,last_synced_at,last_error,updated_at
            FROM cf_dns_accounts ORDER BY created_at,id`;
        // Read-only previews must not create accounts or write sync metadata.
        if (process.env.CLOUDFLARE_DNS_API_TOKEN && !accounts.some(a => a.id === LEGACY_ACCOUNT)) {
            accounts.push({ id: LEGACY_ACCOUNT, name: 'Основной аккаунт', credential_source: 'environment',
                iv: null, tag: null, ciphertext: null, zone_count: 0, last_synced_at: null, last_error: null, updated_at: new Date(0) });
        }
        return accounts;
    }
    private publicAccount(account: AccountRow) {
        return {
            id: account.id, name: account.name, source: account.credential_source,
            configured: account.credential_source === 'stored' || !!process.env.CLOUDFLARE_DNS_API_TOKEN,
            zoneCount: account.zone_count, lastSyncedAt: account.last_synced_at,
            lastError: account.last_error, updatedAt: account.updated_at,
        };
    }
    private async selectedAccount(accountId?: string): Promise<AccountRow> {
        const accounts = await this.accountRows();
        if (accountId !== undefined) {
            const id = this.accountId(accountId), selected = accounts.find(account => account.id === id);
            if (!selected) throw new NotFoundException('Аккаунт Cloudflare не найден');
            return selected;
        }
        if (!accounts.length) throw new ServiceUnavailableException('Подключите аккаунт Cloudflare в настройках');
        if (accounts.length !== 1) throw new BadRequestException('Укажите аккаунт Cloudflare');
        return accounts[0];
    }
    private decrypt(account: AccountRow): string {
        if (account.credential_source === 'environment') {
            const token = process.env.CLOUDFLARE_DNS_API_TOKEN;
            if (!token) throw new ServiceUnavailableException('Токен этого аккаунта больше недоступен. Обновите его в настройках');
            return token;
        }
        try {
            if (!account.iv || !account.tag || !account.ciphertext) throw new Error('Missing credential');
            const cipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), Buffer.from(account.iv));
            cipher.setAuthTag(Buffer.from(account.tag));
            return Buffer.concat([cipher.update(Buffer.from(account.ciphertext)), cipher.final()]).toString('utf8');
        } catch {
            throw new ServiceUnavailableException('Не удалось расшифровать токен Cloudflare. Проверьте постоянный ключ шифрования');
        }
    }
    async accounts() { return { response: (await this.accountRows()).map(account => this.publicAccount(account)) }; }
    async status() {
        const accounts = (await this.accounts()).response;
        return { response: { configured: accounts.some(a => a.configured), accountCount: accounts.length,
            source: accounts.length > 1 ? 'multiple' : accounts[0]?.source ?? 'none', updatedAt: accounts[0]?.updatedAt ?? null } };
    }
    private async payload<T>(token: string, path: string, init: RequestInit = {}): Promise<ApiPayload<T>> {
        if (!path.startsWith('/') || path.includes('..') || path.includes('//')) throw new BadRequestException('Некорректный путь Cloudflare API');
        let response: Response;
        try {
            response = await fetch('https://api.cloudflare.com/client/v4' + path, {
                ...init, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000),
                headers: { ...init.headers, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            });
        } catch { throw new ServiceUnavailableException('Cloudflare не отвечает. Повторите запрос'); }
        const payload = await response.json().catch(() => null) as ApiPayload<T> | null;
        if (!response.ok || !payload?.success) {
            if (response.status === 401 || response.status === 403)
                throw new BadRequestException('Cloudflare отклонил доступ. Проверьте токен и права на выбранный домен');
            if (response.status === 429) throw new ServiceUnavailableException('Достигнут лимит запросов Cloudflare. Повторите позже');
            throw new BadRequestException(`Cloudflare отклонил запрос (HTTP ${response.status})`);
        }
        return payload;
    }
    private async call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
        return (await this.payload<T>(token, path, init)).result;
    }
    private async allPages<T extends { id: string }>(token: string, path: string, perPage: number): Promise<T[]> {
        const all: T[] = [], seen = new Set<string>();
        for (let page = 1; ; page++) {
            const data = await this.payload<T[]>(token, `${path}?per_page=${perPage}&page=${page}`);
            if (!Array.isArray(data.result)) throw new ServiceUnavailableException('Cloudflare вернул некорректный список');
            let added = 0;
            for (const row of data.result) {
                if (!seen.has(row.id)) { seen.add(row.id); all.push(row); added++; }
            }
            if (data.result.length > 0 && !added) throw new ServiceUnavailableException('Cloudflare повторил страницу списка. Повторите обновление');
            const total = data.result_info?.total_pages;
            if (typeof total === 'number' && total >= 0) {
                if (page >= total) {
                    if (typeof data.result_info?.total_count === 'number' && data.result_info.total_count > all.length)
                        throw new ServiceUnavailableException('Cloudflare вернул неполный список. Повторите обновление');
                    return all;
                }
            } else if (data.result.length < perPage) return all;
            if (!added || page >= 10000) throw new ServiceUnavailableException('Cloudflare не завершил загрузку списка. Повторите обновление');
        }
    }
    private async zones(token: string) { return this.allPages<Zone>(token, '/zones', 50); }
    private async zone(token: string, zoneId: string): Promise<Zone> {
        if (!hex32.test(zoneId)) throw new BadRequestException('Некорректный Zone ID');
        const zone = await this.call<Zone>(token, '/zones/' + zoneId.toLowerCase());
        if (zone.id.toLowerCase() !== zoneId.toLowerCase()) throw new ConflictException('Cloudflare вернул другой домен');
        return zone;
    }
    private async records(token: string, zoneId: string) {
        if (!hex32.test(zoneId)) throw new BadRequestException('Некорректный Zone ID');
        return this.allPages<DnsRecord>(token, '/zones/' + zoneId.toLowerCase() + '/dns_records', 100);
    }
    private displayZone(account: AccountRow, zone: Zone) {
        return { id: zone.id, name: zone.name, status: zone.status, accountId: account.id, accountName: account.name,
            cloudflareAccountId: zone.account?.id ?? null, cloudflareAccountName: zone.account?.name ?? null };
    }
    private async refreshZones(account: AccountRow) {
        try {
            const zones = await this.zones(this.decrypt(account));
            await this.db.$executeRaw`UPDATE cf_dns_accounts SET zone_count=${zones.length},last_synced_at=now(),last_error=NULL WHERE id=${account.id}::uuid`;
            return zones;
        } catch (error) {
            await this.db.$executeRaw`UPDATE cf_dns_accounts SET last_error=${errorMessage(error).slice(0,250)} WHERE id=${account.id}::uuid`;
            throw error;
        }
    }
    async addAccount(input: { name: string; apiToken: string }, id = randomUUID()) {
        const name = this.accountName(input?.name), token = this.tokenValue(input?.apiToken);
        const zones = await this.zones(token), encrypted = this.encrypt(token);
        await this.db.$executeRaw`INSERT INTO cf_dns_accounts(id,name,iv,tag,ciphertext,zone_count,last_synced_at)
            VALUES(${id}::uuid,${name},${encrypted.iv},${encrypted.tag},${encrypted.ciphertext},${zones.length},now())`;
        return { response: this.publicAccount(await this.selectedAccount(id)) };
    }
    async updateAccount(id: string, input: { name?: string; apiToken?: string }) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Некорректные настройки аккаунта');
        const account = await this.selectedAccount(id);
        const name = input.name === undefined ? account.name : this.accountName(input.name);
        if (input.apiToken !== undefined) {
            const token = this.tokenValue(input.apiToken), zones = await this.zones(token), encrypted = this.encrypt(token);
            await this.persistEnvironmentAccount(account);
            await this.db.$executeRaw`UPDATE cf_dns_accounts SET name=${name},credential_source='stored',iv=${encrypted.iv},tag=${encrypted.tag},
                ciphertext=${encrypted.ciphertext},zone_count=${zones.length},last_synced_at=now(),last_error=NULL,updated_at=now() WHERE id=${account.id}::uuid`;
        } else {
            await this.persistEnvironmentAccount(account);
            await this.db.$executeRaw`UPDATE cf_dns_accounts SET name=${name},updated_at=now() WHERE id=${account.id}::uuid`;
        }
        return { response: this.publicAccount(await this.selectedAccount(account.id)) };
    }
    async deleteAccount(id: string) {
        const account = await this.selectedAccount(id);
        if (account.id === LEGACY_ACCOUNT && process.env.CLOUDFLARE_DNS_API_TOKEN)
            throw new ConflictException('Сначала удалите резервный токен этого аккаунта из конфигурации сервера');
        const selector = JSON.stringify([{ type: 'cloudflare_dns', accountId: account.id }]);
        const rules = await this.db.$queryRaw<{ name: string }[]>`SELECT name FROM node_automation_rules WHERE enabled AND actions @> ${selector}::jsonb LIMIT 5`;
        if (rules.length) throw new ConflictException('Аккаунт используется в активных автоматизациях: ' + rules.map(r => r.name).join(', '));
        await this.db.$executeRaw`DELETE FROM cf_dns_accounts WHERE id=${account.id}::uuid`;
        return { response: { deleted: true } };
    }
    async configureToken(apiToken: string) {
        this.tokenValue(apiToken);
        const accounts = await this.accountRows(), legacy = accounts.find(a => a.id === LEGACY_ACCOUNT);
        if (legacy) await this.updateAccount(legacy.id, { apiToken });
        else await this.addAccount({ name: 'Основной аккаунт', apiToken }, LEGACY_ACCOUNT);
        return this.status();
    }
    async removeToken() {
        const accounts = await this.accountRows();
        if (accounts.some(a => a.id === LEGACY_ACCOUNT)) await this.deleteAccount(LEGACY_ACCOUNT);
        return this.status();
    }
    async listZones(accountId: string) {
        const account = await this.selectedAccount(accountId);
        return { response: (await this.refreshZones(account)).map(zone => this.displayZone(account, zone)) };
    }
    async listRecords(accountId: string, zoneId: string) {
        const account = await this.selectedAccount(accountId), token = this.decrypt(account), zone = await this.zone(token, zoneId);
        return { response: (await this.records(token, zoneId)).map(record => ({ ...record, accountId: account.id,
            accountName: account.name, zoneId: zone.id, zoneName: zone.name })) };
    }
    async bindings() {
        return this.db.$queryRaw<Binding[]>`SELECT account_id,domain,zone_id,auto_sync FROM cf_dns_zone_bindings ORDER BY domain`;
    }
    async upsertBinding(domainInput: string, zoneId: string, autoSync: boolean, accountId?: string) {
        const domain = canonical(domainInput ?? '');
        if (!domainPattern.test(domain) || !hex32.test(zoneId) || typeof autoSync !== 'boolean') throw new BadRequestException('Некорректный домен или настройка синхронизации');
        const account = await this.selectedAccount(accountId), zone = await this.zone(this.decrypt(account), zoneId);
        if (canonical(zone.name) !== domain) throw new ConflictException('Zone ID принадлежит другому домену');
        await this.persistEnvironmentAccount(account);
        await this.db.$executeRaw`INSERT INTO cf_dns_zone_bindings(account_id,domain,zone_id,auto_sync)
            VALUES(${account.id}::uuid,${domain},${zoneId.toLowerCase()},${autoSync})
            ON CONFLICT(account_id,domain) DO UPDATE SET zone_id=excluded.zone_id,auto_sync=excluded.auto_sync,updated_at=now()`;
        return { response: await this.bindings() };
    }
    private async links(): Promise<Link[]> {
        const rows = await this.db.$queryRaw<{ host_uuid: string; remark: string; address: string; node_uuid: string; node_name: string }[]>`
            SELECT h.uuid AS host_uuid,h.remark,h.address,n.uuid AS node_uuid,n.name AS node_name
            FROM hosts h JOIN hosts_to_nodes hn ON hn.host_uuid=h.uuid JOIN nodes n ON n.uuid=hn.node_uuid WHERE NOT h.is_disabled`;
        const explicit = await this.db.$queryRaw<{ account_id: string; host_uuid: string; zone_id: string; record_id: string }[]>`
            SELECT account_id,host_uuid,zone_id,record_id FROM cf_dns_record_host_links`;
        return rows.map(row => ({ hostUuid: row.host_uuid, hostName: row.remark, nodeUuid: row.node_uuid, nodeName: row.node_name,
            names: [...new Set(namesFor(row.address))], recordRefs: explicit.filter(x => x.host_uuid === row.host_uuid)
                .map(x => ({ accountId: x.account_id, zoneId: x.zone_id, recordId: x.record_id })) }));
    }
    private aliases(records: DnsRecord[], record: DnsRecord): Set<string> {
        const names = new Set([canonical(record.name)]);
        for (let step = 0; step < records.length; step++) {
            let changed = false;
            for (const entry of records) if (entry.type === 'CNAME' && names.has(canonical(entry.content)) && !names.has(canonical(entry.name))) {
                names.add(canonical(entry.name)); changed = true;
            }
            if (!changed) break;
        }
        return names;
    }
    private connected(accountId: string, zoneId: string, records: DnsRecord[], record: DnsRecord, links: Link[]) {
        const names = this.aliases(records, record);
        return links.filter(link => link.recordRefs.some(ref => ref.accountId === accountId && ref.zoneId === zoneId.toLowerCase() && ref.recordId === record.id.toLowerCase())
            || link.names.some(name => names.has(name)));
    }
    async overview(accountId?: string) {
        const allAccounts = await this.accountRows();
        const accounts = accountId ? [await this.selectedAccount(accountId)] : allAccounts;
        const bindings = await this.bindings(), links = accounts.length ? await this.links() : [];
        const zones: ReturnType<CloudflareDnsService['displayZone']>[] = [];
        const displayed: Array<DnsRecord & { accountId: string; accountName: string; zoneId: string; zoneName: string; linkedHosts: Omit<Link, 'names' | 'recordRefs'>[] }> = [];
        const accountErrors: { accountId: string; accountName: string; message: string }[] = [];
        const zoneErrors: { accountId: string; accountName: string; zoneId: string; zoneName: string; message: string }[] = [];
        const jobs: Array<{ account: AccountRow; zone: Zone; token: string }> = [];
        for (const account of accounts) {
            try {
                const token = this.decrypt(account), found = await this.refreshZones(account);
                zones.push(...found.map(zone => this.displayZone(account, zone)));
                jobs.push(...found.map(zone => ({ account, zone, token })));
            } catch (error) { accountErrors.push({ accountId: account.id, accountName: account.name, message: errorMessage(error) }); }
        }
        let cursor = 0;
        await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => {
            while (cursor < jobs.length) {
                const { account, zone, token } = jobs[cursor++];
                try {
                    const records = await this.records(token, zone.id);
                    for (const record of records) displayed.push({ ...record, accountId: account.id, accountName: account.name, zoneId: zone.id, zoneName: zone.name,
                        linkedHosts: this.connected(account.id, zone.id, records, record, links).map(({ names, recordRefs, ...link }) => link) });
                } catch (error) { zoneErrors.push({ accountId: account.id, accountName: account.name, zoneId: zone.id, zoneName: zone.name, message: errorMessage(error) }); }
            }
        }));
        displayed.sort((a, b) => a.accountName.localeCompare(b.accountName) || a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
        return { response: { status: (await this.status()).response, accounts: (await this.accounts()).response,
            zones, records: displayed, bindings, accountErrors, zoneErrors } };
    }
    async bindHost(input: { accountId?: string; zoneId: string; recordId: string; hostUuid: string }) {
        if (!hex32.test(input?.zoneId) || !hex32.test(input?.recordId) || !uuid.test(input?.hostUuid)) throw new BadRequestException('Некорректная DNS-запись или хост');
        const account = await this.selectedAccount(input.accountId), token = this.decrypt(account);
        await this.zone(token, input.zoneId);
        await this.call<DnsRecord>(token, '/zones/' + input.zoneId + '/dns_records/' + input.recordId);
        if (!await this.db.hosts.findUnique({ where: { uuid: input.hostUuid }, select: { uuid: true } })) throw new NotFoundException('Хост не найден');
        await this.persistEnvironmentAccount(account);
        await this.db.$executeRaw`INSERT INTO cf_dns_record_host_links(account_id,zone_id,record_id,host_uuid)
            VALUES(${account.id}::uuid,${input.zoneId.toLowerCase()},${input.recordId.toLowerCase()},${input.hostUuid}::uuid) ON CONFLICT DO NOTHING`;
        return { response: { linked: true } };
    }
    async unbindHost(input: { accountId?: string; zoneId: string; recordId: string; hostUuid: string }) {
        if (!hex32.test(input?.zoneId) || !hex32.test(input?.recordId) || !uuid.test(input?.hostUuid)) throw new BadRequestException('Некорректная DNS-запись или хост');
        const account = await this.selectedAccount(input.accountId);
        await this.db.$executeRaw`DELETE FROM cf_dns_record_host_links WHERE account_id=${account.id}::uuid
            AND zone_id=${input.zoneId.toLowerCase()} AND record_id=${input.recordId.toLowerCase()} AND host_uuid=${input.hostUuid}::uuid`;
        return { response: { linked: false } };
    }
    async explicitLinks() { return { response: await this.db.$queryRaw`SELECT account_id,zone_id,record_id,host_uuid FROM cf_dns_record_host_links` }; }
    async events(accountId?: string) {
        const id = accountId ? this.accountId(accountId) : null;
        return { response: await this.db.$queryRaw`SELECT id,account_id,account_name,zone_id,record_id,record_name,node_uuid,
            host(old_ip) AS old_ip,host(new_ip) AS new_ip,source,status,message,created_at FROM cf_dns_events
            WHERE (${id}::uuid IS NULL OR account_id=${id}::uuid) ORDER BY created_at DESC LIMIT 200` };
    }
    private async log(input: { accountId: string; accountName: string; zoneId: string; recordId: string; recordName: string;
        nodeUuid?: string; oldIp: string; newIp: string; source: string; status: string; message: string }) {
        await this.db.$executeRaw`INSERT INTO cf_dns_events(account_id,account_name,zone_id,record_id,record_name,node_uuid,old_ip,new_ip,source,status,message)
            VALUES(${input.accountId}::uuid,${input.accountName},${input.zoneId},${input.recordId},${input.recordName},${input.nodeUuid ?? null}::uuid,
                ${input.oldIp}::inet,${input.newIp}::inet,${input.source},${input.status},${input.message})`;
    }
    private async readTarget(input: CloudflareRecordTarget) {
        const ids = this.targetIds(input), account = await this.selectedAccount(ids.accountId), token = this.decrypt(account);
        const zone = await this.zone(token, ids.zoneId);
        const record = await this.call<DnsRecord>(token, `/zones/${ids.zoneId}/dns_records/${ids.recordId}`);
        if (record.id.toLowerCase() !== ids.recordId || (record.zone_id && record.zone_id.toLowerCase() !== ids.zoneId))
            throw new ConflictException('DNS-запись принадлежит другому домену');
        if (!['A', 'AAAA'].includes(record.type) || isIP(record.content) !== (record.type === 'A' ? 4 : 6))
            throw new BadRequestException('IP можно изменить только у записи A или AAAA');
        return { ids, account, token, zone, record };
    }
    async getRecordTarget(input: CloudflareRecordTarget) {
        const { ids, account, zone, record } = await this.readTarget(input);
        return { response: { ...ids, accountName: account.name, zoneName: zone.name, domain: record.name,
            type: record.type, content: record.content, ttl: record.ttl, proxied: record.proxied ?? false } };
    }
    private validateChange(input: CloudflareRecordChange, record: DnsRecord) {
        const family = record.type === 'A' ? 4 : 6;
        if (typeof input.newIp !== 'string' || isIP(input.newIp) !== family) throw new BadRequestException(`Для записи ${record.type} нужен IPv${family}`);
        if (input.expectedOldIp !== undefined) {
            if (isIP(input.expectedOldIp) !== family) throw new BadRequestException('Некорректный ожидаемый IP');
            if (input.expectedOldIp !== record.content) throw new ConflictException('IP записи уже изменился. Обновите данные и повторите действие');
        }
    }
    async previewRecordChange(input: CloudflareRecordChange) {
        const { ids, account, zone, record } = await this.readTarget(input);
        this.validateChange(input, record);
        return { response: { ...ids, accountName: account.name, zoneName: zone.name, domain: record.name,
            type: record.type, oldIp: record.content, newIp: input.newIp, changed: record.content !== input.newIp } };
    }
    async updateRecordIp(input: CloudflareRecordChange, source = 'manual') {
        const target = await this.readTarget(input);
        this.validateChange(input, target.record);
        return this.writeRecord(target, input.newIp, source);
    }
    private async writeRecord(target: Awaited<ReturnType<CloudflareDnsService['readTarget']>>, newIp: string, source: string, nodeUuid?: string) {
        const { ids, account, token, record } = target;
        const current = await this.call<DnsRecord>(token, `/zones/${ids.zoneId}/dns_records/${ids.recordId}`);
        if (current.id !== record.id || current.type !== record.type || current.content !== record.content || canonical(current.name) !== canonical(record.name))
            throw new ConflictException('DNS-запись изменилась во время подготовки операции. Обновите данные');
        if (record.content === newIp) return { response: { updated: false, noop: true, ...ids, domain: record.name, oldIp: record.content, newIp } };
        const event = { ...ids, accountName: account.name, recordName: record.name, nodeUuid, oldIp: record.content, newIp, source };
        await this.persistEnvironmentAccount(account);
        try {
            await this.call(token, `/zones/${ids.zoneId}/dns_records/${ids.recordId}`, { method: 'PATCH', body: JSON.stringify({ content: newIp }) });
        } catch (error) {
            try { await this.log({ ...event, status: 'failed', message: errorMessage(error).slice(0,250) }); }
            catch { this.logger.error('Could not record rejected Cloudflare DNS write in audit'); }
            throw error;
        }
        let auditRecorded = true;
        try { await this.log({ ...event, status: 'updated', message: 'IP DNS-записи изменён' }); }
        catch { auditRecorded = false; this.logger.error('Cloudflare DNS changed, but writing the successful change to audit failed'); }
        try {
            await this.forkWebhooks.enqueue(randomUUID(), 'CLOUDFLARE_DNS_IP_UPDATED', new Date(),
                { ...ids, domain: record.name, nodeUuid: nodeUuid ?? null, oldIp: record.content, newIp, source });
        } catch { this.logger.warn('Could not queue Cloudflare DNS webhook'); }
        return { response: { updated: true, noop: false, auditRecorded, ...ids, domain: record.name, nodeUuid: nodeUuid ?? null, oldIp: record.content, newIp } };
    }
    async replaceIp(input: { accountId?: string; zoneId: string; recordId: string; nodeUuid: string; expectedOldIp: string; newIp: string; source?: string }) {
        if (!uuid.test(input?.nodeUuid)) throw new BadRequestException('Некорректная нода');
        const account = await this.selectedAccount(input.accountId);
        const change = { ...input, accountId: account.id }, target = await this.readTarget(change);
        this.validateChange(change, target.record);
        const records = await this.records(target.token, target.ids.zoneId);
        const matches = this.connected(account.id, target.ids.zoneId, records, target.record, await this.links());
        if (!matches.some(link => link.nodeUuid === input.nodeUuid.toLowerCase())) throw new ConflictException('DNS-запись не связана с хостом выбранной ноды');
        if (matches.some(link => link.nodeUuid !== input.nodeUuid.toLowerCase())) throw new ConflictException('DNS-запись используется несколькими нодами. Выберите отдельную запись');
        return this.writeRecord(target, input.newIp, input.source ?? 'manual', input.nodeUuid);
    }
    async syncAfterRotation(nodeUuid: string, oldIp: string, newIp: string) {
        if (!uuid.test(nodeUuid) || isIP(oldIp) !== 4 || isIP(newIp) !== 4) throw new BadRequestException('Некорректная нода или IP');
        const bindings = (await this.bindings()).filter(binding => binding.auto_sync);
        if (!bindings.length) return { updated: 0, failed: 0, skipped: 0 };
        const links = (await this.links()).filter(link => link.nodeUuid === nodeUuid.toLowerCase());
        if (!links.length) return { updated: 0, failed: 0, skipped: 0 };
        let updated = 0, failed = 0, skipped = 0;
        for (const binding of bindings) {
            try {
                const account = await this.selectedAccount(binding.account_id), records = await this.records(this.decrypt(account), binding.zone_id);
                for (const record of records.filter(row => row.type === 'A' && row.content === oldIp)) {
                    if (!this.connected(account.id, binding.zone_id, records, record, links).length) { skipped++; continue; }
                    try {
                        await this.replaceIp({ accountId: account.id, zoneId: binding.zone_id, recordId: record.id, nodeUuid, expectedOldIp: oldIp, newIp, source: 'ip_rotation' });
                        updated++;
                    } catch { failed++; this.logger.warn('Cloudflare DNS record rotation failed for ' + record.id); }
                }
            } catch { failed++; this.logger.warn('Cloudflare DNS zone rotation failed for ' + binding.zone_id); }
        }
        if (failed) throw new ServiceUnavailableException(`Cloudflare DNS: обновлено ${updated}, ошибок ${failed}. Подробности в журнале`);
        return { updated, failed, skipped };
    }
}
