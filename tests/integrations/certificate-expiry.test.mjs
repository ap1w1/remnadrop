import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canonicalCertificateDomain,
  certificateDomainMatches,
  certificateDomainOccurrences,
  certificateExpiryText,
  certificateMatchesInValue,
  jsonCertificateDomainAtOffset,
  matchingCertificates,
} from '../../frontend/src/features/dashboard/config-profiles/certificate-expiry/certificate-expiry.utils.ts';

const certificate = (overrides = {}) => ({
  id: 'certificate-a', name: 'API certificate', domains: ['api.example.com'], nodeUuids: ['node-a'],
  nodes: [{ uuid: 'node-a', name: 'Node A' }], expiresAt: '2030-12-15T09:30:00.000Z',
  reminderDays: [3, 2, 1], enabled: true, daysRemaining: 30, status: 'valid',
  createdAt: '2030-01-01T00:00:00.000Z', updatedAt: '2030-01-01T00:00:00.000Z', ...overrides,
});

test('SSL domain matching canonicalizes case, final dot and international names', () => {
  assert.equal(canonicalCertificateDomain(' API.Example.COM. '), 'api.example.com');
  assert.equal(canonicalCertificateDomain('пример.рф'), 'xn--e1afmkfd.xn--p1ai');
  assert(certificateDomainMatches('xn--e1afmkfd.xn--p1ai', 'ПРИМЕР.РФ'));
  for (const input of ['192.0.2.1', 'localhost', 'https://api.example.com', 'api.example.com:443', 'bad_host.example.com', 'api.example.com/private']) {
    assert.equal(canonicalCertificateDomain(input), null, input);
  }
});

test('SSL wildcard matching respects the certificate single-label boundary', () => {
  assert(certificateDomainMatches('*.example.com', 'api.example.com'));
  assert(certificateDomainMatches('*.example.com', '*.EXAMPLE.COM.'));
  for (const domain of ['example.com', 'deep.api.example.com', 'evil-example.com', 'example.com.evil.invalid']) {
    assert.equal(certificateDomainMatches('*.example.com', domain), false, domain);
  }
  assert.equal(certificateDomainMatches('api.example.com', '*.example.com'), false);
});

test('Domain extraction locates host names inside certificate paths and SNI lists', () => {
  const value = 'API.Example.COM:443, /etc/letsencrypt/live/api.example.com/fullchain.pem';
  const found = certificateDomainOccurrences(value).filter(item => item.domain === 'api.example.com');
  assert.equal(found.length, 2);
  assert.equal(value.slice(found[0].offset, found[0].offset + found[0].length), 'API.Example.COM');
  assert.equal(value.slice(found[1].offset, found[1].offset + found[1].length), 'api.example.com');
  assert.deepEqual(certificateDomainOccurrences('192.0.2.1 bad_host.example.com'), []);
});

test('Registry lookup respects profile nodes and omits absent or invalid calendar dates', () => {
  const matching = certificate();
  const elsewhere = certificate({ id: 'elsewhere', nodeUuids: ['node-b'] });
  const invalid = certificate({ id: 'invalid', expiresAt: '' });
  const disabledReminders = certificate({ id: 'disabled', enabled: false, status: 'disabled' });
  assert.deepEqual(matchingCertificates('api.example.com', [matching, elsewhere, invalid], ['node-a']), [matching]);
  assert.deepEqual(matchingCertificates('unregistered.example.com', [matching], ['node-a']), []);
  assert.deepEqual(matchingCertificates('api.example.com', [disabledReminders], ['node-a']), [disabledReminders]);
  assert.equal(matchingCertificates('api.example.com', [matching, elsewhere], []).length, 2, 'An unassigned profile shows node-labelled calendar entries');
});

test('Shared config shows independent node expiry dates without changing registry order', () => {
  const later = certificate({ expiresAt: '2031-12-15T09:30:00.000Z' });
  const earlier = certificate({ id: 'earlier', nodeUuids: ['node-b'], nodes: [{ uuid: 'node-b', name: 'Node B' }] });
  const source = [later, earlier];
  const matches = certificateMatchesInValue('api.example.com, API.EXAMPLE.COM.', source, ['node-a', 'node-b']);
  assert.deepEqual(matches.map(item => item.certificate.id), ['earlier', 'certificate-a']);
  assert.deepEqual(source, [later, earlier], 'Lookup must not mutate cached API data');
  const label = certificateExpiryText(matches, 'ru');
  assert.match(label, /Срок SSL из календаря/);
  assert.match(label, /15\.12\.2030/);
  assert.match(label, /15\.12\.2031/);
  assert.match(label, /Node A/);
  assert.match(label, /Node B/);
});

test('JSON hover covers SNI, multiline server name lists and certificate file domains', () => {
  const source = JSON.stringify({ inbounds: [{ streamSettings: {
    realitySettings: { serverNames: ['api.example.com', 'second.example.com'], target: 'api.example.com:443' },
    tlsSettings: { serverName: 'api.example.com', certificates: [{ certificateFile: '/certs/api.example.com/fullchain.pem' }] },
  } }] }, null, 2);
  for (const match of source.matchAll(/(?:api|second)\.example\.com/g)) {
    const hovered = jsonCertificateDomainAtOffset(source, match.index + 3);
    assert(hovered, `No hover occurrence at ${match.index}`);
    assert.equal(hovered.offset, match.index);
    assert.equal(hovered.length, match[0].length);
    assert.equal(hovered.domain, match[0]);
  }
  assert.equal(jsonCertificateDomainAtOffset(source, source.indexOf('fullchain.pem') + 2)?.domain, 'fullchain.pem');
  assert.equal(matchingCertificates('fullchain.pem', [certificate()], ['node-a']).length, 0);
});

test('JSON hover ignores credentials, JSON keys and unrelated domain strings', () => {
  const values = {
    privateKey: 'api.example.com', password: 'api.example.com', publicKey: 'api.example.com',
    description: 'api.example.com', 'api.example.com': 'value',
  };
  const source = JSON.stringify(values, null, 2);
  for (const match of source.matchAll(/api\.example\.com/g)) {
    assert.equal(jsonCertificateDomainAtOffset(source, match.index + 4), null);
  }
});

test('Domain hover ranges exclude surrounding quotes and path characters', () => {
  const source = '{"certificateFile":"/certs/api.example.com/fullchain.pem"}';
  const start = source.indexOf('api.example.com');
  assert.equal(jsonCertificateDomainAtOffset(source, start - 1), null);
  assert.equal(jsonCertificateDomainAtOffset(source, start + 'api.example.com'.length), null);
  assert.equal(jsonCertificateDomainAtOffset(source, start)?.domain, 'api.example.com');
});
