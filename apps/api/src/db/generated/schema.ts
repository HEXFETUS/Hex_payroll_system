import { pgTable, foreignKey, check, uuid, text, timestamp, index, char, type PgTableExtraConfigValue, uniqueIndex, unique, varchar, boolean, integer, jsonb, date, bigint, smallint, time, primaryKey } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const syncNodes = pgTable("sync_nodes", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	deviceName: text("device_name").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: 'string' }),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "sync_nodes_organization_id_fkey"
		}),
	check("sync_nodes_name_check", sql`length(btrim(device_name)) > 0`),
]);

export const authSessions = pgTable("auth_sessions", {
	tokenHash: char("token_hash", { length: 64 }).primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
}, (table): PgTableExtraConfigValue[] => [
	index("auth_sessions_expires_at_idx").using("btree", table.expiresAt.asc().nullsLast().op("timestamptz_ops")),
	index("auth_sessions_user_id_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [authUsers.id],
			name: "auth_sessions_user_id_fkey"
		}).onDelete("cascade"),
	check("auth_sessions_check", sql`expires_at > created_at`),
	check("auth_sessions_token_hash_check", sql`token_hash ~ '^[a-f0-9]{64}$'::text`),
]);

export const authUsers = pgTable("auth_users", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	username: varchar({ length: 64 }).notNull(),
	email: varchar({ length: 254 }),
	displayName: varchar("display_name", { length: 128 }).notNull(),
	passwordHash: text("password_hash").notNull(),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	organizationId: uuid("organization_id"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: 'string' }),
	revision: integer().default(1).notNull(),
	updatedBy: uuid("updated_by"),
}, (table): PgTableExtraConfigValue[] => [
	uniqueIndex("auth_users_email_unique").using("btree", sql`lower((email)::text)`).where(sql`(email IS NOT NULL)`),
	uniqueIndex("auth_users_username_unique").using("btree", sql`lower((username)::text)`),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "auth_users_organization_id_fkey"
		}),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [table.id],
			name: "auth_users_updated_by_fkey"
		}),
	unique("auth_users_org_id_unique").on(table.id, table.organizationId),
	check("auth_users_display_name_check", sql`length(btrim((display_name)::text)) > 0`),
	check("auth_users_revision_check", sql`revision > 0`),
	check("auth_users_username_check", sql`(username)::text ~ '^[A-Za-z0-9._-]{3,64}$'::text`),
]);

export const payrollConfigurations = pgTable("payroll_configurations", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	configuration: jsonb().notNull(),
	revision: integer().default(1).notNull(),
	updatedBy: uuid("updated_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "payroll_configurations_organization_id_fkey"
		}),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [authUsers.id],
			name: "payroll_configurations_updated_by_fkey"
		}),
	unique("payroll_configurations_organization_id_key").on(table.organizationId),
	check("payroll_configuration_required_check", sql`(configuration ?& ARRAY['payFrequency'::text, 'workWeekdays'::text, 'workStart'::text, 'workEnd'::text, 'breakMinutes'::text, 'standardMinutesPerDay'::text, 'graceMinutes'::text, 'lateEnabled'::text, 'undertimeEnabled'::text, 'overtimeEnabled'::text, 'roundingMode'::text, 'roundingIncrementMinutes'::text]) AND ((configuration ->> 'payFrequency'::text) = ANY (ARRAY['monthly'::text, 'semi_monthly'::text, 'weekly'::text, 'biweekly'::text])) AND ((configuration ->> 'roundingMode'::text) = ANY (ARRAY['none'::text, 'nearest'::text, 'up'::text, 'down'::text])) AND (jsonb_typeof((configuration -> 'workWeekdays'::text)) = 'array'::text) AND (jsonb_typeof((configuration -> 'lateEnabled'::text)) = 'boolean'::text) AND (jsonb_typeof((configuration -> 'undertimeEnabled'::text)) = 'boolean'::text) AND (jsonb_typeof((configuration -> 'overtimeEnabled'::text)) = 'boolean'::text) AND ((((configuration ->> 'breakMinutes'::text))::integer >= 0) AND (((configuration ->> 'breakMinutes'::text))::integer <= 1440)) AND ((((configuration ->> 'standardMinutesPerDay'::text))::integer >= 1) AND (((configuration ->> 'standardMinutesPerDay'::text))::integer <= 1440)) AND ((((configuration ->> 'graceMinutes'::text))::integer >= 0) AND (((configuration ->> 'graceMinutes'::text))::integer <= 1440)) AND ((((configuration ->> 'roundingIncrementMinutes'::text))::integer >= 1) AND (((configuration ->> 'roundingIncrementMinutes'::text))::integer <= 60))`),
	check("payroll_configurations_configuration_check", sql`jsonb_typeof(configuration) = 'object'::text`),
	check("payroll_configurations_revision_check", sql`revision > 0`),
]);

export const workSchedules = pgTable("work_schedules", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	code: text().notNull(),
	name: text().notNull(),
	description: text(),
	status: text().default('active').notNull(),
	revision: integer().default(1).notNull(),
	updatedBy: uuid("updated_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	uniqueIndex("schedules_code_unique").using("btree", sql`organization_id`, sql`lower(code)`),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "work_schedules_organization_id_fkey"
		}),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [authUsers.id],
			name: "work_schedules_updated_by_fkey"
		}),
	unique("work_schedules_organization_id_id_key").on(table.id, table.organizationId),
	check("work_schedules_code_check", sql`length(btrim(code)) > 0`),
	check("work_schedules_name_check", sql`length(btrim(name)) > 0`),
	check("work_schedules_revision_check", sql`revision > 0`),
	check("work_schedules_status_check", sql`status = ANY (ARRAY['active'::text, 'inactive'::text])`),
]);

export const auditEvents = pgTable("audit_events", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	organizationId: uuid("organization_id"),
	userId: uuid("user_id"),
	action: text().notNull(),
	entityType: text("entity_type").notNull(),
	entityId: uuid("entity_id"),
	description: text().notNull(),
	metadata: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	index("audit_filter_idx").using("btree", table.organizationId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "audit_events_organization_id_fkey"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [authUsers.id],
			name: "audit_events_user_id_fkey"
		}),
	check("audit_events_action_check", sql`action = ANY (ARRAY['CREATE'::text, 'UPDATE'::text, 'ARCHIVE'::text, 'ACTIVATE'::text, 'DEACTIVATE'::text, 'LOGIN'::text, 'LOGOUT'::text, 'CONFIG_CHANGE'::text, 'ROLE_CHANGE'::text])`),
	check("audit_events_metadata_check", sql`jsonb_typeof(metadata) = 'object'::text`),
]);

export const applicationSetup = pgTable("application_setup", {
	singleton: boolean().default(true).primaryKey().notNull(),
	organizationId: uuid("organization_id"),
	administratorId: uuid("administrator_id"),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.administratorId],
			foreignColumns: [authUsers.id],
			name: "application_setup_administrator_id_fkey"
		}),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "application_setup_organization_id_fkey"
		}),
	unique("application_setup_organization_id_key").on(table.organizationId),
	check("application_setup_singleton_check", sql`CHECK (singleton)`),
]);

export const organizations = pgTable("organizations", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	legalName: text("legal_name").notNull(),
	tradeName: text("trade_name"),
	tin: text(),
	rdoCode: text("rdo_code"),
	sssNumber: text("sss_number"),
	philhealthNumber: text("philhealth_number"),
	pagibigNumber: text("pagibig_number"),
	address: text(),
	barangay: text(),
	city: text(),
	province: text(),
	postalCode: text("postal_code"),
	country: char({ length: 2 }).default('PH').notNull(),
	phone: text(),
	email: text(),
	timezone: text().default('Asia/Manila').notNull(),
	currency: char({ length: 3 }).default('PHP').notNull(),
	status: text().default('active').notNull(),
	revision: integer().default(1).notNull(),
	updatedBy: uuid("updated_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [authUsers.id],
			name: "organizations_updated_by_fk"
		}),
	check("organizations_legal_name_check", sql`length(btrim(legal_name)) > 0`),
	check("organizations_locale_check", sql`(country = 'PH'::bpchar) AND (currency = 'PHP'::bpchar)`),
	check("organizations_revision_check", sql`revision > 0`),
	check("organizations_status_check", sql`status = ANY (ARRAY['active'::text, 'inactive'::text])`),
]);

export const roles = pgTable("roles", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	code: text().notNull(),
	name: text().notNull(),
	system: boolean().default(false).notNull(),
	organizationId: uuid("organization_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "roles_organization_id_fkey"
		}),
	unique("roles_code_key").on(table.code),
	check("roles_name_check", sql`length(btrim(name)) > 0`),
]);

export const permissions = pgTable("permissions", {
	code: text().primaryKey().notNull(),
});

export const departments = pgTable("departments", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	code: text().notNull(),
	name: text().notNull(),
	description: text(),
	status: text().default('active').notNull(),
	revision: integer().default(1).notNull(),
	updatedBy: uuid("updated_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	uniqueIndex("departments_code_unique").using("btree", sql`organization_id`, sql`lower(code)`),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "departments_organization_id_fkey"
		}),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [authUsers.id],
			name: "departments_updated_by_fkey"
		}),
	unique("departments_organization_id_id_key").on(table.id, table.organizationId),
	check("departments_code_check", sql`length(btrim(code)) > 0`),
	check("departments_name_check", sql`length(btrim(name)) > 0`),
	check("departments_revision_check", sql`revision > 0`),
	check("departments_status_check", sql`status = ANY (ARRAY['active'::text, 'inactive'::text])`),
]);

export const positions = pgTable("positions", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	departmentId: uuid("department_id"),
	code: text().notNull(),
	name: text().notNull(),
	description: text(),
	status: text().default('active').notNull(),
	revision: integer().default(1).notNull(),
	updatedBy: uuid("updated_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	uniqueIndex("positions_code_unique").using("btree", sql`organization_id`, sql`lower(code)`),
	index("positions_department_idx").using("btree", table.organizationId.asc().nullsLast().op("uuid_ops"), table.departmentId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.organizationId, table.departmentId],
			foreignColumns: [departments.id, departments.organizationId],
			name: "positions_organization_id_department_id_fkey"
		}),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "positions_organization_id_fkey"
		}),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [authUsers.id],
			name: "positions_updated_by_fkey"
		}),
	unique("positions_organization_id_id_key").on(table.id, table.organizationId),
	check("positions_code_check", sql`length(btrim(code)) > 0`),
	check("positions_name_check", sql`length(btrim(name)) > 0`),
	check("positions_revision_check", sql`revision > 0`),
	check("positions_status_check", sql`status = ANY (ARRAY['active'::text, 'inactive'::text])`),
]);

export const employees = pgTable("employees", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	employeeNumber: text("employee_number").notNull(),
	firstName: text("first_name").notNull(),
	middleName: text("middle_name"),
	lastName: text("last_name").notNull(),
	suffix: text(),
	birthDate: date("birth_date"),
	email: text(),
	mobileNumber: text("mobile_number"),
	address: text(),
	barangay: text(),
	city: text(),
	province: text(),
	postalCode: text("postal_code"),
	sssNumber: text("sss_number"),
	philhealthNumber: text("philhealth_number"),
	pagibigNumber: text("pagibig_number"),
	tin: text(),
	status: text().default('active').notNull(),
	revision: integer().default(1).notNull(),
	updatedBy: uuid("updated_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	uniqueIndex("employees_number_unique").using("btree", sql`organization_id`, sql`lower(employee_number)`),
	index("employees_search_idx").using("btree", table.organizationId.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("text_ops"), table.lastName.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "employees_organization_id_fkey"
		}),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [authUsers.id],
			name: "employees_updated_by_fkey"
		}),
	unique("employees_organization_id_id_key").on(table.id, table.organizationId),
	check("employees_employee_number_check", sql`length(btrim(employee_number)) > 0`),
	check("employees_first_name_check", sql`length(btrim(first_name)) > 0`),
	check("employees_last_name_check", sql`length(btrim(last_name)) > 0`),
	check("employees_revision_check", sql`revision > 0`),
	check("employees_status_check", sql`status = ANY (ARRAY['active'::text, 'inactive'::text, 'on_leave'::text, 'terminated'::text])`),
]);

export const scheduleAssignmentHistory = pgTable("schedule_assignment_history", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	assignmentId: uuid("assignment_id").notNull(),
	revision: integer().notNull(),
	snapshot: jsonb().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.organizationId, table.assignmentId],
			foreignColumns: [employeeScheduleAssignments.id, employeeScheduleAssignments.organizationId],
			name: "schedule_assignment_history_organization_id_assignment_id_fkey"
		}),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "schedule_assignment_history_organization_id_fkey"
		}),
	unique("schedule_assignment_history_assignment_id_revision_key").on(table.assignmentId, table.revision),
	check("schedule_assignment_history_revision_check", sql`revision > 0`),
]);

export const employeeScheduleAssignments = pgTable("employee_schedule_assignments", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	employeeId: uuid("employee_id").notNull(),
	scheduleId: uuid("schedule_id").notNull(),
	effectiveFrom: date("effective_from").notNull(),
	effectiveTo: date("effective_to"),
	reason: text(),
	revision: integer().default(1).notNull(),
	updatedBy: uuid("updated_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	index("schedule_assignment_dates_idx").using("btree", table.organizationId.asc().nullsLast().op("uuid_ops"), table.employeeId.asc().nullsLast().op("date_ops"), table.effectiveFrom.asc().nullsLast().op("date_ops")),
	foreignKey({
			columns: [table.organizationId, table.employeeId],
			foreignColumns: [employees.id, employees.organizationId],
			name: "employee_schedule_assignments_organization_id_employee_id_fkey"
		}),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "employee_schedule_assignments_organization_id_fkey"
		}),
	foreignKey({
			columns: [table.organizationId, table.scheduleId],
			foreignColumns: [workSchedules.id, workSchedules.organizationId],
			name: "employee_schedule_assignments_organization_id_schedule_id_fkey"
		}),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [authUsers.id],
			name: "employee_schedule_assignments_updated_by_fkey"
		}),
	unique("employee_schedule_assignments_organization_id_id_key").on(table.id, table.organizationId),
	check("employee_schedule_assignments_check", sql`effective_to > effective_from`),
	check("employee_schedule_assignments_revision_check", sql`revision > 0`),
]);

export const biometricDevices = pgTable("biometric_devices", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	code: text().notNull(),
	name: text().notNull(),
	status: text().default('active').notNull(),
	revision: integer().default(1).notNull(),
	updatedBy: uuid("updated_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "biometric_devices_organization_id_fkey"
		}),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [authUsers.id],
			name: "biometric_devices_updated_by_fkey"
		}),
	unique("biometric_devices_organization_id_code_key").on(table.code, table.organizationId),
	unique("biometric_devices_organization_id_id_key").on(table.id, table.organizationId),
	check("biometric_devices_names_check", sql`(length(btrim(code)) > 0) AND (length(btrim(name)) > 0)`),
	check("biometric_devices_revision_check", sql`revision > 0`),
	check("biometric_devices_status_check", sql`status = ANY (ARRAY['active'::text, 'inactive'::text])`),
]);

export const employmentVersions = pgTable("employment_versions", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	employeeId: uuid("employee_id").notNull(),
	departmentId: uuid("department_id"),
	positionId: uuid("position_id"),
	effectiveFrom: date("effective_from").notNull(),
	effectiveTo: date("effective_to"),
	employmentType: text("employment_type").notNull(),
	employmentStatus: text("employment_status").notNull(),
	hireDate: date("hire_date").notNull(),
	regularizationDate: date("regularization_date"),
	terminationDate: date("termination_date"),
	payType: text("pay_type").notNull(),
	payFrequency: text("pay_frequency").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	basicRateCentavos: bigint("basic_rate_centavos", { mode: "number" }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedBy: uuid("updated_by"),
}, (table): PgTableExtraConfigValue[] => [
	index("employment_employee_idx").using("btree", table.organizationId.asc().nullsLast().op("date_ops"), table.employeeId.asc().nullsLast().op("uuid_ops"), table.effectiveFrom.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.organizationId, table.departmentId],
			foreignColumns: [departments.id, departments.organizationId],
			name: "employment_versions_organization_id_department_id_fkey"
		}),
	foreignKey({
			columns: [table.organizationId, table.employeeId],
			foreignColumns: [employees.id, employees.organizationId],
			name: "employment_versions_organization_id_employee_id_fkey"
		}),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "employment_versions_organization_id_fkey"
		}),
	foreignKey({
			columns: [table.organizationId, table.positionId],
			foreignColumns: [positions.id, positions.organizationId],
			name: "employment_versions_organization_id_position_id_fkey"
		}),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [authUsers.id],
			name: "employment_versions_updated_by_fkey"
		}),
	unique("employment_versions_employee_id_effective_from_key").on(table.effectiveFrom, table.employeeId),
	check("employment_versions_basic_rate_centavos_check", sql`(basic_rate_centavos >= 0) AND (basic_rate_centavos <= '9007199254740991'::bigint)`),
	check("employment_versions_check", sql`effective_to > effective_from`),
	check("employment_versions_check1", sql`regularization_date >= hire_date`),
	check("employment_versions_check2", sql`termination_date >= hire_date`),
	check("employment_versions_employment_status_check", sql`employment_status = ANY (ARRAY['active'::text, 'inactive'::text, 'on_leave'::text, 'terminated'::text])`),
	check("employment_versions_employment_type_check", sql`employment_type = ANY (ARRAY['regular'::text, 'probationary'::text, 'contractual'::text, 'project_based'::text, 'part_time'::text])`),
	check("employment_versions_pay_frequency_check", sql`pay_frequency = ANY (ARRAY['monthly'::text, 'semi_monthly'::text, 'weekly'::text, 'biweekly'::text])`),
	check("employment_versions_pay_type_check", sql`pay_type = ANY (ARRAY['monthly'::text, 'daily'::text, 'hourly'::text])`),
]);

export const biometricMappings = pgTable("biometric_mappings", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	employeeId: uuid("employee_id").notNull(),
	deviceId: uuid("device_id").notNull(),
	deviceEmployeeId: text("device_employee_id").notNull(),
	status: text().default('active').notNull(),
	revision: integer().default(1).notNull(),
	updatedBy: uuid("updated_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	index("mappings_employee_idx").using("btree", table.organizationId.asc().nullsLast().op("uuid_ops"), table.employeeId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.organizationId, table.deviceId],
			foreignColumns: [biometricDevices.id, biometricDevices.organizationId],
			name: "biometric_mappings_organization_id_device_id_fkey"
		}),
	foreignKey({
			columns: [table.organizationId, table.employeeId],
			foreignColumns: [employees.id, employees.organizationId],
			name: "biometric_mappings_organization_id_employee_id_fkey"
		}),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "biometric_mappings_organization_id_fkey"
		}),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [authUsers.id],
			name: "biometric_mappings_updated_by_fkey"
		}),
	unique("biometric_mappings_device_id_device_employee_id_key").on(table.deviceEmployeeId, table.deviceId),
	check("biometric_mappings_device_employee_id_check", sql`length(btrim(device_employee_id)) > 0`),
	check("biometric_mappings_revision_check", sql`revision > 0`),
	check("biometric_mappings_status_check", sql`status = ANY (ARRAY['active'::text, 'inactive'::text])`),
]);

export const syncOutbox = pgTable("sync_outbox", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	entityType: text("entity_type").notNull(),
	entityId: uuid("entity_id").notNull(),
	operation: text().notNull(),
	revision: integer().notNull(),
	payloadVersion: integer("payload_version").default(1).notNull(),
	payload: jsonb().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	attemptCount: integer("attempt_count").default(0).notNull(),
	lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true, mode: 'string' }),
	status: text().default('pending').notNull(),
	error: text(),
}, (table): PgTableExtraConfigValue[] => [
	index("outbox_pending_idx").using("btree", table.organizationId.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("uuid_ops"), table.createdAt.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "sync_outbox_organization_id_fkey"
		}),
	unique("sync_outbox_entity_type_entity_id_revision_key").on(table.entityId, table.entityType, table.revision),
	check("sync_outbox_attempt_count_check", sql`attempt_count >= 0`),
	check("sync_outbox_operation_check", sql`operation = ANY (ARRAY['CREATE'::text, 'UPDATE'::text, 'ARCHIVE'::text])`),
	check("sync_outbox_payload_check", sql`(jsonb_typeof(payload) = 'object'::text) AND (octet_length((payload)::text) <= 262144)`),
	check("sync_outbox_revision_check", sql`revision > 0`),
	check("sync_outbox_status_check", sql`status = ANY (ARRAY['pending'::text, 'processing'::text, 'synced'::text, 'failed'::text])`),
	check("sync_outbox_version_check", sql`payload_version > 0`),
]);

export const timeRecords = pgTable("time_records", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	employeeId: uuid("employee_id").notNull(),
	recordedAt: timestamp("recorded_at", { withTimezone: true, mode: 'string' }).notNull(),
	recordType: text("record_type").notNull(),
	source: text().notNull(),
	deviceId: uuid("device_id"),
	deviceEmployeeId: text("device_employee_id"),
	externalRecordId: text("external_record_id"),
	reason: text(),
	createdBy: uuid("created_by").notNull(),
	revision: integer().default(1).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	index("time_records_employee_date_idx").using("btree", table.organizationId.asc().nullsLast().op("uuid_ops"), table.employeeId.asc().nullsLast().op("uuid_ops"), table.recordedAt.asc().nullsLast().op("timestamptz_ops")),
	uniqueIndex("time_records_external_unique").using("btree", table.deviceId.asc().nullsLast().op("uuid_ops"), table.externalRecordId.asc().nullsLast().op("uuid_ops")).where(sql`(external_record_id IS NOT NULL)`),
	uniqueIndex("time_records_fallback_unique").using("btree", table.deviceId.asc().nullsLast().op("uuid_ops"), table.deviceEmployeeId.asc().nullsLast().op("uuid_ops"), table.recordedAt.asc().nullsLast().op("text_ops"), table.recordType.asc().nullsLast().op("uuid_ops")).where(sql`((external_record_id IS NULL) AND (device_id IS NOT NULL))`),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [authUsers.id],
			name: "time_records_created_by_fkey"
		}),
	foreignKey({
			columns: [table.organizationId, table.deviceId],
			foreignColumns: [biometricDevices.id, biometricDevices.organizationId],
			name: "time_records_organization_id_device_id_fkey"
		}),
	foreignKey({
			columns: [table.organizationId, table.employeeId],
			foreignColumns: [employees.id, employees.organizationId],
			name: "time_records_organization_id_employee_id_fkey"
		}),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "time_records_organization_id_fkey"
		}),
	unique("time_records_organization_id_id_key").on(table.id, table.organizationId),
	check("time_records_check", sql`(source <> 'manual'::text) OR (length(btrim(reason)) > 0)`),
	check("time_records_check1", sql`(source <> 'biometric'::text) OR ((device_id IS NOT NULL) AND (device_employee_id IS NOT NULL))`),
	check("time_records_check2", sql`(source <> 'manual'::text) OR ((reason IS NOT NULL) AND (length(btrim(reason)) > 0))`),
	check("time_records_record_type_check", sql`record_type = ANY (ARRAY['in'::text, 'out'::text, 'break_out'::text, 'break_in'::text, 'unknown'::text])`),
	check("time_records_revision_check", sql`revision = 1`),
	check("time_records_source_check", sql`source = ANY (ARRAY['biometric'::text, 'manual'::text, 'import'::text, 'system'::text])`),
]);

export const biometricIngestionState = pgTable("biometric_ingestion_state", {
	deviceId: uuid("device_id").primaryKey().notNull(),
	lastIngestionAt: timestamp("last_ingestion_at", { withTimezone: true, mode: 'string' }).notNull(),
	lastRecordAt: timestamp("last_record_at", { withTimezone: true, mode: 'string' }),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.deviceId],
			foreignColumns: [biometricDevices.id],
			name: "biometric_ingestion_state_device_id_fkey"
		}),
]);

export const timeRecordCorrections = pgTable("time_record_corrections", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	timeRecordId: uuid("time_record_id").notNull(),
	operation: text().notNull(),
	recordedAt: timestamp("recorded_at", { withTimezone: true, mode: 'string' }),
	recordType: text("record_type"),
	reason: text().notNull(),
	revision: integer().notNull(),
	createdBy: uuid("created_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [authUsers.id],
			name: "time_record_corrections_created_by_fkey"
		}),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "time_record_corrections_organization_id_fkey"
		}),
	foreignKey({
			columns: [table.organizationId, table.timeRecordId],
			foreignColumns: [timeRecords.id, timeRecords.organizationId],
			name: "time_record_corrections_organization_id_time_record_id_fkey"
		}),
	unique("time_record_corrections_time_record_id_revision_key").on(table.revision, table.timeRecordId),
	check("time_record_corrections_check", sql`(operation = 'void'::text) OR ((recorded_at IS NOT NULL) AND (record_type IS NOT NULL))`),
	check("time_record_corrections_operation_check", sql`operation = ANY (ARRAY['replace'::text, 'void'::text])`),
	check("time_record_corrections_reason_check", sql`length(btrim(reason)) > 0`),
	check("time_record_corrections_record_type_check", sql`record_type = ANY (ARRAY['in'::text, 'out'::text, 'break_out'::text, 'break_in'::text, 'unknown'::text])`),
	check("time_record_corrections_revision_check", sql`revision > 0`),
]);

export const attendanceRecords = pgTable("attendance_records", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	employeeId: uuid("employee_id").notNull(),
	workDate: date("work_date").notNull(),
	scheduleAssignmentId: uuid("schedule_assignment_id"),
	scheduleVersionId: uuid("schedule_version_id"),
	firstIn: timestamp("first_in", { withTimezone: true, mode: 'string' }),
	lastOut: timestamp("last_out", { withTimezone: true, mode: 'string' }),
	workedMinutes: integer("worked_minutes").default(0).notNull(),
	lateMinutes: integer("late_minutes").default(0).notNull(),
	undertimeMinutes: integer("undertime_minutes").default(0).notNull(),
	attendanceStatus: text("attendance_status").notNull(),
	approvalStatus: text("approval_status").default('unreviewed').notNull(),
	inputHash: text("input_hash").notNull(),
	result: jsonb().notNull(),
	approvedBy: uuid("approved_by"),
	approvedAt: timestamp("approved_at", { withTimezone: true, mode: 'string' }),
	revision: integer().default(1).notNull(),
	updatedBy: uuid("updated_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	index("attendance_date_idx").using("btree", table.organizationId.asc().nullsLast().op("date_ops"), table.workDate.asc().nullsLast().op("uuid_ops"), table.attendanceStatus.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.approvedBy],
			foreignColumns: [authUsers.id],
			name: "attendance_records_approved_by_fkey"
		}),
	foreignKey({
			columns: [table.organizationId, table.employeeId],
			foreignColumns: [employees.id, employees.organizationId],
			name: "attendance_records_organization_id_employee_id_fkey"
		}),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "attendance_records_organization_id_fkey"
		}),
	foreignKey({
			columns: [table.organizationId, table.scheduleAssignmentId],
			foreignColumns: [employeeScheduleAssignments.id, employeeScheduleAssignments.organizationId],
			name: "attendance_records_organization_id_schedule_assignment_id_fkey"
		}),
	foreignKey({
			columns: [table.organizationId, table.scheduleVersionId],
			foreignColumns: [workScheduleVersions.id, workScheduleVersions.organizationId],
			name: "attendance_records_organization_id_schedule_version_id_fkey"
		}),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [authUsers.id],
			name: "attendance_records_updated_by_fkey"
		}),
	unique("attendance_records_organization_id_employee_id_work_date_key").on(table.employeeId, table.organizationId, table.workDate),
	unique("attendance_records_organization_id_id_key").on(table.id, table.organizationId),
	check("attendance_records_approval_status_check", sql`approval_status = ANY (ARRAY['unreviewed'::text, 'approved'::text, 'needs_review'::text])`),
	check("attendance_records_attendance_status_check", sql`attendance_status = ANY (ARRAY['present'::text, 'late'::text, 'absent'::text, 'on_leave'::text, 'rest_day'::text, 'incomplete'::text])`),
	check("attendance_records_late_minutes_check", sql`late_minutes >= 0`),
	check("attendance_records_revision_check", sql`revision > 0`),
	check("attendance_records_undertime_minutes_check", sql`undertime_minutes >= 0`),
	check("attendance_records_worked_minutes_check", sql`worked_minutes >= 0`),
]);

export const leaveTypes = pgTable("leave_types", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	code: text().notNull(),
	name: text().notNull(),
	description: text(),
	paid: boolean().notNull(),
	requiresApproval: boolean("requires_approval").default(true).notNull(),
	status: text().default('active').notNull(),
	revision: integer().default(1).notNull(),
	updatedBy: uuid("updated_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	uniqueIndex("leave_types_code_unique").using("btree", sql`organization_id`, sql`lower(code)`),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "leave_types_organization_id_fkey"
		}),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [authUsers.id],
			name: "leave_types_updated_by_fkey"
		}),
	unique("leave_types_organization_id_id_key").on(table.id, table.organizationId),
	check("leave_types_code_check", sql`length(btrim(code)) > 0`),
	check("leave_types_name_check", sql`length(btrim(name)) > 0`),
	check("leave_types_revision_check", sql`revision > 0`),
	check("leave_types_status_check", sql`status = ANY (ARRAY['active'::text, 'inactive'::text])`),
]);

export const leaveRequests = pgTable("leave_requests", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	employeeId: uuid("employee_id").notNull(),
	leaveTypeId: uuid("leave_type_id").notNull(),
	startDate: date("start_date").notNull(),
	endDate: date("end_date").notNull(),
	durationType: text("duration_type").notNull(),
	reason: text().notNull(),
	status: text().notNull(),
	typeSnapshot: jsonb("type_snapshot").notNull(),
	requestedBy: uuid("requested_by").notNull(),
	requestedAt: timestamp("requested_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	approvedBy: uuid("approved_by"),
	approvedAt: timestamp("approved_at", { withTimezone: true, mode: 'string' }),
	rejectedBy: uuid("rejected_by"),
	rejectedAt: timestamp("rejected_at", { withTimezone: true, mode: 'string' }),
	cancelledBy: uuid("cancelled_by"),
	cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: 'string' }),
	remarks: text(),
	revision: integer().default(1).notNull(),
	updatedBy: uuid("updated_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	index("leave_employee_dates_idx").using("btree", table.organizationId.asc().nullsLast().op("uuid_ops"), table.employeeId.asc().nullsLast().op("uuid_ops"), table.startDate.asc().nullsLast().op("date_ops"), table.endDate.asc().nullsLast().op("uuid_ops")),
	index("leave_pending_idx").using("btree", table.organizationId.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("date_ops"), table.startDate.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.approvedBy],
			foreignColumns: [authUsers.id],
			name: "leave_requests_approved_by_fkey"
		}),
	foreignKey({
			columns: [table.cancelledBy],
			foreignColumns: [authUsers.id],
			name: "leave_requests_cancelled_by_fkey"
		}),
	foreignKey({
			columns: [table.organizationId, table.employeeId],
			foreignColumns: [employees.id, employees.organizationId],
			name: "leave_requests_organization_id_employee_id_fkey"
		}),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "leave_requests_organization_id_fkey"
		}),
	foreignKey({
			columns: [table.organizationId, table.leaveTypeId],
			foreignColumns: [leaveTypes.id, leaveTypes.organizationId],
			name: "leave_requests_organization_id_leave_type_id_fkey"
		}),
	foreignKey({
			columns: [table.rejectedBy],
			foreignColumns: [authUsers.id],
			name: "leave_requests_rejected_by_fkey"
		}),
	foreignKey({
			columns: [table.requestedBy],
			foreignColumns: [authUsers.id],
			name: "leave_requests_requested_by_fkey"
		}),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [authUsers.id],
			name: "leave_requests_updated_by_fkey"
		}),
	unique("leave_requests_organization_id_id_key").on(table.id, table.organizationId),
	check("leave_requests_check", sql`end_date >= start_date`),
	check("leave_requests_check1", sql`(duration_type = 'full_day'::text) OR (start_date = end_date)`),
	check("leave_requests_duration_type_check", sql`duration_type = ANY (ARRAY['full_day'::text, 'first_half'::text, 'second_half'::text])`),
	check("leave_requests_reason_check", sql`length(btrim(reason)) > 0`),
	check("leave_requests_revision_check", sql`revision > 0`),
	check("leave_requests_status_check", sql`status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text])`),
]);

export const attendanceProcessingJobs = pgTable("attendance_processing_jobs", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	employeeId: uuid("employee_id").notNull(),
	startDate: date("start_date").notNull(),
	endDate: date("end_date").notNull(),
	nextDate: date("next_date").notNull(),
	requestedBy: uuid("requested_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastError: text("last_error"),
	priority: smallint().default(0).notNull(),
	lastProcessedAt: timestamp("last_processed_at", { withTimezone: true, mode: 'string' }),
	reason: text(),
}, (table): PgTableExtraConfigValue[] => [
	index("attendance_jobs_claim_idx").using("btree", sql`priority`, sql`COALESCE(last_processed_at, created_at)`, sql`id`).where(sql`(last_error IS NULL)`),
	index("attendance_jobs_pending_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.organizationId, table.employeeId],
			foreignColumns: [employees.id, employees.organizationId],
			name: "attendance_processing_jobs_organization_id_employee_id_fkey"
		}),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "attendance_processing_jobs_organization_id_fkey"
		}),
	foreignKey({
			columns: [table.requestedBy],
			foreignColumns: [authUsers.id],
			name: "attendance_processing_jobs_requested_by_fkey"
		}),
	check("attendance_processing_jobs_check", sql`end_date >= start_date`),
]);

export const attendanceProcessingCursors = pgTable("attendance_processing_cursors", {
	organizationId: uuid("organization_id").primaryKey().notNull(),
	nextDate: date("next_date").notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "attendance_processing_cursors_organization_id_fkey"
		}),
]);

export const attendanceHistory = pgTable("attendance_history", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	attendanceId: uuid("attendance_id").notNull(),
	revision: integer().notNull(),
	snapshot: jsonb().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.organizationId, table.attendanceId],
			foreignColumns: [attendanceRecords.id, attendanceRecords.organizationId],
			name: "attendance_history_organization_id_attendance_id_fkey"
		}),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "attendance_history_organization_id_fkey"
		}),
	unique("attendance_history_attendance_id_revision_key").on(table.attendanceId, table.revision),
]);

export const attendanceAdjustments = pgTable("attendance_adjustments", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	attendanceId: uuid("attendance_id").notNull(),
	overrides: jsonb().notNull(),
	reason: text().notNull(),
	revision: integer().notNull(),
	createdBy: uuid("created_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [authUsers.id],
			name: "attendance_adjustments_created_by_fkey"
		}),
	foreignKey({
			columns: [table.organizationId, table.attendanceId],
			foreignColumns: [attendanceRecords.id, attendanceRecords.organizationId],
			name: "attendance_adjustments_organization_id_attendance_id_fkey"
		}),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "attendance_adjustments_organization_id_fkey"
		}),
	unique("attendance_adjustments_attendance_id_revision_key").on(table.attendanceId, table.revision),
	check("attendance_adjustments_reason_check", sql`length(btrim(reason)) > 0`),
	check("attendance_adjustments_revision_check", sql`revision > 0`),
]);

export const workScheduleVersions = pgTable("work_schedule_versions", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	scheduleId: uuid("schedule_id").notNull(),
	effectiveFrom: date("effective_from").notNull(),
	reason: text(),
	timezone: text().notNull(),
	revision: integer().default(1).notNull(),
	createdBy: uuid("created_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	name: text().notNull(),
	code: text().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [authUsers.id],
			name: "work_schedule_versions_created_by_fkey"
		}),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "work_schedule_versions_organization_id_fkey"
		}),
	foreignKey({
			columns: [table.organizationId, table.scheduleId],
			foreignColumns: [workSchedules.id, workSchedules.organizationId],
			name: "work_schedule_versions_organization_id_schedule_id_fkey"
		}),
	unique("work_schedule_versions_organization_id_id_key").on(table.id, table.organizationId),
	unique("work_schedule_versions_schedule_id_effective_from_key").on(table.effectiveFrom, table.scheduleId),
	check("work_schedule_versions_code_check", sql`length(btrim(code)) > 0`),
	check("work_schedule_versions_name_check", sql`length(btrim(name)) > 0`),
	check("work_schedule_versions_revision_check", sql`revision = 1`),
]);

export const workScheduleDays = pgTable("work_schedule_days", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	versionId: uuid("version_id").notNull(),
	dayOfWeek: integer("day_of_week").notNull(),
	isWorkDay: boolean("is_work_day").notNull(),
	startTime: time("start_time"),
	endTime: time("end_time"),
	endDayOffset: integer("end_day_offset").default(0).notNull(),
	breakStart: time("break_start"),
	breakEnd: time("break_end"),
	breakStartDayOffset: integer("break_start_day_offset").default(0).notNull(),
	breakEndDayOffset: integer("break_end_day_offset").default(0).notNull(),
	graceMinutes: integer("grace_minutes").default(0).notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "work_schedule_days_organization_id_fkey"
		}),
	foreignKey({
			columns: [table.organizationId, table.versionId],
			foreignColumns: [workScheduleVersions.id, workScheduleVersions.organizationId],
			name: "work_schedule_days_organization_id_version_id_fkey"
		}),
	unique("work_schedule_days_version_id_day_of_week_key").on(table.dayOfWeek, table.versionId),
	check("schedule_break_absolute_bounds", sql`(break_start IS NULL) OR ((((break_start - start_time) + ((break_start_day_offset)::double precision * '1 day'::interval)) >= '00:00:00'::interval) AND (((break_end - end_time) + (((break_end_day_offset - end_day_offset))::double precision * '1 day'::interval)) <= '00:00:00'::interval) AND (((break_end - break_start) + (((break_end_day_offset - break_start_day_offset))::double precision * '1 day'::interval)) < ((end_time - start_time) + ((end_day_offset)::double precision * '1 day'::interval))))`),
	check("schedule_break_pair", sql`((break_start IS NULL) AND (break_end IS NULL)) OR ((break_start IS NOT NULL) AND (break_end IS NOT NULL) AND (start_time IS NOT NULL) AND (end_time IS NOT NULL) AND (((break_end - break_start) + (((break_end_day_offset - break_start_day_offset))::double precision * '1 day'::interval)) > '00:00:00'::interval))`),
	check("work_schedule_days_break_end_day_offset_check", sql`break_end_day_offset = ANY (ARRAY[0, 1])`),
	check("work_schedule_days_break_start_day_offset_check", sql`break_start_day_offset = ANY (ARRAY[0, 1])`),
	check("work_schedule_days_check", sql`(NOT is_work_day) OR ((start_time IS NOT NULL) AND (end_time IS NOT NULL) AND (((end_time - start_time) + ((end_day_offset)::double precision * '1 day'::interval)) > '00:00:00'::interval) AND (((end_time - start_time) + ((end_day_offset)::double precision * '1 day'::interval)) <= '24:00:00'::interval))`),
	check("work_schedule_days_check1", sql`is_work_day OR ((start_time IS NULL) AND (end_time IS NULL) AND (break_start IS NULL) AND (break_end IS NULL))`),
	check("work_schedule_days_day_of_week_check", sql`(day_of_week >= 0) AND (day_of_week <= 6)`),
	check("work_schedule_days_end_day_offset_check", sql`end_day_offset = ANY (ARRAY[0, 1])`),
	check("work_schedule_days_grace_minutes_check", sql`(grace_minutes >= 0) AND (grace_minutes <= 240)`),
]);

export const userRoles = pgTable("user_roles", {
	userId: uuid("user_id").notNull(),
	roleId: uuid("role_id").notNull(),
}, (table): PgTableExtraConfigValue[] => [
	index("user_roles_role_idx").using("btree", table.roleId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.roleId],
			foreignColumns: [roles.id],
			name: "user_roles_role_id_fkey"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [authUsers.id],
			name: "user_roles_user_id_fkey"
		}),
	primaryKey({ columns: [table.roleId, table.userId], name: "user_roles_pkey"}),
]);

export const rolePermissions = pgTable("role_permissions", {
	roleId: uuid("role_id").notNull(),
	permissionCode: text("permission_code").notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.permissionCode],
			foreignColumns: [permissions.code],
			name: "role_permissions_permission_code_fkey"
		}),
	foreignKey({
			columns: [table.roleId],
			foreignColumns: [roles.id],
			name: "role_permissions_role_id_fkey"
		}),
	primaryKey({ columns: [table.permissionCode, table.roleId], name: "role_permissions_pkey"}),
]);
