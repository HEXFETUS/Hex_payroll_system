import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
import pg from 'pg';
import { bootstrapCentral, centralBootstrapSchema } from '../bootstrap/central.js';
let database: pg.Pool | undefined;
function passwordPrompt(label: string): Promise<string> {
  process.stdout.write(label);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      process.stdin.off('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const onKey = (text: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        reject(new Error('Cancelled'));
        return;
      }
      if (key.name === 'return') {
        cleanup();
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
        Array.from(text).every(
          (character) => character.codePointAt(0)! >= 32 && character.codePointAt(0) !== 127,
        )
      )
        value += text;
    };
    process.stdin.on('keypress', onKey);
  });
}
async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.argv.length > 2)
    throw new Error('Run interactively without command-line arguments.');
  if (process.env.SYNC_MODE !== 'central' || !process.env.CENTRAL_BOOTSTRAP_DATABASE_URL)
    throw new Error(
      'Set SYNC_MODE=central and a separate CENTRAL_BOOTSTRAP_DATABASE_URL. Runtime DATABASE_URL is never used.',
    );
  database = new pg.Pool({
    connectionString: process.env.CENTRAL_BOOTSTRAP_DATABASE_URL,
    max: 1,
    options: '-c search_path=public',
    connectionTimeoutMillis: 5000,
  });
  const identity = (
    await database.query('SELECT current_database() AS database,current_user AS role')
  ).rows[0];
  if (identity.role === 'hexpayroll_app')
    throw new Error('Use a separate bootstrap database role.');
  console.log(`Bootstrap target: ${identity.database} as ${identity.role}`);
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  let username: string,
    email: string,
    displayName: string,
    organizationId: string,
    legalName: string;
  try {
    const confirmation = await readline.question('Confirm target by typing its database name: ');
    if (confirmation !== identity.database) throw new Error('Target confirmation did not match.');
    organizationId = (await readline.question('Canonical local organization UUID: ')).trim();
    legalName = (await readline.question('Organization legal name: ')).trim();
    username = (await readline.question('Username: ')).trim();
    email = (await readline.question('Email (optional): ')).trim();
    displayName = (await readline.question('Display name: ')).trim();
  } finally {
    readline.close();
  }
  const password = await passwordPrompt('Password (hidden): ');
  const confirmation = await passwordPrompt('Confirm password (hidden): ');
  if (password !== confirmation) throw new Error('Passwords do not match.');
  const parsed = centralBootstrapSchema.safeParse({
    organization: { id: organizationId, legalName },
    administrator: {
      username,
      ...(email ? { email } : {}),
      displayName,
      password,
    },
  });
  if (!parsed.success)
    throw new Error(
      'Use a valid canonical UUID, company name, username and email, display name, and a password of 15–128 characters.',
    );
  try {
    const result = await bootstrapCentral(database, parsed.data);
    console.log(
      `Central bootstrap complete. Organization: ${result.organizationId}; administrator: ${result.administratorId}`,
    );
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
      throw new Error('Username or email already exists.', { cause: error });
    throw new Error(
      'Central bootstrap failed; transaction rolled back. Check setup state, migrations, and bootstrap-role privileges.',
      { cause: error },
    );
  }
}
main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Central bootstrap failed.');
    process.exitCode = 1;
  })
  .finally(() => database?.end());
