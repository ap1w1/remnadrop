import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMigrationHistory as check } from './migration-preflight.mjs';
const manifest = { initial: 'abc', upgrade: 'def' };
const rows = Object.entries(manifest).map(([migration_name, checksum]) => ({ migration_name, checksum, finished_at: '2026-01-01', rolled_back_at: null }));
test('accept complete matching 2.8.1 history', () => assert.equal(check(rows, manifest, '2.8.1').migrations, 2));
test('reject unsupported source version', () => assert.throws(() => check(rows, manifest, '3.0.0'), /Only/));
test('reject missing migration', () => assert.throws(() => check(rows.slice(1), manifest, '2.8.1'), /Missing/));
test('reject modified migration', () => assert.throws(() => check([{ ...rows[0], checksum: 'changed' }, rows[1]], manifest, '2.8.1'), /Checksum/));
test('reject failed migration', () => assert.throws(() => check([{ ...rows[0], finished_at: null }, rows[1]], manifest, '2.8.1'), /Unfinished/));
test('reject unknown migration', () => assert.throws(() => check([...rows, { migration_name: 'custom', finished_at: 'today' }], manifest, '2.8.1'), /Unknown/));
test('ignore rolled back attempts when a successful retry exists', () => assert.equal(check([{ ...rows[0], finished_at: null, rolled_back_at: 'today' }, ...rows], manifest, '2.8.1').migrations, 2));
test('reject duplicate successful migrations', () => assert.throws(() => check([...rows, rows[0]], manifest, '2.8.1'), /Duplicate/));
test('update accepts only known fork migrations with exact checksums', () => {
    const extra={migration_name:'fork_quota',checksum:'ghi',finished_at:'today'};
    assert.equal(check([...rows,extra],manifest,'2.8.1',{fork_quota:'ghi',not_yet_applied:'jkl'}).migrations,3);
    assert.throws(()=>check([...rows,{...extra,checksum:'changed'}],manifest,'2.8.1',{fork_quota:'ghi'}),/Checksum/);
});
