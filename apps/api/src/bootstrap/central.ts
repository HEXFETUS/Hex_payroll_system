import type { Pool } from 'pg';
import { z } from 'zod';
import { createUserSchema, organizationSetupSchema } from '@hexpayroll/shared';
import { hashPassword } from '../auth/password.js';
import { transaction, insert, audit, outbox } from '../foundation/repository.js';

export const centralBootstrapSchema = z
  .object({
    administrator: createUserSchema,
    organization: organizationSetupSchema.extend({ id: z.uuid() }),
  })
  .strict();

// This service never uses the application's runtime pool or grants privileges.
export async function bootstrapCentral(database: Pool, input: unknown) {
  const parsed = centralBootstrapSchema.parse(input);
  const passwordHash = await hashPassword(parsed.administrator.password);
  return transaction(database, async (client) => {
    const identity = await client.query<{ current_user: string; current_database: string }>(
      'SELECT current_user, current_database()',
    );
    if (identity.rows[0]?.current_user === 'hexpayroll_app')
      throw new Error('Use a separate bootstrap database role');
    const setup = await client.query(
      'SELECT administrator_id,organization_id FROM application_setup WHERE singleton FOR UPDATE',
    );
    if (setup.rowCount !== 1 || setup.rows[0].administrator_id || setup.rows[0].organization_id)
      throw new Error('Bootstrap unavailable: setup is missing or already initialized');
    const existing = await client.query(
      'SELECT EXISTS(SELECT 1 FROM auth_users) OR EXISTS(SELECT 1 FROM organizations) AS populated',
    );
    if (existing.rows[0].populated)
      throw new Error('Central bootstrap requires an empty installation');
    const role = await client.query<{ id: string }>(
      "SELECT id FROM roles WHERE code='administrator' AND system",
    );
    if (role.rowCount !== 1) throw new Error('System administrator role is missing');
    const administrator = parsed.administrator;
    const user = await client.query<{ id: string }>(
      'INSERT INTO auth_users(username,email,display_name,password_hash) VALUES($1,$2,$3,$4) RETURNING id',
      [
        administrator.username,
        administrator.email ?? null,
        administrator.displayName,
        passwordHash,
      ],
    );
    const administratorId = user.rows[0]!.id;
    await client.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [
      administratorId,
      role.rows[0]!.id,
    ]);
    const organization = await insert(client, 'organizations', {
      ...parsed.organization,
      updatedBy: administratorId,
    });
    await client.query('UPDATE auth_users SET organization_id=$1 WHERE id=$2', [
      organization.id,
      administratorId,
    ]);
    await client.query(
      'UPDATE application_setup SET administrator_id=$1,organization_id=$2 WHERE singleton',
      [administratorId, organization.id],
    );
    const actor = { id: administratorId, organizationId: String(organization.id) };
    await audit(client, actor, 'CREATE', 'auth_users', administratorId, [
      'username',
      'displayName',
    ]);
    await audit(client, actor, 'ROLE_CHANGE', 'auth_users', administratorId, ['roles']);
    await audit(client, actor, 'CREATE', 'organizations', String(organization.id), ['legalName']);
    await outbox(client, 'organizations', organization, 'CREATE');
    return { administratorId, organizationId: String(organization.id) };
  });
}
