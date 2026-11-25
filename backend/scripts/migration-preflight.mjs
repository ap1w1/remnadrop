import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateMigrationHistory(rows, manifest, sourceVersion, additional = {}) {
    if (sourceVersion !== '2.8.1') throw new Error('Only Remnawave 2.8.1 is supported by this migration path');
    if (!Array.isArray(rows)) throw new Error('Migration history must be a JSON array');
    const expected = new Map(Object.entries({ ...manifest, ...additional }));
    const applied = new Set();
    for (const row of rows) {
        if (row.rolled_back_at) continue;
        if (!row.finished_at) throw new Error(`Unfinished migration: ${row.migration_name}`);
        if (!expected.has(row.migration_name)) throw new Error(`Unknown migration: ${row.migration_name}`);
        if (row.checksum !== expected.get(row.migration_name)) throw new Error(`Checksum mismatch: ${row.migration_name}`);
        if (applied.has(row.migration_name)) throw new Error(`Duplicate migration: ${row.migration_name}`);
        applied.add(row.migration_name);
    }
    for (const name of Object.keys(manifest)) {
        if (!applied.has(name)) throw new Error(`Missing baseline migration: ${name}`);
    }
    return { baseline: sourceVersion, migrations: applied.size, status: 'history-matches' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        const [, , historyPath, version, migrationsPath] = process.argv;
        if (!historyPath) throw new Error('Usage: node scripts/migration-preflight.mjs HISTORY.json SOURCE_VERSION');
        const manifest = JSON.parse(readFileSync(new URL('./migration-baseline.json', import.meta.url), 'utf8'));
        const rows = JSON.parse(readFileSync(historyPath, 'utf8').replace(/^\uFEFF/, ''));
        const additional = {};
        if (migrationsPath) for (const entry of readdirSync(migrationsPath, {withFileTypes:true})) {
            if (entry.isDirectory() && !Object.hasOwn(manifest,entry.name)) additional[entry.name] = createHash('sha256').update(readFileSync(join(migrationsPath,entry.name,'migration.sql'))).digest('hex');
        }
        console.log(JSON.stringify(validateMigrationHistory(rows, manifest, version, additional)));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
