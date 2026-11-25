const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
Object.assign(process.env, {
    DATABASE_URL: process.env.DATABASE_URL || 'postgresql://test:test@127.0.0.1:5432/test',
    FRONT_END_DOMAIN: process.env.FRONT_END_DOMAIN || 'https://panel.example.com',
    METRICS_USER: process.env.METRICS_USER || 'test',
    METRICS_PASS: process.env.METRICS_PASS || 'test',
    SUB_PUBLIC_DOMAIN: process.env.SUB_PUBLIC_DOMAIN || 'https://sub.example.com',
    APP_SECRET: process.env.APP_SECRET || 'test-secret-for-local-panel-events',
    REDIS_HOST: process.env.REDIS_HOST || '127.0.0.1',
    REDIS_PORT: process.env.REDIS_PORT || '6379',
});
const { PanelEventsService } = require('../dist/src/modules/panel-events/panel-events.service');
const { SslCertificatesService } = require('../dist/src/modules/panel-events/ssl-certificates.service');
const { PanelEventsWorker } = require('../dist/src/modules/panel-events/panel-events.worker');
const { SquadQuotasService } = require('../dist/src/modules/squad-quotas/squad-quotas.service');
const { dueReminder, certificateSchema } = require('../dist/src/modules/panel-events/event-policy');
const admin = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const node = '33333333-3333-4333-8333-333333333333';
const execution = '44444444-4444-4444-8444-444444444444';
let pg, db, events, ssl, sslWebhooks;
const sql = (strings, values) => strings.reduce((text, part, i) => text + part + (i < values.length ? `$${i + 1}` : ''), '');
function adapter(connection) {
    return {
        $queryRaw: async (strings, ...values) => (await connection.query(sql(strings, values), values.map(v => typeof v === 'bigint' ? String(v) : v))).rows,
        $executeRaw: async (strings, ...values) => (await connection.query(sql(strings, values), values.map(v => typeof v === 'bigint' ? String(v) : v))).affectedRows,
        $transaction: callback => connection.transaction(tx => callback(adapter(tx))),
        nodes: { count: async ({ where }) => (await connection.query('SELECT count(*)::int AS count FROM nodes WHERE uuid=ANY($1::uuid[])', [where.uuid.in])).rows[0].count },
    };
}
const eventCount = async () => Number((await pg.query('SELECT count(*) AS n FROM panel_events')).rows[0].n);
const offsetDate = offset => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
const certInput = () => ({ name: 'Edge TLS', domain: '*.example.com', nodeUuids: [node], expiresOn: offsetDate(3), reminderDays: [3, 2, 1], enabled: true });
before(async () => {
    pg = new PGlite();
    await pg.exec(`CREATE TABLE admin(uuid uuid PRIMARY KEY);
        CREATE TABLE nodes(uuid uuid PRIMARY KEY,name text,address text,country_code text DEFAULT 'XX',is_connected boolean DEFAULT true,is_disabled boolean DEFAULT false);
        CREATE TABLE users(uuid uuid PRIMARY KEY);
        CREATE TABLE infra_providers(name text PRIMARY KEY,favicon_link text,login_url text);
        CREATE TABLE user_node_quota_preferences(user_uuid uuid PRIMARY KEY,period_days integer,reset_at timestamptz,threshold_percent integer,updated_at timestamptz DEFAULT now());
        CREATE TABLE user_node_quotas(user_uuid uuid,node_uuid uuid,period_days integer,reset_at timestamptz,threshold_percent integer,threshold_sent boolean DEFAULT false,updated_at timestamptz DEFAULT now());
        CREATE TABLE user_node_quota_groups(user_uuid uuid,threshold_percent integer,threshold_sent boolean DEFAULT false,reset_at timestamptz,updated_at timestamptz DEFAULT now());
        CREATE TABLE node_metric_alert_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),node_uuid uuid,metric text,active boolean,value float8,threshold float8);
        CREATE TABLE node_automation_executions(id uuid PRIMARY KEY,rule_name text,node_uuid uuid,source text,status text DEFAULT 'running');`);
    await pg.exec(fs.readFileSync(path.join(__dirname, '../prisma/migrations/20261123120000_panel_events_ssl/migration.sql'), 'utf8'));
    await pg.exec(fs.readFileSync(path.join(__dirname, '../prisma/migrations/20261124000000_event_login_remove_push/migration.sql'), 'utf8'));
    await pg.exec(`ALTER TABLE node_quota_global_settings ADD COLUMN threshold_percents integer[] NOT NULL DEFAULT ARRAY[80];
        ALTER TABLE user_node_quota_preferences ADD COLUMN threshold_percents integer[] NOT NULL DEFAULT ARRAY[80];
        ALTER TABLE user_node_quotas ADD COLUMN sent_threshold_percents integer[] NOT NULL DEFAULT '{}';
        ALTER TABLE user_node_quota_groups ADD COLUMN sent_threshold_percents integer[] NOT NULL DEFAULT '{}';`);
    db = adapter(pg); events = new PanelEventsService(db);
    sslWebhooks = {destinations:()=>['https://hooks.example.com/ssl'],enqueue:async()=>true};
    ssl = new SslCertificatesService(db, sslWebhooks);
});
beforeEach(async () => {
    sslWebhooks.enqueue = async () => true;
    await pg.exec('TRUNCATE admin,nodes,users,node_metric_alert_events,node_automation_executions,panel_events,ssl_certificates,node_quota_global_settings RESTART IDENTITY CASCADE');
    await pg.query('INSERT INTO admin VALUES($1),($2)', [admin, other]);
    await pg.query("INSERT INTO nodes(uuid,name) VALUES($1,'Frankfurt')", [node]);
});
after(async () => { await pg.close(); });

test('UTC reminder thresholds, leap dates and missed scheduler runs', () => {
    assert.equal(dueReminder('2028-03-01', [3, 2, 1], new Date('2028-02-27T23:59:59Z')), 3);
    assert.equal(dueReminder('2028-03-01', [3, 2, 1], new Date('2028-02-28T00:00:00Z')), 2);
    assert.equal(dueReminder('2028-03-01', [3, 1], new Date('2028-02-28T00:00:00Z')), 3);
    assert.equal(dueReminder('2028-03-01', [3, 2, 1], new Date('2028-03-03T00:00:00Z')), 0);
    assert.equal(dueReminder('2028-03-01', [3, 2, 1], new Date('2028-02-01T00:00:00Z')), null);
    assert.equal(certificateSchema.safeParse({ ...certInput(), expiresOn: '2027-02-29' }).success, false);
    assert.equal(certificateSchema.safeParse({ ...certInput(), reminderDays: [0] }).success, false);
    assert.equal(certificateSchema.parse({ ...certInput(), domain: 'HTTPS://VPN.EXAMPLE.COM:443/path/' }).domain, 'vpn.example.com');
});
test('node transitions are captured once and disabled nodes stay quiet', async () => {
    await pg.query('UPDATE nodes SET is_connected=false WHERE uuid=$1', [node]);
    await pg.query('UPDATE nodes SET is_connected=false WHERE uuid=$1', [node]);
    await pg.query('UPDATE nodes SET is_connected=true WHERE uuid=$1', [node]);
    await pg.query('UPDATE nodes SET is_disabled=true,is_connected=false WHERE uuid=$1', [node]);
    assert.deepEqual((await events.list(admin, {})).response.items.map(e => e.type), ['node.online', 'node.offline']);
});
test('CPU, RAM and automation triggers persist with the source transaction', async () => {
    await pg.query("INSERT INTO node_metric_alert_events(node_uuid,metric,active,value,threshold) VALUES($1,'cpu',true,96,90),($1,'memory',false,50,90)", [node]);
    await pg.query("INSERT INTO node_automation_executions(id,rule_name,node_uuid,source) VALUES($1,'Failover',$2,'automatic')", [execution, node]);
    await pg.query("UPDATE node_automation_executions SET status='failed' WHERE id=$1", [execution]);
    await pg.query("UPDATE node_automation_executions SET status='failed' WHERE id=$1", [execution]);
    const feed = (await events.list(admin, {})).response;
    assert.equal(feed.unread, 4);
    assert.deepEqual(feed.items.map(e => e.type), ['automation.failed', 'automation.triggered', 'metric.memory', 'metric.cpu']);
    assert.equal(feed.items.at(-1).severity, 'warning');
});
test('billing deduplicates a reminder but preserves different due dates and thresholds', async () => {
    const event = { eventName: 'crm.infra_billing_node_payment_in_24hrs', data: { nodeName: 'Frankfurt', providerName: 'Provider', nextBillingAt: new Date('2026-12-01'), loginUrl: 'https://example.com' } };
    await events.billing(event); await events.billing(event);
    await events.billing({ ...event, eventName: 'crm.infra_billing_node_payment_due_today' });
    assert.equal(await eventCount(), 2);
});
test('read receipts are per admin, snapshot bounded, idempotent and do not hide late commits', async () => {
    await pg.query('UPDATE nodes SET is_connected=false WHERE uuid=$1', [node]);
    const snapshot = (await events.list(admin, {})).response;
    await pg.query('UPDATE nodes SET is_connected=true WHERE uuid=$1', [node]);
    await events.read(admin, { through: snapshot.latestId });
    await events.read(admin, { through: snapshot.latestId });
    assert.equal((await events.list(admin, {})).response.unread, 1);
    assert.equal((await events.list(other, {})).response.unread, 2);
    await events.read(admin, { through: '99999' });
    await pg.exec("INSERT INTO panel_events(id,source_key,type,severity,title,message) VALUES(0,'late-transaction','node.offline','error','Late commit','')");
    assert.equal((await events.list(admin, {})).response.unread, 1);
    await assert.rejects(() => events.read(admin, { through: '-1' }));
});
test('event pagination and filters do not alter the global unread count', async () => {
    await pg.query('UPDATE nodes SET is_connected=false WHERE uuid=$1', [node]);
    await pg.query('UPDATE nodes SET is_connected=true WHERE uuid=$1', [node]);
    const first = (await events.list(admin, { limit: '1' })).response;
    const second = (await events.list(admin, { before: first.items[0].id, type: 'node.offline' })).response;
    assert.equal(second.items.length, 1); assert.equal(second.unread, 2);
    assert.equal((await events.list(admin, { severity: 'warning' })).response.items.length, 0);
    await assert.rejects(() => events.list(admin, { limit: '1000' }));
});
test('SSL CRUD validates nodes and schedules one event and one webhook per threshold', async () => {
    await assert.rejects(() => ssl.save(undefined, { ...certInput(), nodeUuids: [admin] }));
    const { response: saved } = await ssl.save(undefined, certInput());
    const cert = (await ssl.list()).response[0];
    assert.equal(cert.id, saved.id); assert.deepEqual(cert.nodeNames, ['Frankfurt']);
    await ssl.reminders(); await ssl.reminders();
    assert.equal(await eventCount(), 1);
    assert.equal((await pg.query('SELECT * FROM panel_webhook_deliveries')).rows.length, 1);
    assert.equal((await events.list(admin, {})).response.items[0].data.reminderDays, 3);
    await ssl.save(saved.id, { ...certInput(), expiresOn: offsetDate(40) });
    await ssl.reminders(); assert.equal(await eventCount(), 1);
    await ssl.save(saved.id, { ...certInput(), expiresOn: offsetDate(2) });
    await ssl.reminders(); assert.equal(await eventCount(), 2);
    await ssl.remove(saved.id); assert.equal((await ssl.list()).response.length, 0);
    assert.equal(await eventCount(), 2); // Historic events survive removal.
});
test('expired, paused and deleted-node certificates have defined reminder behavior', async () => {
    const saved = (await ssl.save(undefined, { ...certInput(), expiresOn: offsetDate(-10), enabled: false })).response;
    await ssl.reminders(); assert.equal(await eventCount(), 0);
    await ssl.save(saved.id, { ...certInput(), expiresOn: offsetDate(-10) });
    await ssl.reminders(); await ssl.reminders();
    assert.equal((await events.list(admin, {})).response.items[0].type, 'ssl.expired');
    assert.equal(await eventCount(), 1);
    await pg.query('DELETE FROM nodes WHERE uuid=$1', [node]);
    await ssl.reminders(); assert.equal(await eventCount(), 1);
});
test('webhook failure remains pending and is rescheduled without duplicating the inbox', async () => {
    await ssl.save(undefined, certInput()); await ssl.reminders();
    sslWebhooks.enqueue = async () => { throw new Error('Queue unavailable'); };
    const worker = new PanelEventsWorker(db, ssl, sslWebhooks);
    await worker.webhooks();
    const row = (await pg.query('SELECT * FROM panel_webhook_deliveries')).rows[0];
    assert.equal(row.attempts, 1); assert.equal(row.delivered_at, null); assert.equal(row.lease_until, null);
    assert.equal(await eventCount(), 1);
});


test('successful panel login records IP and time without storing credentials', async () => {
    await events.login({data:{loginAttempt:{username:'admin',ip:'203.0.113.7',userAgent:'Test'}}});
    const item=(await events.list(admin,{})).response.items[0];
    assert.equal(item.type,'auth.login'); assert.equal(item.data.ip,'203.0.113.7'); assert.ok(item.createdAt);
});
test('global quota settings apply to existing and newly created users', async () => {
    const quotas = new SquadQuotasService(db);
    await pg.query('INSERT INTO users(uuid) VALUES($1)', [admin]);
    await quotas.setGlobalPolicy(30, 80);
    assert.equal((await pg.query('SELECT period_days FROM user_node_quota_preferences WHERE user_uuid=$1', [admin])).rows[0].period_days, 30);
    await pg.query('INSERT INTO users(uuid) VALUES($1)', [other]);
    assert.equal((await pg.query('SELECT threshold_percent FROM user_node_quota_preferences WHERE user_uuid=$1', [other])).rows[0].threshold_percent, 80);
    await quotas.setGlobalPolicy(null, 90);
    assert.equal((await pg.query('SELECT threshold_percent FROM user_node_quota_preferences WHERE user_uuid=$1', [admin])).rows[0].threshold_percent, 90);
});
