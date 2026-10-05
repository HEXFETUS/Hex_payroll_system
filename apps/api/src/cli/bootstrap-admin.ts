import { createInterface } from 'node:readline/promises';
import { pool } from '../db/pool.js';
import { transaction, audit, getActor } from '../foundation/repository.js';
const prompt = createInterface({ input: process.stdin, output: process.stdout });
try {
  const username = (
    await prompt.question('Existing username to bootstrap as Administrator: ')
  ).trim();
  await transaction(pool, async (client) => {
    const setup = await client.query<{
      administrator_id: string | null;
      organization_id: string | null;
    }>('SELECT * FROM application_setup WHERE singleton FOR UPDATE');
    if (setup.rows[0]?.administrator_id || setup.rows[0]?.organization_id)
      throw new Error('Bootstrap already completed');
    const users = await client.query<{ id: string }>(
      'SELECT id FROM auth_users WHERE lower(username)=lower($1) AND active',
      [username],
    );
    const id = users.rows[0]?.id;
    if (!id) throw new Error('Active user not found');
    await client.query(
      "INSERT INTO user_roles SELECT $1,id FROM roles WHERE code='administrator' ON CONFLICT DO NOTHING",
      [id],
    );
    await client.query('UPDATE application_setup SET administrator_id=$1 WHERE singleton', [id]);
    await audit(client, await getActor(client, id), 'ROLE_CHANGE', 'auth_users', id, ['roles']);
  });
  console.log('Administrator selected. Sign in to complete company setup.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Bootstrap failed');
  process.exitCode = 1;
} finally {
  prompt.close();
  await pool.end();
}
