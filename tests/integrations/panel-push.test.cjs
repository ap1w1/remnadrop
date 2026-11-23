'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createECDH, randomBytes } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { createSourceLoader, appRequire } = require('./source-loader.cjs');
const security = createSourceLoader()('src/modules/panel-push/panel-push.security.ts');

function subscription() {
    const recipient = createECDH('prime256v1');
    recipient.generateKeys();
    return { endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic-device', expirationTime: null,
        keys: { p256dh: recipient.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
}

test('Web Push accepts browser keys and refuses arbitrary/internal endpoints and malformed keys', () => {
    const input = subscription();
    assert.deepEqual(security.validatePushSubscription(input), input);
    for (const endpoint of [
        'http://fcm.googleapis.com/fcm/send/x', 'https://127.0.0.1/private',
        'https://169.254.169.254/latest/meta-data', 'https://fcm.googleapis.com.attacker.example/send',
        'https://fcm.googleapis.com:9443/send', 'https://user:pass@fcm.googleapis.com/send',
        'https://fcm.googleapis.com/send#secret', 'https://example.com/push',
    ]) assert.throws(() => security.validatePushSubscription({ ...input, endpoint }));
    assert.throws(() => security.validatePushSubscription({ ...input, keys: { ...input.keys, auth: 'short' } }));
    assert.throws(() => security.validatePushSubscription({ ...input, keys: { ...input.keys, p256dh: Buffer.alloc(65).toString('base64url') } }));
    assert.throws(() => security.validatePushSubscription({ ...input, expirationTime: Date.now() - 1 }));
    for (const endpoint of ['https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/Q/x', 'https://test.notify.windows.com/x']) {
        assert.equal(security.validatePushSubscription({ ...input, endpoint }).endpoint, endpoint);
    }
});

test('Stored subscriptions are authenticated, encrypted, and bound to their purpose and application secret', () => {
    const previous = process.env.APP_SECRET;
    process.env.APP_SECRET = 'synthetic-push-encryption-test-'.repeat(3);
    try {
        const clear = JSON.stringify(subscription());
        const sealed = security.sealPushSecret(clear, 'subscription');
        assert.equal(security.openPushSecret(sealed, 'subscription'), clear);
        assert(!Buffer.from(sealed.ciphertext).includes(Buffer.from('synthetic-device')));
        assert.throws(() => security.openPushSecret(sealed, 'vapid'));
        const changed = { ...sealed, ciphertext: Buffer.from(sealed.ciphertext) };
        changed.ciphertext[0] ^= 1;
        assert.throws(() => security.openPushSecret(changed, 'subscription'));
        process.env.APP_SECRET = 'different-synthetic-encryption-key'.repeat(3);
        assert.throws(() => security.openPushSecret(sealed, 'subscription'));
    } finally { if (previous === undefined) delete process.env.APP_SECRET; else process.env.APP_SECRET = previous; }
});

test('VAPID contact uses the panel origin and rejects localhost or an invalid explicit contact', () => {
    const domain = process.env.FRONT_END_DOMAIN, contact = process.env.WEB_PUSH_SUBJECT;
    delete process.env.WEB_PUSH_SUBJECT;
    try {
        process.env.FRONT_END_DOMAIN = '*';
        assert.equal(security.pushSubject('https://panel.example.com/dashboard/settings'), 'https://panel.example.com');
        assert.throws(() => security.pushSubject('http://localhost:3000'));
        process.env.WEB_PUSH_SUBJECT = 'mailto:admin@example.com';
        assert.equal(security.pushSubject(), 'mailto:admin@example.com');
        process.env.WEB_PUSH_SUBJECT = 'http://localhost';
        assert.throws(() => security.pushSubject('https://panel.example.com'));
    } finally {
        if (domain === undefined) delete process.env.FRONT_END_DOMAIN; else process.env.FRONT_END_DOMAIN = domain;
        if (contact === undefined) delete process.env.WEB_PUSH_SUBJECT; else process.env.WEB_PUSH_SUBJECT = contact;
    }
});

test('Push failure handling removes gone devices, retries transient failures, and bounds attempts', () => {
    for (const statusCode of [404,410]) assert.equal(security.pushRetry({statusCode}, 1).remove, true);
    for (const statusCode of [429,500,502,503]) assert.equal(security.pushRetry({statusCode}, 2).retry, true);
    for (const statusCode of [400,401,403,413]) assert.equal(security.pushRetry({statusCode}, 2).retry, false);
    assert.equal(security.pushRetry(new Error('network'), 7).retry, true);
    assert.equal(security.pushRetry(new Error('network'), 8).retry, false);
    assert(!JSON.stringify(security.pushRetry(new Error('secret endpoint'), 1)).includes('secret endpoint'));
});

test('Push transport sends encrypted AES128GCM payload with VAPID and refuses redirects', async () => {
    let captured, status = 201, requests = 0;
    const transport = createSourceLoader({ 'node:https': { request: (endpoint, options, callback) => {
        requests++;
        const req = new EventEmitter();
        req.destroy = error => req.emit('error', error);
        req.end = body => {
            captured = { endpoint, options, body };
            queueMicrotask(() => {
                const response = new EventEmitter(); response.statusCode = status;
                callback(response); response.emit('end');
            });
        };
        return req;
    } } })('src/modules/panel-push/panel-push.transport.ts');
    const vapid = { ...appRequire('web-push').generateVAPIDKeys(), subject: 'https://panel.example.com' };
    const input = subscription();
    await transport.deliverWebPush(input, { title: 'synthetic sensitive title' }, vapid, 'stable-event-topic', false);
    assert.equal(captured.endpoint, input.endpoint);
    assert.equal(captured.options.method, 'POST');
    assert.equal(captured.options.headers['Content-Encoding'], 'aes128gcm');
    assert.equal(String(captured.options.headers.TTL), '3600');
    assert.match(captured.options.headers.Authorization, /^vapid t=/);
    assert(Buffer.isBuffer(captured.body));
    assert(!captured.body.includes(Buffer.from('synthetic sensitive title')));
    assert.equal(captured.options.headers.Topic, 'stable-event-topic');
    status = 302;
    await assert.rejects(transport.deliverWebPush(input, { title: 'retry' }, vapid, 'same-topic', false), error => error.statusCode === 302);
    assert.equal(requests, 2, 'Redirect must not generate another request');
});
