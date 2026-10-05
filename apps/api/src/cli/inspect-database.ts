import 'dotenv/config';
import pg from 'pg';
const database = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
try {
  console.log(
    await database
      .query(
        "SELECT current_user,current_database(),inet_server_port(),has_database_privilege(current_user,current_database(),'CREATE') can_create_schema,version()",
      )
      .then((r) => r.rows),
  );
  console.log(
    await database
      .query('SELECT rolcreatedb,rolsuper FROM pg_roles WHERE rolname=current_user')
      .then((r) => r.rows),
  );
  const runtime = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });
  try {
    console.log(
      await runtime
        .query(
          "SELECT current_user,current_database(),has_schema_privilege(current_user,'public','CREATE') can_create_tables,has_table_privilege(current_user,'audit_events','UPDATE') can_update_audit,has_table_privilege(current_user,'audit_events','DELETE') can_delete_audit",
        )
        .then((r) => r.rows),
    );
    console.log(
      await runtime
        .query(
          'SELECT organization_id IS NOT NULL company_configured,administrator_id IS NOT NULL administrator_selected FROM application_setup WHERE singleton',
        )
        .then((r) => r.rows),
    );
  } finally {
    await runtime.end();
  }
} catch (error) {
  console.log({
    code:
      typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : 'UNKNOWN',
    reason:
      error instanceof Error
        ? error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]')
        : 'Database inspection failed',
  });
  process.exitCode = 1;
} finally {
  await database.end();
}
