import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';
if (!process.env.MIGRATION_DATABASE_URL) throw new Error('MIGRATION_DATABASE_URL is required');
export default defineConfig({dialect:'postgresql',out:'./src/db/generated',dbCredentials:{url:process.env.MIGRATION_DATABASE_URL},tablesFilter:['organizations','auth_users','auth_sessions','application_setup','permissions','roles','user_roles','role_permissions','departments','positions','employees','employment_versions','biometric_devices','biometric_mappings','payroll_configurations','audit_events','sync_nodes','sync_outbox'],introspect:{casing:'camel'}});
