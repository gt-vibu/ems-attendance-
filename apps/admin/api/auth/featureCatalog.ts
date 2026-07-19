// The single canonical list of every delegable feature/privilege in the
// app, grouped into categories for the Role Permissions editor and the
// hire-form's "additional access" grid (see components/FeatureCatalogGrid
// on the frontend — both surfaces render from this one list, fetched via
// GET /api/tenant/feature-catalog, so adding a feature means editing only
// this file).
//
// Deliberately excluded: 'attendance.create' and 'breaks.create' — every
// clock-in role needs these to function at all (check in, take breaks), so
// they're kept as an always-implicit baseline for any non-admin role (see
// getDefaultPrivilegesForRole in rbac.ts) rather than a togglable card that
// could accidentally lock someone out of using the app at all.
export interface FeatureCatalogEntry {
  key: string;
  label: string;
  description: string;
}

export interface FeatureCatalogCategory {
  category: string;
  icon: string; // lucide-react icon name, resolved on the frontend
  features: FeatureCatalogEntry[];
}

export const FEATURE_CATALOG: FeatureCatalogCategory[] = [
  {
    category: 'Employee Management',
    icon: 'Users',
    features: [
      { key: 'employee.create', label: 'Hire Employees', description: 'Onboard new employees and assign their role, branch, and shift.' },
      { key: 'employee.read', label: 'View Employee Roster', description: 'See the full list of employees and their details.' },
    ],
  },
  {
    category: 'Attendance',
    icon: 'Clock',
    features: [
      { key: 'attendance.read', label: 'View Attendance Records', description: 'See check-in/check-out history for the team.' },
      { key: 'attendance.approve', label: 'Approve Late Arrivals & WFH', description: 'Review and approve or reject late check-ins and Work From Home requests.' },
    ],
  },
  {
    // Its own top-level category (not folded into Attendance) so it's easy
    // to find and grant on its own — e.g. an HR or Team Lead role that
    // should approve leave but has nothing to do with attendance policy.
    category: 'Leave Management',
    icon: 'CalendarDays',
    features: [
      { key: 'leave.approve', label: 'Approve Leave Requests', description: 'Review, approve, or reject employee leave requests.' },
      { key: 'leave.read', label: 'View Leave Tracker', description: 'See leave balances, requests, and leave history.' },
    ],
  },
  {
    category: 'Breaks',
    icon: 'Coffee',
    features: [
      { key: 'breaks.manage', label: 'Manage Break Violations', description: 'Review break-overstay and geofence-exit violations.' },
    ],
  },
  {
    category: 'Reports & Audit',
    icon: 'ScrollText',
    features: [
      { key: 'reports.view', label: 'View Reports & Audit Ledger', description: 'Access analytics, exports, and the immutable audit trail.' },
    ],
  },
  {
    // Its own top-level category so a role like Cashier/Accountant can be
    // granted payroll access without also picking up unrelated report/audit
    // access bundled under the same card.
    category: 'Payroll',
    icon: 'Banknote',
    features: [
      { key: 'payroll.read', label: 'View Payroll Analytics', description: 'See salary breakup, payroll summaries, and per-role or per-department cost reports.' },
      { key: 'payroll.manage', label: 'Manage Payroll Structures', description: 'Configure CTC, salary components, overtime rates, and payroll settings for any employee.' },
    ],
  },
  {
    category: 'Devices',
    icon: 'Smartphone',
    features: [
      { key: 'settings.edit', label: 'Approve Device Change Requests', description: 'Approve or reject employees switching their registered device.' },
    ],
  },
  {
    category: 'Branches & Outlets',
    icon: 'Building2',
    features: [
      { key: 'branch.manage', label: 'Create & Edit Branches', description: 'Add new branches and edit their location, radius, and policies.' },
      { key: 'shift.manage', label: 'Create & Edit Shifts', description: 'Define named shifts (Morning, Night, etc.) for a branch.' },
      { key: 'holiday.manage', label: 'Manage Holiday Calendar', description: 'Import or maintain tenant holidays and optional holiday choices.' },
      { key: 'branch.multi_access', label: 'Manage Multiple Branches', description: 'When granted, this person is assigned a set of branches (chosen at onboarding) instead of just one — their dashboard, analytics, and onboarding are scoped to all of them.' },
    ],
  },
  {
    category: 'QR Attendance',
    icon: 'QrCode',
    features: [
      { key: 'attendance.qr.generate', label: 'Generate QR Sessions', description: 'Start a rotating QR code display session.' },
      { key: 'attendance.qr.display', label: 'Display QR Code', description: 'View the live rotating QR code and scan counts.' },
      { key: 'attendance.qr.close', label: 'Close QR Sessions', description: 'Stop an active QR display session.' },
      { key: 'attendance.qr.override', label: 'Override Failed Scans', description: 'Manually approve a QR scan that failed verification.' },
      { key: 'attendance.qr.view_logs', label: 'View QR Logs', description: 'See QR session history and per-scan results.' },
    ],
  },
  {
    category: 'Work From Home',
    icon: 'Home',
    features: [
      { key: 'wfh.view_logs', label: 'View WFH Ledger', description: 'See who worked from home, when, and why.' },
    ],
  },
  {
    category: 'Teams',
    icon: 'Users2',
    features: [
      { key: 'team.manage', label: 'Manage a Team', description: 'Create a team, pull in colleagues from the same department, and view their attendance/leave/payroll stats where separately permitted.' },
    ],
  },
  {
    category: 'Timing Alerts',
    icon: 'AlertTriangle',
    features: [
      { key: 'alerts.receive', label: 'Receive Timing Alerts', description: 'Get notified of break overstays and geofence exits.' },
      { key: 'alerts.accept', label: 'Accept Alerts', description: 'Mark a timing alert as accepted/valid.' },
      { key: 'alerts.reject', label: 'Reject Alerts', description: 'Dismiss a timing alert as a false positive.' },
    ],
  },
  {
    category: 'Company Announcements',
    icon: 'Megaphone',
    features: [
      { key: 'tenant.policy.manage', label: 'Set Company Policy Announcement', description: 'Write or update the company-wide policy banner shown on every employee and admin dashboard.' },
    ],
  },
];

// Flat set of every valid catalog key, for quick membership checks
// (e.g. rejecting a role-privilege update that references an unknown key).
export const FEATURE_CATALOG_KEYS: Set<string> = new Set(
  FEATURE_CATALOG.flatMap((c) => c.features.map((f) => f.key))
);
