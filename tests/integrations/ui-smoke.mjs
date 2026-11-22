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
    if (!exists?.isFile()) file = join(root, 'index.html');
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    response.end(await readFile(file));
  } catch { response.writeHead(500).end(); }
});
await new Promise(accept => server.listen(0, '127.0.0.1', accept));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, ...(process.env.REMNADROP_CHROMIUM ? { executablePath: process.env.REMNADROP_CHROMIUM } : {}) });
const now = new Date().toISOString();
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
await context.addInitScript(() => {
  localStorage.setItem('sessionStore', JSON.stringify({ state: { token: 'synthetic-ui-token' }, version: 0 }));
  localStorage.setItem('updatesStore', JSON.stringify({ state: { lastUpdateTimestamp: Date.now(), remnawaveInfo: { latestVersion: '2.8.1', starsCount: 1 } }, version: 1 }));
  localStorage.setItem('i18nextLng', 'ru');
  localStorage.setItem('mantine-color-scheme-value', 'dark');
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
    unexpected.push('External request: ' + url.origin + url.pathname);
    return route.abort();
  }
  if (!url.pathname.startsWith('/api/')) return route.continue();
  const pathname = url.pathname, method = request.method(), body = request.postDataJSON();
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
  else if (pathname === '/api/limiter/credentials') result = { configured: false, telegramConfigured: false, maxmindConfigured: false, telegramChatId: '', telegramAdminIds: '', sharedHwidSquadUuids: [] };
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
  } else if (pathname === '/api/nodes') result = [{ uuid: nodeId, name: 'Финляндия-2' }];
  else if (pathname === '/api/hosts') result = [{ uuid: hostId, remark: 'Финляндия', address: 'vpn.example.com' }];
  else if (pathname === '/api/internal-squads') result = { total: 0, internalSquads: [] };
  else {
    unexpected.push(method + ' ' + pathname);
    return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Unhandled UI fixture endpoint' }) });
  }
  await route.fulfill({ status: method === 'POST' ? 201 : 200, contentType: 'application/json', body: JSON.stringify({ response: result }) });
});
const page = await context.newPage();
page.on('pageerror', error => pageErrors.push(error.stack || error.message));
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
  const duplication = page.getByRole('switch', { name: /^Дублировать события и действия в Telegram/ });
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
  await page.getByRole('combobox', { name: 'Нода (если нужна для действий)', exact: true }).click();
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

  await scenario('recap', async () => {
  await page.goto(origin + '/dashboard/management/automations');
  await visible(page.getByRole('heading', { name: 'Автоматизации', exact: true }));
  await page.getByRole('button', { name: 'Recap', exact: true }).click();
  await visible(page.getByRole('dialog').getByText('RemnaDrop', { exact: true }));
  await capture('recap-branding');
  await page.keyboard.press('Escape');
  });

  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path, title, name] of [
    ['/dashboard/tools/limiter', 'Limiter', 'limiter'],
    ['/dashboard/tools/limiter/settings', 'Настройки Limiter', 'limiter-settings'],
    ['/dashboard/tools/cloudflare-dns', 'Cloudflare DNS', 'cloudflare'],
    ['/dashboard/tools/cloudflare-dns/settings', 'Настройки Cloudflare', 'cloudflare-settings'],
    ['/dashboard/management/automations', 'Автоматизации', 'automations'],
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
    if (name === 'automations') await visible(page.getByText('Резервный IP домена', { exact: true }));
    await noHorizontalOverflow(); await capture(name + '-mobile', name === 'limiter' ? checkExpandedLimiterEvent : undefined);
    });
  }
  const passed = failures.length === 0 && unexpected.length === 0 && pageErrors.length === 0;
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: passed ? 'passed' : 'failed', scenarios, failures, syntheticApi: true, desktop: [1440, 1100], mobile: [390, 844], calls: calls.map(({ pathname, method }) => ({ pathname, method })), pageErrors, unexpected }, null, 2));
  assert.deepEqual(failures.map(failure => failure.name), [], 'UI scenarios failed; see per-scenario artifacts');
  assert.deepEqual(unexpected, [], 'Unexpected API/external requests');
  assert.deepEqual(pageErrors, [], 'Uncaught frontend errors');
  console.log('PASS production frontend: Limiter evidence/actions/settings, Cloudflare accounts/record IP, automation builder/preview/run/history, Recap and desktop/mobile');
} catch (error) {
  await capture('failure').catch(() => {});
  await writeFile(join(output, 'failure.json'), JSON.stringify({ message: error.stack, pageErrors, unexpected, text: await page.locator('body').innerText().catch(() => '') }, null, 2));
  throw error;
} finally {
  await browser.close();
  await new Promise(accept => server.close(accept));
}
