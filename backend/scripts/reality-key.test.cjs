const { test } = require('node:test');
const assert = require('node:assert/strict');

const { resolveInboundAndPublicKey } = require('../dist/src/common/helpers/xray-config/resolve-public-key');
const { generateX25519PublicKey } = require('../dist/src/common/helpers/vless-encryption/generate-encryption-from-decryption');
const { XrayJsonGeneratorService } = require('../dist/src/modules/subscription-template/generators/xray-json.generator.service');

const privateKey = 'WG3TSjifyqPQ-BVFdosjJqSz_i4O7pCFomPlkzX7DXM';
const publicKey = '1wwKZV_IxO4W4wcGJ9dgzBMMaZ3mNOJZcy_MVVmC-1M';

test('REALITY public key is derived from an X25519 private key on Node.js 24', async () => {
    const inbounds = [{ tag: 'reality', streamSettings: { realitySettings: { privateKey } } }];
    const keys = await resolveInboundAndPublicKey(inbounds);
    assert.equal(keys.get('reality'), publicKey);
    assert.equal(await generateX25519PublicKey(privateKey), publicKey);
});

test('Xray JSON sends the REALITY public key in password, never the private key', () => {
    const generator = new XrayJsonGeneratorService({});
    const result = generator.buildSecurityEntry({
        security: 'reality',
        securityOptions: { publicKey, serverName: 'example.com', fingerprint: 'chrome', shortId: 'abcd', spiderX: '' },
    });
    assert.equal(result.realitySettings.password, publicKey);
    assert.equal(result.realitySettings.publicKey, undefined);
    assert.ok(!JSON.stringify(result).includes(privateKey));
});
