#!/usr/bin/env node
// Restore the editor assets recorded in the repository lock before Vite bundles them.
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const SOURCE = 'https://validator.remna.dev/';
const FILES = ['wasm_exec.js', 'main.wasm', 'xray.schema.json', 'xray.schema.cn.json'];
const ATTEMPTS = 3;
const TIMEOUT_MS = 120_000;

export function validateLock(lock) {
    if (!lock || typeof lock.source !== 'string' || new URL(lock.source).href !== SOURCE) {
        throw new Error('Editor asset source must be https://validator.remna.dev/');
    }
    if (!lock.files || Object.keys(lock.files).length !== FILES.length
        || Object.keys(lock.files).some((name) => !FILES.includes(name))) {
        throw new Error('Editor asset lock must contain exactly the four expected filenames');
    }
    for (const name of FILES) {
        const entry = lock.files[name];
        if (!entry || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0
            || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
            throw new Error(`Invalid locked size or SHA-256 for ${name}`);
        }
    }
    return lock;
}

function isTransient(error) {
    return error.retryable === true || ['TimeoutError', 'AbortError'].includes(error.name)
        || ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED',
            'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'].includes(error.code ?? error.cause?.code);
}

export async function fetchEditorAssets(lockPath, destination, { fetchImpl = fetch, retryDelayMs = 1000 } = {}) {
    const lock = validateLock(JSON.parse(await readFile(lockPath, 'utf8')));
    await mkdir(destination, { recursive: true });
    for (const name of FILES) {
        const expected = lock.files[name];
        for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
            const temporary = join(destination, `.${name}.${randomUUID()}.tmp`);
            try {
                const signal = AbortSignal.timeout(TIMEOUT_MS);
                const response = await fetchImpl(new URL(name, SOURCE), { signal, redirect: 'manual' });
                if (!response.ok) {
                    await response.body?.cancel();
                    const error = new Error(`Downloading ${name} failed: HTTP ${response.status}`);
                    error.retryable = [408, 425, 429].includes(response.status) || response.status >= 500;
                    throw error;
                }
                if (!response.body) throw new Error(`Empty download response for ${name}`);
                let bytes = 0;
                const hash = createHash('sha256');
                const verify = new Transform({
                    transform(chunk, _encoding, callback) {
                        bytes += chunk.length;
                        if (bytes > expected.bytes) {
                            callback(new Error(`Downloaded size exceeds lock for ${name}`));
                            return;
                        }
                        hash.update(chunk);
                        callback(null, chunk);
                    },
                });
                await pipeline(Readable.fromWeb(response.body), verify,
                    createWriteStream(temporary, { flags: 'wx', mode: 0o644 }), { signal });
                if (bytes !== expected.bytes || hash.digest('hex') !== expected.sha256) {
                    throw new Error(`Downloaded size or SHA-256 does not match lock for ${name}`);
                }
                await rename(temporary, join(destination, name));
                break;
            } catch (error) {
                if (attempt === ATTEMPTS || !isTransient(error)) throw error;
                await delay(retryDelayMs * attempt);
            } finally {
                await rm(temporary, { force: true });
            }
        }
    }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    fetchEditorAssets(new URL('../editor-assets.lock.json', import.meta.url),
        resolve(process.argv[2] || 'frontend/public/assets'))
        .then(() => console.log('Editor assets verified against editor-assets.lock.json'))
        .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
