import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { applyQuotaUsage, requireUnambiguousSquad } = require('../dist/src/modules/squad-quotas/quota-policy.js');
test('quota blocks exactly at threshold', () => {
    assert.equal(applyQuotaUsage({ limitBytes: 80n, usedBytes: 79n, blockedByQuota: false }, 1n).blockedByQuota, true);
});
test('unlimited squad remains available', () => {
    assert.equal(applyQuotaUsage({ limitBytes: null, usedBytes: 0n, blockedByQuota: false }, 2n ** 60n).blockedByQuota, false);
});
test('uses bigint without rounding', () => {
    assert.equal(applyQuotaUsage({ limitBytes: null, usedBytes: 2n ** 60n, blockedByQuota: false }, 1n).usedBytes, 2n ** 60n + 1n);
});
test('rejects negative traffic', () => assert.throws(() => applyQuotaUsage({ limitBytes: 1n, usedBytes: 0n, blockedByQuota: false }, -1n)));
test('rejects overlapping squads instead of charging an arbitrary squad', () => assert.throws(() => requireUnambiguousSquad(['a', 'b']), /AMBIGUOUS/));
test('deduplicates same squad', () => assert.equal(requireUnambiguousSquad(['a', 'a']), 'a'));
