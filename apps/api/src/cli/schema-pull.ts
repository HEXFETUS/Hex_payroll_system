import { spawnSync } from 'node:child_process';
import { readFile, writeFile, unlink } from 'node:fs/promises';
// Machine generation includes deterministic ESM/strict-TypeScript compatibility fixes.
const result = spawnSync(process.execPath, ['node_modules/drizzle-kit/bin.cjs', 'pull'], {
  stdio: 'inherit',
});
if (result.status !== 0) process.exit(result.status ?? 1);
const path = 'src/db/generated/schema.ts';
const generated = await readFile(path, 'utf8');
await writeFile(
  path,
  generated
    .replace('type AnyPgColumn', 'type PgTableExtraConfigValue')
    .replaceAll('}, (table) => [', '}, (table): PgTableExtraConfigValue[] => ['),
);
await unlink('src/db/generated/relations.ts');
