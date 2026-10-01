import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
import { createUserSchema } from '@hexpayroll/shared';
import { pool } from '../db/pool.js';
import { createAuthService } from '../auth/service.js';
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
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  let username: string, email: string, displayName: string;
  try {
    username = (await readline.question('Username: ')).trim();
    email = (await readline.question('Email (optional): ')).trim();
    displayName = (await readline.question('Display name: ')).trim();
  } finally {
    readline.close();
  }
  const password = await passwordPrompt('Password (hidden): ');
  const confirmation = await passwordPrompt('Confirm password (hidden): ');
  if (password !== confirmation) throw new Error('Passwords do not match.');
  const parsed = createUserSchema.safeParse({
    username,
    ...(email ? { email } : {}),
    displayName,
    password,
  });
  if (!parsed.success)
    throw new Error(
      'Use a valid username and email, a display name, and a password of 15–128 characters.',
    );
  try {
    const user = await createAuthService(pool).createUser(parsed.data);
    console.log(`Created payroll user: ${user.username}`);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
      throw new Error('Username or email already exists.', { cause: error });
    throw new Error(
      'Account creation failed. Check database readiness and apply migrations first.',
      { cause: error },
    );
  }
}
main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Account creation failed.');
    process.exitCode = 1;
  })
  .finally(() => pool.end());
