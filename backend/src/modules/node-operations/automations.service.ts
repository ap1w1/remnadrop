import {
    BadRequestException, ConflictException, Injectable, Logger, NotFoundException,
    OnModuleDestroy, OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '@common/database/prisma.service';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { Prisma } from '@prisma/client';
import { postSignedWebhook } from '@modules/squad-quotas/quota-webhooks.service';
import { DpiCheckerService, DpiLocation } from './dpi-checker.service';
import { NodeIpService } from './node-ip.service';
import { CloudflareDnsService } from './cloudflare-dns.service';

export type AutomationAction =
    | { type: 'dpi_check'; hosts: string[]; location: DpiLocation }
    | { type: 'hide_hosts' | 'show_hosts'; hosts: string[] }
    | { type: 'rotate_ip'; updateCloudflare?: boolean }
    | { type: 'webhook'; url: string }
    | { type: 'cloudflare_dns'; accountId: string; zoneId: string; recordId: string;
        ipSource: 'static' | 'rotated'; newIp?: string; expectedOldIp?: string; domain?: string };

export type AutomationInput = {
    node_uuid: string | null;
    name: string;
    enabled: boolean;
    trigger_type: 'online_drop' | 'online_value' | 'node_offline' | 'interval' | 'manual';
    online_operator: 'gt' | 'lt' | 'eq'; online_value: number;
    drop_percent: number;
    min_online: number;
    duration_minutes: number;
    cooldown_minutes: number;
    interval_minutes: number;
    failure_policy: 'stop' | 'continue';
    actions: AutomationAction[];
};

type Rule = AutomationInput & {
    id: string; node_name?: string; pending_since: Date | null; last_run_at: Date | null;
    created_at: Date; updated_at: Date; revision: number; active_execution_id: string | null; execution_lease_until: Date | null;
};
type TriggerState = {
    matched: boolean; ready: boolean; reason: string; online: number | null; baseline: number | null;
    dropPercent: number | null; sampledAt: Date | null; nextRunAt: string | null;
    confirmSeconds: number; cooldownSeconds: number;
};
type ActionDetail = {
    index: number; type: string; title: string; success: boolean;
    status: 'completed' | 'failed' | 'skipped'; message: string; startedAt: string; finishedAt: string;
};

const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const CF_ID = /^[a-f\d]{32}$/i;
const REGIONS = ['russia', 'russia_mobile', 'china', 'iran', 'turkmenistan'];
const ACTION_TITLES: Record<AutomationAction['type'], string> = {
    dpi_check: 'Проверить доступность', hide_hosts: 'Скрыть хосты', show_hosts: 'Показать хосты',
    rotate_ip: 'Сменить IP ноды', webhook: 'Отправить вебхук', cloudflare_dns: 'Изменить IP домена',
};
function errorMessage(error: unknown) {
    return (error instanceof Error ? error.message : String(error)).slice(0,1000);
}
function assertId(id: unknown, title = 'правила'): asserts id is string {
    if (typeof id !== 'string' || !UUID.test(id)) throw new BadRequestException(`Некорректный ID ${title}`);
}

/** Normalize legacy rules without changing their established trigger or failure behavior. */
export function validateAutomation(input: Partial<AutomationInput>): AutomationInput {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Укажите настройки правила');
    const rule: AutomationInput = {
        node_uuid: input.node_uuid || null, name: typeof input.name === 'string' ? input.name.trim() : '',
        enabled: input.enabled ?? false, trigger_type: input.trigger_type ?? 'online_drop',
        online_operator: input.online_operator ?? 'lt', online_value: input.online_value ?? 10,
        drop_percent: input.drop_percent ?? 50, min_online: input.min_online ?? 5,
        duration_minutes: input.duration_minutes ?? 5, cooldown_minutes: input.cooldown_minutes ?? 60,
        interval_minutes: input.interval_minutes ?? 60, failure_policy: input.failure_policy ?? 'continue',
        actions: input.actions ?? [],
    };
    if (rule.name.length < 2 || rule.name.length > 80) throw new BadRequestException('Название должно содержать 2–80 символов');
    if (typeof rule.enabled !== 'boolean') throw new BadRequestException('Некорректное состояние правила');
    if (!['online_drop','online_value','node_offline','interval','manual'].includes(rule.trigger_type)) throw new BadRequestException('Неизвестное условие запуска');
    if (!['stop','continue'].includes(rule.failure_policy)) throw new BadRequestException('Выберите поведение при ошибке');
    if (rule.node_uuid !== null) assertId(rule.node_uuid, 'ноды');
    if (!['gt','lt','eq'].includes(rule.online_operator) || !Number.isInteger(rule.online_value) || rule.online_value < 0 || rule.online_value > 1000000)
        throw new BadRequestException('Укажите оператор и целое значение онлайна от 0 до 1000000');
    if (['online_drop','online_value','node_offline'].includes(rule.trigger_type) && !rule.node_uuid) throw new BadRequestException('Для этого условия выберите ноду');
    for (const [key,min,max] of [
        ['drop_percent',1,100], ['min_online',0,1000000], ['duration_minutes',1,1440],
        ['cooldown_minutes',1,10080], ['interval_minutes',5,525600],
    ] as const) {
        if (!Number.isInteger(rule[key]) || rule[key] < min || rule[key] > max) throw new BadRequestException(`Некорректное значение ${key}: от ${min} до ${max}`);
    }
    if (rule.trigger_type === 'interval' && rule.cooldown_minutes > rule.interval_minutes) throw new BadRequestException('Пауза между запусками не может быть больше интервала');
    if (!Array.isArray(rule.actions) || rule.actions.length < 1 || rule.actions.length > 8) throw new BadRequestException('Добавьте от 1 до 8 действий');
    let rotationSeen = false;
    for (const action of rule.actions) {
        if (!action || typeof action !== 'object' || Array.isArray(action)) throw new BadRequestException('Некорректное действие');
        if (action.type === 'rotate_ip') {
            if (!rule.node_uuid) throw new BadRequestException('Для смены IP выберите ноду');
            if (rotationSeen) throw new BadRequestException('Одна автоматизация может менять IP ноды только один раз');
            if (action.updateCloudflare !== undefined && typeof action.updateCloudflare !== 'boolean') throw new BadRequestException('Некорректная настройка Cloudflare');
            rotationSeen = true;
        } else if (action.type === 'hide_hosts' || action.type === 'show_hosts' || action.type === 'dpi_check') {
            if (!rule.node_uuid) throw new BadRequestException('Для действий с хостами выберите ноду');
            if (!Array.isArray(action.hosts) || !action.hosts.length || action.hosts.length > 20 ||
                action.hosts.some(id => typeof id !== 'string' || !UUID.test(id)) || new Set(action.hosts).size !== action.hosts.length) {
                throw new BadRequestException('Выберите от 1 до 20 разных хостов');
            }
            if (action.type === 'dpi_check' && !REGIONS.includes(action.location)) throw new BadRequestException('Выберите регион проверки');
        } else if (action.type === 'webhook') {
            let url: URL;
            try { url = new URL(action.url); } catch { throw new BadRequestException('Укажите корректный HTTPS-адрес вебхука'); }
            if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443') || action.url.length > 2048) throw new BadRequestException('Вебхук: HTTPS, порт 443, без логина, пароля и фрагмента');
        } else if (action.type === 'cloudflare_dns') {
            assertId(action.accountId, 'аккаунта Cloudflare');
            if (!CF_ID.test(action.zoneId) || !CF_ID.test(action.recordId)) throw new BadRequestException('Выберите домен и DNS-запись');
            if (!['static','rotated'].includes(action.ipSource)) throw new BadRequestException('Выберите источник IP');
            if (action.ipSource === 'rotated' && !rotationSeen) throw new BadRequestException('Перед обновлением DNS добавьте действие «Сменить IP ноды»');
            if (action.ipSource === 'static' && (typeof action.newIp !== 'string' || !isIP(action.newIp))) throw new BadRequestException('Укажите корректный IPv4 или IPv6');
            if (action.expectedOldIp !== undefined && (typeof action.expectedOldIp !== 'string' || !isIP(action.expectedOldIp))) throw new BadRequestException('Укажите корректный ожидаемый старый IP');
        } else throw new BadRequestException('Неизвестное действие автоматизации');
    }
    return rule;
}

@Injectable()
export class AutomationsService implements OnModuleInit, OnModuleDestroy {
    private timer?: ReturnType<typeof setInterval>;
    private busy = false;
    private readonly logger = new Logger(AutomationsService.name);
    constructor(private readonly db: PrismaService, private readonly dpi: DpiCheckerService,
        private readonly ips: NodeIpService, private readonly cf: CloudflareDnsService) {}
    onModuleInit() {
        if (process.env.INSTANCE_TYPE === 'scheduler') {
            this.timer = setInterval(() => void this.tick(), 60000);
            void this.tick();
        }
    }
    onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

    async list() {
        return { response: await this.db.$queryRaw`
            SELECT r.*,n.name AS node_name,e.status AS last_status,e.finished_at AS last_finished_at
            FROM node_automation_rules r LEFT JOIN nodes n ON n.uuid=r.node_uuid
            LEFT JOIN LATERAL (SELECT status,finished_at FROM node_automation_executions
                WHERE rule_id=r.id ORDER BY started_at DESC LIMIT 1) e ON true
            ORDER BY r.created_at DESC` };
    }
    async options() {
        const [nodes,hosts] = await Promise.all([
            this.db.$queryRaw`SELECT uuid,name,address,country_code AS "countryCode" FROM nodes ORDER BY name`,
            this.db.$queryRaw`SELECT h.uuid,h.remark,h.address,h.is_hidden,
                COALESCE(array_agg(hn.node_uuid) FILTER (WHERE hn.node_uuid IS NOT NULL),'{}'::uuid[]) AS node_uuids
                FROM hosts h LEFT JOIN hosts_to_nodes hn ON hn.host_uuid=h.uuid GROUP BY h.uuid ORDER BY h.remark`,
        ]);
        return { response: { nodes, hosts, dpiCostLimitUsd: this.dpiCostLimit() } };
    }
    async executions(query: { ruleId?: string; status?: string; limit?: string; before?: string; cursor?:string } = {}) {
        if (query.ruleId) assertId(query.ruleId);
        if (query.cursor) assertId(query.cursor,'курсора');
        if (query.status && !['running','completed','partial_failure','failed'].includes(query.status)) throw new BadRequestException('Неизвестный статус');
        const limit = query.limit === undefined ? 50 : Number(query.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException('Размер страницы: 1–100');
        if (query.before && Number.isNaN(Date.parse(query.before))) throw new BadRequestException('Некорректная дата');
        const before = query.before ? new Date(query.before) : null;
        return { response: await this.db.$queryRaw`
            SELECT e.*,COALESCE(e.rule_name,r.name,'Удалённое правило') AS name,
                COALESCE(e.node_uuid,r.node_uuid) AS node_uuid,n.name AS node_name
            FROM node_automation_executions e LEFT JOIN node_automation_rules r ON r.id=e.rule_id
            LEFT JOIN nodes n ON n.uuid=COALESCE(e.node_uuid,r.node_uuid)
            WHERE (${query.ruleId ?? null}::uuid IS NULL OR e.rule_id=${query.ruleId ?? null}::uuid)
                AND (${query.status ?? null}::text IS NULL OR e.status=${query.status ?? null})
                AND (${before}::timestamptz IS NULL OR e.started_at<${before})
                AND (${query.cursor ?? null}::uuid IS NULL OR (e.started_at,e.id)<
                    (SELECT started_at,id FROM node_automation_executions WHERE id=${query.cursor ?? null}::uuid))
            ORDER BY e.started_at DESC,e.id DESC LIMIT ${limit}` };
    }
    private async one(id: string): Promise<Rule> {
        assertId(id);
        const rows = await this.db.$queryRaw<Rule[]>`SELECT * FROM node_automation_rules WHERE id=${id}::uuid`;
        if (!rows.length) throw new NotFoundException('Правило не найдено');
        return rows[0];
    }
    private async validateResources(rule: AutomationInput) {
        if (rule.node_uuid && !await this.db.nodes.findUnique({ where: { uuid: rule.node_uuid } })) throw new NotFoundException('Нода не найдена');
        const ids = [...new Set(rule.actions.flatMap(action => 'hosts' in action ? action.hosts : []))];
        if (ids.length) {
            const rows = await this.db.$queryRaw<{uuid:string}[]>`SELECT h.uuid FROM hosts h
                JOIN hosts_to_nodes hn ON hn.host_uuid=h.uuid WHERE hn.node_uuid=${rule.node_uuid}::uuid
                AND h.uuid IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))})`;
            if (new Set(rows.map(row => row.uuid)).size !== ids.length) throw new BadRequestException('Все выбранные хосты должны быть связаны с нодой правила');
        }
    }
    private async checkDnsActions(rule: AutomationInput) {
        for (const action of rule.actions) {
            if (action.type !== 'cloudflare_dns') continue;
            if (action.ipSource === 'static') action.domain = (await this.cf.previewRecordChange({ ...action, newIp: action.newIp! })).response.domain;
            else {
                const target = (await this.cf.getRecordTarget(action)).response;
                if (target.type !== 'A') throw new BadRequestException('Пул ноды содержит IPv4: выберите DNS-запись типа A');
                action.domain = target.domain;
            }
        }
    }
    async create(input: Partial<AutomationInput>) {
        const rule = validateAutomation(input);
        await this.validateResources(rule);
        await this.checkDnsActions(rule);
        await this.db.$executeRaw`INSERT INTO node_automation_rules
            (node_uuid,name,enabled,trigger_type,online_operator,online_value,drop_percent,min_online,duration_minutes,cooldown_minutes,interval_minutes,failure_policy,actions)
            VALUES(${rule.node_uuid}::uuid,${rule.name},${rule.enabled},${rule.trigger_type},${rule.online_operator},${rule.online_value},${rule.drop_percent},${rule.min_online},
                ${rule.duration_minutes},${rule.cooldown_minutes},${rule.interval_minutes},${rule.failure_policy},${JSON.stringify(rule.actions)}::jsonb)`;
        return this.list();
    }
    async update(id: string, input: Partial<AutomationInput>) {
        const existing = await this.one(id);
        const rule = validateAutomation(input);
        await this.validateResources(rule);
        await this.checkDnsActions(rule);
        const changed = await this.db.$executeRaw`UPDATE node_automation_rules
            SET node_uuid=${rule.node_uuid}::uuid,name=${rule.name},enabled=${rule.enabled},trigger_type=${rule.trigger_type},
                online_operator=${rule.online_operator},online_value=${rule.online_value},
                drop_percent=${rule.drop_percent},min_online=${rule.min_online},duration_minutes=${rule.duration_minutes},
                cooldown_minutes=${rule.cooldown_minutes},interval_minutes=${rule.interval_minutes},failure_policy=${rule.failure_policy},
                actions=${JSON.stringify(rule.actions)}::jsonb,updated_at=now(),revision=revision+1,pending_since=NULL
            WHERE id=${existing.id}::uuid AND (execution_lease_until IS NULL OR execution_lease_until<now())`;
        if (!changed) throw new ConflictException('Правило выполняется. Дождитесь завершения перед редактированием');
        return this.list();
    }
    async setEnabled(id: string, enabled: boolean) {
        assertId(id);
        if (typeof enabled !== 'boolean') throw new BadRequestException('Укажите состояние правила');
        if (enabled) {
            const rule = validateAutomation(await this.one(id));
            await this.validateResources(rule);
            await this.checkDnsActions(rule);
        }
        const changed = await this.db.$executeRaw`UPDATE node_automation_rules SET enabled=${enabled},pending_since=NULL,updated_at=now(),revision=revision+1 WHERE id=${id}::uuid`;
        if (!changed) throw new NotFoundException('Правило не найдено');
        return this.list();
    }
    async duplicate(id: string) {
        const rule = await this.one(id);
        return this.create({ ...rule, name: `${rule.name.slice(0,70)} — копия`, enabled: false });
    }
    async remove(id: string) {
        await this.one(id);
        const changed = await this.db.$executeRaw`DELETE FROM node_automation_rules WHERE id=${id}::uuid
            AND (execution_lease_until IS NULL OR execution_lease_until<now())`;
        if (!changed) throw new ConflictException('Правило выполняется. Дождитесь завершения перед удалением');
        return { response: { success: true } };
    }
    private dpiCostLimit() {
        const value = Number(process.env.DPICHECKER_AUTOMATION_MAX_COST_USD ?? '1');
        return Number.isFinite(value) && value >= 0 ? value : 1;
    }
    private async evaluate(rule: AutomationInput & Partial<Rule>): Promise<TriggerState> {
        const now = Date.now();
        const state: TriggerState = { matched: false, ready: false, reason: '', online: null, baseline: null,
            dropPercent: null, sampledAt: null, nextRunAt: null, confirmSeconds: 0, cooldownSeconds: 0 };
        if (rule.last_run_at) state.cooldownSeconds = Math.max(0,Math.ceil((new Date(rule.last_run_at).getTime()+rule.cooldown_minutes*60000-now)/1000));
        if (rule.trigger_type === 'manual') { state.reason = 'Запускается только вручную'; return state; }
        if (rule.trigger_type === 'interval') {
            const due = new Date(rule.last_run_at ?? rule.created_at ?? new Date()).getTime()+rule.interval_minutes*60000;
            state.nextRunAt = new Date(due).toISOString(); state.matched = now >= due;
            state.ready = state.matched && !state.cooldownSeconds;
            state.reason = state.ready ? 'Наступило время запуска' : 'Ожидает следующего запуска по интервалу';
            return state;
        }
        const samples = await this.db.$queryRaw<{online:number|null;available:number|null;baseline:number|null;sampled_at:Date|null;sample_count:number}[]>`
            WITH recent AS (SELECT metrics,sampled_at FROM node_metric_samples WHERE node_uuid=${rule.node_uuid}::uuid
                AND sampled_at>now()-interval '3 minutes' ORDER BY sampled_at DESC LIMIT 1),
            baseline AS (SELECT avg((metrics->>'online')::float8) AS online,count(*)::int AS sample_count FROM node_metric_samples
                WHERE node_uuid=${rule.node_uuid}::uuid AND sampled_at BETWEEN now()-interval '30 minutes' AND now()-interval '5 minutes'
                    AND metrics->>'online' IS NOT NULL AND (metrics->>'available')::float8<>0)
            SELECT (SELECT (metrics->>'online')::float8 FROM recent) AS online,
                (SELECT (metrics->>'available')::float8 FROM recent) AS available,
                (SELECT sampled_at FROM recent) AS sampled_at,baseline.online AS baseline,baseline.sample_count FROM baseline`;
        const row = samples[0];
        if (!row || row.available === null || !row.sampled_at) { state.reason = 'Нет свежих метрик за последние 3 минуты'; return state; }
        state.online = row.online; state.baseline = row.baseline; state.sampledAt = row.sampled_at;
        if (row.available === 0) {
            // Preserve the existing online_drop behavior for confirmed disconnected nodes.
            state.matched = true; state.reason = 'Нода недоступна по последнему замеру';
        } else if (rule.trigger_type === 'node_offline') state.reason = 'Нода доступна';
        else if (rule.trigger_type === 'online_value') {
            if (row.online === null || !Number.isFinite(row.online)) { state.reason = 'Нет достоверного значения онлайна'; return state; }
            const operator = rule.online_operator ?? 'lt'; const limit = rule.online_value ?? 10;
            state.matched = operator === 'gt' ? row.online > limit : operator === 'eq' ? row.online === limit : row.online < limit;
            state.reason = `Онлайн ${row.online}, условие ${operator === 'gt' ? '>' : operator === 'eq' ? '=' : '<'} ${limit}${state.matched ? ' выполнено' : ' не выполнено'}`;
        }
        else if (row.online === null || row.baseline === null || row.sample_count < 3 || row.baseline < rule.min_online || row.baseline <= 0) state.reason = 'Недостаточно исходного онлайна или замеров для сравнения';
        else {
            state.dropPercent = Math.max(0,100*(1-row.online/row.baseline));
            state.matched = state.dropPercent >= rule.drop_percent;
            state.reason = state.matched ? 'Падение онлайна превысило порог' : 'Онлайн в пределах порога';
        }
        if (state.matched) {
            const since = rule.pending_since ? new Date(rule.pending_since).getTime() : now;
            state.confirmSeconds = Math.max(0,Math.ceil((since+rule.duration_minutes*60000-now)/1000));
            state.ready = !state.confirmSeconds && !state.cooldownSeconds;
        }
        return state;
    }

    /** A real read-only preview: never prepare DPI jobs, update rules or reserve an execution. */
    async preview(input: Partial<AutomationInput>, existing?: Rule) {
        const rule = validateAutomation(input);
        await this.validateResources(rule);
        const trigger = await this.evaluate({ ...existing, ...rule });
        const actions: {index:number;type:string;title:string;target:string;warnings:string[];error?:string}[] = [];
        for (const [index,action] of rule.actions.entries()) {
            const item = { index, type: action.type, title: ACTION_TITLES[action.type], target: '', warnings: [] as string[], error: undefined as string|undefined };
            try {
                if (action.type === 'cloudflare_dns') {
                    if (action.ipSource === 'static') {
                        const change = (await this.cf.previewRecordChange({ ...action, newIp: action.newIp! })).response;
                        item.target = `${change.domain}: ${change.oldIp} → ${change.newIp}`;
                        if (!change.changed) item.warnings.push('Адрес уже совпадает: изменение DNS не потребуется');
                    } else {
                        const target = (await this.cf.getRecordTarget(action)).response;
                        if (target.type !== 'A') throw new BadRequestException('Пул ноды содержит IPv4: нужна запись A');
                        item.target = `${target.domain}: ${target.content} → IP после смены адреса ноды`;
                        item.warnings.push('Старый IP записи должен совпасть с предыдущим IP ноды');
                    }
                } else if (action.type === 'rotate_ip') {
                    const pool = (await this.ips.list(rule.node_uuid!)).response;
                    const active = pool.find(record => record.is_active), spares = pool.filter(record => !record.is_active);
                    if (!active) throw new BadRequestException('Сначала отметьте текущий IP ноды активным в пуле');
                    if (!spares.length) throw new BadRequestException('В пуле нет запасного IP');
                    item.target = `${active.ip} → доступный запасной IP (${spares.length})`;
                    item.warnings.push('Доступность запасного адреса проверяется при запуске');
                    if (action.updateCloudflare) item.warnings.push('Также обновятся разрешённые DNS-привязки ноды');
                } else if ('hosts' in action) {
                    const rows = await this.db.$queryRaw<{uuid:string;remark:string;links:number}[]>`
                        SELECT h.uuid,h.remark,(SELECT count(*)::int FROM hosts_to_nodes hn WHERE hn.host_uuid=h.uuid) AS links
                        FROM hosts h WHERE h.uuid IN (${Prisma.join(action.hosts.map(id => Prisma.sql`${id}::uuid`))})`;
                    item.target = rows.map(host => host.remark).join(', ');
                    if (action.type === 'dpi_check') item.warnings.push(`Платная проверка: максимум $${this.dpiCostLimit()} за действие`);
                    else if (rows.some(host => host.links !== 1)) throw new BadRequestException('Общие хосты нескольких нод нельзя скрывать или показывать этим правилом');
                } else if (action.type === 'webhook') {
                    item.target = new URL(action.url).hostname;
                    if (!process.env.AUTOMATIONS_WEBHOOK_SECRET || process.env.AUTOMATIONS_WEBHOOK_SECRET.length < 32) throw new BadRequestException('Не настроен ключ подписи вебхуков AUTOMATIONS_WEBHOOK_SECRET');
                    item.warnings.push('Доступность адреса проверяется при отправке');
                }
            } catch (error) { item.error = errorMessage(error); }
            actions.push(item);
        }
        return { response: { valid: actions.every(action => !action.error), trigger, actions, failurePolicy: rule.failure_policy, readOnly: true } };
    }
    async previewSaved(id: string) { const rule = await this.one(id); return this.preview(rule,rule); }

    private async claim(rule: Rule, source: 'automatic' | 'manual', trigger: TriggerState) {
        const id = randomUUID();
        const claimed = await this.db.$queryRaw<{id:string}[]>`
            WITH claimed AS (
                UPDATE node_automation_rules SET active_execution_id=${id}::uuid,
                    execution_lease_until=now()+interval '15 minutes',last_run_at=now(),pending_since=NULL
                WHERE id=${rule.id}::uuid AND revision=${rule.revision}
                    AND (execution_lease_until IS NULL OR execution_lease_until<now())
                    AND (${source}='manual' OR (enabled AND
                        (last_run_at IS NULL OR last_run_at<now()-${rule.cooldown_minutes}::int*interval '1 minute')
                        AND ((trigger_type='interval' AND COALESCE(last_run_at,created_at)<=now()-interval_minutes*interval '1 minute')
                            OR (trigger_type IN ('online_drop','online_value','node_offline') AND pending_since IS NOT NULL
                                AND pending_since<=now()-duration_minutes*interval '1 minute'))))
                RETURNING id)
            INSERT INTO node_automation_executions(id,rule_id,source,rule_name,node_uuid,trigger_snapshot,rule_snapshot)
                SELECT ${id}::uuid,id,${source},${rule.name},${rule.node_uuid}::uuid,${JSON.stringify(trigger)}::jsonb,
                    ${JSON.stringify({name:rule.name,nodeUuid:rule.node_uuid,trigger:rule.trigger_type,actions:rule.actions,failurePolicy:rule.failure_policy})}::jsonb
                FROM claimed RETURNING id`;
        return claimed.length ? id : null;
    }
    async runNow(id: string, input: {confirmed?: boolean; expectedUpdatedAt?: string; expectedRevision?:number} = {}) {
        if (input?.confirmed !== true) throw new BadRequestException('Подтвердите выполнение действий правила');
        const rule = await this.one(id);
        if (input.expectedRevision !== undefined && input.expectedRevision !== rule.revision) throw new ConflictException('Правило изменилось. Повторно откройте проверку запуска');
        if (input.expectedUpdatedAt && new Date(input.expectedUpdatedAt).getTime() !== new Date(rule.updated_at).getTime()) throw new ConflictException('Правило изменилось. Повторно откройте проверку запуска');
        const preview = (await this.preview(rule,rule)).response;
        if (!preview.valid) throw new BadRequestException('Исправьте ошибки проверки перед запуском');
        const executionId = await this.claim(rule,'manual',preview.trigger);
        if (!executionId) throw new ConflictException('Правило уже выполняется или было изменено');
        void this.execute(rule,executionId).catch(error => this.logger.error(`Execution ${executionId}: ${errorMessage(error)}`));
        return { response: { executionId, status: 'running' } };
    }
    private async execute(rule: Rule, id: string) {
        const details: ActionDetail[] = [];
        let rotation: {previousIp:string;newIp:string}|null = null, failure = false, leaseLost = false, heartbeatBusy = false;
        const heartbeat = setInterval(() => {
            if (heartbeatBusy || leaseLost) return;
            heartbeatBusy = true;
            void this.db.$executeRaw`UPDATE node_automation_rules SET execution_lease_until=now()+interval '15 minutes'
                WHERE id=${rule.id}::uuid AND active_execution_id=${id}::uuid AND execution_lease_until>now()`
                .then(changed => { if (!changed) leaseLost = true; })
                .catch(error => this.logger.warn(`Execution heartbeat ${id}: ${errorMessage(error)}`))
                .finally(() => { heartbeatBusy = false; });
        },30000);
        heartbeat.unref();
        try {
            for (const [index,action] of rule.actions.entries()) {
                const startedAt = new Date().toISOString();
                if (leaseLost || (failure && rule.failure_policy === 'stop')) {
                    failure = true;
                    details.push({index,type:action.type,title:ACTION_TITLES[action.type],success:false,status:'skipped',message:leaseLost ? 'Пропущено: выполнение прервано' : 'Пропущено после ошибки предыдущего действия',startedAt,finishedAt:startedAt});
                    continue;
                }
                try {
                    const owned = await this.db.$executeRaw`UPDATE node_automation_rules SET execution_lease_until=now()+interval '15 minutes' WHERE id=${rule.id}::uuid AND active_execution_id=${id}::uuid AND execution_lease_until>now()`;
                    if (!owned) { leaseLost = true; throw new ConflictException('Выполнение прервано: право на запуск больше не принадлежит этой операции'); }
                    let message = '';
                    if (action.type === 'dpi_check') {
                        const prepared = await this.dpi.prepare({hosts:action.hosts,location:action.location});
                        try { await this.dpi.start(prepared.response.id,this.dpiCostLimit()); }
                        catch (error) { await this.dpi.cancel(prepared.response.id).catch(() => undefined); throw error; }
                        message = `Проверка запущена: ${prepared.response.id}`;
                    } else if (action.type === 'rotate_ip') {
                        const result = (await this.ips.rotateNext(rule.node_uuid!,'automation')).response as {success:boolean;previousIp?:string;newIp?:string};
                        if (!result.success || !result.previousIp || !result.newIp) throw new ConflictException('IP не изменён: проверьте активный адрес и запасные IP');
                        rotation = {previousIp:result.previousIp,newIp:result.newIp}; message = `${rotation.previousIp} → ${rotation.newIp}`;
                        if (action.updateCloudflare) {
                            try { const sync = await this.cf.syncAfterRotation(rule.node_uuid!,rotation.previousIp,rotation.newIp); message += `; DNS-записей обновлено: ${sync.updated}`; }
                            catch (error) { throw new Error(`IP ноды изменён (${message}), обновление DNS не выполнено: ${errorMessage(error)}`); }
                        }
                    } else if (action.type === 'cloudflare_dns') {
                        if (action.ipSource === 'rotated' && !rotation) throw new ConflictException('Предыдущее действие не вернуло новый IP ноды');
                        const newIp = action.ipSource === 'rotated' ? rotation!.newIp : action.newIp!;
                        const expectedOldIp = action.ipSource === 'rotated' ? rotation!.previousIp : action.expectedOldIp;
                        const result = (await this.cf.updateRecordIp({...action,newIp,expectedOldIp},'automation')).response;
                        message = `DNS → ${newIp}${result.noop ? ' (адрес уже совпадает)' : ''}`;
                        if ('auditRecorded' in result && result.auditRecorded === false) message += '; журнал Cloudflare не записан';
                    } else if (action.type === 'hide_hosts' || action.type === 'show_hosts') {
                        const changed = await this.db.$executeRaw(Prisma.sql`
                            WITH eligible AS (SELECT h.uuid FROM hosts h WHERE h.uuid IN (${Prisma.join(action.hosts.map(host => Prisma.sql`${host}::uuid`))})
                                AND EXISTS (SELECT 1 FROM hosts_to_nodes hn WHERE hn.host_uuid=h.uuid AND hn.node_uuid=${rule.node_uuid}::uuid)
                                AND (SELECT count(*) FROM hosts_to_nodes hn WHERE hn.host_uuid=h.uuid)=1)
                            UPDATE hosts SET is_hidden=${action.type === 'hide_hosts'}
                                WHERE uuid IN (SELECT uuid FROM eligible) AND (SELECT count(*) FROM eligible)=${action.hosts.length}`);
                        if (changed !== action.hosts.length) throw new ConflictException('Хосты не изменены: привязки изменились или хост используется несколькими нодами');
                        message = `${action.type === 'hide_hosts' ? 'Скрыто' : 'Показано'} хостов: ${changed}`;
                    } else if (action.type === 'webhook') {
                        const secret = process.env.AUTOMATIONS_WEBHOOK_SECRET;
                        if (!secret || secret.length < 32) throw new Error('Не настроен ключ подписи вебхуков');
                        await postSignedWebhook(action.url,JSON.stringify({event:'NODE_AUTOMATION_TRIGGERED',nodeUuid:rule.node_uuid,ruleId:rule.id,executionId:id}),secret,id);
                        message = 'Вебхук доставлен';
                    }
                    details.push({index,type:action.type,title:ACTION_TITLES[action.type],success:true,status:'completed',message,startedAt,finishedAt:new Date().toISOString()});
                } catch (error) {
                    failure = true;
                    details.push({index,type:action.type,title:ACTION_TITLES[action.type],success:false,status:'failed',message:errorMessage(error),startedAt,finishedAt:new Date().toISOString()});
                }
                await this.db.$executeRaw`UPDATE node_automation_executions SET details=${JSON.stringify(details)}::jsonb WHERE id=${id}::uuid AND status='running'`;
            }
            const status = failure ? (details.some(detail => detail.success) ? 'partial_failure' : 'failed') : 'completed';
            await this.db.$executeRaw`UPDATE node_automation_executions SET status=${status},finished_at=now(),details=${JSON.stringify(details)}::jsonb WHERE id=${id}::uuid AND status='running'`;
        } catch (error) {
            await this.db.$executeRaw`UPDATE node_automation_executions SET status='failed',finished_at=now(),details=${JSON.stringify([
                ...details,{index:details.length,type:'execution',title:'Выполнение',success:false,status:'failed',message:errorMessage(error),startedAt:new Date().toISOString(),finishedAt:new Date().toISOString()},
            ])}::jsonb WHERE id=${id}::uuid AND status='running'`.catch(() => undefined);
            throw error;
        } finally {
            clearInterval(heartbeat);
            await this.db.$executeRaw`UPDATE node_automation_rules SET active_execution_id=NULL,execution_lease_until=NULL WHERE id=${rule.id}::uuid AND active_execution_id=${id}::uuid`;
        }
    }
    async tick() {
        if (this.busy) return;
        this.busy = true;
        try {
            await this.db.$executeRaw`UPDATE node_automation_executions e SET status='failed',finished_at=now(),
                details=e.details || '[{"type":"execution","title":"Выполнение прервано","status":"failed","success":false,"message":"Процесс не завершил выполнение. Проверьте журнал перед повторным запуском."}]'::jsonb
                FROM node_automation_rules r WHERE e.id=r.active_execution_id AND e.status='running' AND r.execution_lease_until<now()`;
            const rules = await this.db.$queryRaw<Rule[]>`SELECT * FROM node_automation_rules WHERE enabled AND trigger_type<>'manual' ORDER BY updated_at`;
            for (const rule of rules) {
                try {
                    const state = await this.evaluate(rule);
                    if (!state.matched) {
                        if (rule.pending_since) await this.db.$executeRaw`UPDATE node_automation_rules SET pending_since=NULL WHERE id=${rule.id}::uuid AND revision=${rule.revision}`;
                        continue;
                    }
                    if (rule.trigger_type !== 'interval' && !rule.pending_since) {
                        await this.db.$executeRaw`UPDATE node_automation_rules SET pending_since=now() WHERE id=${rule.id}::uuid AND enabled AND pending_since IS NULL AND revision=${rule.revision}`;
                        continue;
                    }
                    if (!state.ready) continue;
                    const executionId = await this.claim(rule,'automatic',state);
                    if (executionId) await this.execute(rule,executionId);
                } catch (error) { this.logger.warn(`Rule ${rule.id}: ${errorMessage(error)}`); }
            }
            const periodic = await this.db.$queryRaw<{node_uuid:string}[]>`SELECT node_uuid FROM node_ip_pool WHERE is_active AND rotation_minutes IS NOT NULL
                AND (rotated_at IS NULL OR rotated_at<now()-rotation_minutes*interval '1 minute') LIMIT 30`;
            for (const row of periodic) {
                try { await this.ips.rotateNext(row.node_uuid,'periodic'); }
                catch (error) { this.logger.warn(`Periodic IP rotation ${row.node_uuid}: ${errorMessage(error)}`); }
            }
        } catch (error) { this.logger.warn(errorMessage(error)); }
        finally { this.busy = false; }
    }
}
