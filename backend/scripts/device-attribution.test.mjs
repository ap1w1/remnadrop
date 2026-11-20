import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { attributeDevice, normalizeDeviceIp } = require('../dist/src/modules/squad-quotas/device-attribution.js');
const at = new Date('2026-11-19T12:00:00Z');
const device = {hwid:'one', platform:'Android', deviceModel:'Phone', userAgent:'client', requestIp:'192.0.2.1', updatedAt:new Date('2026-11-19T11:00:00Z')};
test('one recent matching device is probable, never exact', () => {
    const result = attributeDevice('::ffff:192.0.2.1',[device],at);
    assert.equal(result.device.hwid,'one'); assert.equal(result.deviceIdentification.status,'probable');
});
test('shared IP does not identify a device', () => {
    assert.equal(attributeDevice('192.0.2.1',[device,{...device,hwid:'two'}],at).device,null);
});
test('old, future and missing addresses remain unknown', () => {
    for (const change of [{requestIp:null},{updatedAt:new Date('2026-11-17')},{updatedAt:new Date('2026-11-20')}]) {
        assert.equal(attributeDevice('192.0.2.1',[{...device,...change}],at).device,null);
    }
    assert.equal(normalizeDeviceIp('not an IP'),null);
});
test('equivalent IPv6 forms match', () => {
    assert.equal(normalizeDeviceIp('2001:0db8:0:0:0:0:0:1'),normalizeDeviceIp('2001:db8::1'));
});
