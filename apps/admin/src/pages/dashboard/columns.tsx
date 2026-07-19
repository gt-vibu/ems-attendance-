import type { ColumnDef } from '@tanstack/react-table';

// DataTable column definitions used across Dashboard.tsx's Directory, WFH
// Ledger, QR session/scan logs, and drill-down tables. Extracted verbatim
// (pure presentational cell renderers); the handful that need a callback
// (opening the access editor, overriding a QR scan, opening the employee
// detail panel) are factory functions so Dashboard.tsx just passes its own
// handlers in — no behavior change.

export function createDirectoryColumns(openAccessEditor: (emp: any) => void): ColumnDef<any, any>[] {
  return [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ getValue }) => <span className="font-semibold text-[var(--color-nexus-ink)]">{getValue() as string}</span>,
    },
    {
      accessorKey: 'email',
      header: 'Email',
      cell: ({ getValue }) => <span className="text-[var(--color-nexus-muted)] font-mono">{getValue() as string}</span>,
    },
    {
      accessorKey: 'role',
      header: 'Role',
      filterFn: 'equalsString',
      cell: ({ getValue }) => <span className="font-bold text-[var(--color-nexus-ink)] uppercase tracking-wider text-[10px]">{getValue() as string}</span>,
    },
    {
      id: 'kyc',
      accessorFn: (emp: any) => (emp.isKycCompleted ? 'Completed' : 'Pending'),
      header: 'KYC State',
      cell: ({ row }) => (
        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${row.original.isKycCompleted ? 'bg-[color:var(--color-nexus-success-text)]/10 text-[var(--color-nexus-success-text)]' : 'bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)]'}`}>
          {row.original.isKycCompleted ? 'Completed' : 'Pending'}
        </span>
      ),
    },
    {
      id: 'devicePin',
      accessorFn: (emp: any) => emp.registeredDeviceId || '',
      header: 'Device Pin',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="font-mono text-[10px] text-[var(--color-nexus-muted)]">
          {row.original.registeredDeviceId ? row.original.registeredDeviceId.substring(0, 12) + '...' : 'Unpinned'}
        </span>
      ),
    },
    {
      id: 'access',
      header: 'Feature Access',
      enableSorting: false,
      enablePinning: false,
      cell: ({ row }) => (
        <button
          onClick={() => openAccessEditor(row.original)}
          className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-primary)] bg-[var(--color-nexus-primary-fixed)] hover:bg-[var(--color-nexus-primary-fixed)] px-2.5 py-1 rounded-lg transition-colors"
        >
          {(Array.isArray(row.original.privileges) ? row.original.privileges : []).some((p: string) => p.startsWith('attendance.qr.') || p.startsWith('wfh.')) ? 'Manage' : 'Grant'}
        </button>
      ),
    },
  ];
}

export const wfhLedgerColumns: ColumnDef<any, any>[] = [
  {
    accessorKey: 'userName',
    header: 'Employee',
    cell: ({ getValue }) => <span className="font-semibold text-[var(--color-nexus-ink)]">{getValue() as string}</span>,
  },
  {
    accessorKey: 'role',
    header: 'Role',
    filterFn: 'equalsString',
    cell: ({ getValue }) => <span className="font-bold text-[var(--color-nexus-ink)] uppercase tracking-wider text-[10px]">{getValue() as string}</span>,
  },
  {
    accessorKey: 'date',
    header: 'Date',
    cell: ({ getValue }) => <span className="text-[var(--color-nexus-muted)]">{new Date(getValue() as string).toLocaleDateString()}</span>,
  },
  {
    id: 'checkInTime',
    accessorKey: 'checkInTime',
    header: 'Check-In',
    cell: ({ getValue }) => <span className="font-mono text-[11px] text-[var(--color-nexus-muted)]">{new Date(getValue() as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>,
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ getValue }) => {
      const s = getValue() as string;
      return (
        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${s === 'approved' ? 'bg-[color:var(--color-nexus-success-text)]/10 text-[var(--color-nexus-success-text)]' : s === 'pending' ? 'bg-[var(--color-nexus-secondary-container)] text-[var(--color-nexus-secondary)]' : 'bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)]'}`}>
          {s}
        </span>
      );
    },
  },
  {
    id: 'distanceFromHomeMeters',
    accessorKey: 'distanceFromHomeMeters',
    header: 'Dist. From Home',
    cell: ({ getValue }) => {
      const d = getValue() as number | null;
      return <span className="text-[var(--color-nexus-muted)] text-[11px]">{d == null ? '—' : `${Math.round(d)}m`}</span>;
    },
  },
  {
    accessorKey: 'wfhReason',
    header: 'Reason',
    enableSorting: false,
    cell: ({ getValue }) => <span className="text-[var(--color-nexus-muted)] text-[11px] truncate max-w-[220px] block">{(getValue() as string) || '—'}</span>,
  },
];

export const qrSessionColumns: ColumnDef<any, any>[] = [
  {
    accessorKey: 'generatedByName',
    header: 'Started By',
    cell: ({ getValue }) => <span className="font-semibold text-[var(--color-nexus-ink)]">{getValue() as string}</span>,
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ getValue }) => {
      const s = getValue() as string;
      return <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${s === 'active' ? 'bg-[color:var(--color-nexus-success-text)]/10 text-[var(--color-nexus-success-text)]' : 'bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)]'}`}>{s}</span>;
    },
  },
  {
    accessorKey: 'rotationSeconds',
    header: 'Rotation',
    cell: ({ getValue }) => <span className="text-[var(--color-nexus-muted)] font-mono">{getValue() as number}s</span>,
  },
  { accessorKey: 'scansCount', header: 'Scans', cell: ({ getValue }) => <span className="text-[var(--color-nexus-ink)]">{getValue() as number}</span> },
  { accessorKey: 'successCount', header: 'Success', cell: ({ getValue }) => <span className="text-[var(--color-nexus-success-text)]">{getValue() as number}</span> },
  { accessorKey: 'failCount', header: 'Failed', cell: ({ getValue }) => <span className="text-[var(--color-nexus-error)]">{getValue() as number}</span> },
  {
    accessorKey: 'createdAt',
    header: 'Started',
    cell: ({ getValue }) => <span className="text-[var(--color-nexus-muted)] text-[11px]">{new Date(getValue() as string).toLocaleString()}</span>,
  },
];

export function createQrScanColumns(handleOverrideQrScan: (scanId: number) => void): ColumnDef<any, any>[] {
  return [
    {
      accessorKey: 'userName',
      header: 'Employee',
      cell: ({ row }) => (
        <div>
          <span className="font-semibold text-[var(--color-nexus-ink)] block">{row.original.userName}</span>
          <span className="text-[10px] text-[var(--color-nexus-muted)] uppercase font-bold">{row.original.userRole}</span>
        </div>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      filterFn: 'equalsString',
      cell: ({ getValue }) => {
        const s = getValue() as string;
        return (
          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${s === 'success' ? 'bg-[color:var(--color-nexus-success-text)]/10 text-[var(--color-nexus-success-text)]' : s === 'failed' ? 'bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)]' : 'bg-[var(--color-nexus-secondary-container)] text-[var(--color-nexus-secondary)]'}`}>
            {s}
          </span>
        );
      },
    },
    {
      id: 'checksPassed',
      header: 'Checks Passed',
      enableSorting: false,
      cell: ({ row }) => {
        const s = row.original;
        return (
          <span className="font-mono text-[10px] text-[var(--color-nexus-muted)]">
            {[
              s.gpsPassed != null && (s.gpsPassed ? 'GPS✓' : 'GPS✗'),
              s.wifiPassed != null && (s.wifiPassed ? 'WiFi✓' : 'WiFi✗'),
              s.facePassed != null && (s.facePassed ? 'Face✓' : 'Face✗'),
              s.deviceTrustPassed != null && (s.deviceTrustPassed ? 'Device✓' : 'Device✗'),
            ].filter(Boolean).join(' ') || '—'}
          </span>
        );
      },
    },
    {
      accessorKey: 'failureReason',
      header: 'Failure Reason',
      enableSorting: false,
      cell: ({ getValue }) => <span className="text-[var(--color-nexus-muted)]">{(getValue() as string) || '—'}</span>,
    },
    {
      accessorKey: 'ipAddress',
      header: 'IP',
      enableSorting: false,
      cell: ({ getValue }) => <span className="text-[var(--color-nexus-muted)] font-mono text-[10px]">{(getValue() as string) || '—'}</span>,
    },
    {
      accessorKey: 'createdAt',
      header: 'Time',
      cell: ({ getValue }) => <span className="text-[var(--color-nexus-muted)] text-[11px]">{new Date(getValue() as string).toLocaleString()}</span>,
    },
    {
      id: 'actions',
      header: 'Actions',
      enableSorting: false,
      enablePinning: false,
      cell: ({ row }) => (
        row.original.status === 'failed' ? (
          <button
            onClick={() => handleOverrideQrScan(row.original.id)}
            className="bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white text-[10px] font-bold uppercase tracking-wider py-1 px-3 rounded-lg transition-colors"
          >
            Override
          </button>
        ) : null
      ),
    },
  ];
}

// --- Stat-card drill-down column sets ---
// Clicking any person's name anywhere in the dashboard (drill-down tables,
// Pending Approvals, Your Team) opens the shared EmployeeDetailPanel — real
// attendance calendar + leave balance + payroll snapshot for that user,
// sourced entirely from existing endpoints (see EmployeeDetailPanel.tsx).
export function createPersonColumns(setDetailUserId: (id: number) => void) {
  const roleCell = ({ getValue }: any) => <span className="font-bold text-[var(--color-nexus-ink)] uppercase tracking-wider text-[10px]">{getValue() as string}</span>;
  const nameCell = ({ getValue, row }: any) => {
    const uid = row?.original?.userId ?? row?.original?.id;
    if (!uid) return <span className="font-semibold text-[var(--color-nexus-ink)]">{getValue() as string}</span>;
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setDetailUserId(uid); }}
        className="font-semibold text-[var(--color-nexus-ink)] hover:text-[var(--color-nexus-primary)] hover:underline text-left"
      >
        {getValue() as string}
      </button>
    );
  };
  const modeBadge = ({ getValue }: any) => {
    const m = (getValue() as string) || 'office';
    return <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${m === 'wfh' ? 'bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)]' : m === 'qr' ? 'bg-[var(--color-nexus-secondary-container)] text-[var(--color-nexus-secondary)]' : 'bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)]'}`}>{m}</span>;
  };
  const statusBadge = ({ getValue }: any) => {
    const s = (getValue() as string) || '';
    return <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${s === 'approved' ? 'bg-[color:var(--color-nexus-success-text)]/10 text-[var(--color-nexus-success-text)]' : s === 'pending' ? 'bg-[var(--color-nexus-secondary-container)] text-[var(--color-nexus-secondary)]' : 'bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)]'}`}>{s}</span>;
  };
  const timeCell = ({ getValue }: any) => {
    const v = getValue();
    return <span className="font-mono text-[11px] text-[var(--color-nexus-muted)]">{v ? new Date(v as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</span>;
  };

  // Present / Late / Rejected / WFH-today rows (a check-in with time + mode + status)
  const attendancePersonColumns: ColumnDef<any, any>[] = [
    { accessorKey: 'name', header: 'Name', cell: nameCell },
    { accessorKey: 'role', header: 'Role', filterFn: 'equalsString', cell: roleCell },
    { accessorKey: 'checkInTime', header: 'Check-In', cell: timeCell },
    { accessorKey: 'attendanceMode', header: 'Mode', cell: modeBadge },
    { accessorKey: 'status', header: 'Status', cell: statusBadge },
  ];
  // Absent / Total rows (no check-in to show)
  const simplePersonColumns: ColumnDef<any, any>[] = [
    { accessorKey: 'name', header: 'Name', cell: nameCell },
    { accessorKey: 'role', header: 'Role', filterFn: 'equalsString', cell: roleCell },
  ];
  // Pending home-location change requests
  const locationRequestColumns: ColumnDef<any, any>[] = [
    { accessorKey: 'name', header: 'Name', cell: nameCell },
    { accessorKey: 'role', header: 'Role', filterFn: 'equalsString', cell: roleCell },
    { accessorKey: 'newLocation', header: 'Requested Location', enableSorting: false, cell: ({ getValue }) => <span className="text-[var(--color-nexus-muted)] text-[11px]">{(getValue() as string) || '—'}</span> },
    { accessorKey: 'reason', header: 'Reason', enableSorting: false, cell: ({ getValue }) => <span className="text-[var(--color-nexus-muted)] text-[11px] truncate max-w-[200px] block">{(getValue() as string) || '—'}</span> },
  ];

  return { attendancePersonColumns, simplePersonColumns, locationRequestColumns };
}
