import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

// Production Monaco, visual forms and WASM assets; only the panel API is mocked.
const root = resolve(process.env.REMNADROP_UI_DIST || 'artifacts/frontend');
const output = resolve(process.env.REMNADROP_UI_OUTPUT || 'artifacts/ui-config-certificates');
assert(process.env.REMNADROP_PLAYWRIGHT_MODULE, 'Set REMNADROP_PLAYWRIGHT_MODULE to the Playwright module');
await mkdir(output, { recursive: true });
const { chromium } = await import(pathToFileURL(process.env.REMNADROP_PLAYWRIGHT_MODULE).href);
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
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
const profileId = '10000000-0000-4000-8000-000000000001';
const nodeId = '10000000-0000-4000-8000-000000000003';
const config = {
  inbounds: [{ tag: 'TLS fixture', listen: '0.0.0.0', port: 443, protocol: 'vless',
    settings: { clients: [], decryption: 'none' },
    streamSettings: { network: 'raw', security: 'tls', tlsSettings: {
      serverName: 'api.example.com', certificates: [{ certificateFile: '/certs/api.example.com/fullchain.pem', keyFile: '/certs/api.example.com/privkey.pem' }],
    } },
    fixtureExtension: { preserve: ['original', { nested: true }] },
  }],
  outbounds: [{ tag: 'direct', protocol: 'freedom', settings: {} }],
  log: { loglevel: 'warning' },
};
const profile = { uuid: profileId, viewPosition: 0, name: 'SSL hover fixture', config, inbounds: [],
  nodes: [{ uuid: nodeId, name: 'Fixture node', countryCode: 'NL' }], createdAt: now, updatedAt: now };
const certificates = [{ id: '10000000-0000-4000-8000-000000000009', name: 'Synthetic API certificate', domains: ['api.example.com'],
  nodeUuids: [nodeId], nodes: [{ uuid: nodeId, name: 'Fixture node' }], expiresAt: '2030-12-15T09:30:00.000Z',
  reminderDays: [3, 2, 1], enabled: true, daysRemaining: 30, status: 'valid', createdAt: now, updatedAt: now }];
const calls = [], unexpected = [], pageErrors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'ru-RU', timezoneId: 'UTC', colorScheme: 'dark' });
await context.addInitScript(() => {
  localStorage.setItem('sessionStore', JSON.stringify({ state: { token: 'synthetic-ui-token' }, version: 0 }));
  localStorage.setItem('updatesStore', JSON.stringify({ state: { lastUpdateTimestamp: Date.now(), remnawaveInfo: { latestVersion: '2.8.1', starsCount: 1 } }, version: 1 }));
  localStorage.setItem('i18nextLng', 'ru');
  localStorage.setItem('mantine-color-scheme-value', 'dark');
});
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (url.origin !== origin) { unexpected.push('External request: ' + url.origin + url.pathname); return route.abort(); }
  if (!url.pathname.startsWith('/api/')) return route.continue();
  const pathname = url.pathname.replace(/\/$/, ''), method = request.method(), body = request.postDataJSON();
  calls.push({ pathname, method, body });
  let result;
  if (pathname === '/api/auth/status') result = { isLoginAllowed: true, isRegisterAllowed: false, authentication: null, branding: { title: 'RemnaDrop', logoUrl: null } };
  else if (pathname === '/api/panel-events/summary') result = { unreadCount: 0, latestSequence: '0' };
  else if (pathname === '/api/panel-events/preferences') result = { browserEnabled: false, pushEnabled: false, eventTypes: [] };
  else if (pathname === '/api/system/stats/recap') result = { thisMonth: { users: 1, traffic: '0' }, total: { users: 1, nodes: 1, traffic: '0', nodesRam: '4294967296', nodesCpuCores: 2, distinctCountries: 1 }, version: '2.8.1', initDate: now };
  else if (pathname === '/api/system/metadata') result = { version: '2.8.1', build: { time: now, number: 'ui-qa' }, git: { backend: { commitSha: 'ui-fixture', branch: 'qa', commitUrl: '' }, frontend: { commitSha: 'ui-fixture', commitUrl: '' } } };
  else if (pathname === `/api/config-profiles/${profileId}`) result = profile;
  else if (pathname === '/api/config-profiles' && method === 'PATCH') { profile.config = body.config; result = profile; }
  else if (pathname === '/api/config-profiles') result = { total: 1, configProfiles: [profile] };
  else if (pathname === '/api/snippets') result = { total: 0, snippets: [] };
  else if (pathname === '/api/ssl-certificates') result = { items: certificates };
  else { unexpected.push(method + ' ' + pathname); return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Unhandled certificate UI fixture endpoint' }) }); }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ response: result }) });
});
const page = await context.newPage();
page.on('pageerror', error => pageErrors.push(error.stack || error.message));
page.setDefaultTimeout(20000);
const jsonValue = value => page.locator('.monaco-editor .view-lines').getByText('"' + value + '"', { exact: true }).first();
const calendarHover = page.getByText(/Срок SSL из календаря/).filter({ visible: true });
async function dismissHover() {
  await page.mouse.move(0, 0);
  await page.keyboard.press('Escape');
  await calendarHover.waitFor({ state: 'hidden' });
}
async function capture(name) {
  await page.screenshot({ path: join(output, name + '.png'), animations: 'disabled' });
}
try {
  await page.goto(origin + '/dashboard/management/config-profiles/' + profileId);
  await page.getByRole('button', { name: 'Визуальный редактор', exact: true }).waitFor({ state: 'visible' });
  await jsonValue('api.example.com').waitFor({ state: 'visible' });
  await jsonValue('api.example.com').hover();
  await calendarHover.waitFor({ state: 'visible' });
  assert.match(await page.locator('.monaco-hover').filter({ visible: true }).first().innerText(), /15\.12\.2030/);
  assert.match(await page.locator('.monaco-hover').filter({ visible: true }).first().innerText(), /Fixture node/);
  await capture('certificate-json-hover');
  await dismissHover();

  // Make a JSON change through the editor before switching to the visual form.
  const jsonChanged = structuredClone(config);
  jsonChanged.log.loglevel = 'error';
  const textarea = page.locator('.monaco-editor textarea').first();
  await textarea.focus();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(JSON.stringify(jsonChanged, null, 2));
  await page.getByRole('button', { name: 'Визуальный редактор', exact: true }).click();
  const sni = page.getByRole('textbox', { name: 'SNI / ServerName', exact: true });
  assert.equal(await sni.inputValue(), 'api.example.com');
  await sni.hover();
  await calendarHover.waitFor({ state: 'visible' });
  assert.match(await page.getByRole('tooltip').innerText(), /15\.12\.2030/);
  await capture('certificate-visual-hover');
  await dismissHover();
  await page.getByRole('textbox', { name: 'Путь к сертификату TLS', exact: true }).hover();
  await calendarHover.waitFor({ state: 'visible' });
  await dismissHover();

  // Losing a calendar match must not remount the input or interrupt typing.
  await sni.fill('unregistered.example.com');
  assert(await sni.evaluate(element => element === document.activeElement), 'Typing must retain input focus as the tooltip disappears');
  assert.equal(await sni.inputValue(), 'unregistered.example.com');
  await sni.hover();
  await page.waitForTimeout(400);
  assert.equal(await calendarHover.count(), 0, 'No expiry tooltip without a calendar date');
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  await jsonValue('unregistered.example.com').hover();
  await page.waitForTimeout(500);
  assert.equal(await calendarHover.count(), 0, 'JSON hover must not invent a missing date');
  await capture('certificate-json-unregistered');

  await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname.replace(/\/$/, '') === '/api/config-profiles' && response.request().method() === 'PATCH' && response.ok()),
    page.getByRole('button', { name: 'Сохранить', exact: true }).click(),
  ]);
  const saved = calls.find(call => call.pathname === '/api/config-profiles' && call.method === 'PATCH').body;
  const expected = structuredClone(jsonChanged);
  expected.inbounds[0].streamSettings.tlsSettings.serverName = 'unregistered.example.com';
  assert.equal(saved.uuid, profileId);
  assert.deepEqual(saved.config, expected, 'JSON and visual edits must preserve every other config field');
  assert.deepEqual(unexpected, [], 'Unexpected API or external requests');
  assert.deepEqual(pageErrors, [], 'Uncaught frontend errors');
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'passed', syntheticApi: true, checks: ['JSON hover', 'visual SNI and certificate path hover', 'missing date omitted', 'input focus retained', 'JSON and visual edits preserved'], calls: calls.map(({ pathname, method }) => ({ pathname, method })), pageErrors, unexpected }, null, 2));
  console.log('PASS config certificates: JSON and visual expiry hover, absent dates omitted and config round-trip preserved');
} catch (error) {
  await capture('failure').catch(() => {});
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'failed', message: error.stack, pageErrors, unexpected, text: await page.locator('body').innerText().catch(() => '') }, null, 2));
  throw error;
} finally {
  await browser.close();
  await new Promise(accept => server.close(accept));
}
