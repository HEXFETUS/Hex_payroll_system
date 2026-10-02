import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import type { Server } from 'node:http';
import { z } from 'zod';
import {
  employeeInputSchema,
  employmentInputSchema,
  payrollConfigurationSchema,
  decimalStringToCentavos,
  centavosToDecimalString,
  permissionCodes,
} from '@hexpayroll/shared';
import { createAuthService } from '../src/auth/service.js';
import { createAuthRouter } from '../src/routes/auth.js';
import { createFoundationRouter } from '../src/foundation/router.js';
import { migrate } from '../src/db/migrate.js';
import { databaseFixture, databaseTestsEnabled } from './database-fixture.js';
import {
  project,
  transaction,
  insert,
  audit,
  outbox,
  getActor,
} from '../src/foundation/repository.js';
test('foundation validates real dates, controlled values, integer money and cutoff coverage', () => {
  const person = { employeeNumber: 'EMP-01', firstName: 'Ana', lastName: 'Reyes' };
  assert.equal(
    employeeInputSchema.safeParse({ ...person, birthDate: '2026-02-30' }).success,
    false,
  );
  assert.equal(employeeInputSchema.safeParse({ ...person, status: 'deleted' }).success, false);
  assert.equal(decimalStringToCentavos('25000.00'), 2500000);
  assert.equal(centavosToDecimalString(2500000), '25000.00');
  assert.throws(() => decimalStringToCentavos('1.001'));
  const job = {
    effectiveFrom: '2026-01-01',
    hireDate: '2026-01-01',
    employmentType: 'regular',
    employmentStatus: 'active',
    payType: 'monthly',
    payFrequency: 'semi_monthly',
    basicRateCentavos: 2500000,
  };
  assert.equal(employmentInputSchema.safeParse({ ...job, basicRateCentavos: 0.1 }).success, false);
  assert.equal(
    employmentInputSchema.safeParse({ ...job, terminationDate: '2025-12-31' }).success,
    false,
  );
  const config = {
    payFrequency: 'semi_monthly',
    cutoffs: [
      { startDay: 1, endDay: 15 },
      { startDay: 16, endDay: 'end_of_month' },
    ],
    workWeekdays: [1, 2, 3, 4, 5],
    workStart: '08:00',
    workEnd: '17:00',
    breakMinutes: 60,
    standardMinutesPerDay: 480,
    graceMinutes: 0,
    lateEnabled: false,
    undertimeEnabled: false,
    overtimeEnabled: false,
    roundingMode: 'none',
    roundingIncrementMinutes: 1,
  };
  assert.equal(payrollConfigurationSchema.safeParse(config).success, true);
  assert.equal(
    payrollConfigurationSchema.safeParse({
      ...config,
      cutoffs: [
        { startDay: 1, endDay: 15 },
        { startDay: 17, endDay: 'end_of_month' },
      ],
    }).success,
    false,
  );
  assert.equal(
    payrollConfigurationSchema.safeParse({
      ...config,
      payFrequency: 'biweekly',
      cutoffs: [],
      weekday: 5,
    }).success,
    false,
  );
  assert.equal(
    payrollConfigurationSchema.safeParse({
      ...config,
      payFrequency: 'biweekly',
      cutoffs: [],
      weekday: 5,
      anchorDate: '2026-10-02',
    }).success,
    true,
  );
  const viewer = {
    id: 'id',
    organizationId: 'org',
    permissions: ['employees.view'],
    roles: ['viewer'],
  };
  const projected = project(
    { id: 'employee', firstName: 'Ana', tin: 'secret', sssNumber: 'secret', basicRateCentavos: 25 },
    viewer,
  );
  assert.equal(projected.firstName, 'Ana');
  assert(!('tin' in projected));
  assert(!('basicRateCentavos' in projected));
});
test(
  'Phase 1 PostgreSQL APIs, isolation, permissions, history and atomic audit/outbox',
  { skip: !databaseTestsEnabled },
  async () => {
    const fixture = await databaseFixture();
    const { runtime, migrator, migrations } = fixture;
    let server: Server | undefined;
    try {
      // Upgrade real Phase 0 account data rather than only testing a fresh schema.
      await migrate(migrator, migrations.slice(0, 1));
      const { hashPassword } = await import('../src/auth/password.js');
      const password = 'a secure payroll test password';
      const old = await runtime.query<{ id: string }>(
        'INSERT INTO auth_users(id,username,display_name,password_hash) VALUES(uuidv7(),$1,$2,$3) RETURNING id',
        ['admin', 'Administrator', await hashPassword(password)],
      );
      const adminId = old.rows[0]!.id;
      await migrate(migrator, migrations);
      assert.deepEqual(await migrate(migrator, migrations), []);
      assert.equal(
        (await runtime.query('SELECT id FROM auth_users WHERE id=$1', [adminId])).rowCount,
        1,
      );
      await assert.rejects(
        () => runtime.query('CREATE TABLE forbidden(id int)'),
        (e) => Boolean(e && typeof e === 'object' && 'code' in e && e.code === '42501'),
      );
      await runtime.query(
        "INSERT INTO user_roles SELECT $1,id FROM roles WHERE code='administrator'",
        [adminId],
      );
      await runtime.query('UPDATE application_setup SET administrator_id=$1 WHERE singleton', [
        adminId,
      ]);
      const auth = createAuthService(runtime);
      const session = await auth.login({ identifier: 'admin', password });
      assert(session);
      assert(session.user.permissions?.includes('roles.manage'));
      const app = express();
      app.use('/api/auth', createAuthRouter(auth));
      app.use(express.json());
      app.use('/api', createFoundationRouter(runtime));
      server = app.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      assert(address && typeof address === 'object');
      const base = `http://127.0.0.1:${address.port}/api/`;
      async function request(
        path: string,
        method = 'GET',
        body?: unknown,
        token = session!.accessToken,
      ) {
        const response = await fetch(base + path, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return {
          status: response.status,
          data: (await response.json()) as Record<string, unknown>,
        };
      }
      assert.equal((await request('employees')).status, 409);
      const setup = await request('organization/setup', 'POST', {
        legalName: 'Integration Test Company',
      });
      assert.equal(setup.status, 201, JSON.stringify(setup.data));
      const org = String(setup.data.id);
      assert.equal((await request('organization')).data.legalName, 'Integration Test Company');
      assert.equal(
        (await request('organization/setup', 'POST', { legalName: 'Duplicate' })).status,
        409,
      );
      const department = await request('departments', 'POST', {
        code: 'HR',
        name: 'Human Resources',
      });
      assert.equal(department.status, 201, JSON.stringify(department.data));
      assert.equal(
        (await request('departments', 'POST', { code: 'hr', name: 'Duplicate' })).status,
        409,
      );
      const position = await request('positions', 'POST', {
        code: 'OFFICER',
        name: 'HR Officer',
        departmentId: department.data.id,
      });
      assert.equal(position.status, 201);
      const employee = await request('employees', 'POST', {
        employeeNumber: 'EMP-01',
        firstName: 'Ana',
        lastName: 'Reyes',
        tin: 'private-tin',
        birthDate: '1990-01-01',
      });
      assert.equal(employee.status, 201, JSON.stringify(employee.data));
      assert.equal(employee.data.birthDate, '1990-01-01');
      const employeeId = String(employee.data.id);
      assert.equal(
        (
          await request('employees', 'POST', {
            employeeNumber: 'emp-01',
            firstName: 'Duplicate',
            lastName: 'Employee',
          })
        ).status,
        409,
      );
      const job = {
        departmentId: department.data.id,
        positionId: position.data.id,
        effectiveFrom: '2026-01-01',
        hireDate: '2026-01-01',
        employmentType: 'regular',
        employmentStatus: 'active',
        payType: 'monthly',
        payFrequency: 'semi_monthly',
        basicRateCentavos: 2500000,
      };
      assert.equal(
        (
          await request(`employees/${employeeId}/employment`, 'POST', {
            ...job,
            expectedRevision: 1,
          })
        ).status,
        201,
      );
      assert.equal(
        (
          await request(`employees/${employeeId}/employment`, 'POST', {
            ...job,
            effectiveFrom: '2026-02-01',
            basicRateCentavos: 2600000,
            expectedRevision: 2,
          })
        ).status,
        201,
      );
      const history = await request(`employees/${employeeId}`);
      assert.equal(history.status, 200);
      const versions = z
        .array(
          z.object({
            effectiveFrom: z.string(),
            effectiveTo: z.string().nullable(),
            basicRateCentavos: z.number(),
          }),
        )
        .parse(history.data.employmentVersions);
      assert.equal(versions.length, 2);
      assert.equal(versions[1]?.effectiveTo, '2026-02-01');
      await assert.rejects(
        () =>
          runtime.query(
            "INSERT INTO employment_versions(organization_id,employee_id,effective_from,effective_to,employment_type,employment_status,hire_date,pay_type,pay_frequency,basic_rate_centavos) VALUES($1,$2,'2026-01-15','2026-03-01','regular','active','2026-01-01','monthly','semi_monthly',100)",
            [org, employeeId],
          ),
        (error) =>
          Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23514'),
      );
      const device = await request('biometric-devices', 'POST', {
        code: 'DEVICE-1',
        name: 'Office Device',
      });
      assert.equal(device.status, 201);
      const mapping = await request('biometric-mappings', 'POST', {
        employeeId,
        deviceId: device.data.id,
        deviceEmployeeId: '123',
      });
      assert.equal(mapping.status, 201);
      assert.equal(
        (
          await request('biometric-mappings', 'POST', {
            employeeId,
            deviceId: device.data.id,
            deviceEmployeeId: '123',
          })
        ).status,
        409,
      );
      assert.equal((await request('payroll-config')).data.configured, false);
      const configuration = {
        payFrequency: 'semi_monthly',
        cutoffs: [
          { startDay: 1, endDay: 15 },
          { startDay: 16, endDay: 'end_of_month' },
        ],
        workWeekdays: [1, 2, 3, 4, 5],
        workStart: '08:00',
        workEnd: '17:00',
        breakMinutes: 60,
        standardMinutesPerDay: 480,
        graceMinutes: 0,
        lateEnabled: false,
        undertimeEnabled: false,
        overtimeEnabled: false,
        roundingMode: 'none',
        roundingIncrementMinutes: 1,
      };
      assert.equal(
        (await request('payroll-config', 'PUT', { configuration, expectedRevision: null })).status,
        200,
      );
      assert.equal(
        (await request('payroll-config', 'PUT', { configuration, expectedRevision: null })).status,
        409,
      );
      assert.equal(
        (
          await request('payroll-config', 'PUT', {
            configuration: { ...configuration, graceMinutes: 5 },
            expectedRevision: 1,
          })
        ).status,
        200,
      );
      const customRole = await request('roles', 'POST', {
        code: 'hr_reader',
        name: 'HR Reader',
        permissions: ['employees.view'],
      });
      assert.equal(customRole.status, 201);
      assert.equal(
        (
          await request('roles/' + customRole.data.id, 'PUT', {
            code: 'hr_reader',
            name: 'HR Reader Updated',
            permissions: ['employees.view', 'departments.view'],
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await request(`employees/${employeeId}/employment`, 'POST', {
            ...job,
            expectedRevision: 3,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await request(`employees/${employeeId}`, 'PUT', {
            employeeNumber: 'EMP-01',
            firstName: 'Stale',
            lastName: 'Reyes',
            expectedRevision: 1,
          })
        ).status,
        409,
      );
      const viewer = await auth.createUser({ username: 'viewer', displayName: 'Viewer', password });
      const viewerSession = await auth.login({ identifier: 'viewer', password });
      assert(viewerSession);
      assert.equal(
        (
          await request(
            'departments',
            'POST',
            { code: 'BAD', name: 'No permission' },
            viewerSession.accessToken,
          )
        ).status,
        403,
      );
      const viewerProfile = await request(
        `employees/${employeeId}`,
        'GET',
        undefined,
        viewerSession.accessToken,
      );
      assert.equal(viewerProfile.status, 200);
      assert(!JSON.stringify(viewerProfile.data).includes('private-tin'));
      assert(!JSON.stringify(viewerProfile.data).includes('basicRateCentavos'));
      const viewerList = await request('employees', 'GET', undefined, viewerSession.accessToken);
      assert.equal(viewerList.status, 200);
      assert(!JSON.stringify(viewerList.data).includes('private-tin'));
      assert.equal(
        (await request('users', 'GET', undefined, viewerSession.accessToken)).status,
        403,
      );
      const otherOrg = await migrator.query<{ id: string }>(
        "INSERT INTO organizations(legal_name) VALUES('Other Company') RETURNING id",
      );
      const otherDep = await migrator.query<{ id: string }>(
        'INSERT INTO departments(organization_id,code,name) VALUES($1,$2,$3) RETURNING id',
        [otherOrg.rows[0]!.id, 'OTHER', 'Other'],
      );
      assert.equal((await request(`departments/${otherDep.rows[0]!.id}`)).status, 404);
      assert.equal(
        (
          await request('positions', 'POST', {
            code: 'CROSS',
            name: 'Invalid',
            departmentId: otherDep.rows[0]!.id,
          })
        ).status,
        400,
      );
      const roles = await runtime.query<{ id: string; code: string }>(
        "SELECT id,code FROM roles WHERE code IN ('administrator','viewer')",
      );
      const viewerRole = roles.rows.find((r) => r.code === 'viewer')!.id;
      const adminRole = roles.rows.find((r) => r.code === 'administrator')!.id;
      const beforeUser = (
        await runtime.query<{ revision: number }>('SELECT revision FROM auth_users WHERE id=$1', [
          adminId,
        ])
      ).rows[0]!;
      assert.equal(
        (
          await request(`users/${adminId}`, 'PUT', {
            username: 'admin',
            displayName: 'Administrator',
            active: false,
            roleIds: [adminRole],
            expectedRevision: beforeUser.revision,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await request(`users/${adminId}`, 'PUT', {
            username: 'admin',
            displayName: 'Administrator',
            active: true,
            roleIds: [viewerRole],
            expectedRevision: beforeUser.revision,
          })
        ).status,
        409,
      );
      const created = await request('users', 'POST', {
        username: 'new_user',
        displayName: 'New User',
        password,
        roleIds: [viewerRole],
      });
      assert.equal(created.status, 201, JSON.stringify(created.data));
      assert(!JSON.stringify(created.data).includes('password'));
      const newSession = await auth.login({ identifier: 'new_user', password });
      assert(newSession);
      assert.equal(
        (
          await request(`users/${created.data.id}`, 'PUT', {
            username: 'new_user',
            displayName: 'New User',
            active: false,
            roleIds: [viewerRole],
            expectedRevision: 1,
          })
        ).status,
        200,
      );
      assert.equal(await auth.session(newSession.accessToken), null);
      const logs = await request('audit');
      const timezoneEvent = await migrator.query<{ id: string }>(
        "INSERT INTO audit_events(organization_id,user_id,action,entity_type,entity_id,description,created_at) VALUES($1,$2,'LOGIN','auth_users',$2,'timezone fixture','2026-10-01T18:00:00Z') RETURNING id",
        [org, adminId],
      );
      const filteredAudit = await request('audit?from=2026-10-02&to=2026-10-02&pageSize=100');
      assert.equal(filteredAudit.status, 200);
      assert(
        z
          .array(z.object({ id: z.uuid() }))
          .parse(filteredAudit.data.items)
          .some((row) => row.id === timezoneEvent.rows[0]!.id),
      );
      assert.equal(logs.status, 200);
      assert(!JSON.stringify(logs.data).includes('private-tin'));
      assert(!JSON.stringify(logs.data).includes('passwordHash'));
      await assert.rejects(
        () => runtime.query('DELETE FROM audit_events'),
        (e) => Boolean(e && typeof e === 'object' && 'code' in e && e.code === '42501'),
      );
      await assert.rejects(
        () => runtime.query('UPDATE audit_events SET description=description'),
        (e) => Boolean(e && typeof e === 'object' && 'code' in e && e.code === '42501'),
      );
      await assert.rejects(
        () => runtime.query('TRUNCATE audit_events'),
        (e) => Boolean(e && typeof e === 'object' && 'code' in e && e.code === '42501'),
      );
      const actor = await getActor(runtime, adminId);
      // A failed audit insert must also roll back the preceding business insert.
      await migrator.query('REVOKE INSERT ON audit_events FROM hexpayroll_app');
      try {
        assert.equal(
          (await request('departments', 'POST', { code: 'AUDIT-FAIL', name: 'Must Roll Back' }))
            .status,
          500,
        );
        assert.equal(
          (await runtime.query("SELECT id FROM departments WHERE code='AUDIT-FAIL'")).rowCount,
          0,
        );
      } finally {
        await migrator.query('GRANT INSERT ON audit_events TO hexpayroll_app');
      }
      // Fail after business and audit writes: oversized outbox must roll both back.
      const auditsBefore = (
        await runtime.query<{ count: string }>('SELECT count(*) FROM audit_events')
      ).rows[0]!.count;
      await assert.rejects(() =>
        transaction(runtime, async (client) => {
          const row = await insert(client, 'departments', {
            organizationId: org,
            code: 'ROLLBACK',
            name: 'Rollback',
          });
          await audit(client, actor, 'CREATE', 'departments', row.id, ['name']);
          await outbox(client, 'departments', { ...row, name: 'x'.repeat(300000) }, 'CREATE');
        }),
      );
      assert.equal(
        (await runtime.query("SELECT 1 FROM departments WHERE code='ROLLBACK'")).rowCount,
        0,
      );
      assert.equal(
        (await runtime.query<{ count: string }>('SELECT count(*) FROM audit_events')).rows[0]!
          .count,
        auditsBefore,
      );
      const sync = await request('sync/summary');
      assert.equal(sync.status, 200);
      assert(Number(sync.data.pending) >= 6);
      assert(!('payload' in sync.data));
      const snapshots = await runtime.query<{ payload: Record<string, unknown> }>(
        'SELECT payload FROM sync_outbox',
      );
      assert(!JSON.stringify(snapshots.rows).includes('password_hash'));
      assert(!JSON.stringify(snapshots.rows).includes(session.accessToken));
      assert.equal(
        permissionCodes.length,
        (await runtime.query('SELECT code FROM permissions')).rowCount,
      );
      assert.equal((await request('employees', 'GET', undefined, 'a'.repeat(43))).status, 401);
      await auth.logout(viewerSession.accessToken);
      assert.equal(await auth.session(viewerSession.accessToken), null);
      assert(viewer.id);
    } finally {
      if (server)
        await new Promise<void>((resolve, reject) =>
          server!.close((e) => (e ? reject(e) : resolve())),
        );
      await fixture.close();
    }
  },
);
