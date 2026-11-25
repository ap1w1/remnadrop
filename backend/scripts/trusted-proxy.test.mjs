import test from 'node:test';
import assert from 'node:assert/strict';
import proxyaddr from 'proxy-addr';

test('IPv4-mapped untrusted clients do not match an internal proxy subnet', () => {
    const trusted = proxyaddr.compile(['10.0.0.0/8']);
    assert.equal(trusted('10.1.2.3'), true);
    assert.equal(trusted('::ffff:10.1.2.3'), true);
    assert.equal(trusted('203.0.113.5'), false);
    assert.equal(trusted('::ffff:203.0.113.5'), false);
});

test('forwarded addresses are ignored when immediate peer is untrusted', () => {
    const req = { socket: { remoteAddress: '::ffff:203.0.113.5' }, headers: { 'x-forwarded-for': '10.1.2.3' } };
    assert.equal(proxyaddr(req, proxyaddr.compile(['10.0.0.0/8'])), '::ffff:203.0.113.5');
});
