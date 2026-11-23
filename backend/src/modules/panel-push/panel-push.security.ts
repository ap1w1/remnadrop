import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createECDH, createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';

export interface BrowserPushSubscription {
    endpoint: string;
    expirationTime: number | null;
    keys: { p256dh: string; auth: string };
}

export interface EncryptedPushSecret {
    iv: Uint8Array;
    tag: Uint8Array;
    ciphertext: Uint8Array;
}

/** Restrict outbound requests to browser push providers, never arbitrary URLs. */
export function pushEndpoint(value: unknown): string {
    if (typeof value !== 'string' || value.length > 4096) {
        throw new BadRequestException('Некорректный адрес push-подписки');
    }
    let url: URL;
    try { url = new URL(value); } catch {
        throw new BadRequestException('Некорректный адрес push-подписки');
    }
    const hostname = url.hostname.toLowerCase();
    const allowed = hostname === 'fcm.googleapis.com'
        || hostname === 'updates.push.services.mozilla.com'
        || hostname === 'web.push.apple.com'
        || hostname.endsWith('.push.apple.com')
        || hostname.endsWith('.notify.windows.com');
    if (!allowed || url.protocol !== 'https:' || (url.port && url.port !== '443')
        || url.username || url.password || url.hash || url.pathname === '/') {
        throw new BadRequestException('Этот адрес не относится к поддерживаемому сервису push-уведомлений браузера');
    }
    return url.toString();
}

export function validatePushSubscription(input: unknown): BrowserPushSubscription {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new BadRequestException('Некорректная push-подписка');
    }
    const body = input as Record<string, unknown>;
    const endpoint = pushEndpoint(body.endpoint);
    const keys = body.keys as Record<string, unknown> | null;
    if (!keys || typeof keys !== 'object') throw new BadRequestException('Отсутствуют ключи push-подписки');
    const decode = (value: unknown, length: number): Buffer => {
        if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(value) || value.length > 100) {
            throw new BadRequestException('Некорректные ключи push-подписки');
        }
        const bytes = Buffer.from(value, 'base64url');
        if (bytes.length !== length) throw new BadRequestException('Некорректные ключи push-подписки');
        return bytes;
    };
    const publicKey = decode(keys.p256dh, 65);
    const auth = decode(keys.auth, 16);
    try {
        const verifier = createECDH('prime256v1');
        verifier.generateKeys();
        verifier.computeSecret(publicKey);
    } catch { throw new BadRequestException('Некорректный открытый ключ push-подписки'); }
    const expiry = body.expirationTime;
    if (expiry !== undefined && expiry !== null
        && (typeof expiry !== 'number' || !Number.isFinite(expiry) || expiry <= Date.now())) {
        throw new BadRequestException('Push-подписка истекла');
    }
    return { endpoint, expirationTime: typeof expiry === 'number' ? expiry : null,
        keys: { p256dh: publicKey.toString('base64url'), auth: auth.toString('base64url') } };
}

function encryptionKey(): Buffer {
    const secret = process.env.APP_SECRET ?? process.env.JWT_AUTH_SECRET;
    if (!secret || secret.length < 32 || secret === 'change_me') {
        throw new ServiceUnavailableException('Для push нужен постоянный APP_SECRET длиной от 32 символов');
    }
    return createHash('sha256').update('remnadrop-webpush-v1\0').update(secret).digest();
}

export function sealPushSecret(value: string, purpose: 'vapid' | 'subscription'): EncryptedPushSecret {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
    cipher.setAAD(Buffer.from(purpose));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return { iv, tag: cipher.getAuthTag(), ciphertext };
}

export function openPushSecret(value: EncryptedPushSecret, purpose: 'vapid' | 'subscription'): string {
    try {
        const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(value.iv));
        decipher.setAAD(Buffer.from(purpose));
        decipher.setAuthTag(Buffer.from(value.tag));
        return Buffer.concat([decipher.update(Buffer.from(value.ciphertext)), decipher.final()]).toString('utf8');
    } catch {
        throw new ServiceUnavailableException('Не удалось прочитать ключи push: проверьте постоянный APP_SECRET');
    }
}

/** A contact URI for VAPID, not a URL that the backend requests. */
export function pushSubject(referer?: string): string {
    const configured = process.env.WEB_PUSH_SUBJECT;
    if (configured && /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configured)) return configured;
    const candidates = configured ? [configured] : [process.env.FRONT_END_DOMAIN, referer];
    for (const candidate of candidates) {
        if (!candidate || candidate === '*') continue;
        try {
            const url = new URL(candidate.includes('://') ? candidate : 'https://' + candidate);
            if (url.protocol === 'https:' && !url.username && !url.password && !isIP(url.hostname)
                && url.hostname.includes('.') && !url.hostname.endsWith('.localhost')) return url.origin;
        } catch { /* Try the next known panel address. */ }
    }
    throw new ServiceUnavailableException('Укажите публичный HTTPS-адрес панели в FRONT_END_DOMAIN или контакт в WEB_PUSH_SUBJECT');
}

export function pushEndpointHash(endpoint: string): string {
    return createHash('sha256').update(endpoint).digest('hex');
}

export function pushRetry(error: unknown, attempt: number): { remove: boolean; retry: boolean; delay: number; code: string } {
    const status = Number((error as { statusCode?: unknown } | null)?.statusCode);
    const remove = status === 404 || status === 410;
    const transient = !Number.isFinite(status) || status === 408 || status === 429 || status >= 500;
    return { remove, retry: !remove && transient && attempt < 8,
        delay: Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1)),
        code: Number.isFinite(status) ? 'HTTP_' + status : 'PUSH_NETWORK_ERROR' };
}
