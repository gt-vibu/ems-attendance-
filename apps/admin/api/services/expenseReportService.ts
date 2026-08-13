import { buildCsv } from './reportExport';
import { buildReportExcel, buildReportPdf, type ReportExportMeta, type ReportColumnMeta } from './reportFileExport';

export interface ExpenseReportColumnConfig {
  key: string;
  label: string;
  format?: 'hours' | 'currency' | 'boolean';
}

export const ALL_EXPENSE_REPORT_COLUMNS: ExpenseReportColumnConfig[] = [
  { key: 'expenseId', label: 'Expense ID' },
  { key: 'employeeName', label: 'Employee' },
  { key: 'employeeCode', label: 'Employee Code' },
  { key: 'department', label: 'Department' },
  { key: 'branchName', label: 'Branch / Location' },
  { key: 'expenseDate', label: 'Expense Date' },
  { key: 'expenseTime', label: 'Expense Time' },
  { key: 'merchant', label: 'Merchant / Shop' },
  { key: 'category', label: 'Category' },
  { key: 'description', label: 'Description / Purpose' },
  { key: 'location', label: 'Where Spent' },
  { key: 'paymentMethod', label: 'Payment Method' },
  { key: 'amount', label: 'Claimed Amount', format: 'currency' },
  { key: 'approvedAmount', label: 'Approved Amount', format: 'currency' },
  { key: 'reimbursedAmount', label: 'Reimbursed Amount', format: 'currency' },
  { key: 'remainingAmount', label: 'Remaining Amount', format: 'currency' },
  { key: 'status', label: 'Status' },
  { key: 'reimbursementStatus', label: 'Reimbursement Status' },
  { key: 'approvedByName', label: 'Approved By' },
  { key: 'approvedAt', label: 'Approval Date' },
  { key: 'reimbursedByName', label: 'Reimbursed By' },
  { key: 'reimbursedAt', label: 'Reimbursement Date' },
  { key: 'uploadTimestamp', label: 'Submission Timestamp' },
  { key: 'policyViolationFlag', label: 'Policy Flag', format: 'boolean' },
  { key: 'duplicateFlag', label: 'Duplicate Flag', format: 'boolean' },
];

export async function generateExpenseReportFile(params: {
  format: 'csv' | 'excel' | 'pdf' | 'json';
  columns: string[]; // list of column keys chosen by user
  rows: Record<string, any>[];
  meta: ReportExportMeta;
}): Promise<{ buffer: Buffer | string; mimeType: string; filename: string }> {
  const { format, columns, rows, meta } = params;

  // Filter column meta to matching chosen keys in user's desired order
  const activeColumns: ReportColumnMeta[] = columns
    .map((colKey) => ALL_EXPENSE_REPORT_COLUMNS.find((c) => c.key === colKey))
    .filter(Boolean)
    .map((c) => ({ key: c!.key, label: c!.label, format: c!.format }));

  const timestamp = new Date().toISOString().slice(0, 10);
  const sanitizedTitle = meta.title.toLowerCase().replace(/[^a-z0-9]/g, '_');

  if (format === 'csv') {
    // Format rows to map selected column keys to their labels for CSV output
    const formattedRows = rows.map((row) => {
      const formattedRow: Record<string, any> = {};
      for (const col of activeColumns) {
        formattedRow[col.label] = row[col.key];
      }
      return formattedRow;
    });
    const csvContent = buildCsv(formattedRows);
    return {
      buffer: Buffer.from(csvContent, 'utf-8'),
      mimeType: 'text/csv',
      filename: `${sanitizedTitle}_${timestamp}.csv`,
    };
  }

  if (format === 'excel') {
    const excelBuffer = await buildReportExcel(rows, {}, meta, activeColumns, []);
    return {
      buffer: excelBuffer,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `${sanitizedTitle}_${timestamp}.xlsx`,
    };
  }

  if (format === 'pdf') {
    const pdfBuffer = await buildReportPdf(rows, {}, meta, activeColumns, []);
    return {
      buffer: pdfBuffer,
      mimeType: 'application/pdf',
      filename: `${sanitizedTitle}_${timestamp}.pdf`,
    };
  }

  // Fallback / default json
  return {
    buffer: Buffer.from(JSON.stringify({ meta, columns: activeColumns, rows }, null, 2), 'utf-8'),
    mimeType: 'application/json',
    filename: `${sanitizedTitle}_${timestamp}.json`,
  };
}
