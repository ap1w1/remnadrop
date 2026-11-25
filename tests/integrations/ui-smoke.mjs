import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

// Render the actual production bundle. Only API data is synthetic; these tests
// never contact a panel, Telegram or Cloudflare account.
const root = resolve(process.env.REMNADROP_UI_DIST || 'artifacts/frontend');
const output = resolve(process.env.REMNADROP_UI_OUTPUT || 'artifacts/ui');
await mkdir(output, { recursive: true });
const { chromium } = await import(pathToFileURL(process.env.REMNADROP_PLAYWRIGHT_MODULE).href);
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let file = resolve(root, '.' + pathname);
    if (file !== root && !file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    const exists = await stat(file).catch(() => null);
    if (!exists?.isFile()) {
      if (extname(file)) { response.writeHead(404).end(); return; }
      file = join(root, 'index.html');
    }
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    response.end(await readFile(file));
  } catch { response.writeHead(500).end(); }
});
await new Promise(accept => server.listen(0, '127.0.0.1', accept));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, ...(process.env.REMNADROP_CHROMIUM ? { executablePath: process.env.REMNADROP_CHROMIUM } : {}) });
const now = new Date().toISOString();
const panelFixtures = JSON.parse(await readFile(new URL('./fixtures/panel-ui.json', import.meta.url), 'utf8'));
let includeSecondNode = false;
let includeThirdNode = false;
let topologyMode = false;
const topologyProfileId = '10000000-0000-4000-8000-000000000111';
const topologyInboundId = '10000000-0000-4000-8000-000000000112';
const topologySquadId = '10000000-0000-4000-8000-000000000113';
const topologyInbound = {uuid:topologyInboundId,profileUuid:topologyProfileId,tag:'VLESS',type:'vless',network:null,security:null,port:443,rawInbound:null};
const initialGroupId = '10000000-0000-4000-8000-000000000097';
const createdGroupId = '10000000-0000-4000-8000-000000000098';
const nodeQuota = {node_uuid:panelFixtures.node.uuid,group_uuid:initialGroupId,used_bytes:'4424990',limit_bytes:null,blocked:false,period_days:null,threshold_percent:80};
const secondNodeUuid = '10000000-0000-4000-8000-000000000099';
const thirdNodeUuid = '10000000-0000-4000-8000-000000000100';
const initialGroup = {id:initialGroupId,name:'Финляндия',node_uuids:[panelFixtures.node.uuid],limit_bytes:'10737418240',used_bytes:nodeQuota.used_bytes,blocked:false,threshold_percent:80};
let nodeQuotaGroups = [{...initialGroup}];
let panelPreferences = { adminUuid: '10000000-0000-4000-8000-000000000001', browserEnabled: false,
  eventTypes: ['node.offline','node.online','automation.triggered','automation.failed','billing.reminder','auth.login','ssl.expiring','ssl.expired','metric.cpu','metric.memory','metric.online_drop','metric.traffic_drop'] };
let panelUnread = 2;
const panelEvents = [
  { id:'2',type:'ssl.expiring',severity:'warning',title:'Истекает SSL-сертификат',message:'Edge TLS · vpn.example.com · Финляндия-2',createdAt:now,nodeUuid:panelFixtures.node.uuid,nodeName:panelFixtures.node.name,nodeAddress:panelFixtures.node.address,countryCode:'FI',data:{} },
  { id:'1',type:'node.offline',severity:'error',title:'Нода недоступна',message:'Финляндия-2',createdAt:now,nodeUuid:panelFixtures.node.uuid,nodeName:panelFixtures.node.name,nodeAddress:panelFixtures.node.address,countryCode:'FI',data:{} },
];
let certificates = [];
const accountA = '10000000-0000-4000-8000-000000000001';
const accountB = '10000000-0000-4000-8000-000000000002';
const nodeId = '10000000-0000-4000-8000-000000000003';
const hostId = '10000000-0000-4000-8000-000000000004';
const userId = '10000000-0000-4000-8000-000000000005';
const ruleId = '10000000-0000-4000-8000-000000000006';
const zoneId = 'a'.repeat(32), recordId = 'b'.repeat(32);
const accounts = [
  { id: accountA, name: 'Основные домены', configured: true, source: 'stored', zoneCount: 1, lastSyncedAt: now, lastError: null, updatedAt: now },
  { id: accountB, name: 'Резервные домены', configured: true, source: 'stored', zoneCount: 1, lastSyncedAt: now, lastError: null, updatedAt: now },
];
const zones = [
  { id: zoneId, name: 'example.com', status: 'active', accountId: accountA, accountName: accounts[0].name },
  { id: 'c'.repeat(32), name: 'example.net', status: 'active', accountId: accountB, accountName: accounts[1].name },
];
const records = [
  { id: recordId, name: 'vpn.example.com', type: 'A', content: '192.0.2.10', ttl: 300, proxied: false, accountId: accountA, accountName: accounts[0].name, zoneId, zoneName: 'example.com', linkedHosts: [] },
  { id: 'd'.repeat(32), name: 'vpn.example.net', type: 'AAAA', content: '2001:db8::10', ttl: 300, proxied: false, accountId: accountB, accountName: accounts[1].name, zoneId: zones[1].id, zoneName: 'example.net', linkedHosts: [] },
];
const limiterSettings = {
  enabled: true, mode: 'manual', checkIntervalSeconds: 60, activeWindowSeconds: 120,
  tolerance: 0, toleranceMultiplier: 0, defaultDeviceLimit: 5, violationThreshold: 3,
  thresholdWindowSeconds: 3600, cooldownSeconds: 300, autoRestoreMinutes: 1440, softWarnings: false,
  subnetGrouping: false, subnetPrefixV4: 24, asnGrouping: false,
  trafficMonitor: false, trafficSpikeFactor: 10, trafficSpikeMinGb: 150, trafficHeavyGb: 200,
  trafficHeavyDays: 5, sharedHwidMonitor: false, sharedHwidHistoryDays: 30, dailyReport: true,
  updateCheck: false, telegramNotifications: true, ignoredNodes: [], ignoredUsers: [], ignoredIps: [], trafficIgnoredNodes: [],
  ignoreDurationMinutes: 360, userCacheTtlSeconds: 600, logLevel: 'info', lastScanAt: now, lastError: null, engineVersion: '5.1.0',
};
const ips = Array.from({ length: 9 }, (_, index) => ({ ip: '198.51.100.' + (index + 10), node_uuid: nodeId,
  node_name: 'Финляндия-2', last_seen: now, asn: 64496, asn_org: 'Тестовый провайдер',
  nodes: [{ node_uuid: nodeId, node_name: 'Финляндия-2', last_seen: now }],
}));
const limiterEvents = [{
  id: '10000000-0000-4000-8000-000000000007', user_uuid: userId, user_id: '114644', username: '114644',
  event_type: 'violation_detected', mode: 'manual', device_limit: 5, observed_count: 9, ips,
  details: null, created_at: now, occurred_at: now, unique_ip_count: 9, connection_count: 9, violations_24h: 3,
  user_status: 'ACTIVE', subscriptionUrl: 'https://example.invalid/sub/fixture',
  state: { ignored: false, permanentIgnore: false, ignoredUntil: null, restoreAt: null }, stateAvailable: true, last_action: null,
  payload: { violation: { ips, ip_count: 9, device_limit: 5, effective_limit: 5, violation_count_24h: 3, device_group_count: 9, connection_count: 9, grouping_mode: 'none' },
    evidence: { Fetches: { Total: 1, IPs: 1, ASNs: 0, Apps: 0, Rows: [{ IP: ips[0].ip, Org: '', Apps: null, Count: 1, Online: true }] }, Devices: null },
  },
}];
const rules = [{
  id: ruleId, name: 'Резервный IP домена', node_uuid: null, node_name: null, enabled: false,
  trigger_type: 'manual', drop_percent: 50, min_online: 5, duration_minutes: 5, cooldown_minutes: 60,
  interval_minutes: 60, failure_policy: 'stop', created_at: now, updated_at: now, revision: 1,
  active_execution_id: null, execution_lease_until: null, pending_since: null, last_run_at: null, last_status: null, last_finished_at: null,
  actions: [{ type: 'cloudflare_dns', accountId: accountA, zoneId, recordId, ipSource: 'static', newIp: '192.0.2.20', expectedOldIp: '192.0.2.10', domain: 'vpn.example.com' }],
}];
const executions = [];
const calls = [], unexpected = [], pageErrors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'ru-RU', colorScheme: 'dark' });
await context.grantPermissions(['notifications'], { origin });
await context.addInitScript(() => {
  localStorage.setItem('sessionStore', JSON.stringify({ state: { token: 'synthetic-ui-token' }, version: 0 }));
  localStorage.setItem('updatesStore', JSON.stringify({ state: { lastUpdateTimestamp: Date.now(), remnawaveInfo: { latestVersion: '2.8.1', starsCount: 1 } }, version: 1 }));
  localStorage.setItem('i18nextLng', 'ru');
  localStorage.setItem('mantine-color-scheme-value', 'dark');
  window.permissionRequests = 0;
  const permission = Notification.requestPermission.bind(Notification);
  Notification.requestPermission = (...args) => { window.permissionRequests++; return permission(...args); };
});
function preview(input) {
  return { valid: true, readOnly: true, failurePolicy: input.failure_policy || 'stop',
    trigger: { matched: false, ready: false, reason: 'Запускается только вручную', online: null, baseline: null, dropPercent: null, sampledAt: null, nextRunAt: null, confirmSeconds: 0, cooldownSeconds: 0 },
    actions: input.actions.map((action, index) => ({ index, type: action.type, title: action.type === 'cloudflare_dns' ? 'Изменить IP домена' : 'Скрыть хосты', target: action.type === 'cloudflare_dns' ? 'vpn.example.com: 192.0.2.10 → 192.0.2.20' : 'Финляндия', warnings: [] })),
  };
}
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (url.origin !== origin) {
    // Windows needs a flag-font fallback; Linux CI renders flags without this optional request.
    if (process.platform === 'win32' && url.href === 'https://cdn.jsdelivr.net/npm/country-flag-emoji-polyfill@0.1/dist/TwemojiCountryFlags.woff2') return route.abort();
    unexpected.push('External request: ' + url.origin + url.pathname);
    return route.abort();
  }
  if (!url.pathname.startsWith('/api/')) return route.continue();
  const pathname = url.pathname.replace(/\/+$/, ''), method = request.method(), body = request.postDataJSON();
  calls.push({ pathname, method, body });
  let result;
  if (pathname === '/api/auth/status') result = { isLoginAllowed: true, isRegisterAllowed: false, authentication: null, branding: { title: 'RemnaDrop', logoUrl: null } };
  else if (pathname === '/api/system/stats/recap') result = { thisMonth: { users: 240, traffic: '2199023255552' }, total: { users: 1200, nodes: 12, traffic: '21990232555520', nodesRam: '68719476736', nodesCpuCores: 48, distinctCountries: 6 }, version: '2.8.1', initDate: '2026-01-01T00:00:00.000Z' };
  else if (pathname === '/api/system/metadata') result = { version: '2.8.1', build: { time: now, number: 'ui-qa' }, git: { backend: { commitSha: 'ui-fixture', branch: 'qa', commitUrl: '' }, frontend: { commitSha: 'ui-fixture', commitUrl: '' } } };
  else if (pathname === '/api/cloudflare-dns/accounts') {
    if (method === 'POST') { result = { ...accounts[0], id: '10000000-0000-4000-8000-000000000009', name: body.name, zoneCount: 0 }; accounts.push(result); }
    else result = accounts;
  } else if (pathname === '/api/cloudflare-dns/overview') result = { accounts, zones, records, bindings: [], accountErrors: [], zoneErrors: [] };
  else if (pathname === '/api/cloudflare-dns/events' || pathname === '/api/cloudflare-dns/links' || pathname === '/api/cloudflare-dns/bindings') result = [];
  else if (pathname === '/api/cloudflare-dns/zones') result = zones.filter(zone => zone.accountId === url.searchParams.get('accountId'));
  else if (/^\/api\/cloudflare-dns\/zones\/[^/]+\/records$/.test(pathname)) result = records.filter(record => record.accountId === url.searchParams.get('accountId') && record.zoneId === pathname.split('/')[4]);
  else if (pathname === '/api/cloudflare-dns/records/replace-ip') {
    const record = records.find(record => record.accountId === body.accountId && record.zoneId === body.zoneId && record.id === body.recordId);
    assert(record, 'DNS UI did not identify a record/account');
    assert.equal(body.expectedOldIp, record.content);
    record.content = body.newIp; result = { updated: true, auditRecorded: true };
  } else if (pathname === '/api/limiter/settings') { if (method === 'PUT') Object.assign(limiterSettings, body); result = limiterSettings; }
  else if (pathname === '/api/limiter/settings/runtime') result = [{ Key: 'COOLDOWN', Title: 'Пауза между нарушениями', Display: '300', Kind: 1, Allowed: null, Overridden: true }];
  else if (pathname === '/api/limiter/status') result = { embedded: true, running: true, ready: true, lastCheck: now, pid: 100, version: '5.1.0', redisDatabase: 8 };
  else if (pathname === '/api/limiter/outbound-webhook/status') result = {configured:false,destination:null,events:[],pending:0,failed:0,delivered:0};
  else if (pathname === '/api/limiter/credentials') result = { configured: false, telegramConfigured: false, maxmindConfigured: false, telegramChatId: '', telegramThreadId: '', telegramAdminIds: '', sharedHwidSquadUuids: [] };
  else if (pathname === '/api/limiter/events') result = limiterEvents;
  else if (pathname === '/api/limiter/summary') result = { count24h: 3, countWeek: 7, users24h: 1, liveAvailable: true, live: { violations: { Count24h: 3, CountWeek: 7, Top: [] }, heavyTraffic: [], lastCheck: now } };
  else if (pathname === '/api/limiter/ignored' || pathname === '/api/limiter/actions') result = [];
  else if (/^\/api\/limiter\/users\/[^/]+\/actions$/.test(pathname)) result = { success: true, action: body.action, userId: 114644, state: limiterEvents[0].state };
  else if (pathname === '/api/node-automations/options') result = { nodes: [{ uuid: nodeId, name: 'Финляндия-2', countryCode: 'FI', address: '198.51.100.20' }], hosts: [{ uuid: hostId, remark: 'Финляндия', address: 'vpn.example.com', node_uuids: [nodeId], is_hidden: false }], dpiCostLimitUsd: 1 };
  else if (pathname === '/api/node-automations/executions') result = executions;
  else if (pathname === '/api/node-automations/preview') result = preview(body);
  else if (pathname === `/api/node-automations/${ruleId}/preview`) result = preview(rules[0]);
  else if (pathname === `/api/node-automations/${ruleId}/run`) {
    assert.equal(body.confirmed, true);
    const id = '10000000-0000-4000-8000-000000000010';
    executions.unshift({ id, rule_id: ruleId, name: rules[0].name, node_name: null, source: 'manual', status: 'completed', started_at: now, finished_at: now, details: [{ type: 'cloudflare_dns', title: 'Изменить IP домена', success: true, status: 'completed', message: 'DNS → 192.0.2.20' }] });
    result = { executionId: id, status: 'running' };
  } else if (pathname === '/api/node-automations') {
    if (method === 'POST') rules.push({ ...rules[0], ...body, id: '10000000-0000-4000-8000-000000000011' });
    result = rules;
  } else if (pathname === '/api/panel-events') result = { items: panelEvents.filter(event => !url.searchParams.get('type') || event.type===url.searchParams.get('type')), unread: panelUnread, latestId: '2' };
  else if (pathname === '/api/panel-events/read') { panelUnread=0; result={success:true}; }
  else if (pathname === '/api/panel-events/preferences') { if(method==='PUT') panelPreferences={...panelPreferences,...body}; result=panelPreferences; }
  else if (pathname === '/api/node-quotas/global-settings') result={periodDays:30,thresholdPercent:80,configured:true};
  else if (pathname === '/api/ssl-certificates') {
    if(method==='POST') { certificates.push({...body,id:'cert-1',nodeNames:['Финляндия-2']}); result={id:'cert-1'}; }
    else result=certificates;
  } else if (pathname === '/api/ssl-certificates/cert-1') {
    if(method==='PUT') certificates[0]={...certificates[0],...body};
    if(method==='DELETE') certificates=[];
    result={success:true};
  } else if (pathname === '/api/nodes') result = topologyMode
    ? [{...panelFixtures.node,configProfile:{activeConfigProfileUuid:topologyProfileId,activeInbounds:[topologyInbound]}}]
    : includeSecondNode
    ? [panelFixtures.node, {...panelFixtures.node, uuid:secondNodeUuid, name:'Тестовая нода', viewPosition:1},...(includeThirdNode?[{...panelFixtures.node,uuid:thirdNodeUuid,name:'Резервная нода',address:'198.51.100.21',viewPosition:2}]:[])]
    : [panelFixtures.node];
  else if (pathname === `/api/nodes/${panelFixtures.node.uuid}`) result = panelFixtures.node;
  else if (pathname === '/api/keygen') result={pubKey:'test-public-key'};
  else if (pathname === '/api/node-plugins') result={total:0,nodePlugins:[]};
  else if (pathname === '/api/nodes/tags') result={tags:[]};
  else if (pathname === `/api/metadata/node/${panelFixtures.node.uuid}`) result={metadata:{}};
  else if (pathname === '/api/infra-billing/providers') result={total:0,providers:[]};
  else if (pathname === '/api/users') result=method==='POST'?panelFixtures.user:{users:[panelFixtures.user],total:1};
  else if (pathname === '/api/users/tags') result=panelFixtures.tags;
  else if (pathname === `/api/users/${panelFixtures.user.uuid}`) result=panelFixtures.user;
  else if (pathname === `/api/users/${panelFixtures.user.uuid}/node-quotas/groups`) {
    if(method==='POST') {
      assert.equal(body.nodeUuids.length,2);
      nodeQuotaGroups.push({id:createdGroupId,name:body.name,node_uuids:body.nodeUuids,limit_bytes:body.limitBytes,used_bytes:'0',blocked:false,threshold_percent:80});
      result={id:createdGroupId};
    } else result=nodeQuotaGroups;
  }
  else if (pathname.startsWith(`/api/users/${panelFixtures.user.uuid}/node-quotas/groups/`)) {
    const groupId=pathname.split('/').at(-1), group=nodeQuotaGroups.find(item=>item.id===groupId);
    assert(group,'Unknown quota group');
    if(method==='PUT') {Object.assign(group,{name:body.name,node_uuids:body.nodeUuids,limit_bytes:body.limitBytes});result={id:groupId};}
    else if(method==='DELETE') {nodeQuotaGroups=nodeQuotaGroups.filter(item=>item.id!==groupId);result={success:true};}
  }
  else if (pathname.endsWith('/node-quotas/settings')) result={mode:'shared',periodDays:30,resetAt:'2026-12-23T00:00:00Z',thresholdPercent:80};
  else if (pathname.endsWith('/node-quotas/status')) result={pendingSync:false};
  else if (pathname.endsWith('/node-quotas')) result=[nodeQuota];
  else if (pathname === '/api/external-squads') result=panelFixtures.externalSquads;
  else if (pathname === '/api/system/stats') result=panelFixtures.stats;
  else if (pathname === '/api/remnawave-settings') result=panelFixtures.settings;
  else if (pathname === '/api/tokens') result={tokens:[],docs:{enabled:false,scalarPath:null,swaggerPath:null}};
  else if (pathname === '/api/tokens/scopes') result={wildcard:'*',resources:[]};
  else if (pathname === '/api/config-profiles') result=topologyMode?{total:1,configProfiles:[{uuid:topologyProfileId,viewPosition:0,name:'Основной профиль',config:{},inbounds:[topologyInbound],nodes:[],createdAt:now,updatedAt:now}]}:{total:0,configProfiles:[]};
  else if (pathname === '/api/passkeys') result={passkeys:[]};
  else if (pathname.startsWith('/api/subscriptions/connection-keys/')) result={enabledKeys:[],hiddenKeys:[],disabledKeys:[]};
  else if (pathname.startsWith('/api/metadata/user/')) result={metadata:{}};
  else if (pathname === '/api/subscription-templates') result = {total:0,templates:[]};
  else if (pathname === '/api/hosts/tags') result = {tags:[]};
  else if (pathname === '/api/hosts') result = topologyMode
    ? [{uuid:hostId,viewPosition:0,remark:'VPN хост',address:'vpn.example.com',port:443,path:null,sni:null,host:null,alpn:null,fingerprint:null,isDisabled:false,xhttpExtraParams:null,muxParams:null,sockoptParams:null,finalMask:null,inbound:{configProfileUuid:topologyProfileId,configProfileInboundUuid:topologyInboundId},serverDescription:null,isHidden:false,vlessRouteId:null,pinnedPeerCertSha256:null,verifyPeerCertByName:null,shuffleHost:false,mihomoX25519:false,mihomoIpVersion:null,nodes:[panelFixtures.node.uuid],xrayJsonTemplateUuid:null,excludedInternalSquads:[],excludeFromSubscriptionTypes:[]}]
    : [{ uuid: hostId, remark: 'Финляндия', address: 'vpn.example.com' }];
  else if (pathname === '/api/internal-squads') result = topologyMode
    ? {total:1,internalSquads:[{uuid:topologySquadId,viewPosition:0,name:'Основной сквад',inbounds:[topologyInbound],info:{membersCount:7,inboundsCount:1},createdAt:now,updatedAt:now}]}
    : { total: 0, internalSquads: [] };
  else {
    unexpected.push(method + ' ' + pathname);
    return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Unhandled UI fixture endpoint' }) });
  }
  await route.fulfill({ status: method === 'POST' ? 201 : 200, contentType: 'application/json', body: JSON.stringify({ response: result }) });
});
const page = await context.newPage();
page.on('pageerror', error => pageErrors.push(`${page.url()}: ${error.stack || error.message}`));
page.on('response', response => {
  if (response.url().endsWith('.js') && response.headers()['content-type']?.includes('text/html'))
    pageErrors.push(`JavaScript served as HTML: ${response.url()}`);
});
page.setDefaultTimeout(12000);
const visible = locator => locator.waitFor({ state: 'visible' });
async function capture(name, checkState) {
  // Page fades in with Framer Motion. Capture its settled pixels as well as DOM
  // evidence; visibility checks alone can precede the browser's final paint.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForFunction(() => {
    let element = document.querySelector('main h1, main h2, main h3');
    while (element && element.tagName !== 'MAIN') {
      if (element instanceof HTMLElement && element.style.opacity !== '') {
        if (Number(getComputedStyle(element).opacity) < 0.999) return false;
      }
      element = element.parentElement;
    }
    return true;
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (checkState) await checkState();
  const before = await page.locator('main').innerText();
  await page.screenshot({ path: join(output, name + '.png'), fullPage: true, animations: 'disabled' });
  if (checkState) await checkState();
  const after = await page.locator('main').innerText();
  await writeFile(join(output, name + '.json'), JSON.stringify({ url: page.url(), viewport: page.viewportSize(), before, after }, null, 2));
}
async function checkExpandedLimiterEvent() {
  assert.equal(await page.getByRole('button', { name: /^114644/ }).getAttribute('aria-expanded'), 'true', 'The same event must stay expanded while capturing');
  assert(await page.getByText('198.51.100.10', { exact: true }).first().isVisible());
  assert.equal(await page.locator('main .mantine-Skeleton-root').count(), 0, 'A loaded event must not return to the initial skeleton');
}
async function noHorizontalOverflow() {
  const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  assert(width.content <= width.viewport + 1, `Horizontal page overflow: ${width.content} > ${width.viewport}`);
}
const scenarios = [], failures = [];
async function scenario(name, run) {
  if (process.env.REMNADROP_UI_ONLY && !new RegExp(process.env.REMNADROP_UI_ONLY).test(name)) return;
  try {
    await run();
    scenarios.push({ name, status: 'passed' });
  } catch (error) {
    scenarios.push({ name, status: 'failed' });
    failures.push({ name, message: error.stack || String(error) });
    console.error('FAIL ' + name + ': ' + error.message);
    await capture(name + '-failure').catch(() => {});
    const controls = await page.locator('input').evaluateAll(elements => elements.map(element => ({
      type: element.type, role: element.getAttribute('role'), ariaLabel: element.getAttribute('aria-label'),
      labels: Array.from(element.labels || [], label => label.textContent), checked: element.checked,
    }))).catch(() => []);
    await writeFile(join(output, name + '-failure.json'), JSON.stringify({ message: error.stack, pageErrors, unexpected, controls, text: await page.locator('body').innerText().catch(() => '') }, null, 2));
  }
}

try {
  await scenario('node-editor-layout', async () => {
    await page.goto(origin+'/dashboard/management/nodes');
    await page.getByText(panelFixtures.node.name,{exact:true}).first().click();
    await visible(page.getByRole('dialog'));
    const nodeGrid=page.locator('.mantine-Modal-body .mantine-SimpleGrid-root').first();
    assert.equal(await nodeGrid.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),2);
    await visible(page.getByText('Потребление',{exact:true}));
    await noHorizontalOverflow();
    await capture('node-editor-desktop');
  });
  await scenario('node-list-spacing', async () => {
    await page.keyboard.press('Escape');
    includeSecondNode = true;
    try {
      await page.setViewportSize({width:3000,height:900});
      await page.goto(origin+'/dashboard/management/nodes');
      await visible(page.getByText('Тестовая нода',{exact:true}));
      await page.evaluate(() => { document.documentElement.style.fontSize='20px'; });
      await page.evaluate(() => document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
      const positions = await page.locator('[data-index]').evaluateAll(elements => elements.slice(0,2).map(element => {
        const rect=element.getBoundingClientRect(); return {top:rect.top,bottom:rect.bottom};
      }));
      assert.equal(positions.length,2);
      assert(positions[0].bottom-positions[0].top>90, 'The test row must exceed the old fixed estimate');
      assert(positions[1].top>=positions[0].bottom-1, `Node cards overlap: ${JSON.stringify(positions)}`);
      await capture('node-list-wide');
    } finally {
      includeSecondNode = false;
      await page.setViewportSize({width:1440,height:900});
    }
  });
  topologyMode = true;
  await scenario('node-topology', async () => {
    await page.goto(origin+'/dashboard/management/topology');
    const board=page.locator('svg[aria-label^="Схема нод"]');
    const squad=board.locator(`[data-vertex="squad:${topologySquadId}"]`);
    const inbound=board.locator(`[data-vertex="inbound:${topologyInboundId}"]`);
    await visible(squad);
    const squadX = Number((await squad.getAttribute('transform')).match(/^translate\((\d+)/)?.[1]);
    const inboundX = Number((await inbound.getAttribute('transform')).match(/^translate\((\d+)/)?.[1]);
    assert(Number.isFinite(squadX) && Number.isFinite(inboundX) && inboundX > squadX);
    assert.equal(await board.evaluate(element=>getComputedStyle(element).userSelect),'none');
    await visible(page.getByText('Пользователей: 7',{exact:true}));
    await squad.click();
    await visible(page.getByText(/в цепочке: 3/));
    await capture('node-topology');
  });
  topologyMode = false;
  await scenario('cloudflare', async () => {
  await page.goto(origin + '/dashboard/tools/cloudflare-dns');
  await visible(page.getByRole('heading', { name: 'Cloudflare DNS', exact: true }));
  await page.getByRole('button', { name: /example\.com/ }).click();
  await visible(page.getByText('vpn.example.com', { exact: true }).first());
  await noHorizontalOverflow(); await capture('cloudflare-desktop');
  await page.getByRole('button', { name: 'Изменить IP', exact: true }).first().click();
  await page.getByLabel(/^Новый IP(?:\s*\*)?$/).fill('192.0.2.20');
  await page.getByRole('button', { name: 'Сохранить IP', exact: true }).click();
  await visible(page.getByText('IP записи vpn.example.com изменён', { exact: true }));
  const change = calls.find(call => call.pathname === '/api/cloudflare-dns/records/replace-ip');
  assert.deepEqual(change.body, { accountId: accountA, zoneId, recordId, expectedOldIp: '192.0.2.10', newIp: '192.0.2.20' });
  await page.locator('a[href="/dashboard/tools/cloudflare-dns/settings"]').click();
  await visible(page.getByRole('heading', { name: 'Настройки Cloudflare', exact: true }));
  await page.getByRole('button', { name: 'Добавить аккаунт', exact: true }).click();
  await page.getByLabel(/^Название аккаунта(?:\s*\*)?$/).fill('Третий аккаунт');
  await page.getByLabel(/^API-токен(?:\s*\*)?$/).fill('cfat_synthetic_ui_credential_never_sent_to_provider');
  await page.getByRole('button', { name: 'Проверить и подключить', exact: true }).click();
  await visible(page.getByText('Третий аккаунт', { exact: true }));
  await capture('cloudflare-settings-desktop');
  });

  await scenario('limiter', async () => {
  await page.goto(origin + '/dashboard/tools/limiter');
  await visible(page.getByRole('heading', { name: 'Limiter', exact: true }));
  await page.getByRole('button', { name: /^114644/ }).click();
  await visible(page.getByText('198.51.100.10', { exact: true }).first());
  await visible(page.getByText('Финляндия-2', { exact: true }).first());
  await visible(page.getByText('Уникальные IP', { exact: true }));
  assert.equal(await page.getByRole('combobox', { name: 'Режим', exact: true }).count(), 0, 'Settings must not replace the default event feed');
  assert(!/NestJS|Docker-контейнер|Go Limiter 5\.1\.0|Встроенный Limiter 5\.1\.0/.test(await page.locator('body').innerText()));
  await noHorizontalOverflow(); await capture('limiter-desktop', checkExpandedLimiterEvent);
  await page.getByRole('button', { name: 'Игнорировать 6 часов', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await visible(page.getByText(/Действие выполнено:/));
  const ignore = calls.find(call => call.pathname === `/api/limiter/users/${userId}/actions`);
  assert.equal(ignore.body.action, 'ignore_temp');
  assert.equal(ignore.body.minutes, 360);
  assert.match(ignore.body.requestId, /^[a-f\d-]{36}$/i);
  await page.locator('a[href="/dashboard/tools/limiter/settings"]').click();
  await visible(page.getByRole('heading', { name: 'Настройки Limiter', exact: true }));
  await visible(page.getByRole('combobox', { name: 'Режим', exact: true }));
  await capture('limiter-settings-desktop');
  await page.getByRole('tab', { name: 'Уведомления', exact: true }).click();
  await visible(page.getByRole('textbox', { name: 'ID топика', exact: true }));
  assert.equal(await page.getByRole('heading', { name: 'Исходящие вебхуки Limiter', exact: true }).count(), 0);
  await page.getByRole('textbox', { name: 'ID топика', exact: true }).fill('123');
  await page.getByRole('button', { name: 'Сохранить подключения', exact: true }).click();
  assert(calls.some(call => call.pathname === '/api/limiter/credentials' && call.method === 'PUT' && call.body.telegramThreadId === '123'));
  const duplication = page.getByRole('switch', { name: /^Дублировать события в Telegram/ });
  await visible(duplication);
  assert.equal(await duplication.isChecked(), true);
  await duplication.uncheck();
  await page.getByRole('button', { name: 'Сохранить настройки', exact: true }).click();
  await visible(page.getByText('Настройки сохранены. Проверка применит изменения автоматически.', { exact: true }));
  assert(calls.some(call => call.pathname === '/api/limiter/settings' && call.method === 'PUT' && call.body.telegramNotifications === false));
  assert(!calls.some(call => call.pathname === '/api/limiter/credentials' && call.method === 'DELETE'), 'Turning off duplication must preserve credentials');
  await capture('limiter-telegram-duplication');
  });

  await scenario('automations', async () => {
  await page.goto(origin + '/dashboard/management/automations');
  await visible(page.getByRole('heading', { name: 'Автоматизации', exact: true }));
  await visible(page.getByText('Резервный IP домена', { exact: true }));
  await noHorizontalOverflow(); await capture('automations-desktop');
  await page.getByRole('button', { name: 'Создать правило', exact: true }).click();
  await page.getByLabel(/^Название(?:\s*\*)?$/).fill('Проверка нового сценария');
  await page.getByRole('combobox', { name: 'Когда запускать', exact: true }).click();
  await page.getByRole('option', { name: 'Вручную', exact: true }).click();
  await page.getByRole('combobox', { name: 'Ноды (если нужны для действий)', exact: true }).click();
  await page.getByRole('option', { name: /Финляндия-2 · 198\.51\.100\.20/ }).click();
  await page.getByRole('button', { name: 'К действиям', exact: true }).click();
  await page.getByRole('combobox', { name: 'Добавить действие', exact: true }).click();
  await page.getByRole('option', { name: 'Скрыть хосты', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('combobox', { name: 'Хосты', exact: true }).click();
  await page.getByRole('option', { name: 'Финляндия', exact: true }).click();
  await page.getByRole('heading', { name: 'Что выполнить', exact: true }).click();
  const actionsBeforePreview = calls.filter(call => call.pathname.endsWith('/run') || call.pathname.endsWith('/records/replace-ip')).length;
  await page.getByRole('button', { name: 'Проверить сценарий', exact: true }).click();
  await visible(page.getByRole('dialog').getByRole('button', { name: 'Создать правило', exact: true }));
  await capture('automation-builder-preview');
  assert.equal(calls.filter(call => call.pathname.endsWith('/run') || call.pathname.endsWith('/records/replace-ip')).length, actionsBeforePreview);
  await page.getByRole('dialog').getByRole('button', { name: 'Создать правило', exact: true }).click();
  await visible(page.getByText('Правило создано', { exact: true }));
  const created = calls.find(call => call.pathname === '/api/node-automations' && call.method === 'POST');
  assert.equal(created.body.trigger_type, 'manual');
  assert.deepEqual(created.body.actions, [{ type: 'hide_hosts', hosts: [hostId] }]);
  await page.getByRole('button', { name: 'Запустить', exact: true }).first().click();
  await visible(page.getByRole('dialog', { name: 'Запустить правило сейчас?' }));
  await page.getByRole('button', { name: 'Выполнить действия', exact: true }).click();
  await visible(page.getByText('Выполнение запущено. Результаты действий появятся в журнале.', { exact: true }));
  assert(calls.some(call => call.pathname === `/api/node-automations/${ruleId}/run` && call.body.confirmed === true));
  await capture('automation-execution-history');
  });

  await scenario('panel-events', async () => {
    await page.goto(origin + '/dashboard/management/ssl-certificates');
    await visible(page.getByRole('button',{name:'События, непрочитанных: 2'}));
    await page.getByRole('button',{name:'События, непрочитанных: 2'}).click();
    await visible(page.getByRole('heading',{name:'События',exact:true}));
    await visible(page.getByText('Истекает SSL-сертификат',{exact:true}));
    assert.equal(await page.getByText('Финляндия-2',{exact:true}).count(),0,'Node name should appear only in its flag/IP line');
    await visible(page.getByText(/198\.51\.100\.20/).first());
    await visible(page.getByRole('button',{name:'События, непрочитанных: 0'}));
    assert(calls.some(call=>call.pathname==='/api/panel-events/read' && call.body.through==='2'));
    await capture('events-desktop'); await noHorizontalOverflow();
    await page.getByRole('combobox',{name:'Тип события',exact:true}).click();
    await page.getByRole('option',{name:'Загрузка ЦП',exact:true}).click();
    await visible(page.getByText('Нет событий по выбранным фильтрам'));
  });
  await scenario('ssl-certificates', async () => {
    await page.goto(origin + '/dashboard/management/ssl-certificates');
    await page.getByRole('button',{name:'Добавить сертификат',exact:true}).click();
    await page.getByLabel('Название сертификата').fill('Edge TLS');
    await page.getByRole('textbox',{name:/^Домен/}).fill('https://vpn.example.com/path');
    await page.getByRole('combobox',{name:/Ноды с этим сертификатом/}).click();
    await page.getByRole('option',{name:/Финляндия-2/}).click();
    await page.getByRole('heading',{name:'Добавить SSL-сертификат'}).click();
    await page.getByLabel('Дата окончания действия').click();
    await page.locator('button.mantine-DatePickerInput-day').last().click();
    await capture('ssl-certificate-editor');
    await page.getByRole('button',{name:'Сохранить',exact:true}).click();
    await visible(page.getByRole('cell',{name:'Edge TLS vpn.example.com'}));
    assert.deepEqual(certificates[0].reminderDays,[3,2,1]);
    assert.equal(certificates[0].domain,'vpn.example.com');
    assert.deepEqual(certificates[0].nodeUuids,[panelFixtures.node.uuid]);
    await capture('ssl-certificates-desktop'); await noHorizontalOverflow();
    await page.getByRole('button',{name:'Редактировать Edge TLS'}).click();
    await page.getByLabel('Дата окончания действия').click();
    await page.locator('button.mantine-DatePickerInput-day').nth(28).click();
    await page.getByRole('button',{name:'Сохранить',exact:true}).click();
    assert(calls.some(call=>call.method==='PUT'&&call.pathname==='/api/ssl-certificates/cert-1'));
  });
  await scenario('notification-preferences', async () => {
    await page.goto(origin + '/dashboard/management/settings');
    await visible(page.getByText('События сохраняются в журнале.',{exact:false}));
    await page.getByRole('switch',{name:'Уведомления в браузере'}).click();
    await visible(page.getByText('Уведомления включены',{exact:true}));
    assert.equal(await page.evaluate(()=>window.permissionRequests),1);
    await page.getByRole('button',{name:/Типы уведомлений ·/}).click();
    await page.getByRole('checkbox',{name:'Оплата ноды',exact:true}).uncheck();
    await page.getByTestId('notification-settings-card').getByRole('button',{name:'Сохранить',exact:true}).click();
    await visible(page.getByText('Настройки сохранены',{exact:true}));
    assert.equal(panelPreferences.eventTypes.includes('billing.reminder'),false);
    await capture('notification-settings-desktop');
    await page.reload();
    await page.getByRole('button',{name:/Типы уведомлений ·/}).click();
    await visible(page.getByRole('checkbox',{name:'Оплата ноды',exact:true}));
    assert.equal(await page.getByRole('checkbox',{name:'Оплата ноды',exact:true}).isChecked(),false);
  });
  await scenario('documentation-webhook-fields', async () => {
    await page.goto(origin + '/dashboard/documentation');
    await page.getByRole('tab', { name: 'Вебхуки' }).click();
    await page.getByText('torrent_blocker.report', { exact: true }).click();
    const details = await page.locator('.mantine-Accordion-item').filter({ hasText: 'torrent_blocker.report' }).first().locator('.mantine-Accordion-panel').innerText();
    assert.match(details, /deviceIdentification/);
    assert.match(details, /candidateCount/);
    assert.match(details, /device/);
    await page.getByText('node_quota.exhausted',{exact:true}).click();
    const groupDetails=await page.locator('.mantine-Accordion-item').filter({hasText:'node_quota.exhausted'}).first().locator('.mantine-Accordion-panel').innerText();
    assert.match(groupDetails,/nodeUuids/);
    assert.match(groupDetails,/group/);
    await page.getByRole('tab', { name: 'API-запросы' }).click();
    await page.getByText('Создать пользователя, при необходимости с группами лимитов нод',{exact:true}).click();
    await visible(page.getByText('nodeQuotaGroups',{exact:false}).first());
    await page.getByRole('button', { name: 'Лимиты нод', exact: true }).click();
    await visible(page.getByText('/api/users/:userUuid/node-quotas/groups', { exact: true }).first());
    await noHorizontalOverflow();
  });
  await scenario('host-remark-variables', async () => {
    await page.goto(origin+'/dashboard/management/hosts');
    await page.getByRole('button',{name:'Создать новый хост'}).click();
    await visible(page.getByRole('dialog'));
    const remark=page.getByRole('textbox',{name:/Примечание/});
    const oldRemark='🇺🇸 США {{LOCATION_TRAFFIC_USED}}/{{LOCATION_TRAFFIC_LIMIT}}';
    await remark.fill(oldRemark);
    await remark.blur();
    assert.equal(await remark.inputValue(),oldRemark);
    assert.notEqual(await remark.getAttribute('aria-invalid'),'true');
    await page.getByRole('button',{name:'Варианты переменных'}).click();
    await visible(page.getByText('{{N_USED}}',{exact:true}));
    await visible(page.getByText('{{N_LIMIT}}',{exact:true}));
    assert.equal(await page.getByText('{{LOCATION_TRAFFIC_LIMIT}}',{exact:true}).count(),0);
    await visible(page.getByText('{{USERNAME}}',{exact:true}));
    await capture('host-remark-variables');
  });
  await scenario('create-user-node-quotas', async () => {
    await page.goto(origin+'/dashboard/management/users');
    await page.getByRole('button',{name:/Создать польз\.|New user/i}).click();
    const dialog=page.getByRole('dialog');
    await visible(dialog.getByTestId('create-node-quotas'));
    await dialog.getByTestId('create-node-quotas').getByRole('button',{name:'+ Группа'}).click();
    await dialog.getByRole('textbox',{name:'Название группы'}).fill('США');
    await dialog.getByRole('combobox',{name:'Ноды группы'}).click();
    await page.getByRole('option',{name:/Финляндия-2/}).click();
    await dialog.getByRole('textbox',{name:'Общий лимит'}).fill('10');
    await dialog.getByRole('textbox',{name:/Имя пользователя|Username/}).fill('quota_user');
    await capture('create-user-node-quotas');
    await dialog.getByRole('button',{name:'Создать',exact:true}).click();
    const request=calls.findLast(call=>call.pathname==='/api/users'&&call.method==='POST');
    assert(request,'User creation request was not sent');
    assert.deepEqual(request.body.nodeQuotaGroups,[{name:'США',nodeUuids:[panelFixtures.node.uuid],limitBytes:'10737418240'}]);
  });
  await scenario('user-editor-tiles', async () => {
    await page.goto(origin + '/dashboard/management/users');
    await page.getByText('test_user',{exact:true}).click();
    await visible(page.getByRole('dialog'));
    await visible(page.getByText('Группы лимитов нод',{exact:true}));
    await visible(page.getByText('4,22 МиБ / 10 ГиБ',{exact:true}));
    const trafficCard=page.getByTestId('traffic-limits-card');
    assert.equal(await trafficCard.getByTestId('node-quotas').count(),1);
    const groupCard=trafficCard.getByTestId('node-quota-group').filter({hasText:'Финляндия'});
    await groupCard.getByRole('button',{name:'Изменить',exact:true}).click();
    await page.getByRole('textbox',{name:'Лимит группы'}).fill('9');
    await capture('node-quota-edit');
    await page.getByRole('button',{name:'Сохранить группу'}).click();
    await visible(page.getByText('4,22 МиБ / 9 ГиБ',{exact:true}));
    await groupCard.getByRole('button',{name:'Изменить',exact:true}).click();
    assert.equal(await page.getByRole('textbox',{name:'Лимит группы'}).inputValue(),'9');
    await page.getByRole('button',{name:'Отмена',exact:true}).click();
    const grid=page.locator('.mantine-Modal-body > div > .mantine-SimpleGrid-root');
    assert.equal(await grid.count(),1);
    assert.equal(await grid.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),2);
    await capture('user-editor-desktop');
    await page.keyboard.press('Escape');
    await page.setViewportSize({width:390,height:844});
    await page.reload();
    const mobileGuide = page.getByRole('button', { name: 'Все равно продолжить', exact: true });
    await visible(mobileGuide); await mobileGuide.click();
    await page.getByText('test_user',{exact:true}).click();
    await visible(page.getByRole('dialog'));
    await visible(page.getByText('Группы лимитов нод',{exact:true}));
    assert.equal(await page.getByTestId('traffic-limits-card').getByTestId('node-quotas').count(),1);
    assert.equal(await page.locator('.mantine-Modal-body > div > .mantine-SimpleGrid-root').count(),0);
    await page.getByTestId('node-quotas').scrollIntoViewIfNeeded();
    await noHorizontalOverflow(); await capture('user-editor-mobile');
    await page.keyboard.press('Escape');
  });
  await scenario('user-shared-node-quota', async () => {
    await page.setViewportSize({width:1440,height:1100});
    includeSecondNode=true;
    includeThirdNode=true;
    try {
      await page.goto(origin+'/dashboard/management/users');
      await page.getByText('test_user',{exact:true}).click();
      await visible(page.getByRole('dialog'));
      await visible(page.getByTestId('node-quota-group').getByText('Финляндия',{exact:true}));
      assert.equal(await page.getByTestId('node-quota-group').count(),1);
      await page.getByRole('button',{name:'+ Группа'}).click();
      await page.getByRole('textbox',{name:'Название группы'}).fill('Общий пул');
      const selector=page.getByRole('combobox',{name:'Ноды группы'});
      await selector.click();
      await page.getByRole('option',{name:/Тестовая нода/}).click();
      await selector.click();
      await page.getByRole('option',{name:/Резервная нода/}).click();
      await page.getByRole('textbox',{name:'Лимит группы'}).fill('12');
      await page.getByRole('button',{name:'Сохранить группу'}).click();
      await visible(page.getByTestId('node-quota-group').getByText('Общий пул'));
      assert.equal(await page.getByTestId('node-quota-group').count(),2);
      assert.equal(await page.getByTestId('node-quota').count(),0);
      const created=calls.findLast(call=>call.method==='POST'&&call.pathname.endsWith('/node-quotas/groups'));
      assert.deepEqual(new Set(created.body.nodeUuids),new Set([secondNodeUuid,thirdNodeUuid]));
      assert.equal(created.body.limitBytes,'12884901888');
      const shared=page.getByTestId('node-quota-group').filter({hasText:'Общий пул'});
      await shared.getByRole('button',{name:'Изменить'}).click();
      await page.getByRole('textbox',{name:'Лимит группы'}).fill('14');
      await page.getByRole('button',{name:'Сохранить группу'}).click();
      await visible(shared.getByText('0 Б / 14 ГиБ'));
      assert.equal(await page.getByTestId('node-quota-group').count(),2);
      await capture('user-shared-node-quota');
    } finally {includeSecondNode=false;includeThirdNode=false;nodeQuotaGroups=[{...initialGroup,limit_bytes:'9663676416'}];}
  });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path, title, name] of [
    ['/dashboard/tools/limiter', 'Limiter', 'limiter'],
    ['/dashboard/tools/limiter/settings', 'Настройки Limiter', 'limiter-settings'],
    ['/dashboard/tools/cloudflare-dns', 'Cloudflare DNS', 'cloudflare'],
    ['/dashboard/tools/cloudflare-dns/settings', 'Настройки Cloudflare', 'cloudflare-settings'],
    ['/dashboard/management/automations', 'Автоматизации', 'automations'],
    ['/dashboard/events', 'События', 'events'],
    ['/dashboard/management/ssl-certificates', 'SSL-сертификаты', 'ssl-certificates'],
  ]) {
    await scenario(name + '-mobile', async () => {
    await page.goto(origin + path);
    await visible(page.getByRole('heading', { name: title, exact: true }));
    if (name === 'limiter') {
      await page.getByRole('button', { name: /^114644/ }).click();
      await visible(page.getByText('198.51.100.10', { exact: true }).first());
    }
    if (name === 'cloudflare') {
      await page.getByRole('button', { name: /example\.com/ }).click();
      await visible(page.getByText('vpn.example.com', { exact: true }).filter({ visible: true }));
    }
    if (name === 'limiter-settings') await visible(page.getByRole('combobox', { name: 'Режим', exact: true }));
    if (name === 'cloudflare-settings') await visible(page.getByText('Основные домены', { exact: true }));
    if (name === 'automations') await visible(page.getByRole('tabpanel', { name: 'Правила' }).getByText('Резервный IP домена', { exact: true }));
    await noHorizontalOverflow(); await capture(name + '-mobile', name === 'limiter' ? checkExpandedLimiterEvent : undefined);
    });
  }
  const passed = failures.length === 0 && unexpected.length === 0 && pageErrors.length === 0;
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: passed ? 'passed' : 'failed', scenarios, failures, syntheticApi: true, desktop: [1440, 1100], mobile: [390, 844], calls: calls.map(({ pathname, method }) => ({ pathname, method })), pageErrors, unexpected }, null, 2));
  assert.deepEqual(failures.map(failure => failure.name), [], 'UI scenarios failed; see per-scenario artifacts');
  assert.deepEqual(unexpected, [], 'Unexpected API/external requests');
  assert.deepEqual(pageErrors, [], 'Uncaught frontend errors');
  console.log('PASS production frontend: Limiter evidence/actions/settings, Cloudflare accounts/record IP, automation builder/preview/run/history, desktop/mobile');
} catch (error) {
  await capture('failure').catch(() => {});
  await writeFile(join(output, 'failure.json'), JSON.stringify({ message: error.stack, pageErrors, unexpected, text: await page.locator('body').innerText().catch(() => '') }, null, 2));
  throw error;
} finally {
  await browser.close();
  await new Promise(accept => server.close(accept));
}
