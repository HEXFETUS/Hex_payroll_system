import { createInterface } from 'node:readline/promises';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { queueAccountByUsername } from '../sync/accounts.js';

try {
  if (
    env.SYNC_MODE === 'central' ||
    !process.stdin.isTTY ||
    !process.stdout.isTTY ||
    process.argv.length !== 2
  )
    throw new Error('Run interactively on the local laptop without command-line arguments.');
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  let username: string;
  try {
    const target = (await pool.query('SELECT current_database() AS database')).rows[0].database;
    console.log(`Local account sync target: ${target}`);
    if ((await prompt.question('Confirm local database name: ')) !== target)
      throw new Error('Target mismatch');
    username = (await prompt.question('Existing username to sync: ')).trim();
    if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) throw new Error('Invalid username');
  } finally {
    prompt.close();
  }
  const receipt = await queueAccountByUsername(pool, username);
  console.log(
    `Account event ${receipt.eventId}: ${receipt.status}. The local sync worker delivers pending events to the VPS.`,
  );
} catch {
  console.error(
    'Account queue failed. Check the username, local organization, verifier, and sync revision. No credentials were printed.',
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
