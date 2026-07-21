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
      { key: 'employee.edit', label: 'Edit Employee Details', description: 'Update an existing employee\'s name, role, department, designation, branch, or shift. Separate from Hire — a role can be trusted to keep records current without being able to onboard new headcount.' },
      { key: 'employee.read', label: 'View Employee Roster', description: 'See the full list of employees and their details.' },
      { key: 'employee.terminate', label: 'Terminate Employees', description: 'Remove an employee from the organization. The tenant admin does this immediately; anyone else with this permission must submit a reason for the tenant admin to approve first.' },
    ],
  },
  {
    // 'attendance.approve' used to be one bucket covering three unrelated
    // approval queues (late arrivals, WFH, missed-punch corrections) — split
    // per-type below, same reasoning as the Timing Alerts split: a floor
    // supervisor might reasonably approve late arrivals without also being
    // trusted to approve WFH. 'attendance.approve' is kept as a general/
    // legacy bucket so anyone already holding it keeps working exactly as
    // before (no regression) — see review.routes.ts/wfh.routes.ts, which
    // check the specific key OR this one.
    category: 'Attendance',
    icon: 'Clock',
    features: [
      { key: 'attendance.read', label: 'View Attendance Records', description: 'See check-in/check-out history for the team.' },
      { key: 'attendance.approve.late_arrival', label: 'Approve Late Arrivals', description: 'Review and approve or reject late check-ins.' },
      { key: 'attendance.approve.wfh', label: 'Approve Work From Home', description: 'Review and approve or reject Work From Home check-ins and home-location change requests.' },
      { key: 'attendance.approve.corrections', label: 'Approve Attendance Corrections', description: 'Review and approve or reject employee-submitted corrections (missed check-in/out, wrong location flagged).' },
      { key: 'attendance.approve', label: 'Approve All Attendance Requests (general)', description: 'General bucket — anyone holding this can approve every request type above regardless of the specific toggles.' },
      { key: 'attendance.edit', label: 'Edit Attendance Records', description: 'Directly correct an existing attendance record\'s status or times (e.g. flip a wrongly-marked Absent to Present) — the fix reflects immediately in attendance history, leave, and payroll.' },
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
      { key: 'leave.edit', label: 'Amend Leave History', description: 'Change the dates, type, or outcome of an already-decided leave request — the fix reflects immediately in leave history and payroll.' },
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
    // One receive/resolve PAIR per violation type, instead of one bucket
    // covering everything — so a tenant admin can e.g. give a floor
    // supervisor visibility into break overstays without also handing them
    // fraud/spoofing alerts. 'Resolve' covers both accept AND reject in one
    // toggle — matching the same read/write shape used everywhere else in
    // this catalog (attendance.approve, leave.approve, employee.terminate.
    // approve all gate approve+reject together; there's no reason alerts
    // should be the one place split into three). 'alerts.receive'/'resolve'
    // below are kept as a general/legacy bucket: anyone already holding them
    // keeps seeing/resolving every alert type (no regression), and they
    // still cover the two types with no dedicated toggle (security/fraud
    // signals, low-attendance compliance). Late-arrival alerts are
    // deliberately NOT duplicated here — they already have their own
    // dedicated toggle under Attendance ('attendance.approve.late_arrival').
    category: 'Timing Alerts',
    icon: 'AlertTriangle',
    features: [
      { key: 'alerts.break_violation.receive', label: 'Receive Break Violation Alerts', description: 'Get notified when an employee overstays a break or leaves the geofence while on break.' },
      { key: 'alerts.break_violation.resolve', label: 'Resolve Break Violation Alerts', description: 'Accept or dismiss a break violation alert.' },
      { key: 'alerts.geofence_exit.receive', label: 'Receive GPS Out-of-Bounds Alerts', description: 'Get notified when a clocked-in employee\'s location drifts outside the company area during working hours (not on break).' },
      { key: 'alerts.geofence_exit.resolve', label: 'Resolve GPS Out-of-Bounds Alerts', description: 'Accept or dismiss a GPS out-of-bounds alert (e.g. dismiss a legitimate off-site errand).' },
      { key: 'alerts.security.receive', label: 'Receive Security & Fraud Alerts', description: 'Get notified of spoofing signals and unverified auto-checkouts.' },
      { key: 'alerts.security.resolve', label: 'Resolve Security & Fraud Alerts', description: 'Accept or dismiss a security/fraud alert.' },
      { key: 'alerts.low_attendance.receive', label: 'Receive Low-Attendance Alerts', description: 'Get notified when an employee\'s monthly attendance percentage drops below the configured threshold.' },
      { key: 'alerts.receive', label: 'Receive All Other Alerts (general)', description: 'General alert bucket — anyone holding this sees every alert type regardless of the specific toggles above.' },
      { key: 'alerts.resolve', label: 'Resolve All Other Alerts (general)', description: 'General resolve permission (accept or dismiss) across every alert type.' },
    ],
  },
  {
    // Whether someone is even eligible to be routed a ticket at all is NOT
    // gated by this — routing follows the real org hierarchy (manager -> GM
    // -> tenant_admin, see services/escalation.ts) regardless of privileges,
    // since a ticket must always reach someone. This privilege instead
    // gates the manual "view every ticket / act on any ticket" override —
    // tenant_admin has it implicitly; a delegated HR/ops role can be given
    // it to act as a backup resolver across the whole tenant.
    category: 'Tickets & Disputes',
    icon: 'Ticket',
    features: [
      { key: 'tickets.manage', label: 'Manage All Tickets', description: 'View and act on every ticket tenant-wide, not just ones routed to you personally.' },
    ],
  },
  {
    category: 'Company Announcements',
    icon: 'Megaphone',
    features: [
      { key: 'tenant.policy.manage', label: 'Set Company Policy Announcement', description: 'Write or update the company-wide policy banner shown on every employee and admin dashboard.' },
    ],
  },
  {
    // Capabilities that used to be hardcoded to `role === 'tenant_admin'`
    // with no delegation path at all. Folded into the same catalog as
    // everything else so a tenant admin can choose to hand any of these to
    // a trusted role instead of being the sole person who can ever do them —
    // per the standing "no capability is special-cased, everything is a
    // toggle" rule. tenant_admin/super_admin still hold all of these
    // implicitly (hasPrivilege() short-circuits true for those two roles),
    // so nothing changes unless the admin explicitly grants one of these.
    category: 'Administration',
    icon: 'ShieldCheck',
    features: [
      { key: 'tenant.config.manage', label: 'Manage Company Policy Settings', description: 'Change WiFi/GPS geofence rules, shift defaults, grace period, break budget, and other org-wide policy settings.' },
      { key: 'employee.terminate.approve', label: 'Approve Termination Requests', description: 'Review and approve or reject termination requests submitted by delegated staff.' },
      { key: 'gdpr.manage', label: 'Manage Data Privacy (GDPR)', description: 'Erase a terminated employee\'s personal data on request, per data-privacy regulations.' },
      { key: 'webhooks.manage', label: 'Manage Webhooks & Integrations', description: 'Create, view, and remove outbound webhook subscriptions for external integrations.' },
      { key: 'serviceAccounts.manage', label: 'Manage API Keys (Service Accounts)', description: 'Create and revoke machine-to-machine API keys used by external integrations.' },
    ],
  },
];

// Flat set of every valid catalog key, for quick membership checks
// (e.g. rejecting a role-privilege update that references an unknown key).
export const FEATURE_CATALOG_KEYS: Set<string> = new Set(
  FEATURE_CATALOG.flatMap((c) => c.features.map((f) => f.key))
);

// key -> the other key(s) it's useless without. Only genuinely hard
// dependencies belong here (not "commonly granted together") — a
// '.resolve' toggle with no matching '.receive' means the grantee can be
// routed alerts they're not allowed to even see, which is a real broken
// state, not just an unusual one. Consumed by both directions in the UI
// (see FeatureCatalogGrid.tsx): granting the dependent auto-grants the
// dependency; revoking the dependency warns about (and cascades to) every
// dependent currently granted, before the change is saved.
export const FEATURE_DEPENDENCIES: Record<string, string[]> = {
  'alerts.break_violation.resolve': ['alerts.break_violation.receive'],
  'alerts.geofence_exit.resolve': ['alerts.geofence_exit.receive'],
  'alerts.security.resolve': ['alerts.security.receive'],
  'alerts.resolve': ['alerts.receive'],
};
