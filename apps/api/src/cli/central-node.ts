import { createInterface } from 'node:readline/promises';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';
import { enrollCentralNode, revokeCentralNode } from '../sync/administration.js';

let database: pg.Pool | undefined;
try {
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.argv.length !== 2)
    throw new Error('Run interactively without arguments');
  if (process.env.SYNC_MODE !== 'central' || !process.env.CENTRAL_ENROLLMENT_DATABASE_URL)
    throw new Error('Set SYNC_MODE=central and a separate CENTRAL_ENROLLMENT_DATABASE_URL');
  database = new pg.Pool({
    connectionString: process.env.CENTRAL_ENROLLMENT_DATABASE_URL,
    max: 1,
    options: '-c search_path=public',
    connectionTimeoutMillis: 5000,
  });
  const target = (
    await database.query('SELECT current_database() AS database,current_user AS role')
  ).rows[0];
  if (target.role === 'hexpayroll_app') throw new Error('Use a separate enrollment database role');
  console.log(`Central node management: ${target.database} as ${target.role}`);
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if ((await prompt.question('Confirm database name: ')) !== target.database)
      throw new Error('Target confirmation did not match');
    const organizationId = (await prompt.question('Canonical organization UUID: ')).trim();
    const action = (await prompt.question('Action (enroll/revoke): ')).trim();
    if (action === 'revoke') {
      const nodeId = (await prompt.question('Node UUID to revoke: ')).trim();
      await revokeCentralNode(database, organizationId, nodeId);
      console.log(`Revoked node ${nodeId}`);
    } else if (action === 'enroll') {
      const deviceName = (await prompt.question('Device name: ')).trim();
      const destination = (await prompt.question('New private credential file path: ')).trim();
      if (!destination) throw new Error('Credential file path required');
      const credential = await enrollCentralNode(database, { organizationId, deviceName });
      console.log(`Created node ${credential.nodeId}; delivering its one-time credential file.`);
      try {
        await writeFile(destination, JSON.stringify(credential) + '\n', {
          flag: 'wx',
          mode: 0o600,
        });
      } catch {
        // A committed credential that could not be delivered must not remain usable.
        await revokeCentralNode(database, organizationId, credential.nodeId);
        throw new Error(
          'Credential file could not be created; the new node was revoked. Use a new private file path.',
        );
      }
      console.log(
        `Enrolled node ${credential.nodeId}. Credential written once to the private file; transfer securely and remove it after import.`,
      );
    } else throw new Error('Choose enroll or revoke');
  } finally {
    prompt.close();
  }
} catch {
  // Never expose connection strings or generated credentials in exceptions.
  console.error(
    'Central node operation failed. Check target, setup, enrollment-role privileges and credential file delivery before retrying.',
  );
  process.exitCode = 1;
} finally {
  await database?.end();
}
