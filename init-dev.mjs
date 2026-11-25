import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const secret = () => randomBytes(32).toString('hex');
const root = new URL('./', import.meta.url);
for (const name of ['.env', 'backend/.env.dev']) {
    if (existsSync(new URL(name, root))) throw new Error(`Refusing to overwrite ${name}`);
}
writeFileSync(new URL('.env', root), `DEV_DB_PASSWORD=${secret()}\n`, { flag: 'wx', mode: 0o600 });
writeFileSync(new URL('backend/.env.dev', root), [
    `APP_SECRET=${secret()}`, `JWT_AUTH_SECRET=${secret()}`, `JWT_API_TOKENS_SECRET=${secret()}`,
    `NODE_METRICS_SECRET=${secret()}`,
    'METRICS_USER=local', `METRICS_PASS=${secret()}`, 'FRONT_END_DOMAIN=http://localhost:3000',
    'PANEL_DOMAIN=localhost', 'SUB_PUBLIC_DOMAIN=localhost:3000/api/sub',
    'IS_TELEGRAM_NOTIFICATIONS_ENABLED=false', 'WEBHOOK_ENABLED=false',
    '__RW_METADATA_VERSION=2.8.1-fork-dev',
].join('\n') + '\n', { flag: 'wx', mode: 0o600 });
console.log('Created local development secrets. No values printed. Not for production migration.');
