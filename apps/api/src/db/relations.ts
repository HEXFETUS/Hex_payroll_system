import { relations } from 'drizzle-orm';
import {
  organizations,
  employees,
  employmentVersions,
  departments,
  positions,
  biometricMappings,
  biometricDevices,
  authUsers,
  roles,
  userRoles,
  rolePermissions,
  permissions,
  auditEvents,
  syncOutbox,
  payrollConfigurations,
  syncNodes,
} from './generated/schema.js';
export const organizationRelations = relations(organizations, ({ many }) => ({
  employees: many(employees),
  departments: many(departments),
  positions: many(positions),
  users: many(authUsers),
  configuration: many(payrollConfigurations),
  audit: many(auditEvents),
  outbox: many(syncOutbox),
  nodes: many(syncNodes),
}));
export const employeeRelations = relations(employees, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [employees.organizationId],
    references: [organizations.id],
  }),
  employment: many(employmentVersions),
  mappings: many(biometricMappings),
}));
export const employmentRelations = relations(employmentVersions, ({ one }) => ({
  employee: one(employees, { fields: [employmentVersions.employeeId], references: [employees.id] }),
  department: one(departments, {
    fields: [employmentVersions.departmentId],
    references: [departments.id],
  }),
  position: one(positions, { fields: [employmentVersions.positionId], references: [positions.id] }),
}));
export const mappingRelations = relations(biometricMappings, ({ one }) => ({
  employee: one(employees, { fields: [biometricMappings.employeeId], references: [employees.id] }),
  device: one(biometricDevices, {
    fields: [biometricMappings.deviceId],
    references: [biometricDevices.id],
  }),
}));
export const userRelations = relations(authUsers, ({ many }) => ({ assignments: many(userRoles) }));
export const roleRelations = relations(roles, ({ many }) => ({
  users: many(userRoles),
  permissions: many(rolePermissions),
}));
export const assignmentRelations = relations(userRoles, ({ one }) => ({
  user: one(authUsers, { fields: [userRoles.userId], references: [authUsers.id] }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
}));
export const permissionRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionCode],
    references: [permissions.code],
  }),
}));
