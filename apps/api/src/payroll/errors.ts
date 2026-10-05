import type { ErrorRequestHandler } from 'express';
import { DomainError, databaseErrorCode } from '../foundation/repository.js';
import { domainErrors } from '../timekeeping/middleware.js';
const conflicts: Record<string, string> = {
  'Supersession would alter finalized payroll applicability':
    'The new effective date would change a reference window used by finalized payroll. Choose a later date.',
  'Payroll periods overlap':
    'Another payroll period already covers these dates for the same pay frequency.',
  'Payroll policy versions overlap':
    'A monetary policy already covers part of this effective date range.',
  'Active statutory versions overlap':
    'An active statutory version already covers part of this effective date range.',
  'Finalized payroll is immutable':
    'Finalized payroll cannot be changed. Use a future correction workflow.',
  'Closed payroll cannot be modified': 'This payroll period is closed and cannot be modified.',
  'Closed payroll entries cannot be changed':
    'Entries assigned to closed payroll cannot be changed.',
  'Active statutory versions are immutable':
    'Import a new statutory version instead of changing an active version.',
  'Payroll policy versions are immutable':
    'Create a new monetary policy version instead of editing an existing version.',
};
export const payrollErrors: ErrorRequestHandler = (error: unknown, req, res, next) => {
  const code = databaseErrorCode(error);
  if (['40001', '40P01'].includes(code))
    return domainErrors(
      new DomainError(
        409,
        'CONCURRENT_CHANGE',
        'Payroll inputs changed concurrently; refresh and retry the request.',
      ),
      req,
      res,
      next,
    );
  if (code === '23514' && error instanceof Error && conflicts[error.message])
    return domainErrors(
      new DomainError(409, 'PAYROLL_CONFLICT', conflicts[error.message]!),
      req,
      res,
      next,
    );
  return domainErrors(error, req, res, next);
};
