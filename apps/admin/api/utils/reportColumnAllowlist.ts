/**
 * Strict server-side allowlists for report & export columns.
 * Prevents arbitrary SQL expression injection, internal table field leakage
 * (e.g. password, token, secret, tenant_id), and unapproved column requests.
 */

export const ALLOWED_REPORT_COLUMNS: Record<string, Set<string>> = {
  attendance: new Set([
    'date', 'employeeId', 'employeeName', 'department', 'designation', 'branchName',
    'status', 'checkIn', 'checkOut', 'workingHours', 'overtimeHours', 'lateMins',
    'presentDays', 'absentDays', 'leaveDays', 'attendancePct', 'shiftName'
  ]),
  leave: new Set([
    'employeeId', 'employeeName', 'department', 'leaveType', 'startDate', 'endDate',
    'daysCount', 'status', 'reason', 'appliedOn', 'approvedBy', 'leaveBalance'
  ]),
  payroll: new Set([
    'employeeId', 'employeeName', 'department', 'designation', 'month', 'year',
    'basicSalary', 'allowances', 'grossSalary', 'deductions', 'pfAmount', 'netSalary',
    'status', 'paymentDate'
  ]),
  expenses: new Set([
    'id', 'claimNumber', 'employeeId', 'employeeName', 'department', 'categoryName',
    'merchantName', 'expenseDate', 'amount', 'approvedAmount', 'status', 'paymentStatus',
    'description', 'createdAt'
  ]),
};

/**
 * Sanitizes an array of requested column names against a strict allowlist.
 * Unknown, SQL injection, or unapproved fields are filtered out.
 * If no valid columns remain, returns undefined so the report engine uses its default column list.
 */
export function sanitizeReportColumns(reportType: string, requestedColumns: any): string[] | undefined {
  if (!requestedColumns) return undefined;

  let columnsArr: string[] = [];
  if (Array.isArray(requestedColumns)) {
    columnsArr = requestedColumns.map((c) => String(c).trim());
  } else if (typeof requestedColumns === 'string') {
    columnsArr = requestedColumns.split(',').map((c) => c.trim());
  }

  if (columnsArr.length === 0) return undefined;

  let normalizedType = 'attendance';
  const lowerType = String(reportType || '').toLowerCase();
  if (lowerType.includes('leave')) normalizedType = 'leave';
  else if (lowerType.includes('payroll') || lowerType.includes('salary')) normalizedType = 'payroll';
  else if (lowerType.includes('expense')) normalizedType = 'expenses';

  const allowlist = ALLOWED_REPORT_COLUMNS[normalizedType] || ALLOWED_REPORT_COLUMNS.attendance;
  const filtered = columnsArr.filter((col) => allowlist.has(col));

  return filtered.length > 0 ? filtered : undefined;
}
