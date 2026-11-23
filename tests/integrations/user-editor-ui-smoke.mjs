import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

// Exercise the production editor, including its real form and responsive styles.
// All API data is synthetic; the browser cannot contact a panel or any provider.
const root = resolve(process.env.REMNADROP_UI_DIST || 'artifacts/frontend');
const output = resolve(process.env.REMNADROP_UI_OUTPUT || 'artifacts/ui-user-editor');
assert(process.env.REMNADROP_PLAYWRIGHT_MODULE, 'Set REMNADROP_PLAYWRIGHT_MODULE to the Playwright module');
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
const userId = '10000000-0000-4000-8000-000000000005';
const nodeId = '10000000-0000-4000-8000-000000000003';
const user = {
  uuid: userId, id: 42001, shortUuid: 'synthetic-user', username: 'layout-fixture', status: 'ACTIVE',
  trafficLimitBytes: 0, trafficLimitStrategy: 'NO_RESET', expireAt: '2099-11-26T20:09:00.000Z',
  telegramId: 100000001, email: 'layout@example.invalid', description: 'Synthetic layout fixture',
  tag: null, hwidDeviceLimit: 5, externalSquadUuid: null, activeInternalSquads: [],
  trojanPassword: 'synthetic-trojan-password', vlessUuid: userId, ssPassword: 'synthetic-ss-password',
  lastTriggeredThreshold: 0, subRevokedAt: null, lastTrafficResetAt: null,
  createdAt: now, updatedAt: now, subscriptionUrl: 'https://example.invalid/sub/synthetic-layout-fixture',
  userTraffic: { usedTrafficBytes: 12519829668, lifetimeUsedTrafficBytes: 12519829668, onlineAt: now, lastConnectedNodeUuid: nodeId, firstConnectedAt: now },
};
const node = {
  uuid: nodeId, name: 'Нидерланды · тестовая нода', countryCode: 'NL', address: '192.0.2.20', port: 2222,
  proxyUrl: null, backupProxyUrl: null, isConnected: true, isConnecting: false, isDisabled: false,
  lastStatusChange: now, lastStatusMessage: null, trafficResetDay: 1, consumptionMultiplier: 1,
  nodeConsumptionMultiplier: 1, isTrafficTrackingActive: false, trafficLimitBytes: 0, trafficUsedBytes: 0,
  notifyPercent: 90, note: null, viewPosition: 0, tags: [], createdAt: now, updatedAt: now,
  configProfile: { activeConfigProfileUuid: null, activeInbounds: [] }, providerUuid: null,
  provider: null, activePluginUuid: null, xrayUptime: 3600, usersOnline: 1, system: null, versions: null,
};
const calls = [], unexpected = [], pageErrors = [], scenarios = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'ru-RU', colorScheme: 'dark' });
await context.addInitScript(() => {
  localStorage.setItem('sessionStore', JSON.stringify({ state: { token: 'synthetic-ui-token' }, version: 0 }));
  localStorage.setItem('updatesStore', JSON.stringify({ state: { lastUpdateTimestamp: Date.now(), remnawaveInfo: { latestVersion: '2.8.1', starsCount: 1 } }, version: 1 }));
  localStorage.setItem('i18nextLng', 'ru');
  localStorage.setItem('mantine-color-scheme-value', 'dark');
});
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (url.origin !== origin) {
    unexpected.push('External request: ' + url.origin + url.pathname);
    return route.abort();
  }
  if (!url.pathname.startsWith('/api/')) return route.continue();
  const pathname = url.pathname.replace(/\/$/, ''), method = request.method(), body = request.postDataJSON();
  calls.push({ pathname, method, body });
  let result;
  if (pathname === '/api/auth/status') result = { isLoginAllowed: true, isRegisterAllowed: false, authentication: null, branding: { title: 'RemnaDrop', logoUrl: null } };
  else if (pathname === '/api/panel-events/summary') result = { unreadCount: 0, latestSequence: '0' };
  else if (pathname === '/api/panel-events/preferences') result = { browserEnabled: false, pushEnabled: false, eventTypes: [] };
  else if (pathname === '/api/panel-events') result = { items: [], unreadCount: 0, latestSequence: '0', nextCursor: null };
  else if (pathname === '/api/system/stats/recap') result = { thisMonth: { users: 1, traffic: '12519829668' }, total: { users: 1, nodes: 1, traffic: '12519829668', nodesRam: '4294967296', nodesCpuCores: 2, distinctCountries: 1 }, version: '2.8.1', initDate: '2026-01-01T00:00:00.000Z' };
  else if (pathname === '/api/system/metadata') result = { version: '2.8.1', build: { time: now, number: 'ui-qa' }, git: { backend: { commitSha: 'ui-fixture', branch: 'qa', commitUrl: '' }, frontend: { commitSha: 'ui-fixture', commitUrl: '' } } };
  else if (pathname === '/api/nodes') result = [node];
  else if (pathname === '/api/internal-squads') result = { total: 0, internalSquads: [] };
  else if (pathname === '/api/external-squads') result = { total: 0, externalSquads: [] };
  else if (pathname === '/api/users/tags') result = { tags: [] };
  else if (pathname === '/api/users' && method === 'GET') result = { total: 1, users: [user] };
  else if (pathname === '/api/users' && method === 'PATCH') { Object.assign(user, body, { updatedAt: new Date().toISOString() }); result = user; }
  else if (pathname === `/api/users/${userId}`) result = user;
  else if (pathname === `/api/metadata/user/${userId}`) result = { metadata: {} };
  else if (pathname === `/api/users/${userId}/node-quotas`) result = [{ node_uuid: nodeId, limit_bytes: '53687091200', used_bytes: '1073741824', blocked: false, period_days: 30, threshold_percent: 90 }];
  else if (pathname === `/api/users/${userId}/node-quotas/settings`) result = { mode: 'legacy', periodDays: 30, resetAt: null, thresholdPercent: 90 };
  else if (pathname === `/api/users/${userId}/node-quotas/status`) result = { pendingSync: false };
  else {
    unexpected.push(method + ' ' + pathname);
    return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Unhandled editor UI fixture endpoint' }) });
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ response: result }) });
});
const page = await context.newPage();
page.on('pageerror', error => pageErrors.push(error.stack || error.message));
page.setDefaultTimeout(12000);
const dialog = page.getByRole('dialog', { name: 'Редактирование', exact: true });
const cardNames = {
  identification: String(user.id),
  contact: 'Контактная информация',
  devices: 'Устройства & Теги',
  traffic: 'Трафик и лимиты',
  access: 'Настройки доступа',
  quotas: 'Лимиты по нодам',
};
function card(name) {
  const label = name === 'quotas'
    ? page.getByText(cardNames[name], { exact: true })
    : page.getByRole('heading', { name: cardNames[name], exact: true });
  return dialog.locator('.mantine-Card-root').filter({ has: label });
}
async function openEditor() {
  await page.goto(origin + '/dashboard/management/users?user=' + userId);
  await dialog.waitFor({ state: 'visible' });
  for (const name of Object.keys(cardNames)) await card(name).waitFor({ state: 'visible' });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForFunction(() => Array.from(document.querySelectorAll('[role="dialog"] .mantine-Card-root')).every(element => {
    const style = getComputedStyle(element.parentElement);
    return Number(style.opacity) > 0.999 && (style.transform === 'none' || Math.abs(new DOMMatrix(style.transform).m42) < 0.1);
  }));
}
async function geometry() {
  return Object.fromEntries(await Promise.all(Object.keys(cardNames).map(async name => [name, await card(name).boundingBox()])));
}
function closeTo(actual, expected, message) {
  assert(Math.abs(actual - expected) <= 2, `${message}: ${actual} vs ${expected}`);
}
async function checkOverflowAndFooter() {
  const widths = await dialog.evaluate(element => ({ content: element.scrollWidth, box: element.clientWidth, page: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert(widths.content <= widths.box + 1, `Editor overflows horizontally: ${JSON.stringify(widths)}`);
  assert(widths.page <= widths.viewport + 1, `Page overflows horizontally: ${JSON.stringify(widths)}`);
  const footer = await dialog.getByRole('button', { name: 'Сохранить', exact: true }).boundingBox();
  assert(footer && footer.y >= 0 && footer.y + footer.height <= page.viewportSize().height + 1, 'Sticky save button must remain in the viewport');
}
async function capture(name) {
  await page.screenshot({ path: join(output, name + '.png'), animations: 'disabled' });
  await writeFile(join(output, name + '.json'), JSON.stringify({ viewport: page.viewportSize(), cards: await geometry(), text: await dialog.innerText() }, null, 2));
}
async function checkDesktop(name) {
  await openEditor();
  const boxes = await geometry();
  const { identification, contact, devices, traffic, access, quotas } = boxes;
  assert(traffic.x >= identification.x + identification.width + 8, 'Traffic tile must be in a separate right-hand column');
  closeTo(traffic.y, identification.y, 'Top tiles align');
  closeTo(traffic.width, identification.width, 'Desktop columns have equal widths');
  closeTo(contact.x, identification.x, 'Contact tile stays in the left column');
  closeTo(devices.x, identification.x, 'Device tile stays in the left column');
  closeTo(access.x, traffic.x, 'Access tile stays in the right column');
  assert(contact.y >= identification.y + identification.height + 8, 'Contact tile follows identification');
  assert(devices.y >= contact.y + contact.height + 8, 'Device tile follows contact');
  assert(access.y >= traffic.y + traffic.height + 8, 'Access tile follows traffic');
  closeTo(quotas.x, identification.x, 'Node quotas align with the left edge');
  closeTo(quotas.width, traffic.x + traffic.width - identification.x, 'Node quotas span both columns');
  assert(quotas.y >= Math.max(devices.y + devices.height, access.y + access.height) + 8, 'Node quotas follow both card columns');
  await checkOverflowAndFooter();
  await capture(name);
  scenarios.push({ name, status: 'passed' });
}
try {
  await checkDesktop('user-editor-desktop');
  const email = 'updated-layout@example.invalid';
  await dialog.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
  await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname.replace(/\/$/, '') === '/api/users' && response.request().method() === 'PATCH' && response.ok()),
    dialog.getByRole('button', { name: 'Сохранить', exact: true }).click(),
  ]);
  const update = calls.find(call => call.pathname === '/api/users' && call.method === 'PATCH');
  assert.equal(update.body.uuid, userId);
  assert.equal(update.body.email, email);
  assert.equal(update.body.telegramId, 100000001);
  assert.equal(update.body.hwidDeviceLimit, 5);
  assert(!Object.hasOwn(update.body, 'trafficLimitBytes'), 'Saving contact details must not overwrite untouched traffic settings');
  assert(!Object.hasOwn(update.body, 'activeInternalSquads'), 'Saving contact details must not overwrite untouched access settings');
  await card('quotas').scrollIntoViewIfNeeded();
  await card('quotas').getByText(node.name, { exact: false }).first().waitFor({ state: 'visible' });
  await checkOverflowAndFooter();
  await capture('user-editor-node-quotas');
  scenarios.push({ name: 'save-contact-preserves-user-settings-and-node-quotas', status: 'passed' });

  await page.setViewportSize({ width: 1025, height: 900 });
  await checkDesktop('user-editor-desktop-breakpoint');

  await page.setViewportSize({ width: 390, height: 844 });
  await openEditor();
  const mobile = await geometry();
  const order = ['identification', 'quotas', 'traffic', 'access', 'contact', 'devices'];
  for (const [index, name] of order.entries()) {
    closeTo(mobile[name].x, mobile.identification.x, `${name} aligns in the mobile column`);
    closeTo(mobile[name].width, mobile.identification.width, `${name} fills the mobile column`);
    if (index) {
      const previous = mobile[order[index - 1]];
      assert(mobile[name].y >= previous.y + previous.height + 8, `${name} follows the previous mobile tile without overlap`);
    }
  }
  await checkOverflowAndFooter();
  await capture('user-editor-mobile');
  await card('quotas').scrollIntoViewIfNeeded();
  await checkOverflowAndFooter();
  scenarios.push({ name: 'user-editor-mobile', status: 'passed' });
  assert.deepEqual(unexpected, [], 'Unexpected API or external requests');
  assert.deepEqual(pageErrors, [], 'Uncaught frontend errors');
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'passed', scenarios, syntheticApi: true, calls: calls.map(({ pathname, method }) => ({ pathname, method })), pageErrors, unexpected }, null, 2));
  console.log('PASS production user editor: two desktop columns, full-width node quotas, mobile stacking, sticky save and unchanged update semantics');
} catch (error) {
  await page.screenshot({ path: join(output, 'failure.png'), animations: 'disabled' }).catch(() => {});
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'failed', message: error.stack, scenarios, pageErrors, unexpected, text: await page.locator('body').innerText().catch(() => '') }, null, 2));
  throw error;
} finally {
  await browser.close();
  await new Promise(accept => server.close(accept));
}
