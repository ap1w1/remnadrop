import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

// The production UI and service worker are real. API fixtures and the browser's
// push subscription transport are synthetic; no external account is contacted.
const root = resolve(process.env.REMNADROP_UI_DIST || 'artifacts/frontend');
const output = resolve(process.env.REMNADROP_UI_OUTPUT || 'artifacts/ui');
await mkdir(output, { recursive: true });
const { chromium } = await import(pathToFileURL(process.env.REMNADROP_PLAYWRIGHT_MODULE).href);
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let file = resolve(root, '.' + pathname);
    if (file !== root && !file.startsWith(root + sep)) return response.writeHead(403).end();
    if (!(await stat(file).catch(() => null))?.isFile()) file = join(root, 'index.html');
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    response.end(await readFile(file));
  } catch { response.writeHead(500).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.REMNADROP_CHROMIUM ? { executablePath: process.env.REMNADROP_CHROMIUM } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'ru-RU', colorScheme: 'dark' });
const now = new Date().toISOString(), adminUuid = '10000000-0000-4000-8000-000000000001', nodeUuid = '10000000-0000-4000-8000-000000000002';
const publicKey = createECDH('prime256v1').generateKeys().toString('base64url');
const types = ['node.connection_lost', 'node.connection_restored', 'automation.triggered', 'automation.failed', 'billing.payment_due', 'ssl.expiring', 'ssl.expired', 'node.cpu_high', 'node.cpu_recovered', 'node.memory_high', 'node.memory_recovered', 'node.online_drop', 'node.online_recovered', 'node.traffic_drop', 'node.traffic_recovered'];
const preferences = { adminUuid, browserEnabled: false, pushEnabled: false, eventTypes: [...types] };
const events = Array.from({ length: 55 }, (_, i) => ({ id: `event-${i + 1}`, sequence: String(i + 1), type: i % 2 ? 'ssl.expiring' : 'node.cpu_high', severity: i % 2 ? 'warning' : 'critical', title: i % 2 ? `SSL · напоминание ${i + 1}` : `Высокая нагрузка ${i + 1}`, message: 'Тестовое событие для проверки журнала панели.', nodeUuid, nodeName: 'Тестовая нода', occurredAt: now, data: {} }));
let seen = 0n, injectNewEvent = true;
let forcePreferences401 = false, loginCount = 0;
let certificates = [{ id: '10000000-0000-4000-8000-000000000003', name: 'Публичная подписка', domains: ['vpn.example.com'], nodeUuids: [nodeUuid], nodes: [{ uuid: nodeUuid, name: 'Тестовая нода' }], expiresAt: new Date(Date.now() + 2 * 86400000).toISOString(), reminderDays: [3, 2, 1], enabled: true, daysRemaining: 2, status: 'expiring', createdAt: now, updatedAt: now }];
const calls = [], unexpected = [], pageErrors = [], screenshots = [];
const summary = () => ({ unreadCount: events.filter(event => BigInt(event.sequence) > seen).length, latestSequence: events.at(-1).sequence });
await context.addInitScript(({ publicKey }) => {
  localStorage.setItem('sessionStore', JSON.stringify({ state: { token: 'synthetic-ui-token' }, version: 0 }));
  localStorage.setItem('updatesStore', JSON.stringify({ state: { lastUpdateTimestamp: Date.now(), remnawaveInfo: { latestVersion: '2.8.1', starsCount: 1 } }, version: 1 }));
  localStorage.setItem('i18nextLng', 'ru'); localStorage.setItem('mantine-color-scheme-value', 'dark');
  window.__permissionRequests = 0;
  if ('Notification' in window) {
    const original = Notification.requestPermission.bind(Notification);
    Notification.requestPermission = (...args) => { window.__permissionRequests += 1; return original(...args); };
  }
  if ('PushManager' in window) {
    const makeSubscription = () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/remnadrop-ui-fixture', expirationTime: null,
        toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/remnadrop-ui-fixture', expirationTime: null, keys: { p256dh: publicKey, auth: 'AAAAAAAAAAAAAAAAAAAAAA' } }),
        unsubscribe: async () => { localStorage.removeItem('__test-push-subscribed'); return true; } });
    PushManager.prototype.getSubscription = async () => localStorage.getItem('__test-push-subscribed') ? makeSubscription() : null;
    PushManager.prototype.subscribe = async () => {
      localStorage.setItem('__test-push-subscribed', '1');
      return makeSubscription();
    };
  }
}, { publicKey });

await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (url.origin !== origin) { unexpected.push('external ' + url.origin + url.pathname); return route.abort(); }
  if (!url.pathname.startsWith('/api/')) return route.continue();
  const path = url.pathname.replace(/\/$/, ''), method = request.method(), body = request.postDataJSON();
  calls.push({ path, method, body, query: url.search });
  let result;
  if (path === '/api/auth/status') result = { isLoginAllowed: true, isRegisterAllowed: false, authentication: null, branding: { title: 'RemnaDrop', logoUrl: null } };
  else if (path === '/api/auth/login') {
    loginCount += 1;
    Object.assign(preferences, { adminUuid: `20000000-0000-4000-8000-00000000000${loginCount}`, browserEnabled: false, pushEnabled: false, eventTypes: [loginCount === 1 ? 'node.cpu_high' : 'ssl.expired'] });
    result = { accessToken: `synthetic-account-${loginCount}` };
  }
  else if (path === '/api/system/stats/recap') result = { thisMonth: { users: 2, traffic: '0' }, total: { users: 2, nodes: 1, traffic: '0', nodesRam: '0', nodesCpuCores: 2, distinctCountries: 1 }, version: '2.8.1', initDate: now };
  else if (path === '/api/system/metadata') result = { version: '2.8.1', build: { time: now, number: 'ui-qa' }, git: { backend: { commitSha: 'fixture', branch: 'qa', commitUrl: '' }, frontend: { commitSha: 'fixture', commitUrl: '' } } };
  else if (path === '/api/panel-events/summary') result = summary();
  else if (path === '/api/panel-events/preferences') {
    if (method === 'PUT' && forcePreferences401) { forcePreferences401 = false; return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'Session expired' }) }); }
    if (method === 'PUT') Object.assign(preferences, body); result = preferences;
  }
  else if (path === '/api/panel-events/read') {
    assert.match(body.throughSequence, /^\d+$/); seen = BigInt(body.throughSequence) > seen ? BigInt(body.throughSequence) : seen;
    if (injectNewEvent) { events.push({ ...events.at(-1), id: 'event-56', sequence: '56', title: 'Новое событие во время открытия' }); injectNewEvent = false; }
    result = summary();
  } else if (path === '/api/panel-events') {
    const after = url.searchParams.get('after'), before = url.searchParams.get('before');
    let filtered = events.filter(event => (!after || BigInt(event.sequence) > BigInt(after)) && (!before || BigInt(event.sequence) < BigInt(before)) && (!url.searchParams.get('type') || event.type === url.searchParams.get('type')) && (!url.searchParams.get('severity') || event.severity === url.searchParams.get('severity')) && (url.searchParams.get('unread') !== 'true' || BigInt(event.sequence) > seen));
    if (!after) filtered = filtered.toReversed();
    const items = filtered.slice(0, Number(url.searchParams.get('limit') || 50)).map(event => ({ ...event, isRead: BigInt(event.sequence) <= seen }));
    result = { ...summary(), items, nextCursor: filtered.length > items.length ? items.at(-1).sequence : null };
  } else if (path === '/api/panel-events/push/config') result = { enabled: true, publicKey };
  else if (path === '/api/panel-events/push/subscriptions') result = { success: true };
  else if (path === '/api/ssl-certificates') {
    if (method === 'POST') {
      result = { ...body, id: '10000000-0000-4000-8000-000000000004', nodes: [{ uuid: nodeUuid, name: 'Тестовая нода' }], daysRemaining: 30, status: 'valid', createdAt: now, updatedAt: now }; certificates.push(result);
    } else result = { items: certificates };
  } else if (path.startsWith('/api/ssl-certificates/')) {
    const id = path.split('/').at(-1), index = certificates.findIndex(item => item.id === id);
    assert(index >= 0);
    if (method === 'DELETE') { certificates.splice(index, 1); result = { success: true }; }
    else { certificates[index] = { ...certificates[index], ...body, updatedAt: now }; result = certificates[index]; }
  } else if (path === '/api/nodes') result = [{ uuid: nodeUuid, name: 'Тестовая нода' }];
  else if (path === '/api/remnawave-settings') result = { passwordSettings: { enabled: true }, passkeySettings: { enabled: false, rpId: null, origin: null }, brandingSettings: { title: 'RemnaDrop', logoUrl: null }, oauth2Settings: { github: { enabled: false, clientId: null, clientSecret: null, allowedEmails: [] }, pocketid: { enabled: false, clientId: null, clientSecret: null, plainDomain: null, allowedEmails: [] }, yandex: { enabled: false, clientId: null, clientSecret: null, allowedEmails: [] } } };
  else if (path === '/api/tokens') result = { tokens: [], docs: { enabled: false, scalarPath: null, swaggerPath: null } };
  else if (path === '/api/tokens/scopes') result = { wildcard: '*', resources: [] };
  else { unexpected.push(method + ' ' + path); return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Unhandled fixture' }) }); }
  await route.fulfill({ status: method === 'POST' ? 201 : 200, contentType: 'application/json', body: JSON.stringify({ response: result }) });
});
const page = await context.newPage(); page.setDefaultTimeout(15_000);
page.on('pageerror', error => pageErrors.push(error.stack || error.message));
const cdp = await context.newCDPSession(page);
let registrationId;
cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => { registrationId = registrations.find(item => !item.isDeleted && item.scopeURL === origin + '/')?.registrationId || registrationId; });
await cdp.send('ServiceWorker.enable');
async function capture(name) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForFunction(() => {
    let element = document.querySelector('main h2, main h3');
    while (element && element.tagName !== 'MAIN') { if (getComputedStyle(element).opacity < 0.999) return false; element = element.parentElement; }
    return true;
  });
  const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert(geometry.scrollWidth <= geometry.width + 2, `Horizontal overflow ${name}: ${JSON.stringify(geometry)}`);
  await page.screenshot({ path: join(output, name + '.png'), fullPage: true, animations: 'disabled' }); screenshots.push(name);
}
async function notifications() { return page.evaluate(async () => (await (await navigator.serviceWorker.getRegistration('/')).getNotifications()).map(item => ({ tag: item.tag, title: item.title }))); }
async function workerSetting(key, value) {
  await page.waitForFunction(async ({ key, value }) => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('remnadrop-notifications-v1', 1); request.onsuccess = () => resolve(request.result); request.onerror = reject; });
    const current = await new Promise(resolve => { const request = db.transaction('settings').objectStore('settings').get('current'); request.onsuccess = () => resolve(request.result); }); db.close();
    return current?.[key] === value;
  }, { key, value });
}
async function postWorker(message) {
  await page.evaluate(async message => {
    const registration = await navigator.serviceWorker.getRegistration('/');
    await new Promise(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = resolve; registration.active.postMessage(message, [channel.port2]); });
  }, message);
}

try {
  await page.goto(origin + '/dashboard/management/ssl-certificates');
  await page.getByRole('heading', { name: 'Публичная подписка', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__permissionRequests), 0, 'Never request notification permission on mount');
  await page.getByTestId('header-events').click();
  await page.getByRole('heading', { name: 'События', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="header-events"]')?.getAttribute('aria-label') === 'События: 1 новых');
  assert(calls.filter(call => call.path === '/api/panel-events/read').every(call => call.body.throughSequence === '55'), 'Header must acknowledge its captured watermark, preserving concurrent arrivals');
  await page.getByRole('button', { name: 'Показать ещё', exact: true }).click();
  await page.locator('[data-event-id="event-1"]').waitFor();
  await page.getByRole('combobox', { name: 'Тип события', exact: true }).click();
  await page.getByRole('option', { name: 'Перегрузка ЦП', exact: true }).click();
  await page.locator('[data-event-id="event-55"]').waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-event-id="event-54"]'));
  await capture('panel-events-desktop');
  await page.reload();
  await page.locator('[data-event-id="event-1"]').count();
  await page.getByRole('heading', { name: 'События', exact: true }).waitFor();
  assert(events.length === 56, 'Marking read preserves event history');

  await page.goto(origin + '/dashboard/management/ssl-certificates');
  await page.getByRole('heading', { name: 'Публичная подписка', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Добавить сертификат', exact: true }).click();
  const dialog = page.getByRole('dialog');
  assert.equal(await dialog.getByLabel('Напомнить за сколько дней', { exact: true }).inputValue(), '3, 2, 1');
  await dialog.getByLabel('Название', { exact: true }).fill('Новый сертификат');
  await dialog.getByRole('combobox', { name: 'Ноды', exact: true }).click();
  await page.getByRole('option', { name: 'Тестовая нода', exact: true }).click();
  await dialog.getByLabel('Домены сертификата', { exact: true }).fill('edge.example.com\n*.example.net');
  await dialog.getByLabel('Дата и время истечения', { exact: true }).fill('2027-12-31T23:59');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.getByRole('heading', { name: 'Новый сертификат', exact: true }).waitFor();
  const created = calls.find(call => call.path === '/api/ssl-certificates' && call.method === 'POST');
  assert.deepEqual(created.body.reminderDays, [3, 2, 1]); assert.deepEqual(created.body.nodeUuids, [nodeUuid]); assert.deepEqual(created.body.domains, ['edge.example.com', '*.example.net']);
  await capture('ssl-certificates-desktop');
  await page.locator('[data-certificate-id="10000000-0000-4000-8000-000000000004"]').getByRole('button', { name: 'Изменить' }).click();
  await dialog.getByLabel('Напомнить за сколько дней', { exact: true }).fill('7, 3, 1');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(certificates.at(-1).reminderDays, [7, 3, 1]);

  await page.goto(origin + '/dashboard/management/settings#notifications');
  await page.getByRole('heading', { name: 'Уведомления', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__permissionRequests), 0);
  await context.grantPermissions(['notifications'], { origin });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('switch', { name: 'Уведомлять, пока панель открыта', exact: true }).check();
  await page.getByText('Уведомления для открытой панели включены.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__permissionRequests), 1);
  await page.getByRole('button', { name: 'Очистить типы', exact: true }).click();
  await page.getByRole('combobox', { name: 'О каких событиях уведомлять', exact: true }).click();
  await page.getByRole('option', { name: 'Скоро истечёт SSL', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Сохранить типы', exact: true }).click();
  await page.getByText('Типы событий сохранены.', { exact: true }).waitFor();
  assert.deepEqual(preferences.eventTypes, ['ssl.expiring']);
  await page.getByRole('switch', { name: 'Получать события в фоне', exact: true }).check();
  await page.getByText('Push подключён на этом устройстве.', { exact: true }).waitFor();
  assert(calls.some(call => call.path === '/api/panel-events/push/subscriptions' && call.method === 'POST' && call.body.keys.p256dh));
  assert(registrationId, 'Production worker must be registered');
  const push = { id: 'push-ui-test', type: 'ssl.expiring', adminUuid, title: 'Проверка фонового push', message: 'Сертификат скоро истечёт.' };
  await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data: JSON.stringify(push) });
  await page.waitForFunction(async () => (await (await navigator.serviceWorker.getRegistration('/')).getNotifications()).some(item => item.tag.endsWith(':push-ui-test')));
  await page.evaluate(payload => navigator.serviceWorker.controller.postMessage({ type: 'show-event', epoch: JSON.parse(localStorage.getItem('remnadrop-notification-session')).epoch, event: payload }), push);
  await page.evaluate(payload => navigator.serviceWorker.controller.postMessage({ type: 'show-event', epoch: JSON.parse(localStorage.getItem('remnadrop-notification-session')).epoch, event: payload }), { ...push, id: 'browser-filtered', type: 'node.cpu_high' });
  await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data: JSON.stringify({ ...push, id: 'push-updated-server-filter', type: 'node.cpu_high' }) });
  await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data: JSON.stringify({ ...push, id: 'push-wrong-admin', adminUuid: 'another-admin' }) });
  await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data: JSON.stringify({ ...push, id: 'push-sentinel' }) });
  await page.waitForFunction(async () => (await (await navigator.serviceWorker.getRegistration('/')).getNotifications()).some(item => item.tag.endsWith(':push-sentinel')));
  const shown = await notifications();
  assert.equal(shown.filter(item => item.tag.endsWith(':push-ui-test')).length, 1, 'Foreground and push deliveries must deduplicate');
  assert(!shown.some(item => /browser-filtered|push-wrong-admin/.test(item.tag)), 'Worker respects browser event filters and account isolation');
  assert(shown.some(item => item.tag.endsWith(':push-updated-server-filter')), 'Background push uses current server filters instead of a stale device copy');
  const permissionRequests = await page.evaluate(() => window.__permissionRequests);
  await context.clearPermissions(); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await workerSetting('browserEnabled', false);
  await context.grantPermissions(['notifications'], { origin }); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await workerSetting('browserEnabled', true);
  assert.equal(await page.evaluate(() => window.__permissionRequests), permissionRequests, 'Permission restoration resumes without prompting or changing saved preferences');
  await capture('notification-settings-desktop');

  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path, title, name] of [
    ['/dashboard/events', 'События', 'panel-events-mobile'],
    ['/dashboard/management/ssl-certificates', 'SSL-сертификаты', 'ssl-certificates-mobile'],
    ['/dashboard/management/settings#notifications', 'Уведомления', 'notification-settings-mobile']
  ]) { await page.goto(origin + path); await page.getByRole('heading', { name: title, exact: true }).waitFor(); await capture(name); }

  const oldEpoch = await page.evaluate(() => JSON.parse(localStorage.getItem('remnadrop-notification-session')).epoch);
  const oldPreferences = { ...preferences };
  await page.getByRole('button', { name: 'Выйти из аккаунта', exact: true }).click();
  await page.waitForURL('**/auth/login');
  assert.equal(await page.evaluate(() => localStorage.getItem('remnadrop-push-owner')), null);
  assert(calls.some(call => call.path === '/api/panel-events/push/subscriptions' && call.method === 'DELETE'), 'Logout removes the registered browser endpoint');
  // Simulate an old tab's already-posted settings message arriving after logout.
  await postWorker({ type: 'settings', epoch: oldEpoch, preferences: oldPreferences });
  await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data: JSON.stringify({ ...push, id: 'after-logout' }) });
  assert.equal((await notifications()).length, 0, 'Logout closes notifications and disables worker delivery');
  for (let account = 1; account <= 2; account += 1) {
    const beforeLogin = calls.length;
    await page.evaluate(() => sessionStorage.setItem('returnTo', '/dashboard/management/settings#notifications'));
    await page.locator('input[name="username"]').fill(`test-admin-${account}`);
    await page.locator('input[name="password"]').fill('synthetic-password-for-ui-test');
    await page.locator('form button[type="submit"]').click();
    await page.getByRole('heading', { name: 'Уведомления', exact: true }).waitFor();
    await workerSetting('adminUuid', preferences.adminUuid);
    assert(calls.slice(beforeLogin).some(call => call.path === '/api/panel-events/preferences' && call.method === 'GET'), 'New account must fetch its own preferences');
    assert.equal(await page.getByRole('switch', { name: 'Уведомлять, пока панель открыта', exact: true }).isChecked(), false);
    if (account === 1) {
      forcePreferences401 = true;
      await page.getByRole('button', { name: 'Очистить типы', exact: true }).click();
      await page.getByRole('button', { name: 'Сохранить типы', exact: true }).click();
      await page.waitForURL('**/auth/login');
    }
  }
  assert.deepEqual(unexpected, [], 'Unexpected requests'); assert.deepEqual(pageErrors, [], 'Uncaught browser errors');
  await writeFile(join(output, 'panel-events-report.json'), JSON.stringify({ status: 'passed', syntheticApi: true, syntheticPushTransport: true, productionServiceWorker: true, screenshots, checks: ['captured read watermark', 'persistent history and pagination', 'event filters', 'certificate create/edit', 'permission only on gesture and restoration', 'notification type preferences', 'push subscription', 'background push handler with current server filters', 'push/browser deduplication', 'account isolation after automatic logout', 'late cross-tab message rejected after logout', 'desktop/mobile overflow'], calls: calls.map(({ path, method }) => ({ path, method })) }, null, 2));
  console.log('PASS production Events, SSL, notification settings and service-worker push workflows');
} catch (error) {
  await page.screenshot({ path: join(output, 'panel-events-failure.png'), fullPage: true }).catch(() => {});
  await writeFile(join(output, 'panel-events-failure.json'), JSON.stringify({ message: error.stack, unexpected, pageErrors, text: await page.locator('body').innerText().catch(() => '') }, null, 2));
  throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
