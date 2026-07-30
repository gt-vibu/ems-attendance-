// Server-side CSV builder for report exports (email attachments, scheduled
// deliveries) — the client already has its own CSV export
// (apps/admin/src/lib/csv.ts) for the on-screen "Download" button, but that
// only runs in the browser. This is the same escaping approach, applied to
// whatever row shape services/reportData.ts produced, so a scheduled export
// and an on-screen download always look the same.
function escapeCell(value: any): string {
  const str = value === null || value === undefined ? '' : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

export function buildCsv(rows: any[]): string {
  if (rows.length === 0) return 'No data\n';
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCell(row[h])).join(','));
  }
  return lines.join('\n');
}
