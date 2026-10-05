import { relations } from 'drizzle-orm';
import {
  payrollPeriods,
  payrollRuns,
  employeePayrollResults,
  payrollEarningLines,
  payrollDeductionLines,
  payrollContributionLines,
  statutoryRuleSets,
  payrollPolicies,
  payrollTypes,
  payrollEntries,
} from './generated/schema.js';
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
  workSchedules,
  workScheduleVersions,
  workScheduleDays,
  employeeScheduleAssignments,
  timeRecords,
  timeRecordCorrections,
  leaveTypes,
  leaveRequests,
  attendanceRecords,
  attendanceHistory,
  attendanceAdjustments,
  scheduleAssignmentHistory,
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
  schedules: many(employeeScheduleAssignments),
  timeRecords: many(timeRecords),
  leave: many(leaveRequests),
  attendance: many(attendanceRecords),
}));
export const scheduleRelations = relations(workSchedules, ({ many }) => ({
  versions: many(workScheduleVersions),
  assignments: many(employeeScheduleAssignments),
}));
export const scheduleVersionRelations = relations(workScheduleVersions, ({ one, many }) => ({
  schedule: one(workSchedules, {
    fields: [workScheduleVersions.scheduleId],
    references: [workSchedules.id],
  }),
  days: many(workScheduleDays),
}));
export const scheduleDayRelations = relations(workScheduleDays, ({ one }) => ({
  version: one(workScheduleVersions, {
    fields: [workScheduleDays.versionId],
    references: [workScheduleVersions.id],
  }),
}));
export const employeeScheduleRelations = relations(
  employeeScheduleAssignments,
  ({ one, many }) => ({
    employee: one(employees, {
      fields: [employeeScheduleAssignments.employeeId],
      references: [employees.id],
    }),
    schedule: one(workSchedules, {
      fields: [employeeScheduleAssignments.scheduleId],
      references: [workSchedules.id],
    }),
    history: many(scheduleAssignmentHistory),
  }),
);
export const scheduleAssignmentHistoryRelations = relations(
  scheduleAssignmentHistory,
  ({ one }) => ({
    assignment: one(employeeScheduleAssignments, {
      fields: [scheduleAssignmentHistory.assignmentId],
      references: [employeeScheduleAssignments.id],
    }),
  }),
);
export const timeRecordRelations = relations(timeRecords, ({ one, many }) => ({
  employee: one(employees, { fields: [timeRecords.employeeId], references: [employees.id] }),
  device: one(biometricDevices, {
    fields: [timeRecords.deviceId],
    references: [biometricDevices.id],
  }),
  corrections: many(timeRecordCorrections),
}));
export const timeCorrectionRelations = relations(timeRecordCorrections, ({ one }) => ({
  record: one(timeRecords, {
    fields: [timeRecordCorrections.timeRecordId],
    references: [timeRecords.id],
  }),
}));
export const leaveTypeRelations = relations(leaveTypes, ({ many }) => ({
  requests: many(leaveRequests),
}));
export const leaveRequestRelations = relations(leaveRequests, ({ one }) => ({
  employee: one(employees, { fields: [leaveRequests.employeeId], references: [employees.id] }),
  type: one(leaveTypes, { fields: [leaveRequests.leaveTypeId], references: [leaveTypes.id] }),
}));
export const attendanceRelations = relations(attendanceRecords, ({ one, many }) => ({
  employee: one(employees, { fields: [attendanceRecords.employeeId], references: [employees.id] }),
  assignment: one(employeeScheduleAssignments, {
    fields: [attendanceRecords.scheduleAssignmentId],
    references: [employeeScheduleAssignments.id],
  }),
  version: one(workScheduleVersions, {
    fields: [attendanceRecords.scheduleVersionId],
    references: [workScheduleVersions.id],
  }),
  history: many(attendanceHistory),
  adjustments: many(attendanceAdjustments),
}));
export const attendanceHistoryRelations = relations(attendanceHistory, ({ one }) => ({
  attendance: one(attendanceRecords, {
    fields: [attendanceHistory.attendanceId],
    references: [attendanceRecords.id],
  }),
}));
export const attendanceAdjustmentRelations = relations(attendanceAdjustments, ({ one }) => ({
  attendance: one(attendanceRecords, {
    fields: [attendanceAdjustments.attendanceId],
    references: [attendanceRecords.id],
  }),
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

export const payrollPeriodRelations = relations(payrollPeriods, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [payrollPeriods.organizationId],
    references: [organizations.id],
  }),
  runs: many(payrollRuns, { relationName: 'periodRuns' }),
  latestRun: one(payrollRuns, {
    fields: [payrollPeriods.latestRunId],
    references: [payrollRuns.id],
    relationName: 'latestPayrollRun',
  }),
  reviewedRun: one(payrollRuns, {
    fields: [payrollPeriods.reviewedRunId],
    references: [payrollRuns.id],
    relationName: 'reviewedPayrollRun',
  }),
}));
export const payrollRunRelations = relations(payrollRuns, ({ one, many }) => ({
  period: one(payrollPeriods, {
    fields: [payrollRuns.periodId],
    references: [payrollPeriods.id],
    relationName: 'periodRuns',
  }),
  results: many(employeePayrollResults),
}));
export const payrollResultRelations = relations(employeePayrollResults, ({ one, many }) => ({
  run: one(payrollRuns, {
    fields: [employeePayrollResults.payrollRunId],
    references: [payrollRuns.id],
  }),
  employee: one(employees, {
    fields: [employeePayrollResults.employeeId],
    references: [employees.id],
  }),
  earnings: many(payrollEarningLines),
  deductions: many(payrollDeductionLines),
  contributions: many(payrollContributionLines),
}));
export const payrollEarningRelations = relations(payrollEarningLines, ({ one }) => ({
  result: one(employeePayrollResults, {
    fields: [payrollEarningLines.resultId],
    references: [employeePayrollResults.id],
  }),
}));
export const payrollDeductionRelations = relations(payrollDeductionLines, ({ one }) => ({
  result: one(employeePayrollResults, {
    fields: [payrollDeductionLines.resultId],
    references: [employeePayrollResults.id],
  }),
}));
export const payrollContributionRelations = relations(payrollContributionLines, ({ one }) => ({
  result: one(employeePayrollResults, {
    fields: [payrollContributionLines.resultId],
    references: [employeePayrollResults.id],
  }),
  rule: one(statutoryRuleSets, {
    fields: [payrollContributionLines.ruleSetId],
    references: [statutoryRuleSets.id],
  }),
}));
export const payrollRuleRelations = relations(statutoryRuleSets, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [statutoryRuleSets.organizationId],
    references: [organizations.id],
  }),
  contributions: many(payrollContributionLines),
}));
export const payrollPolicyRelations = relations(payrollPolicies, ({ one }) => ({
  organization: one(organizations, {
    fields: [payrollPolicies.organizationId],
    references: [organizations.id],
  }),
}));
export const payrollTypeRelations = relations(payrollTypes, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [payrollTypes.organizationId],
    references: [organizations.id],
  }),
  entries: many(payrollEntries),
}));
export const payrollEntryRelations = relations(payrollEntries, ({ one }) => ({
  type: one(payrollTypes, { fields: [payrollEntries.typeId], references: [payrollTypes.id] }),
  employee: one(employees, { fields: [payrollEntries.employeeId], references: [employees.id] }),
  period: one(payrollPeriods, {
    fields: [payrollEntries.periodId],
    references: [payrollPeriods.id],
  }),
}));
