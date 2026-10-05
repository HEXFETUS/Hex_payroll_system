import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
const files = (await readdir('test'))
  .filter((name) => name.endsWith('.test.ts'))
  .filter(name=>process.argv.length===2||process.argv.slice(2).some(filter=>name===filter))
  .map((name) => 'test/' + name);
const result = spawnSync(
  process.execPath,
  ['node_modules/tsx/dist/cli.mjs', '--test', '--test-concurrency=1', ...files],
  { stdio: 'inherit', env: { ...process.env, PHASE1_TEST_LOCAL: '1' } },
);
process.exitCode = result.status ?? 1;
