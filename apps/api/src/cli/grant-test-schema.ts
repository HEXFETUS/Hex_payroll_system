import 'dotenv/config';
import pg from 'pg';
import { emitKeypressEvents } from 'node:readline';
// Use an available administrator connection; never print connection URLs or passwords.
const configured = process.env.ADMIN_DATABASE_URL ?? process.env.MIGRATION_DATABASE_URL;
if (!configured) throw new Error('No database connection configured');
const url = new URL(configured);
url.username = 'postgres';
if (process.argv.includes('--prompt')) {
  if (!process.stdin.isTTY) throw new Error('Run in an interactive local terminal');
  process.stdout.write('PostgreSQL administrator password (hidden): ');
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  url.password = await new Promise<string>((resolve, reject) => {
    let value = '';
    const done = () => {
      process.stdin.off('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const onKey = (text: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === 'c') {
        done();
        reject(new Error('Cancelled'));
        return;
      }
      if (key.name === 'return') {
        done();
        resolve(value);
        return;
      }
      if (key.name === 'backspace') {
        value = Array.from(value).slice(0, -1).join('');
        return;
      }
      if (
        text &&
        !key.ctrl &&
        Array.from(text).every((c) => c.codePointAt(0)! >= 32 && c.codePointAt(0) !== 127)
      )
        value += text;
    };
    process.stdin.on('keypress', onKey);
  });
}
const database = new pg.Pool({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
try {
  const role = await database.query<{ rolsuper: boolean }>(
    'SELECT rolsuper FROM pg_roles WHERE rolname=current_user',
  );
  if (!role.rows[0]?.rolsuper) throw new Error('Administrator connection required');
  await database.query(
    'GRANT CREATE ON DATABASE ' +
      pg.escapeIdentifier(url.pathname.slice(1)) +
      ' TO hexpayroll_migrator',
  );
  console.log('Isolated test schema privilege granted.');
} catch {
  console.error('Administrator authentication unavailable with configured credentials.');
  process.exitCode = 1;
} finally {
  await database.end();
}
