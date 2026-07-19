import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { User } from '../lib/auth';
import PortalShell, { type PortalNavItem } from '../components/PortalShell';
import DataTable from '../components/DataTable';
import StatCard from '../components/StatCard';
import type { ColumnDef } from '@tanstack/react-table';
import QrAttendanceDisplay from '../components/dashboard/QrAttendanceDisplay';
import EmployeeDetailPanel from '../components/EmployeeDetailPanel';
import LeaveManagementPage from './LeaveManagementPage';
import PayrollPage from './PayrollPage';
import EmployeeDirectory from './EmployeeDirectory';
import TeamsPage from './TeamsPage';
// Lazy so Leaflet is code-split out of the main bundle.
const LocationPicker = lazy(() => import('../components/LocationPicker'));
import {
  LayoutDashboard, Users, Users2, Building2, ShieldCheck, Bell,
  ScrollText, AlertTriangle, Smartphone, X, ClipboardCheck, Home, Clock, MapPin, Download,
  QrCode, ScanLine, Activity, Power, Play, ExternalLink, TrendingUp, CalendarDays, Banknote,
  CheckCircle2, UserX, AlarmClock, CalendarClock,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, AreaChart, Area
} from 'recharts';

// Warm the lazy chunks for the other sidebar destinations as soon as the
// Dashboard mounts, so clicking Leave Management/Payroll/Directory resolves
// the already-fetched module instantly instead of showing the Suspense
// fallback flash — the visible cause of "navigating feels like a reload".
// Fire-and-forget; failures here are harmless (the route's own Suspense
// boundary still handles a slow/failed fetch normally on click).
let navPagesPreloaded = false;
function preloadNavPages() {
  if (navPagesPreloaded) return;
  navPagesPreloaded = true;
  import('./LeaveManagementPage');
  import('./PayrollPage');
  import('./EmployeeDirectory');
}

export default function Dashboard({ user, onLogout }: { user: User, onLogout: () => void }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const token = localStorage.getItem('auth_token');

  useEffect(() => { preloadNavPages(); }, []);

  // The caller's own effective privileges — used to hide sidebar
  // destinations (Leave Management, Payroll, Directory) the current user
  // doesn't actually have access to, instead of showing the tab and letting
  // the page itself render "Access Denied" (e.g. a manager who wasn't
  // granted payroll.read/payroll.manage). 'ALL' (super_admin/tenant_admin)
  // always passes every check. Starts as 'ALL' so nothing flashes hidden
  // then reappears for the two admin tiers while this loads.
  const [myPrivileges, setMyPrivileges] = useState<string[] | 'ALL'>('ALL');
  useEffect(() => {
    fetch('/api/tenant/my-privileges', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => { if (d.privileges) setMyPrivileges(d.privileges); })
      .catch(() => {
        // Network hiccup — default already permissive ('ALL') so a
        // temporary failure never spuriously hides nav items for an admin;
        // for anyone else the underlying page's own privilege check still
        // protects the data even if a hidden tab briefly shows.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const hasAnyPrivilege = (...keys: string[]) => myPrivileges === 'ALL' || keys.some((k) => myPrivileges.includes(k));

  // Which user's EmployeeDetailPanel (attendance calendar + leave + payroll)
  // is currently open, if any — set from any clickable name across this
  // page (drill-down tables, Pending Approvals, Your Team roster).
  const [detailUserId, setDetailUserId] = useState<number | null>(null);

  // Unified notifications list
  const [notifications, setNotifications] = useState<any[]>([]);

  // Tab selection:
  // For Super Admin: 'requests' | 'notifications'
  // For Tenant Admin (adminSubTab, nested under 'administration'): 'settings' | 'devices' | 'notifications' | 'ledger' | 'roles' | 'branches'
  const [activeTab, setActiveTab] = useState<string>('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // ==========================================
  // AUDIT LEDGER STATES & FUNCTIONS
  // ==========================================
  const [ledger, setLedger] = useState<any[]>([]);
  const [ledgerVerifying, setLedgerVerifying] = useState(false);
  const [ledgerVerificationResult, setLedgerVerificationResult] = useState<{
    isValid: boolean;
    invalidBlocks: number[];
    verifiedBlocksCount: number;
  } | null>(null);

  const fetchLedgerData = async () => {
    try {
      const res = await fetch('/api/tenant/ledger', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.ledger) {
        setLedger(data.ledger);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Zero-dependency CSV export — no export library exists anywhere in this
  // app yet, and pulling in xlsx/jspdf for Excel/PDF is a bigger call than
  // this task needs; a hand-built CSV blob covers the common case (opens
  // straight into Excel/Sheets) without a new dependency.
  const downloadCsv = (filename: string, rows: (string | number)[][]) => {
    const escapeCell = (cell: string | number) => {
      const str = String(cell ?? '');
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const csv = rows.map(row => row.map(escapeCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportLedgerCsv = () => {
    const header = ['Timestamp', 'Actor', 'Actor ID', 'Action', 'IP Address', 'Device Info', 'Block Hash'];
    const rows = ledger.map((log: any) => [
      new Date(log.timestamp).toLocaleString(),
      log.actorName,
      log.actorId ?? 'SYS',
      log.action,
      log.ipAddress || '',
      log.deviceInfo || '',
      log.hash,
    ]);
    downloadCsv(`audit-ledger-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...rows]);
  };

  const verifyLedgerIntegrity = async () => {
    setLedgerVerifying(true);
    setLedgerVerificationResult(null);
    try {
      await new Promise(resolve => setTimeout(resolve, 1200)); // premium verification scan feel
      const res = await fetch('/api/tenant/ledger/verify', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setLedgerVerificationResult({
        isValid: data.isValid,
        invalidBlocks: data.invalidBlocks || [],
        verifiedBlocksCount: data.verifiedBlocksCount || 0
      });
      fetchLedgerData();
    } catch (err) {
      console.error(err);
    } finally {
      setLedgerVerifying(false);
    }
  };


  // ==========================================
  // SUPER ADMIN STATES & FUNCTIONS
  // ==========================================
  const [tenancyRequests, setTenancyRequests] = useState<any[]>([]);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>(['kyc', 'gps_geofence']);
  const [selectedPlanOverride, setSelectedPlanOverride] = useState<string>('');
  const [allTenants, setAllTenants] = useState<any[]>([]);
  const [superAnalytics, setSuperAnalytics] = useState<any>(null);

  const fetchSuperAdminData = async () => {
    try {
      const reqsRes = await fetch('/api/super/requests', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const reqsData = await reqsRes.json();
      if (reqsData.requests) setTenancyRequests(reqsData.requests);

      const notifyRes = await fetch('/api/super/notifications', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const notifyData = await notifyRes.json();
      if (notifyData.notifications) setNotifications(notifyData.notifications);

      const tenantsRes = await fetch('/api/super/tenants', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const tenantsData = await tenantsRes.json();
      if (tenantsData.tenants) setAllTenants(tenantsData.tenants);

      const analyticsRes = await fetch('/api/super/analytics', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const analyticsData = await analyticsRes.json();
      setSuperAnalytics(analyticsData);
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleTenantStatus = async (tenantId: number, currentStatus: string) => {
    const nextStatus = currentStatus === 'suspended' ? 'active' : 'suspended';
    if (!window.confirm(`${nextStatus === 'suspended' ? 'Suspend' : 'Reactivate'} this tenant? ${nextStatus === 'suspended' ? 'Their users will be immediately blocked from logging in or checking in.' : ''}`)) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/super/tenants/status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ tenantId, status: nextStatus })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update tenant status');
      setSuccess(`Tenant ${nextStatus === 'suspended' ? 'suspended' : 'reactivated'} successfully.`);
      fetchSuperAdminData();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setError(err.message || 'Failed to update tenant status');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenApproveModal = (req: any) => {
    setSelectedRequest(req);
    setSelectedPlanOverride(req.plan || 'Standard');
    setShowApprovalModal(true);
  };

  const handleApproveRequest = async () => {
    if (!selectedRequest) return;
    setLoading(true);
    setError('');
    
    try {
      const res = await fetch('/api/super/approve', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          requestId: selectedRequest.id,
          featuresAllowed: selectedFeatures,
          plan: selectedPlanOverride || selectedRequest.plan
        })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to approve onboarding');

      setSuccess(`Tenant "${selectedRequest.companyName}" approved successfully! Temporary credentials mailed.`);
      setShowApprovalModal(false);
      fetchSuperAdminData();
      
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setError(err.message || 'Approval failed');
    } finally {
      setLoading(false);
    }
  };

  // ==========================================
  // TENANT ADMIN STATES & FUNCTIONS
  // ==========================================
  const [wifiSsid, setWifiSsid] = useState('');
  const [officeIp, setOfficeIp] = useState('');
  const [wifiCheckEnabled, setWifiCheckEnabled] = useState(false);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radius, setRadius] = useState('100');

  // Company Policy announcement banner — shown on both this dashboard and
  // the employee dashboard; editing gated behind 'tenant.policy.manage'.
  const [policyAnnouncement, setPolicyAnnouncement] = useState('');
  const [policyExpanded, setPolicyExpanded] = useState(false);
  const [policyDraft, setPolicyDraft] = useState('');
  const [policySaving, setPolicySaving] = useState(false);

  const fetchPolicyAnnouncement = async () => {
    try {
      const res = await fetch('/api/tenant/policy', { headers: { 'Authorization': `Bearer ${token}` } });
      const data = await res.json();
      setPolicyAnnouncement(data.policyAnnouncement || '');
      setPolicyDraft(data.policyAnnouncement || '');
    } catch { /* non-critical, banner just stays hidden */ }
  };

  const handleSavePolicy = async () => {
    setPolicySaving(true);
    try {
      const res = await fetch('/api/tenant/policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ policyAnnouncement: policyDraft }),
      });
      const data = await res.json();
      if (res.ok) setPolicyAnnouncement(data.policyAnnouncement || '');
    } finally {
      setPolicySaving(false);
    }
  };

  // Attendance policy fields — configurable by the tenant admin, actually
  // used by the backend's late-arrival, half-day, and break-budget logic
  // (previously these silently stayed at hardcoded defaults forever).
  const [shiftStart, setShiftStart] = useState('09:00');
  const [shiftEnd, setShiftEnd] = useState('18:00');
  const [gracePeriodMins, setGracePeriodMins] = useState('15');
  const [halfDayMins, setHalfDayMins] = useState('240');
  const [dailyBreakBudgetMins, setDailyBreakBudgetMins] = useState('60');
  const [weekendConfig, setWeekendConfig] = useState<string[]>(['Saturday', 'Sunday']);
  const [minAttendancePercent, setMinAttendancePercent] = useState('75');

  // Work From Home (WFH) policy — additive; mirrors the office policy
  // fields above and is saved via the same /api/tenant/config/update call.
  // Allowed-roles options come from `allRoleNames` (this tenant's real,
  // possibly-custom role list — see refreshRoleSetupStatus above) rather
  // than a hardcoded ['employee','manager','HR','GM'], so a custom role
  // (e.g. "L1") actually shows up here instead of being un-selectable.
  const WEEKDAY_OPTIONS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const [wfhEnabled, setWfhEnabled] = useState(false);
  const [wfhAllowedRoles, setWfhAllowedRoles] = useState<string[]>([]);
  const [wfhMaxDaysPerMonth, setWfhMaxDaysPerMonth] = useState('');
  const [wfhAllowedWeekdays, setWfhAllowedWeekdays] = useState<string[]>(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
  const [wfhRadiusMeters, setWfhRadiusMeters] = useState('200');
  const [wfhApprovalRequired, setWfhApprovalRequired] = useState(true);
  const [wfhRequireReason, setWfhRequireReason] = useState(true);
  const [wfhLateLoginGraceMins, setWfhLateLoginGraceMins] = useState('');

  const toggleWfhRole = (role: string) => {
    setWfhAllowedRoles(prev => prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]);
  };
  const toggleWfhWeekday = (day: string) => {
    setWfhAllowedWeekdays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  };

  // Dynamic QR Attendance policy — its own PUT /api/qr/config endpoint
  // (not bundled into handleSaveConfig/`/api/tenant/config/update`), so its
  // own form/state/save handler, same pattern as the Holiday Calendar
  // section below.
  const QR_ROTATION_CHOICES = [15, 30, 60, 120];
  const [qrEnabled, setQrEnabled] = useState(false);
  const [qrRotationSeconds, setQrRotationSeconds] = useState(30);
  const [qrRequireGps, setQrRequireGps] = useState(true);
  const [qrRequireWifi, setQrRequireWifi] = useState(false);
  const [qrRequireFace, setQrRequireFace] = useState(true);
  const [qrGeofenceRadiusMeters, setQrGeofenceRadiusMeters] = useState('');
  const [qrRequireDeviceTrust, setQrRequireDeviceTrust] = useState(false);
  const [qrConfigSaving, setQrConfigSaving] = useState(false);

  const fetchQrConfig = async () => {
    try {
      const res = await fetch('/api/qr/config', { headers: { 'Authorization': `Bearer ${token}` } });
      if (!res.ok) return;
      const data = await res.json();
      if (data.policy) {
        setQrEnabled(data.policy.qrEnabled);
        setQrRotationSeconds(data.policy.rotationSeconds);
        setQrRequireGps(data.policy.requireGps);
        setQrRequireWifi(data.policy.requireWifi);
        setQrRequireFace(data.policy.requireFace);
        setQrGeofenceRadiusMeters(data.policy.geofenceRadiusMeters ? String(data.policy.geofenceRadiusMeters) : '');
        setQrRequireDeviceTrust(data.policy.requireDeviceTrust);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveQrConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setQrConfigSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/qr/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          qrEnabled,
          qrRotationSeconds,
          qrRequireGps,
          qrRequireWifi,
          qrRequireFace,
          qrGeofenceRadiusMeters: qrGeofenceRadiusMeters ? parseInt(qrGeofenceRadiusMeters, 10) : null,
          qrRequireDeviceTrust,
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save QR Attendance policy');
      setSuccess('QR Attendance policy saved successfully.');
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setError(err.message || 'Failed to save QR Attendance policy');
    } finally {
      setQrConfigSaving(false);
    }
  };

  const [tenantAnalytics, setTenantAnalytics] = useState<any>(null);
  const [wfhStats, setWfhStats] = useState<any>(null);

  // ==========================================
  // DUAL-MODE HOME DASHBOARD STATE
  // ==========================================
  // 'organization' = admin org overview; 'self-service' = personal attendance workspace
  const [homeTabMode, setHomeTabMode] = useState<'organization' | 'self-service'>('organization');

  // 30-day attendance & lateness trend data for the AreaChart
  const [tenantTrends, setTenantTrends] = useState<any[]>([]);

  // ==========================================
  // SELF-SERVICE (My Space) STATE
  // ==========================================
  // Personal attendance state for the logged-in admin (used in Self Service mode)
  const [selfCheckInTime, setSelfCheckInTime] = useState<string | null>(null);
  const [selfHoursWorked, setSelfHoursWorked] = useState('00:00:00');
  const [selfActiveBreak, setSelfActiveBreak] = useState<any>(null);
  const [selfBreakTimer, setSelfBreakTimer] = useState('00:00');
  const [selfBreakType, setSelfBreakType] = useState('Lunch');
  const [selfBreaksToday, setSelfBreaksToday] = useState<any[]>([]);
  const [selfBudgetMins, setSelfBudgetMins] = useState(60);
  const [selfRemainingMins, setSelfRemainingMins] = useState(60);
  const [selfCheckingOut, setSelfCheckingOut] = useState(false);
  const [selfTodayPending, setSelfTodayPending] = useState(false);
  const [selfCorrections, setSelfCorrections] = useState<any[]>([]);
  const [showSelfCorrectionModal, setShowSelfCorrectionModal] = useState(false);
  const [selfCorrectionType, setSelfCorrectionType] = useState('check_in');
  const [selfCorrectionDate, setSelfCorrectionDate] = useState('');
  const [selfCorrectionTime, setSelfCorrectionTime] = useState('');
  const [selfCorrectionReason, setSelfCorrectionReason] = useState('');
  const [selfCorrectionSubmitting, setSelfCorrectionSubmitting] = useState(false);
  // True after a correction is submitted (shows a thank-you state in the modal)
  const [selfCorrectionSubmitted, setSelfCorrectionSubmitted] = useState(false);

  // Attendance sub-tab state (used by the quick-access shortcut cards in the org view
  // to deep-link into the correct attendance sub-section)
  const [attendanceSubTab, setAttendanceSubTab] = useState<string>('status');
  const [adminSubTab, setAdminSubTab] = useState<string | null>(null);

  // Progressive disclosure for the Attendance section — advanced admin options
  // (corrections, late arrivals, QR, violations, etc.) are hidden until the
  // user explicitly expands them via this toggle.
  const [showOtherOptions, setShowOtherOptions] = useState(false);
  const [otherOptionsTab, setOtherOptionsTab] = useState<string | null>(null);

  // Fetch current admin's personal attendance state for Self-Service mode
  const fetchSelfServiceData = async () => {
    try {
      // Today's check-in
      const todayRes = await fetch('/api/attendance/today', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (todayRes.ok) {
        const d = await todayRes.json();
        if (d.checkInTime) {
          setSelfCheckInTime(d.checkInTime);
          setSelfTodayPending(d.status === 'pending');
        } else {
          setSelfCheckInTime(null);
          setSelfTodayPending(false);
        }
      }

      // Active break
      const breakRes = await fetch('/api/breaks/active', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (breakRes.ok) {
        const bd = await breakRes.json();
        setSelfActiveBreak(bd.activeBreak || null);
      }

      // Today's breaks + remaining budget
      const breaksRes = await fetch('/api/breaks/today', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (breaksRes.ok) {
        const bd = await breaksRes.json();
        setSelfBreaksToday(bd.breaks || []);
        if (bd.budgetMins != null) setSelfBudgetMins(bd.budgetMins);
        if (bd.remainingMins != null) setSelfRemainingMins(bd.remainingMins);
      }

      // Personal correction requests
      const corrRes = await fetch('/api/attendance/my-corrections', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (corrRes.ok) {
        const cd = await corrRes.json();
        setSelfCorrections(cd.corrections || []);
      }
    } catch (err) {
      console.error('[self-service] fetch error:', err);
    }
  };

  // Fetch 30-day attendance trends for the AreaChart
  const fetchTenantTrends = async () => {
    try {
      const res = await fetch('/api/tenant/analytics/trends', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return;
      const d = await res.json();
      if (Array.isArray(d.trends)) setTenantTrends(d.trends);
    } catch (err) {
      console.error('[trends] fetch error:', err);
    }
  };

  // Self-service: start a break
  const handleStartSelfBreak = async () => {
    if (!selfCheckInTime || selfActiveBreak) return;
    try {
      const res = await fetch('/api/breaks/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ breakType: selfBreakType })
      });
      if (res.ok) await fetchSelfServiceData();
    } catch (err) {
      console.error('[self-service] start break error:', err);
    }
  };

  // Self-service: end the active break
  const handleEndSelfBreak = async () => {
    if (!selfActiveBreak) return;
    try {
      const res = await fetch('/api/breaks/end', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setSelfActiveBreak(null);
        await fetchSelfServiceData();
      }
    } catch (err) {
      console.error('[self-service] end break error:', err);
    }
  };

  // Self-service: punch out
  const handleSelfCheckout = async () => {
    if (!selfCheckInTime || selfActiveBreak) return;
    setSelfCheckingOut(true);
    try {
      const res = await fetch('/api/attendance/checkout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setSelfCheckInTime(null);
        setSelfHoursWorked('00:00:00');
        await fetchSelfServiceData();
      }
    } catch (err) {
      console.error('[self-service] checkout error:', err);
    } finally {
      setSelfCheckingOut(false);
    }
  };

  // Self-service: submit a correction request
  const handleSubmitSelfCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selfCorrectionDate || !selfCorrectionReason) return;
    setSelfCorrectionSubmitting(true);
    try {
      const res = await fetch('/api/tenant/corrections/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          requestType: selfCorrectionType,
          requestedDate: selfCorrectionDate,
          requestedTime: selfCorrectionTime || undefined,
          reason: selfCorrectionReason,
        })
      });
      if (res.ok) {
        setSelfCorrectionSubmitted(true);
        setSelfCorrectionDate('');
        setSelfCorrectionTime('');
        setSelfCorrectionReason('');
        await fetchSelfServiceData();
        // Auto-close after a short delay so the user sees the success message
        setTimeout(() => {
          setShowSelfCorrectionModal(false);
          setSelfCorrectionSubmitted(false);
        }, 2000);
      }
    } catch (err) {
      console.error('[self-service] correction submit error:', err);
    } finally {
      setSelfCorrectionSubmitting(false);
    }
  };

  // Live work-hours ticker: updates every second when clocked in
  useEffect(() => {
    if (!selfCheckInTime) {
      setSelfHoursWorked('00:00:00');
      return;
    }
    const tick = () => {
      const start = new Date(selfCheckInTime).getTime();
      const elapsed = Math.max(0, Math.floor((Date.now() - start) / 1000));
      const h = Math.floor(elapsed / 3600).toString().padStart(2, '0');
      const m = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
      const s = (elapsed % 60).toString().padStart(2, '0');
      setSelfHoursWorked(`${h}:${m}:${s}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [selfCheckInTime]);

  // Live break-timer ticker: updates every second when a break is active
  useEffect(() => {
    if (!selfActiveBreak?.startTime) {
      setSelfBreakTimer('00:00');
      return;
    }
    const tick = () => {
      const start = new Date(selfActiveBreak.startTime).getTime();
      const elapsed = Math.max(0, Math.floor((Date.now() - start) / 1000));
      const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
      const s = (elapsed % 60).toString().padStart(2, '0');
      setSelfBreakTimer(`${m}:${s}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [selfActiveBreak]);

  // Fetch self-service data + trends when tenant admin loads the home tab
  useEffect(() => {
    if (user.role !== 'super_admin') {
      fetchSelfServiceData();
      fetchTenantTrends();
    }
  }, [user]);

  const fetchWfhStats = async () => {
    try {
      const res = await fetch('/api/tenant/wfh/stats', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return; // user may not have reports.view — fail quietly, matches fetchLedgerData's convention
      const data = await res.json();
      setWfhStats(data);
    } catch (err) {
      console.error(err);
    }
  };
  const [holidaysList, setHolidaysList] = useState<any[]>([]);
  const [newHolidayDate, setNewHolidayDate] = useState('');
  const [newHolidayName, setNewHolidayName] = useState('');
  const [corrections, setCorrections] = useState<any[]>([]);
  const [hasCorrectionsAccess, setHasCorrectionsAccess] = useState(false);
  const [pendingAttendance, setPendingAttendance] = useState<any[]>([]);
  const [hasAttendanceApprovalAccess, setHasAttendanceApprovalAccess] = useState(false);

  const fetchHolidays = async () => {
    try {
      const res = await fetch('/api/tenant/holidays', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.holidays) setHolidaysList(data.holidays);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHolidayDate || !newHolidayName) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/holidays', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ date: newHolidayDate, name: newHolidayName })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add holiday');
      setNewHolidayDate('');
      setNewHolidayName('');
      fetchHolidays();
    } catch (err: any) {
      setError(err.message || 'Failed to add holiday');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteHoliday = async (id: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tenant/holidays/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) { const data = await res.json(); throw new Error(data.error); }
      fetchHolidays();
    } catch (err: any) {
      setError(err.message || 'Failed to remove holiday');
    } finally {
      setLoading(false);
    }
  };

  const fetchCorrections = async () => {
    try {
      const res = await fetch('/api/tenant/corrections', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) { setHasCorrectionsAccess(false); return; }
      const data = await res.json();
      setHasCorrectionsAccess(true);
      if (data.corrections) setCorrections(data.corrections);
    } catch (err) {
      console.error(err);
    }
  };

  const handleResolveCorrection = async (correctionId: number, action: 'approve' | 'reject') => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/corrections/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ correctionId, action })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resolve request');
      setSuccess(`Correction request ${action === 'approve' ? 'approved' : 'rejected'}.`);
      fetchCorrections();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to resolve request');
    } finally {
      setLoading(false);
    }
  };

  // Late check-ins awaiting approval — an employee checked in late,
  // explained why, and the log was written as 'pending' instead of
  // 'approved' until someone with 'attendance.approve' resolves it.
  const fetchPendingAttendance = async () => {
    try {
      const res = await fetch('/api/tenant/attendance/pending', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) { setHasAttendanceApprovalAccess(false); return; }
      const data = await res.json();
      setHasAttendanceApprovalAccess(true);
      if (data.logs) setPendingAttendance(data.logs);
    } catch (err) {
      console.error(err);
    }
  };

  const handleResolveAttendance = async (logId: number, action: 'approve' | 'reject') => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/attendance/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ logId, action })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resolve request');
      setSuccess(`Late check-in ${action === 'approve' ? 'approved' : 'rejected — marked absent'}.`);
      fetchPendingAttendance();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to resolve request');
    } finally {
      setLoading(false);
    }
  };
  // Dynamic QR Attendance — access gated purely by permission (see
  // QR_PERMISSIONS in apps/admin/qr.ts), probed the same way every other
  // privilege-gated tab in this file is: try the real endpoint, read
  // whether it 403'd.
  const [hasQrAccess, setHasQrAccess] = useState(false);
  const [hasQrLogsAccess, setHasQrLogsAccess] = useState(false);
  const [qrSessionHistory, setQrSessionHistory] = useState<any[]>([]);
  const [qrScanLogs, setQrScanLogs] = useState<any[]>([]);

  const fetchQrAccess = async () => {
    try {
      const res = await fetch('/api/qr/current', { headers: { 'Authorization': `Bearer ${token}` } });
      setHasQrAccess(res.ok);
    } catch (err) {
      console.error(err);
    }
  };

  const handleOverrideQrScan = async (scanId: number) => {
    const reason = window.prompt('Reason for manually approving this failed QR scan (required, logged in the audit ledger):');
    if (!reason || !reason.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/qr/scans/${scanId}/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ reason: reason.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to override scan');
      setSuccess('QR scan overridden — attendance recorded.');
      fetchQrLogs();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to override scan');
    } finally {
      setLoading(false);
    }
  };

  const fetchQrLogs = async () => {
    try {
      const [historyRes, logsRes] = await Promise.all([
        fetch('/api/qr/history', { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch('/api/qr/logs', { headers: { 'Authorization': `Bearer ${token}` } }),
      ]);
      if (!historyRes.ok) { setHasQrLogsAccess(false); return; }
      setHasQrLogsAccess(true);
      const historyData = await historyRes.json();
      const logsData = await logsRes.json();
      if (historyData.sessions) setQrSessionHistory(historyData.sessions);
      if (logsData.scans) setQrScanLogs(logsData.scans);
    } catch (err) {
      console.error(err);
    }
  };

  // WFH home-location change requests — same approval convention as
  // corrections/late-arrivals above ('attendance.approve').
  const [wfhLocationRequests, setWfhLocationRequests] = useState<any[]>([]);
  const [hasWfhLocationAccess, setHasWfhLocationAccess] = useState(false);

  const fetchWfhLocationRequests = async () => {
    try {
      const res = await fetch('/api/tenant/wfh/location-change-requests', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) { setHasWfhLocationAccess(false); return; }
      const data = await res.json();
      setHasWfhLocationAccess(true);
      if (data.requests) setWfhLocationRequests(data.requests);
    } catch (err) {
      console.error(err);
    }
  };

  const handleResolveWfhLocationRequest = async (requestId: number, action: 'approve' | 'reject') => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/wfh/location-change-requests/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ requestId, action })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resolve request');
      setSuccess(`Home location request ${action === 'approve' ? 'approved' : 'rejected'}.`);
      fetchWfhLocationRequests();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to resolve request');
    } finally {
      setLoading(false);
    }
  };

  // Per-employee/per-day WFH ledger — gated by wfh.view_logs (delegable to
  // managers/HR/etc., same probe-the-endpoint pattern as QR logs above).
  const [wfhLedger, setWfhLedger] = useState<any[]>([]);
  const [hasWfhLedgerAccess, setHasWfhLedgerAccess] = useState(false);

  const fetchWfhLedger = async () => {
    try {
      const res = await fetch('/api/tenant/wfh/ledger', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) { setHasWfhLedgerAccess(false); return; }
      const data = await res.json();
      setHasWfhLedgerAccess(true);
      if (data.ledger) setWfhLedger(data.ledger);
    } catch (err) {
      console.error(err);
    }
  };

  const [attendanceAlerts, setAttendanceAlerts] = useState<any[]>([]);
  const [hasAlertsAccess, setHasAlertsAccess] = useState(false);

  const fetchAlerts = async () => {
    try {
      const res = await fetch('/api/tenant/alerts', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) { setHasAlertsAccess(false); return; } // user may not have alerts.receive — fail quietly
      const data = await res.json();
      setHasAlertsAccess(true);
      if (data.alerts) setAttendanceAlerts(data.alerts);
    } catch (err) {
      console.error(err);
    }
  };

  const handleResolveAlert = async (alertId: number, action: 'accept' | 'reject') => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/alerts/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ alertId, action })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resolve alert');
      setSuccess(`Alert ${action === 'accept' ? 'accepted' : 'rejected'}.`);
      fetchAlerts();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to resolve alert');
    } finally {
      setLoading(false);
    }
  };

  const toggleWeekendDay = (day: string) => {
    setWeekendConfig(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  };
  
  // Recruitment Form fields
  const [recruitedUsers, setRecruitedUsers] = useState<any[]>([]);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  // Empty by default (not e.g. 'Employee') so the <datalist> below shows every
  // suggestion — browsers filter datalist options to ones that substring-match
  // whatever's already typed, so a pre-filled value used to hide every option
  // that didn't literally contain that text.
  const [newUserRole, setNewUserRole] = useState('');
  const [newUserPrivileges, setNewUserPrivileges] = useState<string[]>([]);
  const [hasRecruitmentAccess, setHasRecruitmentAccess] = useState(false);

  // POST /api/tenant/users/create requires branchId/shiftId (every employee
  // must belong to a real branch and a real shift from day one) — these
  // fields drive that, sourced from the caller's own manageable branches
  // (GET /api/tenant/my-branches, already branch-scoped server-side) rather
  // than the unscoped /api/branches.
  const [hireBranches, setHireBranches] = useState<any[]>([]);
  const [hireShifts, setHireShifts] = useState<any[]>([]);
  const [newUserBranchId, setNewUserBranchId] = useState('');
  const [newUserShiftId, setNewUserShiftId] = useState('');

  // Branch options for the Recruit Team Member form above — fetched once;
  // not gated behind any tab check since it's cheap and the form needs it
  // ready the moment Administration > Recruitment is opened.
  useEffect(() => {
    fetch('/api/tenant/my-branches', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        const list = Array.isArray(d.branches) ? d.branches : [];
        setHireBranches(list);
        if (list.length > 0) setNewUserBranchId((current) => current || String(list[0].id));
      })
      .catch(() => { /* Recruitment form just shows "no branches yet" below */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Shift options depend on which branch is selected above.
  useEffect(() => {
    if (!newUserBranchId) { setHireShifts([]); return; }
    fetch(`/api/branches/${newUserBranchId}/shifts`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        const list = Array.isArray(d.shifts) ? d.shifts : [];
        setHireShifts(list);
        setNewUserShiftId((current) => (list.some((s: any) => String(s.id) === current) ? current : (list[0] ? String(list[0].id) : '')));
      })
      .catch(() => setHireShifts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newUserBranchId]);

  // "Set up this new role" prompt — a banner shown right after hiring the
  // first person into a brand-new role (POST /api/tenant/users/create's
  // isNewRole flag), plus a persistent list (derived fresh from real data
  // every time this loads, not stored anywhere) of any role that has
  // privilege defaults but no payroll role-default yet — so the reminder
  // survives a dismiss/navigate-away instead of being a one-time toast.
  const [newRolePrompt, setNewRolePrompt] = useState<string | null>(null);
  const [allRoleNames, setAllRoleNames] = useState<string[]>([]);
  const [payrollConfiguredRoleNames, setPayrollConfiguredRoleNames] = useState<string[]>([]);
  const refreshRoleSetupStatus = () => {
    fetch('/api/tenant/roles', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setAllRoleNames(Array.isArray(d.roles) ? d.roles.map((r: any) => r.roleName) : []))
      .catch(() => {});
    fetch('/api/tenant/payroll/role-defaults', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setPayrollConfiguredRoleNames(Array.isArray(d.roleDefaults) ? d.roleDefaults.map((r: any) => r.roleName) : []))
      .catch(() => {});
  };
  useEffect(() => { refreshRoleSetupStatus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const rolesNeedingPayrollSetup = allRoleNames.filter((r) => !payrollConfiguredRoleNames.includes(r));

  // Home tab (organization overview) — extra widgets: pending leave, payroll
  // this month, department breakdown, pending approvals, and manager "your
  // team" scoping. Each fetch fails quietly (mirrors the recruitedUsers/
  // hasRecruitmentAccess pattern above) so a caller without the underlying
  // privilege just doesn't see that widget, rather than erroring the page.
  const [homeLeaveRequests, setHomeLeaveRequests] = useState<any[]>([]);
  const [hasLeaveAccess, setHasLeaveAccess] = useState(false);
  const [homePayrollOverview, setHomePayrollOverview] = useState<any>(null);
  const [hasPayrollAccess, setHasPayrollAccess] = useState(false);
  // Full employee roster (department + managerId) — reports.view/employee.read
  // gated. Powers both the admin's Department Breakdown widget and a
  // manager's "Your Team" direct-report scoping (data-derived, not role-name).
  const [homeEmployees, setHomeEmployees] = useState<any[]>([]);
  const [hasEmployeesAccess, setHasEmployeesAccess] = useState(false);

  // Device Requests fields
  const [deviceRequests, setDeviceRequests] = useState<any[]>([]);
  const [hasDevicesAccess, setHasDevicesAccess] = useState(false);

  const fetchTenantAdminData = async () => {
    try {
      // 1. Fetch config
      const configRes = await fetch('/api/tenant/config', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const configData = await configRes.json();
      if (configData.tenant) {
        setWifiSsid(configData.tenant.wifiSsid || '');
        setOfficeIp(configData.tenant.officeIp || '');
        setWifiCheckEnabled(!!configData.tenant.wifiCheckEnabled);
        setLat(configData.tenant.locationLat ? configData.tenant.locationLat.toString() : '');
        setLng(configData.tenant.locationLng ? configData.tenant.locationLng.toString() : '');
        setRadius(configData.tenant.locationRadiusMeters ? configData.tenant.locationRadiusMeters.toString() : '100');
        setShiftStart(configData.tenant.shiftStart || '09:00');
        setShiftEnd(configData.tenant.shiftEnd || '18:00');
        setGracePeriodMins(configData.tenant.gracePeriodMins != null ? configData.tenant.gracePeriodMins.toString() : '15');
        setHalfDayMins(configData.tenant.halfDayMins != null ? configData.tenant.halfDayMins.toString() : '240');
        setDailyBreakBudgetMins(configData.tenant.dailyBreakBudgetMins != null ? configData.tenant.dailyBreakBudgetMins.toString() : '60');
        setMinAttendancePercent(configData.tenant.minAttendancePercent != null ? configData.tenant.minAttendancePercent.toString() : '75');
        if (Array.isArray(configData.tenant.weekendConfig)) setWeekendConfig(configData.tenant.weekendConfig);

        setWfhEnabled(!!configData.tenant.wfhEnabled);
        if (Array.isArray(configData.tenant.wfhAllowedRoles)) setWfhAllowedRoles(configData.tenant.wfhAllowedRoles);
        setWfhMaxDaysPerMonth(configData.tenant.wfhMaxDaysPerMonth != null ? configData.tenant.wfhMaxDaysPerMonth.toString() : '');
        if (Array.isArray(configData.tenant.wfhAllowedWeekdays)) setWfhAllowedWeekdays(configData.tenant.wfhAllowedWeekdays);
        setWfhRadiusMeters(configData.tenant.wfhRadiusMeters != null ? configData.tenant.wfhRadiusMeters.toString() : '200');
        setWfhApprovalRequired(configData.tenant.wfhApprovalRequired !== false);
        setWfhRequireReason(configData.tenant.wfhRequireReason !== false);
        setWfhLateLoginGraceMins(configData.tenant.wfhLateLoginGraceMins != null ? configData.tenant.wfhLateLoginGraceMins.toString() : '');
      }

      // 2. Fetch users (fails quietly if this user wasn't granted employee.read/employee.create)
      const usersRes = await fetch('/api/tenant/users', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setHasRecruitmentAccess(usersRes.ok);
      const usersData = await usersRes.json();
      if (usersData.users) setRecruitedUsers(usersData.users);

      // 3. Fetch device change requests (fails quietly if this user wasn't granted settings.edit)
      const deviceRes = await fetch('/api/tenant/device-requests', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setHasDevicesAccess(deviceRes.ok);
      const deviceData = await deviceRes.json();
      if (deviceData.requests) setDeviceRequests(deviceData.requests);

      // 4. Fetch tenant notifications
      const notifyRes = await fetch('/api/tenant/notifications', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const notifyData = await notifyRes.json();
      if (notifyData.notifications) setNotifications(notifyData.notifications);

      // Fetch audit ledger data
      await fetchLedgerData();

      // Fetch Company Policy announcement (view-only unless the caller has
      // tenant.policy.manage; the endpoint itself doesn't gate reads)
      await fetchPolicyAnnouncement();

      // Fetch analytics snapshot
      try {
        const analyticsRes = await fetch('/api/tenant/analytics', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const analyticsData = await analyticsRes.json();
        setTenantAnalytics(analyticsData);
      } catch (e) { console.error(e); }

      // Fetch alerts (fails quietly if this user wasn't granted alerts.receive)
      await fetchAlerts();

      // Fetch holiday calendar (visible to everyone in the tenant)
      await fetchHolidays();

      // Fetch correction requests (fails quietly if this user wasn't granted attendance.approve)
      await fetchCorrections();

      // Fetch late check-ins pending approval (same privilege gate)
      await fetchPendingAttendance();

      // Fetch WFH home-location change requests (same privilege gate)
      await fetchWfhLocationRequests();

      // Fetch WFH ledger (per-employee/per-day, gated by wfh.view_logs)
      await fetchWfhLedger();

      // Fetch WFH dashboard stats (fails quietly if this user wasn't granted reports.view)
      await fetchWfhStats();

      // Dynamic QR Attendance — display access + logs/history (each fails
      // quietly if this user wasn't granted the corresponding permission)
      await fetchQrAccess();
      await fetchQrLogs();
      await fetchQrConfig();

      // Home tab widgets: leave requests (fails quietly if this user wasn't
      // granted leave.approve/leave.read) — backs Pending Leave Requests +
      // Pending Approvals widget.
      try {
        const leaveRes = await fetch('/api/tenant/leave/requests', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        setHasLeaveAccess(leaveRes.ok);
        const leaveData = await leaveRes.json();
        if (leaveData.requests) setHomeLeaveRequests(leaveData.requests);
      } catch (e) { console.error(e); }

      // Payroll overview (fails quietly if this user wasn't granted
      // payroll.read/reports.view) — backs the Payroll This Month card.
      try {
        const payrollRes = await fetch('/api/tenant/payroll/overview', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        setHasPayrollAccess(payrollRes.ok);
        const payrollData = await payrollRes.json();
        if (payrollData.totals) setHomePayrollOverview(payrollData);
      } catch (e) { console.error(e); }

      // Employee roster (fails quietly if this user wasn't granted
      // employee.read/reports.view) — backs Department Breakdown and the
      // manager-mode "Your Team" section.
      try {
        const employeesRes = await fetch('/api/tenant/employees', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        setHasEmployeesAccess(employeesRes.ok);
        const employeesData = await employeesRes.json();
        if (employeesData.employees) setHomeEmployees(employeesData.employees);
      } catch (e) { console.error(e); }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/tenant/config/update', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          wifiSsid,
          officeIp,
          wifiCheckEnabled,
          lat: lat ? parseFloat(lat) : undefined,
          lng: lng ? parseFloat(lng) : undefined, 
          radius: radius ? parseInt(radius, 10) : undefined,
          shiftStart,
          shiftEnd,
          gracePeriodMins: parseInt(gracePeriodMins, 10),
          halfDayMins: parseInt(halfDayMins, 10),
          dailyBreakBudgetMins: parseInt(dailyBreakBudgetMins, 10),
          minAttendancePercent: parseInt(minAttendancePercent, 10),
          weekendConfig,
          wfhEnabled,
          wfhAllowedRoles,
          wfhMaxDaysPerMonth: wfhMaxDaysPerMonth ? parseInt(wfhMaxDaysPerMonth, 10) : null,
          wfhAllowedWeekdays,
          wfhRadiusMeters: wfhRadiusMeters ? parseInt(wfhRadiusMeters, 10) : undefined,
          wfhApprovalRequired,
          wfhRequireReason,
          wfhLateLoginGraceMins: wfhLateLoginGraceMins ? parseInt(wfhLateLoginGraceMins, 10) : null,
        })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save configuration');
      setSuccess('Tenant boundary and network configuration saved successfully.');
      
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setError(err.message || 'Failed to save configuration.');
    } finally {
      setLoading(false);
    }
  };

  const handleGetCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLat(position.coords.latitude.toString());
          setLng(position.coords.longitude.toString());
        },
        () => {
          setError('Unable to retrieve location. Please check browser permissions.');
        }
      );
    } else {
      setError('Geolocation not supported in this browser.');
    }
  };

  const handleHireUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/tenant/users/create', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          email: newUserEmail,
          name: newUserName,
          role: newUserRole,
          privileges: newUserPrivileges,
          branchId: newUserBranchId ? Number(newUserBranchId) : undefined,
          shiftId: newUserShiftId ? Number(newUserShiftId) : undefined,
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to register employee');

      setSuccess(
        data.emailDelivered
          ? `Employee "${newUserName}" hired successfully. Temporary credentials sent.`
          : `Employee "${newUserName}" hired successfully — but the credential email could NOT be delivered (no mail provider is configured or it failed). Share their temporary password with them manually, or check the SMTP/Resend setup.`
      );
      if (data.isNewRole && data.role) {
        setNewRolePrompt(data.role);
        refreshRoleSetupStatus();
      }
      setNewUserEmail('');
      setNewUserName('');
      setNewUserRole('');
      setNewUserPrivileges([]);

      fetchTenantAdminData();

      setTimeout(() => setSuccess(''), data.emailDelivered ? 4000 : 10000);
    } catch (err: any) {
      setError(err.message || 'Failed to register employee');
    } finally {
      setLoading(false);
    }
  };

  const handleDeviceAction = async (requestId: number, action: 'approve' | 'reject') => {
    setLoading(true);
    setError('');
    
    try {
      const res = await fetch('/api/tenant/device-requests/action', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ requestId, action })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to process request');

      setSuccess(`Device request ${action}ed successfully.`);
      fetchTenantAdminData();
      
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setError(err.message || 'Action failed');
    } finally {
      setLoading(false);
    }
  };

  // Initialize data depending on user role. Land on whichever tile the user
  // was actually headed for — routeForAdminNav() (lib/adminPortalNav.ts)
  // sends cross-page nav clicks (from the standalone Payroll/Leave
  // Management/Directory pages' own sidebars) to `/dashboard?tab=<id>`, but
  // this component used to always land on 'home' regardless, ignoring that
  // param entirely — every one of those clicks silently bounced through
  // Overview first. Falls back to 'home' when there's no (or an unrecognized)
  // tab param, e.g. a plain `/dashboard` visit.
  // `hasInitializedTab` guards this to the very first mount only — this
  // effect previously reset activeTab back to 'home' on every `user`
  // reference change, which could silently override a tab the user had
  // just clicked into if anything upstream ever re-issued the user object.
  const hasInitializedTab = useRef(false);
  useEffect(() => {
    if (!hasInitializedTab.current) {
      hasInitializedTab.current = true;
      const requestedTab = searchParams.get('tab');
      setActiveTab(requestedTab || 'home');
    }
    if (user.role === 'super_admin') {
      fetchSuperAdminData();
    } else {
      fetchTenantAdminData();
    }
  }, [user]);

  const toggleFeature = (feat: string) => {
    if (selectedFeatures.includes(feat)) {
      setSelectedFeatures(selectedFeatures.filter(f => f !== feat));
    } else {
      setSelectedFeatures([...selectedFeatures, feat]);
    }
  };

  // Functional update — required because "Manage Employees" calls this twice
  // in one handler (toggling both 'employee.create' and 'employee.read'
  // together); reading the `newUserPrivileges` closure variable directly (as
  // this used to) meant the second call saw the same stale pre-update array
  // as the first, so it silently overwrote the first toggle instead of
  // building on it. The functional form always sees the latest queued state.
  const togglePrivilege = (priv: string) => {
    setNewUserPrivileges(prev => prev.includes(priv) ? prev.filter(p => p !== priv) : [...prev, priv]);
  };

  // Drill-down modal behind the clickable stat cards — one piece of state
  // drives a shared DataTable modal. Each card sets { title, rows, columns }.
  const [drillDown, setDrillDown] = useState<{ title: string; rows: any[]; columns: ColumnDef<any, any>[]; searchIds?: string[]; roleFilter?: boolean } | null>(null);
  const openDrillDown = (title: string, rows: any[], columns: ColumnDef<any, any>[], opts?: { searchIds?: string[]; roleFilter?: boolean }) => {
    setDrillDown({ title, rows: rows || [], columns, searchIds: opts?.searchIds, roleFilter: opts?.roleFilter });
  };

  // Granting/revoking delegable feature access (QR Attendance + WFH Ledger)
  // for an already-hired employee — there's no general "edit an existing
  // user's privileges" screen in this app (privileges are otherwise only
  // set once, at hire time), so this is deliberately scoped to just these
  // named permission strings. Both permission groups are saved through the
  // same checkbox set but POSTed to their own endpoint
  // (/api/tenant/users/:id/qr-access, /wfh-access) — each endpoint already
  // filters the submitted array down to only the values it owns, so the
  // full draft can be sent to both without splitting it client-side.
  const ACCESS_OPTIONS: { key: string; label: string }[] = [
    { key: 'attendance.qr.generate', label: 'QR: Generate' },
    { key: 'attendance.qr.display', label: 'QR: Display' },
    { key: 'attendance.qr.close', label: 'QR: Close' },
    { key: 'attendance.qr.override', label: 'QR: Override' },
    { key: 'attendance.qr.view_logs', label: 'QR: View Logs' },
    { key: 'wfh.view_logs', label: 'WFH: View Ledger' },
  ];
  const [accessEditingUser, setAccessEditingUser] = useState<any>(null);
  const [accessDraft, setAccessDraft] = useState<string[]>([]);
  const [accessSaving, setAccessSaving] = useState(false);

  const openAccessEditor = (emp: any) => {
    const current: string[] = Array.isArray(emp.privileges) ? emp.privileges : [];
    setAccessDraft(ACCESS_OPTIONS.map(o => o.key).filter(k => current.includes(k)));
    setAccessEditingUser(emp);
  };

  const toggleAccessDraft = (key: string) => {
    setAccessDraft(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const saveAccess = async (userId: number) => {
    setAccessSaving(true);
    setError('');
    try {
      const [qrRes, wfhRes] = await Promise.all([
        fetch(`/api/tenant/users/${userId}/qr-access`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ permissions: accessDraft })
        }),
        fetch(`/api/tenant/users/${userId}/wfh-access`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ permissions: accessDraft })
        }),
      ]);
      const qrData = await qrRes.json();
      const wfhData = await wfhRes.json();
      if (!qrRes.ok) throw new Error(qrData.error || 'Failed to update QR access');
      if (!wfhRes.ok) throw new Error(wfhData.error || 'Failed to update WFH access');
      setAccessEditingUser(null);
      fetchTenantAdminData();
    } catch (err: any) {
      setError(err.message || 'Failed to update feature access');
    } finally {
      setAccessSaving(false);
    }
  };

  const directoryRoleOptions = [...new Set(recruitedUsers.map((u: any) => u.role))].sort() as string[];

  const directoryColumns: ColumnDef<any, any>[] = [
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

  const wfhLedgerColumns: ColumnDef<any, any>[] = [
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

  const qrSessionColumns: ColumnDef<any, any>[] = [
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

  const qrScanColumns: ColumnDef<any, any>[] = [
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

  // --- Stat-card drill-down column sets ---
  const roleCell = ({ getValue }: any) => <span className="font-bold text-[var(--color-nexus-ink)] uppercase tracking-wider text-[10px]">{getValue() as string}</span>;
  // Clicking any person's name anywhere in the dashboard (drill-down tables,
  // Pending Approvals, Your Team) opens the shared EmployeeDetailPanel —
  // real attendance calendar + leave balance + payroll snapshot for that
  // user, sourced entirely from existing endpoints (see EmployeeDetailPanel.tsx).
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

  // Sidebar navigation — the standard left-nav pattern used across Zoho
  // People, Keka, BambooHR, Darwinbox, etc., rather than a marketing-site
  // style top tab bar.
  // Sections tiles/nav items resolve to. Every item here is something this
  // specific logged-in user is actually allowed to do — 'settings' is
  // role-gated (only the tenant admin account can change org policy, a
  // non-delegable rule enforced server-side too), 'recruitment'/'devices'
  // are privilege-gated via the probe pattern above (same as
  // corrections/violations already were). Manager/HR/GM only ever see
  // tiles/nav entries for what they were actually granted.
  const superAdminNav = [
    { id: 'analytics', label: 'Analytics', icon: LayoutDashboard, description: 'Cross-tenant usage and health at a glance.' },
    { id: 'requests', label: 'Tenancy Requests', icon: ClipboardCheck, count: tenancyRequests.length, description: 'Approve or reject new company sign-ups.' },
    { id: 'tenants', label: 'Manage Tenants', icon: Building2, count: allTenants.length, description: 'Suspend, reinstate, and inspect every workspace.' },
    { id: 'notifications', label: 'Admin Inbox', icon: Bell, count: notifications.length, description: 'Platform-wide alerts and messages.' },
  ];

  // Pending count badge for the unified Attendance sidebar item — aggregates
  // corrections + late arrivals + WFH location requests so the badge is always
  // the total outstanding action queue, not just one sub-category.
  const pendingAttendanceActions =
    corrections.filter(c => c.status === 'pending').length +
    pendingAttendance.length +
    wfhLocationRequests.length;

  // Each destination is independently gated by whether the current user
  // actually holds a privilege that page's own backend checks — Leave
  // Management and Payroll are deliberately separate checks (not "has
  // either"), so e.g. a manager granted leave.approve but not payroll.read
  // sees Leave Management but never sees a Payroll tab that would just
  // render "Access Denied" for them.
  const tenantAdminNavAll = [
    // Attendance's own data (GET /api/tenant/analytics) has no privilege
    // gate server-side — always visible to anyone who reaches /dashboard.
    { id: 'attendance', label: 'Attendance', icon: Clock, count: pendingAttendanceActions || undefined, description: 'Attendance status, monthly reports, WFH shifts, corrections, and more.', visible: true },
    // Leave Management, Payroll, and Directory each render inline via their
    // own `embedded` mode — no route change, no sidebar/header remount.
    { id: 'leave-management', label: 'Leave Management', icon: CalendarDays, description: 'Review requests, approvals, and leave policies.', visible: hasAnyPrivilege('leave.read', 'leave.approve') },
    { id: 'payroll', label: 'Payroll', icon: Banknote, description: 'Salary structures, payslips, deductions.', visible: hasAnyPrivilege('payroll.read', 'payroll.manage') },
    { id: 'directory', label: 'Directory', icon: Users, description: 'Browse and search the organization.', visible: hasAnyPrivilege('employee.read', 'reports.view') },
    // Its own top-level destination (not nested under Administration) since
    // hiring is a frequent day-to-day action, not a one-off config screen.
    { id: 'recruitment', label: 'Recruitment', icon: ClipboardCheck, count: recruitedUsers.length || undefined, description: 'Recruit new team members and manage the hiring queue.', visible: hasRecruitmentAccess },
    // Teams is a personal "my team" workspace for whoever was granted
    // team.manage — the tenant admin already administers the whole org via
    // Administration, so it's deliberately excluded here even though
    // hasAnyPrivilege('team.manage') is always true for them.
    { id: 'teams', label: 'Teams', icon: Users2, description: 'Build your own team from your department and track their stats.', visible: user.role !== 'tenant_admin' && hasAnyPrivilege('team.manage') },
    // Administration bundles several sub-screens (branches, roles, settings,
    // devices, audit ledger) — visible if the user holds any
    // one of the privileges those sub-screens actually check.
    { id: 'administration', label: 'Administration', icon: ShieldCheck, description: 'Workspace config, branches, roles, staff management, audit ledger, device approvals.', visible: hasAnyPrivilege('settings.edit', 'branch.manage', 'shift.manage', 'holiday.manage', 'employee.create', 'roles.manage') },
  ];
  const tenantAdminNav = tenantAdminNavAll.filter((item) => item.visible).map(({ visible, ...item }) => item);

  const navItems = user.role === 'super_admin' ? superAdminNav : tenantAdminNav;
  const roleLabel = user.role === 'super_admin' ? 'Super Admin'
    : user.role === 'tenant_admin' ? 'Tenant Admin'
    : user.role.toUpperCase() === user.role ? user.role // already an acronym like 'HR', 'GM'
    : user.role.charAt(0).toUpperCase() + user.role.slice(1);
  const activeNavLabel = activeTab === 'home' ? 'Home' : (navItems.find(n => n.id === activeTab)?.label || 'Dashboard');
  const activeNavSubtitle: Record<string, string> = {
    home: 'Company-wide overview and key metrics',
    attendance: 'Status, monthly reports, WFH shifts, and corrections',
    'leave-management': 'Policies, approvals, and holiday calendar',
    payroll: 'Salary structures, payslips, and deductions',
    directory: 'Browse and search the organization',
    recruitment: 'Recruit new team members and manage the hiring queue',
    administration: 'Workspace configuration and staff management',
  };

  // PortalShell's nav array — same items as navItems (used by the Home tab's
  // tile grid) with a 'home' entry prepended, since PortalShell's sidebar
  // includes Home as a regular nav row rather than a separate hardcoded button.
  const portalNavItems: PortalNavItem[] = [
    { id: 'home', label: 'Home', icon: Home },
    ...navItems.map(({ id, label, icon, count }) => ({ id, label, icon, count })),
  ];

  // When the user clicks a nav item that is a section group (e.g. 'administration'),
  // reset sub-state so the section renders its default landing view.
  const handleTabChange = (id: string) => {
    // Leave Management, Payroll, and Directory all render inline via their
    // own `embedded` mode (see their tab render below) — no route change,
    // no sidebar/header remount, no Suspense flash.
    setActiveTab(id);
    // Keep the URL's `tab` param in sync so a refresh, browser back/forward,
    // or a deep link built from this URL lands back on the same tab instead
    // of always resetting to Overview.
    setSearchParams(id === 'home' ? {} : { tab: id }, { replace: true });
    if (id === 'attendance') {
      setAttendanceSubTab('status');
      setShowOtherOptions(false);
      setOtherOptionsTab(null);
    }
    if (id === 'administration') {
      setAdminSubTab(null);
    }
  };

  return (
    <PortalShell
      user={user}
      roleLabel={roleLabel}
      navItems={portalNavItems}
      activeTab={activeTab}
      onTabChange={handleTabChange}
      onLogout={onLogout}
      title={activeNavLabel}
      subtitle={activeNavSubtitle[activeTab]}
      fallbackHref="/login"
      headerActions={
        <button
          onClick={() => { if (user.role === 'super_admin') { setActiveTab('notifications'); } else { setActiveTab('administration'); setAdminSubTab('notifications'); } }}
          className="relative text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-primary)] transition-colors"
          title="Notifications"
        >
          <Bell size={19} />
          {notifications.filter((n: any) => !n.isRead).length > 0 && (
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-[var(--color-nexus-error)] rounded-full pulse-ring" />
          )}
        </button>
      }
    >
        {/* Alerts */}
        {error && <div className="bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)] text-xs p-4 rounded-xl mb-6 border border-[var(--color-nexus-error)]/20 font-medium">{error}</div>}
        {success && <div className="bg-[color:var(--color-nexus-success-text)]/10 text-[var(--color-nexus-success-text)] text-xs p-4 rounded-xl mb-6 border border-[color:var(--color-nexus-success-text)]/20 font-medium">{success}</div>}

        {/* ======================================================== */}
        {/* HOME — role-aware tile landing view. Built directly from
            navItems, so every tile here is something this specific user's
            role/privileges actually unlock; nothing is shown here that
            isn't equally reachable (and equally enforced server-side) from
            the sidebar. */}
        {/* ======================================================== */}
        {activeTab === 'home' && (
          user.role === 'super_admin' ? (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-extrabold font-sans text-gradient inline-block">Welcome, {user.name || user.email}</h2>
                <p className="text-sm text-[var(--color-nexus-muted)] mt-1">Signed in as <strong>{roleLabel}</strong>. Here's what you can do.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {navItems.map((item, i) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveTab(item.id)}
                      className="text-left nexus-card  rise-in rounded-2xl p-5 group"
                      style={{ animationDelay: `${i * 60}ms` }}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="w-10 h-10 rounded-xl bg-[var(--color-nexus-primary-fixed)] group-hover:bg-[var(--color-nexus-primary)] flex items-center justify-center transition-colors float-c">
                          <Icon size={18} className="text-[var(--color-nexus-primary)] group-hover:text-white transition-colors" />
                        </div>
                        {typeof item.count === 'number' && item.count > 0 && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)]">{item.count}</span>
                        )}
                      </div>
                      <h3 className="font-bold text-sm text-[var(--color-nexus-ink)]">{item.label}</h3>
                      <p className="text-xs text-[var(--color-nexus-muted)] mt-1 leading-relaxed">{item.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Home Mode Switcher — tenant_admin manages the org, they
                  don't clock in themselves, so they never get a personal
                  self-service space; every other dashboard-capable role
                  (manager, HR, GM, etc.) still does. */}
              {user.role !== 'tenant_admin' && (
                <div className="flex bg-[var(--color-nexus-surface-alt)] p-1 rounded-full border border-[var(--color-nexus-border)] w-fit mx-auto shadow-sm">
                  <button
                    type="button"
                    onClick={() => setHomeTabMode('organization')}
                    className={`px-5 py-2 rounded-full text-xs font-bold transition-all ${homeTabMode === 'organization' ? 'bg-[var(--color-nexus-primary)] text-white shadow-sm' : 'text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)]'}`}
                  >
                    <Activity size={13} className="inline-block mr-1.5 align-middle" />
                    Organization Dashboard
                  </button>
                  <button
                    type="button"
                    onClick={() => setHomeTabMode('self-service')}
                    className={`px-5 py-2 rounded-full text-xs font-bold transition-all ${homeTabMode === 'self-service' ? 'bg-[var(--color-nexus-primary)] text-white shadow-sm' : 'text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)]'}`}
                  >
                    <Users size={13} className="inline-block mr-1.5 align-middle" />
                    Self Service (My Space)
                  </button>
                </div>
              )}

              {/* ======================================================== */}
              {/* SELF SERVICE — PERSONAL ATTENDANCE & BREAKS WORKSPACE */}
              {/* ======================================================== */}
              {user.role !== 'tenant_admin' && homeTabMode === 'self-service' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Left columns: Punch Card & Break manager */}
                  <div className="lg:col-span-2 space-y-6">
                    {/* Punch clock widget */}
                    <div className="nexus-card  rounded-2xl p-6 relative overflow-hidden flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
                      <div className="space-y-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-[var(--color-nexus-primary-fixed)] flex items-center justify-center text-[var(--color-nexus-primary)]">
                            <Clock size={20} />
                          </div>
                          <div>
                            <span className="block text-[10px] text-[var(--color-nexus-muted)] uppercase font-mono tracking-wider">Self Service Attendance</span>
                            <h3 className="font-bold text-sm text-[var(--color-nexus-ink)]">Punch Clock</h3>
                          </div>
                        </div>

                        <div>
                          <span className="block text-[10px] text-[var(--color-nexus-muted)] font-mono uppercase tracking-wider">Clock Status</span>
                          <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full mt-1.5 ${selfCheckInTime ? 'bg-[var(--color-nexus-success-text)]/10 text-[var(--color-nexus-success-text)]' : 'bg-[var(--color-nexus-muted)]/10 text-[var(--color-nexus-muted)]'}`}>
                            <span className={`w-2.5 h-2.5 rounded-full ${selfCheckInTime ? 'bg-[var(--color-nexus-success-text)]' : 'bg-[var(--color-nexus-muted)]'} ${selfCheckInTime && !selfActiveBreak ? 'pulse-ring' : ''}`} />
                            {selfCheckInTime ? (selfActiveBreak ? `On Break (${selfActiveBreak.breakType})` : 'Clocked In') : 'Not Clocked In'}
                          </span>
                        </div>

                        {selfCheckInTime && (
                          <div className="grid grid-cols-2 gap-4 pt-3 border-t border-[var(--color-nexus-border)]/50">
                            <div>
                              <span className="block text-[9px] text-[var(--color-nexus-muted)] font-mono uppercase">Checked In At</span>
                              <span className="text-sm font-mono font-bold text-[var(--color-nexus-ink)] mt-0.5 block">
                                {new Date(selfCheckInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <div>
                              <span className="block text-[9px] text-[var(--color-nexus-primary)] font-mono uppercase">Hours Worked</span>
                              <span className="text-sm font-mono font-bold text-[var(--color-nexus-primary)] mt-0.5 block">{selfHoursWorked}</span>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col gap-3 justify-center min-w-[160px]">
                        {!selfCheckInTime ? (
                          <button
                            type="button"
                            onClick={() => navigate('/employee/attendance')}
                            className="bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white text-xs font-bold uppercase tracking-wider py-4 px-6 rounded-xl transition-all shadow-[0_4px_15px_rgba(37,99,235,0.3)] flex items-center justify-center gap-2 cursor-pointer float-c hover:-translate-y-0.5 active:translate-y-0"
                          >
                            <Power size={14} />
                            Punch In
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={handleSelfCheckout}
                            disabled={selfCheckingOut || !!selfActiveBreak}
                            title={selfActiveBreak ? 'Resume work before punching out' : undefined}
                            className="bg-[var(--color-nexus-error)] hover:brightness-110 text-white text-xs font-bold uppercase tracking-wider py-4 px-6 rounded-xl transition-all shadow-[0_4px_15px_rgba(226,69,69,0.3)] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:-translate-y-0.5 active:translate-y-0"
                          >
                            {selfCheckingOut ? 'Checking Out...' : 'Punch Out'}
                          </button>
                        )}
                        {selfTodayPending && (
                          <p className="text-[9px] font-bold text-[var(--color-nexus-secondary)] uppercase tracking-wider text-center bg-[var(--color-nexus-secondary-container)]/20 p-2 rounded-lg border border-[var(--color-nexus-secondary)]/20">
                            Check-in Pending Approval
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Break Management */}
                    {selfCheckInTime && (
                      <div className="nexus-card rounded-2xl p-6 space-y-4">
                        <div className="flex items-center justify-between">
                          <h3 className="text-xs font-bold text-[var(--color-nexus-ink)] uppercase tracking-wider">Break Management</h3>
                          <span className="text-[10px] font-mono text-[var(--color-nexus-muted)]">{selfRemainingMins}m left of {selfBudgetMins}m budget</span>
                        </div>

                        <div className="w-full bg-[var(--color-nexus-border)]/40 rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-2 rounded-full transition-all duration-500 ${selfBudgetMins - selfRemainingMins >= selfBudgetMins ? 'bg-[var(--color-nexus-error)]' : 'bg-[var(--color-nexus-primary)]'}`}
                            style={{ width: `${Math.min(100, Math.round(((selfBudgetMins - selfRemainingMins) / selfBudgetMins) * 100))}%` }}
                          />
                        </div>

                        {selfActiveBreak ? (
                          <div className="bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] p-4 rounded-xl flex justify-between items-center gap-4">
                            <div>
                              <span className="inline-block text-[9px] text-[var(--color-nexus-error)] font-mono uppercase tracking-wider bg-[var(--color-nexus-error)]/10 px-2 py-0.5 rounded-full pulse-ring">
                                Active Break ({selfActiveBreak.breakType})
                              </span>
                              <span className="text-xl font-mono font-bold text-[var(--color-nexus-ink)] mt-1.5 block">{selfBreakTimer}</span>
                            </div>
                            <button
                              type="button"
                              onClick={handleEndSelfBreak}
                              className="bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white font-bold text-xs uppercase tracking-wider px-5 py-3 rounded-lg transition-all shadow-md cursor-pointer hover:-translate-y-0.5 active:translate-y-0"
                            >
                              Resume Work
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-col sm:flex-row gap-3">
                            <select
                              value={selfBreakType}
                              onChange={e => setSelfBreakType(e.target.value)}
                              className="bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl px-4 py-3 text-xs font-mono text-[var(--color-nexus-ink)] focus:outline-none focus:border-[var(--color-nexus-primary)] flex-1"
                            >
                              <option value="Lunch">Lunch</option>
                              <option value="Tea">Tea / Coffee</option>
                              <option value="Personal">Personal</option>
                              <option value="Meeting">Meeting</option>
                              <option value="General">General</option>
                            </select>
                            <button
                              type="button"
                              onClick={handleStartSelfBreak}
                              className="bg-[var(--color-nexus-primary-fixed)] hover:bg-[var(--color-nexus-primary)] hover:text-white text-[var(--color-nexus-primary)] font-bold text-xs uppercase tracking-wider px-6 py-3 rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer hover:-translate-y-0.5 active:translate-y-0"
                            >
                              <Play size={12} />
                              Go on Break
                            </button>
                          </div>
                        )}

                        {/* Breaks list */}
                        {selfBreaksToday.length > 0 && (
                          <div className="space-y-1.5 pt-3 border-t border-[var(--color-nexus-border)]/50">
                            <span className="block text-[9px] text-[var(--color-nexus-muted)] uppercase font-mono tracking-wider mb-2">Today's Breaks</span>
                            {selfBreaksToday.map((b) => (
                              <div key={b.id} className="flex items-center justify-between text-[11px] font-mono px-3 py-2 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-lg">
                                <span className="text-[var(--color-nexus-ink)] font-bold">{b.breakType}</span>
                                <span className="text-[var(--color-nexus-muted)]">
                                  {new Date(b.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  {b.endTime ? ` – ${new Date(b.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ' – ongoing'}
                                </span>
                                {b.isViolation && <span className="text-[var(--color-nexus-error)] text-[9px] uppercase font-bold">Over budget</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Right column: Leave balance & correction trigger */}
                  <div className="space-y-6">
                    {/* Leave Balance widget */}
                    <div className="nexus-card rounded-2xl p-6 space-y-4">
                      <h3 className="text-xs font-bold text-[var(--color-nexus-ink)] uppercase tracking-wider">Leave Balances</h3>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="p-3 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-center">
                          <span className="text-lg font-black text-[var(--color-nexus-primary)] block">6</span>
                          <span className="text-[9px] text-[var(--color-nexus-muted)] uppercase block mt-1">Casual</span>
                        </div>
                        <div className="p-3 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-center">
                          <span className="text-lg font-black text-[var(--color-nexus-secondary)] block">4</span>
                          <span className="text-[9px] text-[var(--color-nexus-muted)] uppercase block mt-1">Sick</span>
                        </div>
                        <div className="p-3 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-center">
                          <span className="text-lg font-black text-[var(--color-nexus-success-text)] block">15</span>
                          <span className="text-[9px] text-[var(--color-nexus-muted)] uppercase block mt-1">Earned</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => navigate('/tenant/leave')}
                        className="w-full bg-[var(--color-nexus-border)]/50 hover:bg-[var(--color-nexus-border)] text-[var(--color-nexus-ink)] text-xs font-semibold py-2.5 rounded-xl transition-all flex items-center justify-center gap-1.5"
                      >
                        Apply / Request Leave
                        <ExternalLink size={12} />
                      </button>
                    </div>

                    {/* Personal Logs & Correction Request Tracker */}
                    <div className="nexus-card rounded-2xl p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-bold text-[var(--color-nexus-ink)] uppercase tracking-wider">My Requests</h3>
                        <button
                          type="button"
                          onClick={() => setShowSelfCorrectionModal(true)}
                          className="text-[var(--color-nexus-primary)] hover:text-[var(--color-nexus-primary-hover)] text-[10px] font-bold uppercase tracking-wider"
                        >
                          Request Correction
                        </button>
                      </div>

                      {selfCorrections.length === 0 ? (
                        <div className="text-center py-6 text-[var(--color-nexus-muted)] text-xs">
                          No correction requests submitted today.
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {selfCorrections.map((c) => (
                            <div key={c.id} className="p-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl flex items-center justify-between gap-3 text-xs">
                              <div>
                                <span className="font-bold text-[var(--color-nexus-ink)] block uppercase text-[10px]">{c.requestType.replace('_', ' ')}</span>
                                <span className="text-[10px] text-[var(--color-nexus-muted)] block mt-0.5">{c.requestedDate}</span>
                              </div>
                              <span className={`text-[9px] uppercase font-mono font-black ${c.status === 'approved' ? 'text-[var(--color-nexus-success-text)]' : c.status === 'pending' ? 'text-[var(--color-nexus-secondary)]' : 'text-[var(--color-nexus-error)]'}`}>
                                {c.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ======================================================== */}
              {/* ORGANIZATION DASHBOARD — STATS, CHARTS & ACTION QUEUE */}
              {/* ======================================================== */}
              {homeTabMode === 'organization' && (
                <div className="space-y-6">
                  {/* Stat card row — single responsive row of equal-width
                      cards (Total Staff, Present/Absent/Late Today, Pending
                      Leave Requests, Payroll This Month), matching the
                      reference design's dense single-row stat strip instead
                      of the old gauge-widget + split 4-then-2 layout. Caption
                      coloring: green for a positive framing, amber/bold for
                      an actionable alert ("Needs approval"), plain gray
                      otherwise — no fabricated Turnover card, since
                      employeeStatus has no tracked transition date to derive
                      "departures this period" from. */}
                  {tenantAnalytics && (() => {
                    const bd = tenantAnalytics.breakdown;
                    const clickable = !!bd;
                    const attendanceRatePct = tenantAnalytics.totalStaff > 0 ? Math.round((tenantAnalytics.presentToday / tenantAnalytics.totalStaff) * 100) : 0;
                    const pendingLeaveCount = homeLeaveRequests.filter((r: any) => r.status === 'pending').length;
                    return (
                      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
                        <StatCard
                          label="Total Employees"
                          value={tenantAnalytics.totalStaff}
                          caption="Registered accounts"
                          icon={Users}
                          onClick={clickable ? () => {
                            setActiveTab('attendance');
                            setAttendanceSubTab('status');
                            openDrillDown('All Staff', bd!.total, simplePersonColumns, { searchIds: ['name'], roleFilter: true });
                          } : undefined}
                        />
                        <StatCard
                          label="Present Today"
                          value={tenantAnalytics.presentToday}
                          caption={`${attendanceRatePct}% active attendance`}
                          trend="up"
                          icon={CheckCircle2}
                          iconBg="var(--color-nexus-tertiary-fixed)"
                          onClick={clickable ? () => {
                            setActiveTab('attendance');
                            setAttendanceSubTab('status');
                            openDrillDown('Present Today', bd!.present, attendancePersonColumns, { searchIds: ['name'], roleFilter: true });
                          } : undefined}
                        />
                        <StatCard
                          label="Absent Today"
                          value={tenantAnalytics.absentToday}
                          caption={`${100 - attendanceRatePct}% out of office`}
                          icon={UserX}
                          iconBg="var(--color-nexus-error-soft)"
                          iconColor="var(--color-nexus-error)"
                          onClick={clickable ? () => {
                            setActiveTab('attendance');
                            setAttendanceSubTab('status');
                            openDrillDown('Absent Today', bd!.absent, simplePersonColumns, { searchIds: ['name'], roleFilter: true });
                          } : undefined}
                        />
                        <StatCard
                          label="Late Today"
                          value={tenantAnalytics.lateToday}
                          caption={`${tenantAnalytics.presentToday > 0 ? Math.round((tenantAnalytics.lateToday / tenantAnalytics.presentToday) * 100) : 0}% late check-in rate`}
                          icon={AlarmClock}
                          iconBg="var(--color-nexus-secondary-container)"
                          iconColor="var(--color-nexus-secondary)"
                          onClick={clickable ? () => {
                            setActiveTab('attendance');
                            setAttendanceSubTab('status');
                            openDrillDown('Late Today', bd!.late, attendancePersonColumns, { searchIds: ['name'], roleFilter: true });
                          } : undefined}
                        />
                        {hasLeaveAccess && (
                          <StatCard
                            label="Pending Leave Requests"
                            value={pendingLeaveCount}
                            caption={pendingLeaveCount > 0 ? 'Needs approval' : 'All caught up'}
                            trend={pendingLeaveCount > 0 ? 'down' : 'neutral'}
                            icon={CalendarClock}
                            onClick={() => navigate('/tenant/leave')}
                          />
                        )}
                        {hasPayrollAccess && (
                          <StatCard
                            label="Payroll This Month"
                            value={`₹${Number(homePayrollOverview?.totals?.totalMonthlyNet || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                            caption={`Net payout across ${homePayrollOverview?.employees?.length || 0} employees`}
                            icon={Banknote}
                            onClick={() => navigate('/tenant/payroll')}
                          />
                        )}
                      </div>
                    );
                  })()}

                  {/* Quick Actions + Company Policy — deliberately no
                      team/recruitment action here; Teams and Recruitment
                      already have their own dedicated top-level sidebar tabs,
                      same tier as Attendance/Payroll/Directory. */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="nexus-card p-4">
                      <h3 className="text-base font-bold text-[var(--color-nexus-ink)] mb-3">Quick Actions</h3>
                      <div className="space-y-1.5">
                        {hasPayrollAccess && (
                          <button type="button" onClick={() => navigate('/tenant/payroll')} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-nexus-control)] hover:bg-[var(--color-nexus-surface-alt)] transition-colors text-left">
                            <span className="w-8 h-8 rounded-lg bg-[var(--color-nexus-primary-fixed)] flex items-center justify-center shrink-0"><Banknote size={16} className="text-[var(--color-nexus-primary)]" /></span>
                            <span className="text-sm font-semibold text-[var(--color-nexus-ink)]">Open Payroll</span>
                          </button>
                        )}
                        <button type="button" onClick={() => { setActiveTab('administration'); setAdminSubTab('ledger'); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-nexus-control)] hover:bg-[var(--color-nexus-surface-alt)] transition-colors text-left">
                          <span className="w-8 h-8 rounded-lg bg-[var(--color-nexus-secondary-container)] flex items-center justify-center shrink-0"><ScrollText size={16} className="text-[var(--color-nexus-secondary)]" /></span>
                          <span className="text-sm font-semibold text-[var(--color-nexus-ink)]">View Audit Logs</span>
                        </button>
                        <button type="button" onClick={() => { setActiveTab('administration'); setAdminSubTab('settings'); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-nexus-control)] hover:bg-[var(--color-nexus-surface-alt)] transition-colors text-left">
                          <span className="w-8 h-8 rounded-lg bg-[var(--color-nexus-surface-sunken)] flex items-center justify-center shrink-0"><ShieldCheck size={16} className="text-[var(--color-nexus-muted)]" /></span>
                          <span className="text-sm font-semibold text-[var(--color-nexus-ink)]">Attendance &amp; Break Settings</span>
                        </button>
                      </div>
                    </div>

                    {(policyAnnouncement || hasAnyPrivilege('tenant.policy.manage')) && (
                      <div className="nexus-card p-4 bg-[var(--color-nexus-primary-container)] text-white">
                        <div className="flex items-center gap-2 mb-2">
                          <Bell size={16} className="text-[var(--color-nexus-tertiary-fixed)]" />
                          <h3 className="text-base font-bold">Company Policy</h3>
                        </div>
                        {policyAnnouncement ? (
                          <>
                            <p className={`text-sm text-white/80 leading-relaxed ${policyExpanded ? '' : 'line-clamp-2'}`}>{policyAnnouncement}</p>
                            <button type="button" onClick={() => setPolicyExpanded((v) => !v)} className="text-xs font-bold text-[var(--color-nexus-tertiary-fixed)] mt-2 hover:underline">
                              {policyExpanded ? 'Show less' : 'Read more'}
                            </button>
                          </>
                        ) : (
                          <p className="text-sm text-white/60">No policy announcement set yet.</p>
                        )}
                        {hasAnyPrivilege('tenant.policy.manage') && (
                          <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
                            <textarea
                              value={policyDraft}
                              onChange={(e) => setPolicyDraft(e.target.value)}
                              placeholder="e.g. All departments must review the new remote-work guidelines by Friday."
                              rows={2}
                              className="w-full bg-white/10 border border-white/15 rounded-lg px-3 py-2 text-xs text-white placeholder-white/40 focus:outline-none resize-none"
                            />
                            <button type="button" onClick={handleSavePolicy} disabled={policySaving} className="bg-white text-[var(--color-nexus-ink)] text-xs font-bold uppercase tracking-wider px-4 py-1.5 rounded-lg disabled:opacity-50">
                              {policySaving ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Department Breakdown + Pending Approvals widgets */}
                  {(hasEmployeesAccess || hasLeaveAccess) && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {hasEmployeesAccess && (() => {
                        const byDept = homeEmployees.reduce((acc: Record<string, number>, e: any) => {
                          const key = e.department || 'Unassigned';
                          acc[key] = (acc[key] || 0) + 1;
                          return acc;
                        }, {});
                        const rows = Object.entries(byDept).sort((a, b) => (b[1] as number) - (a[1] as number));
                        const maxCount = rows.length ? Math.max(...rows.map(([, c]) => c as number)) : 1;
                        return (
                          <div className="nexus-card p-4 space-y-3">
                            <div>
                              <h3 className="text-base font-bold text-[var(--color-nexus-ink)]">Department Breakdown</h3>
                              <span className="text-xs text-[var(--color-nexus-muted)] block mt-0.5">Headcount by department</span>
                            </div>
                            {rows.length === 0 ? (
                              <div className="h-32 flex items-center justify-center text-xs text-[var(--color-nexus-muted)]">
                                No department data available.
                              </div>
                            ) : (
                              <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                                {rows.map(([dept, count]) => (
                                  <button
                                    key={dept}
                                    type="button"
                                    onClick={() => {
                                      const deptEmployees = homeEmployees.filter((e: any) => (e.department || 'Unassigned') === dept);
                                      openDrillDown(dept, deptEmployees, simplePersonColumns, { searchIds: ['name'], roleFilter: true });
                                    }}
                                    className="w-full text-left hover:opacity-80 transition-opacity"
                                  >
                                    <div className="flex items-center justify-between text-sm mb-1">
                                      <span className="font-semibold text-[var(--color-nexus-ink)]">{dept}</span>
                                      <span className="text-[var(--color-nexus-muted)]">{count as number} {(count as number) === 1 ? 'person' : 'people'}</span>
                                    </div>
                                    <div className="h-2 rounded-full bg-[var(--color-nexus-surface-alt)] overflow-hidden">
                                      <div
                                        className="h-full rounded-full bg-[var(--color-nexus-primary)]"
                                        style={{ width: `${Math.max(4, ((count as number) / maxCount) * 100)}%` }}
                                      />
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {hasLeaveAccess && (() => {
                        const pending = homeLeaveRequests.filter((r: any) => r.status === 'pending').slice(0, 5);
                        const avatarPalette = ['bg-sky-500', 'bg-orange-500', 'bg-violet-500', 'bg-emerald-500', 'bg-pink-500'];
                        const initialsOf = (name: string) => (name || '?').split(' ').filter(Boolean).slice(0, 2).map((p: string) => p[0]?.toUpperCase()).join('');
                        return (
                          <div className="nexus-card p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <div>
                                <h3 className="text-base font-bold text-[var(--color-nexus-ink)]">Pending Approvals</h3>
                                <span className="text-xs text-[var(--color-nexus-muted)] block mt-0.5">Leave requests awaiting your decision</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => navigate('/tenant/leave')}
                                className="text-xs font-bold text-[var(--color-nexus-primary)] hover:underline whitespace-nowrap"
                              >
                                View All
                              </button>
                            </div>
                            {pending.length === 0 ? (
                              <div className="h-32 flex items-center justify-center text-xs text-[var(--color-nexus-muted)]">
                                ✨ No pending leave requests.
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {pending.map((r: any, i: number) => (
                                  <button
                                    type="button"
                                    key={r.id}
                                    onClick={() => setDetailUserId(r.userId)}
                                    className="w-full flex items-center gap-3 text-sm text-left hover:bg-[var(--color-nexus-surface-alt)] rounded-xl p-1.5 -m-1.5 transition-colors"
                                  >
                                    <div className={`w-9 h-9 shrink-0 rounded-full ${avatarPalette[i % avatarPalette.length]} text-white flex items-center justify-center text-xs font-bold`}>
                                      {initialsOf(r.employeeName)}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="font-bold text-[var(--color-nexus-ink)] truncate">{r.employeeName}</div>
                                      <div className="text-xs text-[var(--color-nexus-muted)] truncate">{r.leaveType} · {r.totalDays} {r.totalDays === 1 ? 'day' : 'days'}</div>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Manager-scoped "Your Team" section — additive, not a
                      replacement for the org-wide view above. Shown for any
                      user (other than the exempt admin tiers) whose employee
                      roster contains people reporting to them, derived purely
                      from users.managerId — no hardcoded role-name check.
                      Direct-reports data comes from the same
                      /api/tenant/employees fetch above (already gated by
                      employee.read OR reports.view server-side, and branch-
                      scoped there); a plain user with no reports simply
                      renders nothing here. */}
                  {hasEmployeesAccess && user.role !== 'tenant_admin' && user.role !== 'super_admin' && (() => {
                    const myTeam = homeEmployees.filter((e: any) => e.managerId === user.id);
                    if (myTeam.length === 0) return null;
                    const teamIds = new Set(myTeam.map((e: any) => e.id));
                    const bd = tenantAnalytics?.breakdown;
                    const teamPresent = bd ? bd.present.filter((p: any) => teamIds.has(p.userId)).length : null;
                    const teamLate = bd ? bd.late.filter((p: any) => teamIds.has(p.userId)).length : null;
                    const teamAbsent = bd ? bd.absent.filter((p: any) => teamIds.has(p.userId)).length : null;
                    const todayStr = new Date().toISOString().slice(0, 10);
                    const teamOnLeave = homeLeaveRequests.filter((r: any) =>
                      teamIds.has(r.userId) && r.status === 'approved' && r.startDate <= todayStr && r.endDate >= todayStr
                    ).length;
                    // Per-person status pill — reuses the same present/late/absent
                    // classification the stat tiles above are computed from
                    // (bd.present/late/absent), plus the same on-leave-today
                    // leave-request check, instead of showing plain department
                    // text on each roster row.
                    const onLeaveIds = new Set(
                      homeLeaveRequests
                        .filter((r: any) => teamIds.has(r.userId) && r.status === 'approved' && r.startDate <= todayStr && r.endDate >= todayStr)
                        .map((r: any) => r.userId)
                    );
                    const statusOf = (userId: string): { label: string; className: string } => {
                      if (onLeaveIds.has(userId)) return { label: 'On Leave', className: 'bg-[var(--color-nexus-info-soft)] text-[var(--color-nexus-info)]' };
                      if (bd?.late?.some((p: any) => p.userId === userId)) return { label: 'Late', className: 'bg-[var(--color-nexus-warning-soft)] text-[var(--color-nexus-secondary)]' };
                      if (bd?.present?.some((p: any) => p.userId === userId)) return { label: 'Present', className: 'bg-[var(--color-nexus-success-soft)] text-[var(--color-nexus-success-text)]' };
                      if (bd?.absent?.some((p: any) => p.userId === userId)) return { label: 'Absent', className: 'bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)]' };
                      return { label: 'Unknown', className: 'bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)]' };
                    };
                    const avatarPalette = ['bg-sky-500', 'bg-orange-500', 'bg-violet-500', 'bg-emerald-500', 'bg-pink-500', 'bg-teal-500'];
                    const initialsOf = (name: string) => (name || '?').split(' ').filter(Boolean).slice(0, 2).map((p: string) => p[0]?.toUpperCase()).join('');
                    return (
                      <div className="nexus-card rounded-2xl p-5 space-y-4">
                        <div>
                          <h3 className="text-xs font-bold text-[var(--color-nexus-ink)] uppercase tracking-wider">Your Team</h3>
                          <span className="text-[10px] text-[var(--color-nexus-muted)] block mt-0.5">Snapshot of your direct reports, today</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                          <div className="rounded-xl p-3 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)]">
                            <span className="text-[9px] text-[var(--color-nexus-muted)] uppercase font-bold tracking-wider block">Team Size</span>
                            <span className="text-xl font-black text-[var(--color-nexus-ink)] block mt-1">{myTeam.length}</span>
                          </div>
                          <div className="rounded-xl p-3 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)]">
                            <span className="text-[9px] text-[var(--color-nexus-muted)] uppercase font-bold tracking-wider block">Present Today</span>
                            <span className="text-xl font-black text-[var(--color-nexus-success-text)] block mt-1">{teamPresent ?? '—'}</span>
                          </div>
                          <div className="rounded-xl p-3 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)]">
                            <span className="text-[9px] text-[var(--color-nexus-muted)] uppercase font-bold tracking-wider block">Late Today</span>
                            <span className="text-xl font-black text-[var(--color-nexus-secondary)] block mt-1">{teamLate ?? '—'}</span>
                          </div>
                          <div className="rounded-xl p-3 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)]">
                            <span className="text-[9px] text-[var(--color-nexus-muted)] uppercase font-bold tracking-wider block">Absent Today</span>
                            <span className="text-xl font-black text-[var(--color-nexus-error)] block mt-1">{teamAbsent ?? '—'}</span>
                          </div>
                          <div className="rounded-xl p-3 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)]">
                            <span className="text-[9px] text-[var(--color-nexus-muted)] uppercase font-bold tracking-wider block">On Leave Today</span>
                            <span className="text-xl font-black text-blue-500 block mt-1">{teamOnLeave}</span>
                          </div>
                        </div>
                        <div className="divide-y divide-[var(--color-nexus-border)]/50 max-h-72 overflow-y-auto pr-1">
                          {myTeam.map((e: any, i: number) => {
                            const status = statusOf(e.id);
                            return (
                              <button
                                type="button"
                                key={e.id}
                                onClick={() => setDetailUserId(e.id)}
                                className="w-full py-2.5 flex items-center justify-between gap-3 text-xs text-left hover:bg-[var(--color-nexus-surface-alt)] rounded-lg px-1.5 -mx-1.5 transition-colors"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className={`w-8 h-8 shrink-0 rounded-full ${avatarPalette[i % avatarPalette.length]} text-white flex items-center justify-center text-[11px] font-bold`}>
                                    {initialsOf(e.name)}
                                  </div>
                                  <div className="min-w-0">
                                    <span className="font-bold text-[var(--color-nexus-ink)] block truncate">{e.name}</span>
                                    <span className="text-[var(--color-nexus-muted)] block truncate">{e.designation || e.role}</span>
                                  </div>
                                </div>
                                <span className={`shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full ${status.className}`}>{status.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* WFH headcount cards row */}
                  {wfhStats && (() => {
                    const now = new Date();
                    const todayStr = now.toDateString();
                    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
                    const wfhTodayRows = (wfhLedger || [])
                      .filter((l: any) => new Date(l.date).toDateString() === todayStr)
                      .map((l: any) => ({ name: l.userName, role: l.role, checkInTime: l.checkInTime, attendanceMode: 'wfh', status: l.status }));
                    const wfhMonthRows = (wfhLedger || [])
                      .filter((l: any) => new Date(l.date) >= monthStart)
                      .map((l: any) => ({ name: l.userName, role: l.role, checkInTime: l.checkInTime, attendanceMode: 'wfh', status: l.status }));
                    const pendingWfhRows = (pendingAttendance || [])
                      .filter((l: any) => l.attendanceMode === 'wfh')
                      .map((l: any) => ({ name: l.userName, role: l.userRole, checkInTime: l.createdAt, attendanceMode: 'wfh', status: l.status }));
                    const locationRows = (wfhLocationRequests || []).map((r: any) => ({
                      name: r.userName, role: r.userRole,
                      newLocation: r.newAddress || (r.newLatitude != null ? `${Number(r.newLatitude).toFixed(4)}, ${Number(r.newLongitude).toFixed(4)}` : '—'),
                      reason: r.reason,
                    }));
                    const wfhCard = 'text-left nexus-card  rounded-2xl p-4 cursor-pointer transition-all hover:bg-[var(--color-nexus-primary-fixed)]/20 w-full';
                    return (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab('attendance');
                            setAttendanceSubTab('wfh');
                            openDrillDown('WFH Today', wfhTodayRows, attendancePersonColumns, { searchIds: ['name'], roleFilter: true });
                          }}
                          className={wfhCard}
                        >
                          <span className="text-[9px] text-[var(--color-nexus-muted)] uppercase font-bold tracking-wider block">WFH Today</span>
                          <span className="text-xl font-black text-[var(--color-nexus-primary)] block mt-1">{wfhStats.todayWfhCount}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab('attendance');
                            setAttendanceSubTab('wfh');
                            openDrillDown('WFH This Month', wfhMonthRows, attendancePersonColumns, { searchIds: ['name'], roleFilter: true });
                          }}
                          className={wfhCard}
                        >
                          <span className="text-[9px] text-[var(--color-nexus-muted)] uppercase font-bold tracking-wider block">WFH This Month</span>
                          <span className="text-xl font-black text-[var(--color-nexus-primary)] block mt-1">{wfhStats.monthlyWfhCount}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab('attendance');
                            setAttendanceSubTab('late-arrivals');
                            openDrillDown('Pending WFH Approvals', pendingWfhRows, attendancePersonColumns, { searchIds: ['name'], roleFilter: true });
                          }}
                          className={wfhCard}
                        >
                          <span className="text-[9px] text-[var(--color-nexus-muted)] uppercase font-bold tracking-wider block">Pending WFH Approvals</span>
                          <span className="text-xl font-black text-[var(--color-nexus-secondary)] block mt-1">{wfhStats.pendingWfhApprovals}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab('attendance');
                            setAttendanceSubTab('wfh-locations');
                            openDrillDown('Pending Location Requests', locationRows, locationRequestColumns, { searchIds: ['name'], roleFilter: true });
                          }}
                          className={wfhCard}
                        >
                          <span className="text-[9px] text-[var(--color-nexus-muted)] uppercase font-bold tracking-wider block">Pending Location Requests</span>
                          <span className="text-xl font-black text-[var(--color-nexus-secondary)] block mt-1">{wfhStats.pendingLocationChangeRequests}</span>
                        </button>
                      </div>
                    );
                  })()}

                  {/* Zoho approvals inbox queue */}
                  <div className="nexus-card rounded-2xl p-5 space-y-4">
                    <div className="flex items-center justify-between border-b border-[var(--color-nexus-border)]/50 pb-3">
                      <div>
                        <h3 className="text-xs font-bold text-[var(--color-nexus-ink)] uppercase tracking-wider">Approvals Inbox</h3>
                        <span className="text-[10px] text-[var(--color-nexus-muted)]">Action requests awaiting administrative resolution</span>
                      </div>
                      <span className="text-xs font-mono font-bold bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] px-2.5 py-1 rounded-full">
                        {corrections.filter((c) => c.status === 'pending').length + pendingAttendance.length + wfhLocationRequests.length} Pending
                      </span>
                    </div>

                    {corrections.filter((c) => c.status === 'pending').length === 0 && pendingAttendance.length === 0 && wfhLocationRequests.length === 0 ? (
                      <div className="text-center py-8 text-xs text-[var(--color-nexus-muted)] font-medium">
                        ✨ All clear! No pending corrections, check-ins, or WFH location requests.
                      </div>
                    ) : (
                      <div className="divide-y divide-[var(--color-nexus-border)]/50 max-h-[350px] overflow-y-auto pr-1">
                        {/* Corrections */}
                        {corrections.filter((c) => c.status === 'pending').map((c) => (
                          <div key={`corr-${c.id}`} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 text-xs">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-[var(--color-nexus-ink)]">{c.userName || 'Employee'}</span>
                                <span className="bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-md">Correction</span>
                              </div>
                              <p className="text-[var(--color-nexus-muted)] leading-relaxed">
                                Requested <strong className="text-[var(--color-nexus-ink)]">{c.requestType.replace('_', ' ')}</strong> on <strong>{c.requestedDate}</strong> {c.requestedTime && `at ${c.requestedTime}`}.
                              </p>
                              {c.reason && <p className="text-[11px] text-[var(--color-nexus-muted)] italic">" {c.reason} "</p>}
                            </div>
                            <div className="flex items-center gap-2 self-end sm:self-center">
                              <button
                                type="button"
                                onClick={() => handleResolveCorrection(c.id, 'approve')}
                                className="bg-[var(--color-nexus-success-text)] hover:brightness-110 text-white text-[10px] font-bold uppercase tracking-wider px-3.5 py-1.5 rounded-lg transition-all"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => handleResolveCorrection(c.id, 'reject')}
                                className="bg-[var(--color-nexus-error)] hover:brightness-110 text-white text-[10px] font-bold uppercase tracking-wider px-3.5 py-1.5 rounded-lg transition-all"
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                        ))}

                        {/* Late arrivals / WFH check-ins */}
                        {pendingAttendance.map((l) => (
                          <div key={`late-${l.id}`} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 text-xs">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-[var(--color-nexus-ink)]">{l.userName || 'Employee'}</span>
                                <span className="bg-[var(--color-nexus-secondary-container)] text-[var(--color-nexus-secondary)] text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-md">Late / WFH Check-in</span>
                              </div>
                              <p className="text-[var(--color-nexus-muted)] leading-relaxed">
                                Checked in at <strong>{new Date(l.createdAt).toLocaleTimeString()}</strong> via <strong>{l.attendanceMode.toUpperCase()}</strong>.
                              </p>
                              {l.reason && <p className="text-[11px] text-[var(--color-nexus-muted)] italic">" {l.reason} "</p>}
                            </div>
                            <div className="flex items-center gap-2 self-end sm:self-center">
                              <button
                                type="button"
                                onClick={() => handleResolveAttendance(l.id, 'approve')}
                                className="bg-[var(--color-nexus-success-text)] hover:brightness-110 text-white text-[10px] font-bold uppercase tracking-wider px-3.5 py-1.5 rounded-lg transition-all"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => handleResolveAttendance(l.id, 'reject')}
                                className="bg-[var(--color-nexus-error)] hover:brightness-110 text-white text-[10px] font-bold uppercase tracking-wider px-3.5 py-1.5 rounded-lg transition-all"
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                        ))}

                        {/* WFH Location requests */}
                        {wfhLocationRequests.map((r) => (
                          <div key={`loc-${r.id}`} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 text-xs">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-[var(--color-nexus-ink)]">{r.userName || 'Employee'}</span>
                                <span className="bg-blue-100 text-blue-700 text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-md">WFH Geofence Change</span>
                              </div>
                              <p className="text-[var(--color-nexus-muted)] leading-relaxed">
                                Requested geofence center to: <strong className="text-[var(--color-nexus-ink)]">{r.newAddress || `${Number(r.newLatitude).toFixed(4)}, ${Number(r.newLongitude).toFixed(4)}`}</strong>
                              </p>
                              {r.reason && <p className="text-[11px] text-[var(--color-nexus-muted)] italic">" {r.reason} "</p>}
                            </div>
                            <div className="flex items-center gap-2 self-end sm:self-center">
                              <button
                                type="button"
                                onClick={() => handleResolveWfhLocationRequest(r.id, 'approve')}
                                className="bg-[var(--color-nexus-success-text)] hover:brightness-110 text-white text-[10px] font-bold uppercase tracking-wider px-3.5 py-1.5 rounded-lg transition-all"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => handleResolveWfhLocationRequest(r.id, 'reject')}
                                className="bg-[var(--color-nexus-error)] hover:brightness-110 text-white text-[10px] font-bold uppercase tracking-wider px-3.5 py-1.5 rounded-lg transition-all"
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Visual charts analytics panel */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Area trend line */}
                    <div className="nexus-card rounded-2xl p-5 space-y-4">
                      <div>
                        <h3 className="text-xs font-bold text-[var(--color-nexus-ink)] uppercase tracking-wider">Attendance & Lateness Trend</h3>
                        <span className="text-[10px] text-[var(--color-nexus-muted)] block mt-0.5">30-day historical check-in percentages</span>
                      </div>
                      {tenantTrends.length === 0 ? (
                        <div className="h-60 flex items-center justify-center text-xs text-[var(--color-nexus-muted)]">
                          No trend statistics available.
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height={240}>
                          <AreaChart data={tenantTrends} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <defs>
                              <linearGradient id="colorAttendance" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="var(--color-nexus-primary)" stopOpacity={0.3}/>
                                <stop offset="95%" stopColor="var(--color-nexus-primary)" stopOpacity={0}/>
                              </linearGradient>
                              <linearGradient id="colorLateness" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="var(--color-nexus-secondary)" stopOpacity={0.3}/>
                                <stop offset="95%" stopColor="var(--color-nexus-secondary)" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-nexus-border)" />
                            <XAxis
                              dataKey="date"
                              tick={{ fontSize: 9, fill: 'var(--color-nexus-muted)' }}
                              axisLine={false}
                              tickLine={false}
                              tickFormatter={(str) => {
                                const d = new Date(str);
                                return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
                              }}
                            />
                            <YAxis tick={{ fontSize: 9, fill: 'var(--color-nexus-muted)' }} axisLine={false} tickLine={false} domain={[0, 100]} />
                            <RechartsTooltip
                              contentStyle={{
                                backgroundColor: 'var(--color-nexus-surface)',
                                border: '1px solid var(--color-nexus-border)',
                                borderRadius: '12px',
                                fontSize: '11px',
                                color: 'var(--color-nexus-ink)'
                              }}
                            />
                            <Area type="monotone" name="Attendance Rate" dataKey="attendancePercent" stroke="var(--color-nexus-primary)" fillOpacity={1} fill="url(#colorAttendance)" strokeWidth={2} />
                            <Area type="monotone" name="Lateness Rate" dataKey="latePercent" stroke="var(--color-nexus-secondary)" fillOpacity={1} fill="url(#colorLateness)" strokeWidth={2} />
                          </AreaChart>
                        </ResponsiveContainer>
                      )}
                    </div>

                    {/* Role doughnut pie */}
                    <div className="nexus-card rounded-2xl p-5 space-y-4">
                      <div>
                        <h3 className="text-xs font-bold text-[var(--color-nexus-ink)] uppercase tracking-wider">Staff Role Distribution</h3>
                        <span className="text-[10px] text-[var(--color-nexus-muted)] block mt-0.5">Headcount shares across administrative and operational roles</span>
                      </div>

                      {tenantAnalytics && (() => {
                        const rolesData = Object.entries(tenantAnalytics.staffByRole || {}).map(([name, value]) => ({
                          name: name.replace('_', ' ').toUpperCase(),
                          value
                        }));
                        const COLORS = ['#7B5CFA', '#10B981', '#F59E0B', '#EF4444', '#6E6A85'];
                        if (rolesData.length === 0) {
                          return (
                            <div className="h-60 flex items-center justify-center text-xs text-[var(--color-nexus-muted)]">
                              No staff roles data compiled.
                            </div>
                          );
                        }
                        return (
                          <div className="flex flex-col sm:flex-row items-center justify-center gap-6 h-60">
                            <ResponsiveContainer width="50%" height="100%">
                              <PieChart>
                                <Pie
                                  data={rolesData}
                                  cx="50%" cy="50%"
                                  innerRadius={50} outerRadius={75}
                                  paddingAngle={3}
                                  dataKey="value"
                                >
                                  {rolesData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                  ))}
                                </Pie>
                                <RechartsTooltip
                                  contentStyle={{
                                    backgroundColor: 'var(--color-nexus-surface)',
                                    border: '1px solid var(--color-nexus-border)',
                                    borderRadius: '12px',
                                    fontSize: '11px'
                                  }}
                                />
                              </PieChart>
                            </ResponsiveContainer>

                            <div className="flex flex-col gap-2.5 text-xs text-[var(--color-nexus-ink)]">
                              {rolesData.map((item, idx) => (
                                <div key={item.name} className="flex items-center gap-2">
                                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                                  <span className="font-medium text-[11px]">{item.name}:</span>
                                  <span className="font-bold">{item.value as number} staff</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Module Cards Grid (Quick Access Shortcuts) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('attendance');
                        setAttendanceSubTab('status');
                      }}
                      className="text-left nexus-card  rounded-2xl p-6 group transition-all hover:border-[var(--color-nexus-primary)]/50"
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div className="w-12 h-12 rounded-2xl bg-[var(--color-nexus-primary-fixed)] group-hover:bg-[var(--color-nexus-primary)] flex items-center justify-center transition-colors">
                          <Clock size={22} className="text-[var(--color-nexus-primary)] group-hover:text-white transition-colors" />
                        </div>
                      </div>
                      <h3 className="font-bold text-base text-[var(--color-nexus-ink)]">Attendance Management</h3>
                      <p className="text-xs text-[var(--color-nexus-muted)] mt-1.5 leading-relaxed">
                        Check daily check-in logs, view shifts, manage Work From Home requests, and review QR codes.
                      </p>
                      {tenantAnalytics && (
                        <div className="mt-4 pt-4 border-t border-[var(--color-nexus-border)] flex items-center gap-4 text-xs font-semibold text-[var(--color-nexus-ink)]">
                          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[var(--color-nexus-success-text)]" /> {tenantAnalytics.presentToday} Present</span>
                          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[var(--color-nexus-secondary)]" /> {tenantAnalytics.lateToday} Late</span>
                        </div>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => navigate('/tenant/leave')}
                      className="text-left nexus-card  rounded-2xl p-6 group transition-all hover:border-[var(--color-nexus-primary)]/50"
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div className="w-12 h-12 rounded-2xl bg-[var(--color-nexus-primary-fixed)] group-hover:bg-[var(--color-nexus-primary)] flex items-center justify-center transition-colors">
                          <CalendarDays size={22} className="text-[var(--color-nexus-primary)] group-hover:text-white transition-colors" />
                        </div>
                      </div>
                      <h3 className="font-bold text-base text-[var(--color-nexus-ink)]">Leave Management</h3>
                      <p className="text-xs text-[var(--color-nexus-muted)] mt-1.5 leading-relaxed">
                        Apply and approve leaves, configure sick/casual balances, and view leave balance ledgers.
                      </p>
                      <div className="mt-4 pt-4 border-t border-[var(--color-nexus-border)] flex items-center gap-4 text-xs font-semibold text-[var(--color-nexus-muted)]">
                        <span>Manage policies, balances, history</span>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => navigate('/tenant/payroll')}
                      className="text-left nexus-card  rounded-2xl p-6 group transition-all hover:border-[var(--color-nexus-primary)]/50"
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div className="w-12 h-12 rounded-2xl bg-[var(--color-nexus-primary-fixed)] group-hover:bg-[var(--color-nexus-primary)] flex items-center justify-center transition-colors">
                          <Banknote size={22} className="text-[var(--color-nexus-primary)] group-hover:text-white transition-colors" />
                        </div>
                      </div>
                      <h3 className="font-bold text-base text-[var(--color-nexus-ink)]">Payroll Module</h3>
                      <p className="text-xs text-[var(--color-nexus-muted)] mt-1.5 leading-relaxed">
                        Set up monthly salary structures, bonuses, deductions, and download payslips.
                      </p>
                      <div className="mt-4 pt-4 border-t border-[var(--color-nexus-border)] flex items-center gap-4 text-xs font-semibold text-[var(--color-nexus-muted)]">
                        <span>Calculate monthly net, CTC, deductions</span>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('administration');
                        setAdminSubTab(null);
                      }}
                      className="text-left nexus-card  rounded-2xl p-6 group transition-all hover:border-[var(--color-nexus-primary)]/50"
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div className="w-12 h-12 rounded-2xl bg-[var(--color-nexus-primary-fixed)] group-hover:bg-[var(--color-nexus-primary)] flex items-center justify-center transition-colors">
                          <ShieldCheck size={22} className="text-[var(--color-nexus-primary)] group-hover:text-white transition-colors" />
                        </div>
                      </div>
                      <h3 className="font-bold text-base text-[var(--color-nexus-ink)]">Administration</h3>
                      <p className="text-xs text-[var(--color-nexus-muted)] mt-1.5 leading-relaxed">
                        Configure office boundary rules (IP & GPS limits), onboard new staff, and review audit logs.
                      </p>
                      <div className="mt-4 pt-4 border-t border-[var(--color-nexus-border)] flex items-center gap-4 text-xs font-semibold text-[var(--color-nexus-ink)]">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[var(--color-nexus-primary)]" /> {notifications.filter((n: any) => !n.isRead).length} Alerts</span>
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {/* Correction Request Modal for Self Service */}
              {showSelfCorrectionModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm">
                  <div className="max-w-md w-full bg-[var(--color-nexus-surface)] rounded-3xl p-8 shadow-[0_20px_60px_rgba(37,99,235,0.2)] border border-[var(--color-nexus-border)]">
                    {selfCorrectionSubmitted ? (
                      <div className="text-center py-6">
                        <p className="text-[var(--color-nexus-success-text)] font-bold text-sm uppercase tracking-wider">Request submitted</p>
                        <p className="text-[var(--color-nexus-muted)] text-xs mt-2">Your managers will review it shortly.</p>
                      </div>
                    ) : (
                      <form onSubmit={handleSubmitSelfCorrection}>
                        <h3 className="text-[var(--color-nexus-ink)] font-bold text-sm uppercase tracking-wider mb-5">Request Attendance Correction</h3>
                        <div className="space-y-4">
                          <div>
                            <label className="block text-[10px] font-bold text-[var(--color-nexus-muted)] uppercase tracking-widest mb-1.5">Issue Type</label>
                            <select
                              value={selfCorrectionType}
                              onChange={e => setSelfCorrectionType(e.target.value)}
                              className="w-full bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--color-nexus-ink)] focus:outline-none focus:border-[var(--color-nexus-primary)]"
                            >
                              <option value="missed_checkin">Missed Check-In</option>
                              <option value="missed_checkout">Missed Check-Out</option>
                              <option value="wrong_location">Wrong Location Flagged</option>
                              <option value="other">Other</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-[var(--color-nexus-muted)] uppercase tracking-widest mb-1.5">Date</label>
                            <input
                              type="date"
                              value={selfCorrectionDate}
                              onChange={e => setSelfCorrectionDate(e.target.value)}
                              className="w-full bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--color-nexus-ink)] focus:outline-none focus:border-[var(--color-nexus-primary)]"
                              required
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-[var(--color-nexus-muted)] uppercase tracking-widest mb-1.5">Time (optional)</label>
                            <input
                              type="time"
                              value={selfCorrectionTime}
                              onChange={e => setSelfCorrectionTime(e.target.value)}
                              className="w-full bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--color-nexus-ink)] focus:outline-none focus:border-[var(--color-nexus-primary)]"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-[var(--color-nexus-muted)] uppercase tracking-widest mb-1.5">Explanation</label>
                            <textarea
                              value={selfCorrectionReason}
                              onChange={e => setSelfCorrectionReason(e.target.value)}
                              rows={3}
                              className="w-full bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--color-nexus-ink)] focus:outline-none focus:border-[var(--color-nexus-primary)] resize-none"
                              placeholder="e.g. Forgot checking in when returning from client meeting."
                              required
                            />
                          </div>
                        </div>
                        {error && <p className="text-[var(--color-nexus-error)] text-[10px] mt-3">{error}</p>}
                        <div className="flex gap-3 mt-6">
                          <button
                            type="button"
                            onClick={() => setShowSelfCorrectionModal(false)}
                            className="flex-1 bg-[var(--color-nexus-surface-alt)] hover:bg-[var(--color-nexus-border)] text-[var(--color-nexus-ink)] rounded-xl py-3 text-xs font-bold uppercase tracking-wider transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={selfCorrectionSubmitting}
                            className="flex-1 bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white rounded-xl py-3 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
                          >
                            {selfCorrectionSubmitting ? 'Submitting...' : 'Submit Request'}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        )}

        {/* ======================================================== */}
        {/* SUPER ADMIN WORKSPACE */}
        {/* ======================================================== */}
        {user.role === 'super_admin' && (
          <div>

            {/* Analytics */}
            {activeTab === 'analytics' && superAnalytics && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="nexus-card  rise-in rounded-2xl p-4" style={{ animationDelay: '0ms' }}>
                    <span className="text-[10px] text-[var(--color-nexus-muted)] uppercase font-bold tracking-wider block">Total Tenants</span>
                    <span className="text-2xl font-black text-[var(--color-nexus-ink)] block mt-1">{superAnalytics.totalTenants}</span>
                  </div>
                  <div className="nexus-card  rise-in rounded-2xl p-4" style={{ animationDelay: '60ms' }}>
                    <span className="text-[10px] text-[var(--color-nexus-muted)] uppercase font-bold tracking-wider block">Active Tenants</span>
                    <span className="text-2xl font-black text-[var(--color-nexus-success-text)] block mt-1">{superAnalytics.activeTenants}</span>
                  </div>
                  <div className="nexus-card  rise-in rounded-2xl p-4" style={{ animationDelay: '120ms' }}>
                    <span className="text-[10px] text-[var(--color-nexus-muted)] uppercase font-bold tracking-wider block">Suspended</span>
                    <span className="text-2xl font-black text-[var(--color-nexus-error)] block mt-1">{superAnalytics.suspendedTenants}</span>
                  </div>
                  <div className="nexus-card  rise-in rounded-2xl p-4" style={{ animationDelay: '180ms' }}>
                    <span className="text-[10px] text-[var(--color-nexus-muted)] uppercase font-bold tracking-wider block">Total Staff (All Tenants)</span>
                    <span className="text-2xl font-black text-[var(--color-nexus-ink)] block mt-1">{superAnalytics.totalEmployees}</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="nexus-card rounded-2xl p-5">
                    <h3 className="text-sm font-bold text-[var(--color-nexus-ink)] mb-1">This Month, Across All Tenants</h3>
                    <p className="text-[10px] text-[var(--color-nexus-muted)] mb-3">Approved check-ins vs. rejected verification attempts</p>
                    {(superAnalytics.monthlyCheckInEvents + superAnalytics.monthlyRejectedEvents) > 0 ? (
                      <div style={{ width: '100%', height: 200 }}>
                        <ResponsiveContainer>
                          <PieChart>
                            <Pie
                              data={[
                                { name: 'Approved', value: superAnalytics.monthlyCheckInEvents },
                                { name: 'Rejected', value: superAnalytics.monthlyRejectedEvents },
                              ]}
                              dataKey="value"
                              nameKey="name"
                              innerRadius={45}
                              outerRadius={75}
                              paddingAngle={3}
                            >
                              <Cell fill="#16A34A" />
                              <Cell fill="#E24545" />
                            </Pie>
                            <RechartsTooltip />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <p className="text-xs text-[var(--color-nexus-muted)] text-center py-16">No attendance events recorded yet this month.</p>
                    )}
                    <div className="flex justify-center gap-6 mt-2">
                      <span className="text-xs text-[var(--color-nexus-muted)] flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[var(--color-nexus-success-text)] inline-block" /> Approved ({superAnalytics.monthlyCheckInEvents})</span>
                      <span className="text-xs text-[var(--color-nexus-muted)] flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[var(--color-nexus-error)] inline-block" /> Rejected ({superAnalytics.monthlyRejectedEvents})</span>
                    </div>
                  </div>
                  <div className="nexus-card rounded-2xl p-5">
                    <h3 className="text-sm font-bold text-[var(--color-nexus-ink)] mb-1">Plan Breakdown</h3>
                    <p className="text-[10px] text-[var(--color-nexus-muted)] mb-3">Tenants grouped by subscription plan</p>
                    {Object.keys(superAnalytics.planBreakdown || {}).length > 0 ? (
                      <div style={{ width: '100%', height: 200 }}>
                        <ResponsiveContainer>
                          <BarChart data={Object.entries(superAnalytics.planBreakdown || {}).map(([plan, count]) => ({ plan, count }))}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E9E4FB" />
                            <XAxis dataKey="plan" tick={{ fontSize: 11, fill: '#6E6A85' }} axisLine={false} tickLine={false} />
                            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6E6A85' }} axisLine={false} tickLine={false} />
                            <RechartsTooltip cursor={{ fill: '#EFE9FF' }} />
                            <Bar dataKey="count" fill="#7B5CFA" radius={[6, 6, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <p className="text-xs text-[var(--color-nexus-muted)] text-center py-16">No tenants onboarded yet.</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Manage Tenants: suspend / reactivate */}
            {activeTab === 'tenants' && (
              <div className="nexus-card rounded-3xl p-6">
                <h2 className="text-lg font-bold text-gradient mb-6 font-sans">All Tenants</h2>
                {allTenants.length === 0 ? (
                  <p className="text-sm text-[var(--color-nexus-muted)] text-center py-12">No tenants onboarded yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)] text-[10px] uppercase font-bold tracking-wider">
                          <th className="py-3 px-4">Company Name</th>
                          <th className="py-3 px-4">Plan</th>
                          <th className="py-3 px-4">Staff</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allTenants.map((t) => (
                          <tr key={t.id} className="border-b border-[var(--color-nexus-border)] text-sm hover:bg-[var(--color-nexus-primary-fixed)] transition-colors">
                            <td className="py-4 px-4 font-semibold text-[var(--color-nexus-ink)]">{t.name}</td>
                            <td className="py-4 px-4">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-ink)]">{t.plan}</span>
                            </td>
                            <td className="py-4 px-4 font-semibold">{t.employeeCount}</td>
                            <td className="py-4 px-4">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${(t.status || 'active') === 'active' ? 'bg-[color:var(--color-nexus-success-text)]/10 text-[var(--color-nexus-success-text)]' : 'bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)]'}`}>
                                {t.status || 'active'}
                              </span>
                            </td>
                            <td className="py-4 px-4 text-right">
                              <button
                                onClick={() => handleToggleTenantStatus(t.id, t.status || 'active')}
                                className={`font-bold text-xs uppercase tracking-wider py-1.5 px-4 rounded-lg transition-colors ${(t.status || 'active') === 'active' ? 'bg-[var(--color-nexus-error)] hover:brightness-110 text-white' : 'bg-[var(--color-nexus-success-text)] hover:brightness-110 text-white'}`}
                              >
                                {(t.status || 'active') === 'active' ? 'Suspend' : 'Reactivate'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Tenancy Requests List */}
            {activeTab === 'requests' && (
              <div className="nexus-card rounded-3xl p-6">
                <h2 className="text-lg font-bold text-gradient mb-6 font-sans">Inbound Tenant Registrations</h2>
                {tenancyRequests.length === 0 ? (
                  <p className="text-sm text-[var(--color-nexus-muted)] text-center py-12">No pending registration requests found.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)] text-[10px] uppercase font-bold tracking-wider">
                          <th className="py-3 px-4">Company Name</th>
                          <th className="py-3 px-4">Admin Email</th>
                          <th className="py-3 px-4">Plan Selected</th>
                          <th className="py-3 px-4">Employees</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tenancyRequests.map((req) => (
                          <tr key={req.id} className="border-b border-[var(--color-nexus-border)] text-sm hover:bg-[var(--color-nexus-primary-fixed)] transition-colors">
                            <td className="py-4 px-4 font-semibold text-[var(--color-nexus-ink)]">{req.companyName}</td>
                            <td className="py-4 px-4 text-[var(--color-nexus-muted)] font-mono text-xs">{req.email}</td>
                            <td className="py-4 px-4">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${req.plan === 'Enterprise' ? 'bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)]' : req.plan === 'Professional' ? 'bg-[var(--color-nexus-secondary-container)] text-[var(--color-nexus-secondary)]' : 'bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-ink)]'}`}>
                                {req.plan}
                              </span>
                            </td>
                            <td className="py-4 px-4 font-semibold">{req.numEmployees}</td>
                            <td className="py-4 px-4">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${req.status === 'approved' ? 'bg-[color:var(--color-nexus-success-text)]/10 text-[var(--color-nexus-success-text)]' : 'bg-[var(--color-nexus-secondary-container)] text-[var(--color-nexus-secondary)]'}`}>
                                {req.status}
                              </span>
                            </td>
                            <td className="py-4 px-4 text-right">
                              {req.status === 'pending' && (
                                <button 
                                  onClick={() => handleOpenApproveModal(req)}
                                  className="bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white font-bold text-xs uppercase tracking-wider py-1.5 px-4 rounded-lg transition-colors"
                                >
                                  Onboard Tenant
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Super Admin Notifications */}
            {activeTab === 'notifications' && (
              <div className="nexus-card rounded-3xl p-6">
                <h2 className="text-lg font-bold text-gradient mb-6 font-sans">Admin Inbox</h2>
                {notifications.length === 0 ? (
                  <p className="text-sm text-[var(--color-nexus-muted)] text-center py-12">No notifications found.</p>
                ) : (
                  <div className="space-y-4">
                    {notifications.map((notif) => (
                      <div key={notif.id} className="p-4 bg-[var(--color-nexus-surface-alt)] rounded-2xl border border-[var(--color-nexus-border)] flex justify-between items-start gap-4">
                        <div>
                          <h4 className="text-xs font-bold text-[var(--color-nexus-ink)] uppercase tracking-wider">{notif.title}</h4>
                          <p className="text-xs text-[var(--color-nexus-muted)] mt-1">{notif.message}</p>
                          <span className="text-[10px] text-[var(--color-nexus-muted)] mt-2 block">{new Date(notif.createdAt).toLocaleString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Approval Modal */}
        {showApprovalModal && selectedRequest && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-6">
            <div className="nexus-card rounded-3xl p-8 max-w-md w-full shadow-2xl">
              <h3 className="text-lg font-bold text-[var(--color-nexus-ink)] mb-2 font-sans">Approve Tenancy Onboarding</h3>
              <p className="text-xs text-[var(--color-nexus-muted)] mb-6">Assign feature capabilities and privileges for <strong>{selectedRequest.companyName}</strong>.</p>

              <div className="mb-6">
                <label className="block text-xs font-bold text-[var(--color-nexus-muted)] uppercase tracking-wider mb-2">Subscription Plan</label>
                <select
                  value={selectedPlanOverride}
                  onChange={e => setSelectedPlanOverride(e.target.value)}
                  className="w-full px-4 py-3 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-sm focus:outline-none text-[var(--color-nexus-ink)] font-medium"
                >
                  <option value="Basic">Basic</option>
                  <option value="Standard">Standard</option>
                  <option value="Professional">Professional</option>
                  <option value="Enterprise">Enterprise</option>
                </select>
                <p className="text-[10px] text-[var(--color-nexus-muted)] mt-1">Requested: <strong>{selectedRequest.plan}</strong> — you can change it before onboarding.</p>
              </div>

              <div className="space-y-4 mb-8">
                <span className="block text-xs font-bold text-[var(--color-nexus-muted)] uppercase tracking-wider">Features Package</span>
                
                <label className="flex items-center gap-3 p-3 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl cursor-pointer hover:bg-[var(--color-nexus-primary-fixed)]/50 transition-colors">
                  <input 
                    type="checkbox" 
                    checked={selectedFeatures.includes('kyc')} 
                    onChange={() => toggleFeature('kyc')}
                    className="w-4 h-4 accent-[var(--color-nexus-primary)]"
                  />
                  <div>
                    <span className="block text-xs font-bold text-[var(--color-nexus-ink)]">KYC Biometrics Check</span>
                    <span className="text-[10px] text-[var(--color-nexus-muted)]">Requires camera face embeddings matching</span>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-3 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl cursor-pointer hover:bg-[var(--color-nexus-primary-fixed)]/50 transition-colors">
                  <input 
                    type="checkbox" 
                    checked={selectedFeatures.includes('gps_geofence')} 
                    onChange={() => toggleFeature('gps_geofence')}
                    className="w-4 h-4 accent-[var(--color-nexus-primary)]"
                  />
                  <div>
                    <span className="block text-xs font-bold text-[var(--color-nexus-ink)]">GPS Geofencing Bounds</span>
                    <span className="text-[10px] text-[var(--color-nexus-muted)]">Limits checking in to office coordinate radius</span>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-3 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl cursor-pointer hover:bg-[var(--color-nexus-primary-fixed)]/50 transition-colors">
                  <input 
                    type="checkbox" 
                    checked={selectedFeatures.includes('wifi_lock')} 
                    onChange={() => toggleFeature('wifi_lock')}
                    className="w-4 h-4 accent-[var(--color-nexus-primary)]"
                  />
                  <div>
                    <span className="block text-xs font-bold text-[var(--color-nexus-ink)]">Corporate Wi-Fi IP Security</span>
                    <span className="text-[10px] text-[var(--color-nexus-muted)]">Validates corporate public network IP addresses</span>
                  </div>
                </label>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => setShowApprovalModal(false)}
                  className="flex-1 bg-[var(--color-nexus-surface-alt)] hover:bg-[var(--color-nexus-border)] text-[var(--color-nexus-ink)] font-bold text-xs uppercase tracking-wider py-3.5 rounded-xl transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleApproveRequest}
                  disabled={loading}
                  className="flex-1 bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white font-bold text-xs uppercase tracking-wider py-3.5 rounded-xl transition-all disabled:opacity-50"
                >
                  {loading ? 'Onboarding...' : 'Confirm Approval'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TENANT ADMIN WORKSPACE */}
        {/* ======================================================== */}
        {user.role !== 'super_admin' && (
          <div>
            {activeTab === 'leave-management' && (
              <LeaveManagementPage user={user} onLogout={onLogout} embedded />
            )}

            {activeTab === 'payroll' && (
              <PayrollPage user={user} onLogout={onLogout} embedded />
            )}

            {activeTab === 'directory' && (
              <EmployeeDirectory user={user} onLogout={onLogout} embedded />
            )}

            {activeTab === 'teams' && (
              <TeamsPage user={user} onLogout={onLogout} embedded />
            )}

            {activeTab === 'attendance' && (
              <div className="mb-6">
                <h2 className="text-xl font-bold text-gradient font-sans">Attendance</h2>
                <p className="text-sm text-[var(--color-nexus-muted)] mt-1">Status, monthly report, and Work From Home — the essentials. Everything else is one tap away below.</p>
              </div>
            )}

            {/* Live snapshot ("Attendance Status") — cards drill down to the
                actual people when the viewer has reporting/directory access
                (tenantAnalytics.breakdown). */}
            {activeTab === 'attendance' && tenantAnalytics && (() => {
              const bd = tenantAnalytics.breakdown;
              const clickable = !!bd;
              const cardClass = (extra: string) => `text-left nexus-card  rounded-2xl p-4 ${clickable ? 'cursor-pointer' : 'cursor-default'} ${extra}`;
              return (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                <button type="button" disabled={!clickable} onClick={() => bd && openDrillDown('All Staff', bd.total, simplePersonColumns, { searchIds: ['name'], roleFilter: true })} className={cardClass('')}>
                  <span className="text-[9px] text-[var(--color-nexus-muted)] uppercase font-bold tracking-wider block">Total Staff</span>
                  <span className="text-xl font-black text-[var(--color-nexus-ink)] block mt-1">{tenantAnalytics.totalStaff}</span>
                </button>
                <button type="button" disabled={!clickable} onClick={() => bd && openDrillDown('Present Today', bd.present, attendancePersonColumns, { searchIds: ['name'], roleFilter: true })} className={cardClass('')}>
                  <span className="text-[9px] text-[var(--color-nexus-muted)] uppercase font-bold tracking-wider block">Present Today</span>
                  <span className="text-xl font-black text-[var(--color-nexus-success-text)] block mt-1">{tenantAnalytics.presentToday}</span>
                </button>
                <button type="button" disabled={!clickable} onClick={() => bd && openDrillDown('Absent Today', bd.absent, simplePersonColumns, { searchIds: ['name'], roleFilter: true })} className={cardClass('')}>
                  <span className="text-[9px] text-[var(--color-nexus-muted)] uppercase font-bold tracking-wider block">Absent Today</span>
                  <span className="text-xl font-black text-[var(--color-nexus-ink)] block mt-1">{tenantAnalytics.absentToday}</span>
                </button>
                <button type="button" disabled={!clickable} onClick={() => bd && openDrillDown('Late Today', bd.late, attendancePersonColumns, { searchIds: ['name'], roleFilter: true })} className={cardClass('')}>
                  <span className="text-[9px] text-[var(--color-nexus-muted)] uppercase font-bold tracking-wider block">Late Today</span>
                  <span className="text-xl font-black text-[var(--color-nexus-secondary)] block mt-1">{tenantAnalytics.lateToday}</span>
                </button>
                <button type="button" disabled={!clickable} onClick={() => bd && openDrillDown('Rejected Today', bd.rejected, attendancePersonColumns, { searchIds: ['name'], roleFilter: true })} className={cardClass('')}>
                  <span className="text-[9px] text-[var(--color-nexus-muted)] uppercase font-bold tracking-wider block">Rejected Today</span>
                  <span className="text-xl font-black text-[var(--color-nexus-error)] block mt-1">{tenantAnalytics.rejectedToday}</span>
                </button>
              </div>
              );
            })()}

            {/* Today's status donut + 30-day trend — visual complement to
                the stat-card row above, both derived from the same real
                data (tenantAnalytics.breakdown counts, tenantTrends). */}
            {activeTab === 'attendance' && tenantAnalytics && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <div className="nexus-card rounded-2xl p-5">
                  <h3 className="text-xs font-bold text-[var(--color-nexus-ink)] uppercase tracking-wider mb-3">Today's Status Breakdown</h3>
                  {(tenantAnalytics.presentToday + tenantAnalytics.absentToday + tenantAnalytics.lateToday) === 0 ? (
                    <div className="h-52 flex items-center justify-center text-xs text-[var(--color-nexus-muted)]">No attendance data for today yet.</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie
                          data={[
                            { name: 'Present', value: tenantAnalytics.presentToday, fill: 'var(--color-nexus-success-text)' },
                            { name: 'Absent', value: tenantAnalytics.absentToday, fill: 'var(--color-nexus-error)' },
                            { name: 'Late', value: tenantAnalytics.lateToday, fill: 'var(--color-nexus-secondary)' },
                          ]}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={55}
                          outerRadius={85}
                          paddingAngle={2}
                        >
                          {['Present', 'Absent', 'Late'].map((k) => <Cell key={k} />)}
                        </Pie>
                        <RechartsTooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>

                <div className="nexus-card rounded-2xl p-5">
                  <h3 className="text-xs font-bold text-[var(--color-nexus-ink)] uppercase tracking-wider mb-3">30-Day Attendance Trend</h3>
                  {tenantTrends.length === 0 ? (
                    <div className="h-52 flex items-center justify-center text-xs text-[var(--color-nexus-muted)]">No trend statistics available.</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <AreaChart data={tenantTrends} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="attendanceTabTrend" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="var(--color-nexus-primary)" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="var(--color-nexus-primary)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-nexus-border)" />
                        <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--color-nexus-muted)' }} axisLine={false} tickLine={false}
                          tickFormatter={(str) => new Date(str).toLocaleDateString([], { month: 'short', day: 'numeric' })} />
                        <YAxis tick={{ fontSize: 9, fill: 'var(--color-nexus-muted)' }} axisLine={false} tickLine={false} />
                        <RechartsTooltip />
                        <Area type="monotone" dataKey="attendancePercent" stroke="var(--color-nexus-primary)" fill="url(#attendanceTabTrend)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            )}

            {/* Work From Home snapshot ("wfh") — mirrors the office
                snapshot above; only appears for users with 'reports.view'
                (the same privilege already gating the audit ledger). */}
            {activeTab === 'attendance' && wfhStats && (() => {
              const now = new Date();
              const todayStr = now.toDateString();
              const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
              // Normalize each WFH source into the shared attendance-person row shape.
              const wfhTodayRows = (wfhLedger || [])
                .filter((l: any) => new Date(l.date).toDateString() === todayStr)
                .map((l: any) => ({ name: l.userName, role: l.role, checkInTime: l.checkInTime, attendanceMode: 'wfh', status: l.status }));
              const wfhMonthRows = (wfhLedger || [])
                .filter((l: any) => new Date(l.date) >= monthStart)
                .map((l: any) => ({ name: l.userName, role: l.role, checkInTime: l.checkInTime, attendanceMode: 'wfh', status: l.status }));
              const pendingWfhRows = (pendingAttendance || [])
                .filter((l: any) => l.attendanceMode === 'wfh')
                .map((l: any) => ({ name: l.userName, role: l.userRole, checkInTime: l.createdAt, attendanceMode: 'wfh', status: l.status }));
              const locationRows = (wfhLocationRequests || []).map((r: any) => ({
                name: r.userName, role: r.userRole,
                newLocation: r.newAddress || (r.newLatitude != null ? `${Number(r.newLatitude).toFixed(4)}, ${Number(r.newLongitude).toFixed(4)}` : '—'),
                reason: r.reason,
              }));
              const wfhCard = 'text-left nexus-card  rounded-2xl p-4 cursor-pointer';
              return (
              <div className="mb-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <button type="button" onClick={() => openDrillDown('WFH Today', wfhTodayRows, attendancePersonColumns, { searchIds: ['name'], roleFilter: true })} className={wfhCard}>
                    <span className="text-[9px] text-[var(--color-nexus-muted)] uppercase font-bold tracking-wider block">WFH Today</span>
                    <span className="text-xl font-black text-[var(--color-nexus-primary)] block mt-1">{wfhStats.todayWfhCount}</span>
                  </button>
                  <button type="button" onClick={() => openDrillDown('WFH This Month', wfhMonthRows, attendancePersonColumns, { searchIds: ['name'], roleFilter: true })} className={wfhCard}>
                    <span className="text-[9px] text-[var(--color-nexus-muted)] uppercase font-bold tracking-wider block">WFH This Month</span>
                    <span className="text-xl font-black text-[var(--color-nexus-primary)] block mt-1">{wfhStats.monthlyWfhCount}</span>
                  </button>
                  <button type="button" onClick={() => openDrillDown('Pending WFH Approvals', pendingWfhRows, attendancePersonColumns, { searchIds: ['name'], roleFilter: true })} className={wfhCard}>
                    <span className="text-[9px] text-[var(--color-nexus-muted)] uppercase font-bold tracking-wider block">Pending WFH Approvals</span>
                    <span className="text-xl font-black text-[var(--color-nexus-secondary)] block mt-1">{wfhStats.pendingWfhApprovals}</span>
                  </button>
                  <button type="button" onClick={() => openDrillDown('Pending Location Requests', locationRows, locationRequestColumns, { searchIds: ['name'], roleFilter: true })} className={wfhCard}>
                    <span className="text-[9px] text-[var(--color-nexus-muted)] uppercase font-bold tracking-wider block">Pending Location Requests</span>
                    <span className="text-xl font-black text-[var(--color-nexus-secondary)] block mt-1">{wfhStats.pendingLocationChangeRequests}</span>
                  </button>
                </div>

                {(wfhStats.officeVsWfh30d.office > 0 || wfhStats.officeVsWfh30d.wfh > 0) && (
                  <div className="nexus-card rounded-2xl p-5 mt-3">
                    <h3 className="text-xs font-bold text-[var(--color-nexus-ink)] uppercase tracking-wider mb-3">Office vs. Work From Home (Last 30 Days)</h3>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={[{ name: 'Check-ins', Office: wfhStats.officeVsWfh30d.office, WFH: wfhStats.officeVsWfh30d.wfh }]} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E9E4FB" />
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#6E6A85' }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 11, fill: '#6E6A85' }} axisLine={false} tickLine={false} />
                        <RechartsTooltip cursor={{ fill: '#EFE9FF' }} />
                        <Bar dataKey="Office" fill="#6E6A85" radius={[0, 4, 4, 0]} />
                        <Bar dataKey="WFH" fill="#7B5CFA" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
              );
            })()}

            {/* "Report" (basic) — monthly check-in/rejection summary, and
                "Shifts" (basic) — links to Branches, where shifts actually
                live. Then the progressive-disclosure "More Options" grid for
                everything else (corrections, late arrivals, QR, violations,
                Leave Management), hidden until explicitly expanded. */}
            {activeTab === 'attendance' && (
              <div className="space-y-6 mb-8">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="nexus-card rounded-2xl p-5">
                    <h3 className="text-xs font-bold text-[var(--color-nexus-ink)] uppercase tracking-wider mb-3">Monthly Report</h3>
                    {tenantAnalytics ? (
                      <div className="flex gap-6">
                        <div>
                          <span className="text-[9px] text-[var(--color-nexus-muted)] uppercase font-bold tracking-wider block">Check-ins</span>
                          <span className="text-xl font-black text-[var(--color-nexus-ink)] block mt-1">{tenantAnalytics.monthlyCheckIns ?? 0}</span>
                        </div>
                        <div>
                          <span className="text-[9px] text-[var(--color-nexus-muted)] uppercase font-bold tracking-wider block">Rejected</span>
                          <span className="text-xl font-black text-[var(--color-nexus-error)] block mt-1">{tenantAnalytics.monthlyRejections ?? 0}</span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-[var(--color-nexus-muted)]">No data yet this month.</p>
                    )}
                  </div>
                  <button type="button" onClick={() => navigate('/tenant/branches')} className="text-left nexus-card  rounded-2xl p-5">
                    <h3 className="text-xs font-bold text-[var(--color-nexus-ink)] uppercase tracking-wider mb-1">Shifts</h3>
                    <p className="text-[11px] text-[var(--color-nexus-muted)]">Named shifts (Morning, Night, etc.) are managed per-branch — open Branches to view or edit them.</p>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => { setShowOtherOptions(s => !s); if (showOtherOptions) setOtherOptionsTab(null); }}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] text-xs font-bold uppercase tracking-wider text-[var(--color-nexus-ink)] hover:bg-[var(--color-nexus-primary-fixed)] transition-colors"
                >
                  {showOtherOptions ? 'Hide Other Options' : 'Show Other Options'}
                  <span className={`transition-transform ${showOtherOptions ? 'rotate-180' : ''}`}>⌄</span>
                </button>

                {showOtherOptions && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { id: 'corrections', label: 'Corrections', icon: ClipboardCheck, count: corrections.filter(c => c.status === 'pending').length },
                      { id: 'late-arrivals', label: 'Late Arrivals & WFH', icon: Clock, count: pendingAttendance.length },
                      { id: 'wfh-locations', label: 'WFH Location Requests', icon: MapPin, count: wfhLocationRequests.length },
                      { id: 'wfh-ledger', label: 'WFH Ledger', icon: ClipboardCheck },
                      { id: 'qr-attendance', label: 'QR Attendance', icon: QrCode },
                      { id: 'qr-logs', label: 'QR Attendance Logs', icon: ScanLine },
                      { id: 'violations', label: 'Timing Violations', icon: AlertTriangle, count: attendanceAlerts.filter(a => a.status === 'pending').length },
                    ].map((opt) => {
                      const Icon = opt.icon;
                      const isActive = otherOptionsTab === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setOtherOptionsTab(isActive ? null : opt.id)}
                          className={`text-left nexus-card  rounded-2xl p-4 ${isActive ? '!bg-[var(--color-nexus-primary)] text-white' : ''}`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <Icon size={18} className={isActive ? 'text-white' : 'text-[var(--color-nexus-primary)]'} />
                            {!!opt.count && (
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isActive ? 'bg-white/25 text-white' : 'bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)]'}`}>{opt.count}</span>
                            )}
                          </div>
                          <span className="text-xs font-bold block">{opt.label}</span>
                        </button>
                      );
                    })}
                    <button type="button" onClick={() => navigate('/tenant/leave')} className="text-left nexus-card  rounded-2xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <CalendarDays size={18} className="text-[var(--color-nexus-primary)]" />
                      </div>
                      <span className="text-xs font-bold block">Leave Management</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Tab: Attendance Corrections (regularization requests) */}
            {activeTab === 'attendance' && otherOptionsTab === 'corrections' && (
              <div className="nexus-card rounded-3xl p-6 mb-8">
                <h2 className="text-lg font-bold text-gradient mb-2 font-sans">Attendance Corrections</h2>
                <p className="text-xs text-[var(--color-nexus-muted)] mb-6">Requests from staff to regularize a missed check-in/out or flag a wrong location. Approving here does not silently rewrite the original record — it's logged as its own reviewed decision.</p>
                {corrections.length === 0 ? (
                  <p className="text-sm text-[var(--color-nexus-muted)] text-center py-8">No correction requests yet.</p>
                ) : (
                  <div className="space-y-3">
                    {corrections.map((c) => (
                      <div key={c.id} className="flex items-center justify-between p-4 bg-[var(--color-nexus-surface-alt)] rounded-2xl border border-[var(--color-nexus-border)]">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-bold text-[var(--color-nexus-ink)]">{c.userName}</span>
                            <span className="text-[10px] text-[var(--color-nexus-muted)] uppercase font-bold">{c.userRole}</span>
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase bg-[var(--color-nexus-border)] text-[var(--color-nexus-ink)]">
                              {c.requestType.replace('_', ' ')}
                            </span>
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${c.status === 'pending' ? 'bg-[var(--color-nexus-secondary-container)] text-[var(--color-nexus-secondary)]' : c.status === 'approved' ? 'bg-[color:var(--color-nexus-success-text)]/10 text-[var(--color-nexus-success-text)]' : 'bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)]'}`}>
                              {c.status}
                            </span>
                          </div>
                          <p className="text-xs text-[var(--color-nexus-muted)]">
                            {c.requestedDate}{c.requestedTime ? ` at ${c.requestedTime}` : ''} — {c.reason}
                          </p>
                          <p className="text-[10px] text-[var(--color-nexus-muted)] mt-1">Submitted {new Date(c.createdAt).toLocaleString()}</p>
                        </div>
                        {c.status === 'pending' && (
                          <div className="flex gap-2 shrink-0 ml-4">
                            <button
                              onClick={() => handleResolveCorrection(c.id, 'approve')}
                              disabled={loading}
                              className="bg-[var(--color-nexus-success-text)] hover:brightness-110 text-white text-xs font-bold uppercase tracking-wider py-1.5 px-4 rounded-lg transition-colors disabled:opacity-50"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleResolveCorrection(c.id, 'reject')}
                              disabled={loading}
                              className="bg-[var(--color-nexus-error)] hover:brightness-110 text-white text-xs font-bold uppercase tracking-wider py-1.5 px-4 rounded-lg transition-colors disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Tab: Late Arrivals (check-ins pending manager approval) */}
            {activeTab === 'attendance' && otherOptionsTab === 'late-arrivals' && (
              <div className="nexus-card rounded-3xl p-6 mb-8">
                <h2 className="text-lg font-bold text-gradient mb-2 font-sans">Late Arrivals &amp; Work From Home</h2>
                <p className="text-xs text-[var(--color-nexus-muted)] mb-6">Late check-ins with an explanation, and WFH check-ins awaiting approval, both land here. Approving finalizes the check-in; rejecting marks the day absent.</p>
                {pendingAttendance.length === 0 ? (
                  <p className="text-sm text-[var(--color-nexus-muted)] text-center py-8">Nothing awaiting approval.</p>
                ) : (
                  <div className="space-y-3">
                    {pendingAttendance.map((l) => (
                      <div key={l.id} className="flex items-center justify-between p-4 bg-[var(--color-nexus-surface-alt)] rounded-2xl border border-[var(--color-nexus-border)]">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-bold text-[var(--color-nexus-ink)]">{l.userName}</span>
                            <span className="text-[10px] text-[var(--color-nexus-muted)] uppercase font-bold">{l.userRole}</span>
                            {l.attendanceMode === 'wfh' ? (
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)]">
                                🏠 WFH
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase bg-[var(--color-nexus-secondary-container)] text-[var(--color-nexus-secondary)]">
                                late arrival
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-[var(--color-nexus-muted)]">
                            {l.attendanceMode === 'wfh'
                              ? <>Checked in {new Date(l.createdAt).toLocaleString()} — {Math.round(l.distanceFromHomeMeters ?? 0)}m from home{l.wfhReason ? ` — "${l.wfhReason}"` : ''}</>
                              : <>Checked in {new Date(l.createdAt).toLocaleString()} — {l.explanation}</>}
                          </p>
                        </div>
                        <div className="flex gap-2 shrink-0 ml-4">
                          <button
                            onClick={() => handleResolveAttendance(l.id, 'approve')}
                            disabled={loading}
                            className="bg-[var(--color-nexus-success-text)] hover:brightness-110 text-white text-xs font-bold uppercase tracking-wider py-1.5 px-4 rounded-lg transition-colors disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleResolveAttendance(l.id, 'reject')}
                            disabled={loading}
                            className="bg-[var(--color-nexus-error)] hover:brightness-110 text-white text-xs font-bold uppercase tracking-wider py-1.5 px-4 rounded-lg transition-colors disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Tab: WFH Home-Location Change Requests */}
            {activeTab === 'attendance' && otherOptionsTab === 'wfh-locations' && (
              <div className="nexus-card rounded-3xl p-6 mb-8">
                <h2 className="text-lg font-bold text-gradient mb-2 font-sans">WFH Home Location Requests</h2>
                <p className="text-xs text-[var(--color-nexus-muted)] mb-6">Employees cannot change their registered Work From Home location themselves — approving one of these replaces it going forward.</p>
                {wfhLocationRequests.length === 0 ? (
                  <p className="text-sm text-[var(--color-nexus-muted)] text-center py-8">No home-location change requests awaiting review.</p>
                ) : (
                  <div className="space-y-3">
                    {wfhLocationRequests.map((r) => (
                      <div key={r.id} className="flex items-center justify-between p-4 bg-[var(--color-nexus-surface-alt)] rounded-2xl border border-[var(--color-nexus-border)]">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-bold text-[var(--color-nexus-ink)]">{r.userName}</span>
                            <span className="text-[10px] text-[var(--color-nexus-muted)] uppercase font-bold">{r.userRole}</span>
                          </div>
                          <p className="text-xs text-[var(--color-nexus-muted)]">
                            New location: {r.newAddress || `${r.newLatitude.toFixed(5)}, ${r.newLongitude.toFixed(5)}`}
                            {r.reason ? ` — "${r.reason}"` : ''}
                          </p>
                          <p className="text-[10px] text-[var(--color-nexus-muted)] mt-1">{new Date(r.createdAt).toLocaleString()}</p>
                        </div>
                        <div className="flex gap-2 shrink-0 ml-4">
                          <button
                            onClick={() => handleResolveWfhLocationRequest(r.id, 'approve')}
                            disabled={loading}
                            className="bg-[var(--color-nexus-success-text)] hover:brightness-110 text-white text-xs font-bold uppercase tracking-wider py-1.5 px-4 rounded-lg transition-colors disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleResolveWfhLocationRequest(r.id, 'reject')}
                            disabled={loading}
                            className="bg-[var(--color-nexus-error)] hover:brightness-110 text-white text-xs font-bold uppercase tracking-wider py-1.5 px-4 rounded-lg transition-colors disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Tab: WFH Ledger — per-employee/per-day record */}
            {activeTab === 'attendance' && otherOptionsTab === 'wfh-ledger' && (
              <div className="nexus-card rounded-3xl p-6 mb-8">
                <h2 className="text-lg font-bold text-gradient mb-2 font-sans">Work From Home Ledger</h2>
                <p className="text-xs text-[var(--color-nexus-muted)] mb-6">Every WFH check-in over the last 90 days — search by employee, sort or filter by role/date, and page through the records.</p>
                <DataTable
                  data={wfhLedger}
                  columns={wfhLedgerColumns}
                  searchPlaceholder="Search by employee name..."
                  globalFilterColumnIds={['userName']}
                  filterColumn={{ id: 'role', label: 'Roles', options: [...new Set(wfhLedger.map((l: any) => l.role))].sort() as string[] }}
                  initialPinning={{ left: ['userName'] }}
                  pageSize={12}
                  emptyMessage="No Work From Home check-ins recorded in the last 90 days."
                />
              </div>
            )}

            {/* Tab: Dynamic QR Attendance display */}
            {activeTab === 'attendance' && otherOptionsTab === 'qr-attendance' && (
              <QrAttendanceDisplay />
            )}

            {/* Tab: QR Attendance session history + scan logs */}
            {activeTab === 'attendance' && otherOptionsTab === 'qr-logs' && (
              <div className="space-y-6">
                <div className="nexus-card rounded-3xl p-6">
                  <h2 className="text-lg font-bold text-gradient mb-2 font-sans">QR Session History</h2>
                  <p className="text-xs text-[var(--color-nexus-muted)] mb-6">Every Start/Stop session, most recent first — search by who started it, sort any column, page through.</p>
                  <DataTable
                    data={qrSessionHistory}
                    columns={qrSessionColumns}
                    searchPlaceholder="Search by who started it..."
                    globalFilterColumnIds={['generatedByName']}
                    initialPinning={{ left: ['generatedByName'] }}
                    pageSize={10}
                    emptyMessage="No QR sessions yet."
                  />
                </div>

                <div className="nexus-card rounded-3xl p-6">
                  <h2 className="text-lg font-bold text-gradient mb-2 font-sans">QR Scan Attempts</h2>
                  <p className="text-xs text-[var(--color-nexus-muted)] mb-6">Every scan attempt — successful, failed, or expired — traceable by employee, device, and IP.</p>
                  <DataTable
                    data={qrScanLogs}
                    columns={qrScanColumns}
                    searchPlaceholder="Search by employee name..."
                    globalFilterColumnIds={['userName']}
                    filterColumn={{ id: 'status', label: 'Statuses', options: [...new Set(qrScanLogs.map((s: any) => s.status))].sort() as string[] }}
                    initialPinning={{ left: ['userName'] }}
                    pageSize={12}
                    emptyMessage="No scan attempts yet."
                  />
                </div>
              </div>
            )}

            {/* Tab: Timing Violations (break overstays, geofence exits) */}
            {activeTab === 'attendance' && otherOptionsTab === 'violations' && (
              <div className="nexus-card rounded-3xl p-6 mb-8">
                <h2 className="text-lg font-bold text-gradient mb-2 font-sans">Timing &amp; Break Violations</h2>
                <p className="text-xs text-[var(--color-nexus-muted)] mb-6">Raised automatically when someone exceeds the daily break budget or returns from break outside the office boundary. Only visible to people granted &quot;Receive Alerts&quot;; accepting/rejecting requires the matching privilege.</p>
                {attendanceAlerts.length === 0 ? (
                  <p className="text-sm text-[var(--color-nexus-muted)] text-center py-8">No violations recorded.</p>
                ) : (
                  <div className="space-y-3">
                    {attendanceAlerts.map((a) => (
                      <div key={a.id} className="flex items-center justify-between p-4 bg-[var(--color-nexus-surface-alt)] rounded-2xl border border-[var(--color-nexus-border)]">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-bold text-[var(--color-nexus-ink)]">{a.userName}</span>
                            <span className="text-[10px] text-[var(--color-nexus-muted)] uppercase font-bold">{a.userRole}</span>
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${a.status === 'pending' ? 'bg-[var(--color-nexus-secondary-container)] text-[var(--color-nexus-secondary)]' : a.status === 'accepted' ? 'bg-[color:var(--color-nexus-success-text)]/10 text-[var(--color-nexus-success-text)]' : 'bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)]'}`}>
                              {a.status}
                            </span>
                          </div>
                          <p className="text-xs text-[var(--color-nexus-muted)]">{a.message}</p>
                          <p className="text-[10px] text-[var(--color-nexus-muted)] mt-1">{new Date(a.createdAt).toLocaleString()}</p>
                        </div>
                        {a.status === 'pending' && (
                          <div className="flex gap-2 shrink-0 ml-4">
                            <button
                              onClick={() => handleResolveAlert(a.id, 'accept')}
                              disabled={loading}
                              className="bg-[var(--color-nexus-success-text)] hover:brightness-110 text-white text-xs font-bold uppercase tracking-wider py-1.5 px-4 rounded-lg transition-colors disabled:opacity-50"
                            >
                              Accept
                            </button>
                            <button
                              onClick={() => handleResolveAlert(a.id, 'reject')}
                              disabled={loading}
                              className="bg-[var(--color-nexus-error)] hover:brightness-110 text-white text-xs font-bold uppercase tracking-wider py-1.5 px-4 rounded-lg transition-colors disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Administration launcher — pick a section; nothing renders
                below until one is chosen (same progressive-disclosure
                pattern as the Attendance tab's "Other Options"). */}
            {activeTab === 'administration' && (
              <div className="space-y-6 mb-8">
                <div>
                  <h2 className="text-xl font-bold text-gradient font-sans">Administration</h2>
                  <p className="text-sm text-[var(--color-nexus-muted)] mt-1">Pick a section to manage.</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { id: 'settings', label: 'Workspace Boundaries', icon: ShieldCheck },
                    { id: 'branches', label: 'Branches', icon: Building2, navigateTo: '/tenant/branches' },
                    { id: 'roles', label: 'Roles & Permissions', icon: Users, navigateTo: '/tenant/roles' },
                    { id: 'devices', label: 'Device Approvals', icon: Smartphone, count: deviceRequests.filter((d: any) => d.status === 'pending').length },
                    { id: 'notifications', label: 'Notifications', icon: Bell, count: notifications.filter((n: any) => !n.isRead).length },
                    { id: 'ledger', label: 'Audit Ledger', icon: ScrollText },
                  ].map((opt) => {
                    const Icon = opt.icon;
                    const isActive = adminSubTab === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => opt.navigateTo ? navigate(opt.navigateTo) : setAdminSubTab(isActive ? null : opt.id)}
                        className={`text-left nexus-card  rounded-2xl p-4 ${isActive ? '!bg-[var(--color-nexus-primary)] text-white' : ''}`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <Icon size={18} className={isActive ? 'text-white' : 'text-[var(--color-nexus-primary)]'} />
                          {!!opt.count && (
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isActive ? 'bg-white/25 text-white' : 'bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)]'}`}>{opt.count}</span>
                          )}
                        </div>
                        <span className="text-xs font-bold block">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Tab: Settings */}
            {activeTab === 'administration' && adminSubTab === 'settings' && (
              <div className="nexus-card rounded-3xl p-8">
                <div className="mb-8">
                  <h2 className="text-xl font-bold text-gradient font-sans">Office Boundary Rules</h2>
                  <p className="text-sm text-[var(--color-nexus-muted)] mt-1">Configure Geofence coordinates and public network IP values.</p>
                </div>
                
                <form onSubmit={handleSaveConfig} className="space-y-6">
                  {/* Network Requirement */}
                  <div className="p-5 bg-[var(--color-nexus-surface-alt)] rounded-2xl border border-[var(--color-nexus-border)]">
                    <h3 className="text-sm font-semibold text-[var(--color-nexus-ink)] mb-2 flex items-center gap-2">
                      Corporate Network Locking
                    </h3>
                    <p className="text-[11px] text-[var(--color-nexus-muted)] mb-4 leading-relaxed">
                      Browsers cannot read a device's actual Wi-Fi network name (SSID) — that's blocked by every
                      browser for privacy reasons, and only possible from a native mobile app with special OS
                      permissions. So the real check here is <strong>public IP address matching</strong>: if your
                      office has a static public IP (typical for business internet), attendance is only accepted
                      when the employee's request comes from that IP — i.e. genuinely on the office network, not
                      just physically nearby on mobile data. This is checked independently of, and in addition to,
                      GPS geofencing below.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1.5 uppercase tracking-wider">Wi-Fi Network Name (Reference Only)</label>
                        <input 
                          type="text"
                          value={wifiSsid}
                          onChange={e => setWifiSsid(e.target.value)}
                          className="w-full px-4 py-3 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-nexus-primary)]/20 focus:border-[var(--color-nexus-primary)] transition-all"
                          placeholder="e.g. SmartTeams_Office"
                        />
                        <p className="text-[10px] text-[var(--color-nexus-muted)] mt-1">A label for your own reference — not technically enforced. The IP address to the right is what's actually checked.</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1.5 uppercase tracking-wider">Office Public IP Address (Enforced)</label>
                        <input 
                          type="text"
                          value={officeIp}
                          onChange={e => setOfficeIp(e.target.value)}
                          className="w-full px-4 py-3 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-nexus-primary)]/20 focus:border-[var(--color-nexus-primary)] transition-all font-mono"
                          placeholder="e.g. 122.161.44.89 (or 127.0.0.1 for local host)"
                        />
                        <p className="text-[10px] text-[var(--color-nexus-muted)] mt-1">Find this by searching "what is my IP" from a device connected to office Wi-Fi.</p>
                      </div>
                    </div>
                    <label className="flex items-center gap-2.5 mt-4 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={wifiCheckEnabled}
                        onChange={e => setWifiCheckEnabled(e.target.checked)}
                        className="w-4 h-4 rounded border-[var(--color-nexus-border)] text-[var(--color-nexus-ink)] focus:ring-[var(--color-nexus-primary)]/30"
                      />
                      <span className="text-xs font-semibold text-[var(--color-nexus-ink)]">Require corporate network for check-in/out</span>
                    </label>
                    <p className="text-[10px] text-[var(--color-nexus-muted)] mt-1 ml-6">When off, employees can clock in from any network — Wi-Fi is shown as its own step during check-in only if this is on.</p>
                  </div>

                  {/* Geofence Requirement */}
                  <div className="p-5 bg-[var(--color-nexus-surface-alt)] rounded-2xl border border-[var(--color-nexus-border)]">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-sm font-semibold text-[var(--color-nexus-ink)]">Geofence Coordinates</h3>
                      <button 
                        type="button" 
                        onClick={handleGetCurrentLocation}
                        className="text-xs bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] text-[var(--color-nexus-ink)] font-semibold px-3 py-1.5 rounded-lg hover:bg-[var(--color-nexus-primary-fixed)] transition-colors shadow-sm"
                      >
                        Fetch Coordinates
                      </button>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1.5 uppercase tracking-wider">Latitude</label>
                        <input 
                          type="number"
                          step="any"
                          value={lat}
                          onChange={e => setLat(e.target.value)}
                          className="w-full px-4 py-3 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-nexus-primary)]/20 focus:border-[var(--color-nexus-primary)] transition-all font-mono"
                          placeholder="13.0827"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1.5 uppercase tracking-wider">Longitude</label>
                        <input 
                          type="number"
                          step="any"
                          value={lng}
                          onChange={e => setLng(e.target.value)}
                          className="w-full px-4 py-3 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-nexus-primary)]/20 focus:border-[var(--color-nexus-primary)] transition-all font-mono"
                          placeholder="80.2707"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1.5 uppercase tracking-wider">Allowed Radius (Meters)</label>
                        <input
                          type="number"
                          value={radius}
                          onChange={e => setRadius(e.target.value)}
                          className="w-full px-4 py-3 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-nexus-primary)]/20 focus:border-[var(--color-nexus-primary)] transition-all"
                          placeholder="100"
                        />
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {[25, 50, 75, 100, 150, 200, 300, 500].map(m => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setRadius(String(m))}
                              className={`text-[11px] px-2.5 py-1 rounded-lg border font-semibold transition-colors ${radius === String(m) ? 'bg-[var(--color-nexus-primary)] text-white border-[var(--color-nexus-primary)]' : 'bg-[var(--color-nexus-surface)] text-[var(--color-nexus-muted)] border-[var(--color-nexus-border)] hover:bg-[var(--color-nexus-primary-fixed)]'}`}
                            >
                              {m}m
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Interactive OpenStreetMap picker — click to place, drag
                          the pin, or use current location. Reads/writes the SAME
                          lat/lng/radius state as the inputs above; the circle
                          previews the allowed radius. Lazy-loaded. */}
                      <div className="md:col-span-2">
                        <Suspense fallback={<div className="h-[300px] rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] flex items-center justify-center text-xs text-[var(--color-nexus-muted)]">Loading map…</div>}>
                          <LocationPicker
                            lat={lat ? parseFloat(lat) : null}
                            lng={lng ? parseFloat(lng) : null}
                            radius={radius ? parseInt(radius, 10) : null}
                            onChange={(la, ln) => { setLat(la.toFixed(7)); setLng(ln.toFixed(7)); }}
                          />
                        </Suspense>
                      </div>
                    </div>
                  </div>
                  
                  {/* Attendance Policy — actually consumed by the backend's
                      late-arrival, half-day, and break-budget calculations,
                      which previously had no way to be configured. */}
                  <div className="p-5 bg-[var(--color-nexus-surface-alt)] rounded-2xl border border-[var(--color-nexus-border)]">
                    <h3 className="text-sm font-semibold text-[var(--color-nexus-ink)] mb-4">Attendance &amp; Break Policy</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1.5 uppercase tracking-wider">Shift Start Time</label>
                        <input 
                          type="time"
                          value={shiftStart}
                          onChange={e => setShiftStart(e.target.value)}
                          className="w-full px-4 py-3 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-nexus-primary)]/20 focus:border-[var(--color-nexus-primary)] transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1.5 uppercase tracking-wider">Shift End Time</label>
                        <input 
                          type="time"
                          value={shiftEnd}
                          onChange={e => setShiftEnd(e.target.value)}
                          className="w-full px-4 py-3 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-nexus-primary)]/20 focus:border-[var(--color-nexus-primary)] transition-all"
                        />
                        <p className="text-[10px] text-[var(--color-nexus-muted)] mt-1">Expected clock-out time. Used for out-time and overtime calculations.</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1.5 uppercase tracking-wider">Grace Period (Minutes)</label>
                        <input 
                          type="number"
                          min="0"
                          value={gracePeriodMins}
                          onChange={e => setGracePeriodMins(e.target.value)}
                          className="w-full px-4 py-3 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-nexus-primary)]/20 focus:border-[var(--color-nexus-primary)] transition-all"
                          placeholder="15"
                        />
                        <p className="text-[10px] text-[var(--color-nexus-muted)] mt-1">Arrivals after Shift Start + Grace are marked Late.</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1.5 uppercase tracking-wider">Half-Day Threshold (Minutes Worked)</label>
                        <input 
                          type="number"
                          min="0"
                          value={halfDayMins}
                          onChange={e => setHalfDayMins(e.target.value)}
                          className="w-full px-4 py-3 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-nexus-primary)]/20 focus:border-[var(--color-nexus-primary)] transition-all"
                          placeholder="240"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1.5 uppercase tracking-wider">Daily Break Budget (Minutes)</label>
                        <input 
                          type="number"
                          min="0"
                          value={dailyBreakBudgetMins}
                          onChange={e => setDailyBreakBudgetMins(e.target.value)}
                          className="w-full px-4 py-3 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-nexus-primary)]/20 focus:border-[var(--color-nexus-primary)] transition-all"
                          placeholder="60"
                        />
                        <p className="text-[10px] text-[var(--color-nexus-muted)] mt-1">Breaks exceeding this budget escalate to you automatically.</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1.5 uppercase tracking-wider">Minimum Attendance %</label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={minAttendancePercent}
                          onChange={e => setMinAttendancePercent(e.target.value)}
                          className="w-full px-4 py-3 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-nexus-primary)]/20 focus:border-[var(--color-nexus-primary)] transition-all"
                          placeholder="75"
                        />
                        <p className="text-[10px] text-[var(--color-nexus-muted)] mt-1">Below this monthly percentage, alert emails go to the employee and their reporting hierarchy.</p>
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1.5 uppercase tracking-wider">Weekend Days</label>
                        <div className="flex flex-wrap gap-3">
                          {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(day => (
                            <label key={day} className="flex items-center gap-1.5 cursor-pointer text-xs text-[var(--color-nexus-ink)] bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-lg px-3 py-1.5">
                              <input
                                type="checkbox"
                                checked={weekendConfig.includes(day)}
                                onChange={() => toggleWeekendDay(day)}
                                className="accent-[var(--color-nexus-primary)]"
                              />
                              {day}
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Work From Home (WFH) Policy — additive attendance mode,
                      disabled by default so existing tenants see no change
                      until this is explicitly turned on. */}
                  <div className="p-5 bg-[var(--color-nexus-surface-alt)] rounded-2xl border border-[var(--color-nexus-border)]">
                    <label className="flex items-center gap-2.5 cursor-pointer select-none mb-4">
                      <input
                        type="checkbox"
                        checked={wfhEnabled}
                        onChange={e => setWfhEnabled(e.target.checked)}
                        className="w-4 h-4 rounded border-[var(--color-nexus-border)] text-[var(--color-nexus-ink)] focus:ring-[var(--color-nexus-primary)]/30"
                      />
                      <span className="text-sm font-semibold text-[var(--color-nexus-ink)]">Enable Work From Home</span>
                    </label>

                    {wfhEnabled && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                          <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1.5 uppercase tracking-wider">Allowed Roles</label>
                          <div className="flex flex-wrap gap-3">
                            {allRoleNames.map(role => (
                              <label key={role} className="flex items-center gap-1.5 cursor-pointer text-xs text-[var(--color-nexus-ink)] bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-lg px-3 py-1.5">
                                <input type="checkbox" checked={wfhAllowedRoles.includes(role)} onChange={() => toggleWfhRole(role)} className="accent-[var(--color-nexus-primary)]" />
                                {role}
                              </label>
                            ))}
                          </div>
                          <p className="text-[10px] text-[var(--color-nexus-muted)] mt-1">Leave all unchecked to allow every clock-in-capable role (any custom roles you've created too).</p>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1.5 uppercase tracking-wider">Max WFH Days / Month</label>
                          <input
                            type="number" min="0" value={wfhMaxDaysPerMonth} onChange={e => setWfhMaxDaysPerMonth(e.target.value)}
                            className="w-full px-4 py-3 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-nexus-primary)]/20 focus:border-[var(--color-nexus-primary)] transition-all"
                            placeholder="Leave blank for unlimited"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1.5 uppercase tracking-wider">Allowed Radius From Home (Meters)</label>
                          <input
                            type="number" min="0" value={wfhRadiusMeters} onChange={e => setWfhRadiusMeters(e.target.value)}
                            className="w-full px-4 py-3 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-nexus-primary)]/20 focus:border-[var(--color-nexus-primary)] transition-all"
                            placeholder="200"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1.5 uppercase tracking-wider">WFH Late-Login Grace (Minutes)</label>
                          <input
                            type="number" min="0" value={wfhLateLoginGraceMins} onChange={e => setWfhLateLoginGraceMins(e.target.value)}
                            className="w-full px-4 py-3 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-nexus-primary)]/20 focus:border-[var(--color-nexus-primary)] transition-all"
                            placeholder={`Leave blank to reuse office grace (${gracePeriodMins}m)`}
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1.5 uppercase tracking-wider">Allowed Weekdays</label>
                          <div className="flex flex-wrap gap-3">
                            {WEEKDAY_OPTIONS.map(day => (
                              <label key={day} className="flex items-center gap-1.5 cursor-pointer text-xs text-[var(--color-nexus-ink)] bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-lg px-3 py-1.5">
                                <input type="checkbox" checked={wfhAllowedWeekdays.includes(day)} onChange={() => toggleWfhWeekday(day)} className="accent-[var(--color-nexus-primary)]" />
                                {day}
                              </label>
                            ))}
                          </div>
                        </div>
                        <label className="flex items-center gap-2.5 cursor-pointer select-none">
                          <input type="checkbox" checked={wfhApprovalRequired} onChange={e => setWfhApprovalRequired(e.target.checked)} className="w-4 h-4 rounded border-[var(--color-nexus-border)] text-[var(--color-nexus-ink)] focus:ring-[var(--color-nexus-primary)]/30" />
                          <span className="text-xs font-semibold text-[var(--color-nexus-ink)]">Require manager approval for every WFH check-in</span>
                        </label>
                        <label className="flex items-center gap-2.5 cursor-pointer select-none">
                          <input type="checkbox" checked={wfhRequireReason} onChange={e => setWfhRequireReason(e.target.checked)} className="w-4 h-4 rounded border-[var(--color-nexus-border)] text-[var(--color-nexus-ink)] focus:ring-[var(--color-nexus-primary)]/30" />
                          <span className="text-xs font-semibold text-[var(--color-nexus-ink)]">Require a reason for each WFH day</span>
                        </label>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={loading}
                      className="bg-[var(--color-nexus-primary)] text-white rounded-xl px-8 py-3.5 font-bold text-xs uppercase tracking-wider hover:bg-[var(--color-nexus-primary-hover)] transition-colors disabled:opacity-50 shadow-sm"
                    >
                      {loading ? 'Saving...' : 'Save Policies'}
                    </button>
                  </div>
                </form>

                {/* Dynamic QR Attendance Policy — its own form/endpoint
                    (PUT /api/qr/config), separate from the office/WFH
                    policy form above. Disabled by default so existing
                    tenants see no change until this is explicitly turned on. */}
                <form onSubmit={handleSaveQrConfig} className="mt-8 p-5 bg-[var(--color-nexus-surface-alt)] rounded-2xl border border-[var(--color-nexus-border)]">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none mb-4">
                    <input
                      type="checkbox"
                      checked={qrEnabled}
                      onChange={e => setQrEnabled(e.target.checked)}
                      className="w-4 h-4 rounded border-[var(--color-nexus-border)] text-[var(--color-nexus-ink)] focus:ring-[var(--color-nexus-primary)]/30"
                    />
                    <span className="text-sm font-semibold text-[var(--color-nexus-ink)]">Enable Dynamic QR Attendance</span>
                  </label>
                  <p className="text-[11px] text-[var(--color-nexus-muted)] mb-4 -mt-2">A privileged employee (see "QR Attendance" permissions above) displays a rotating QR code; any employee scans it with their own device and goes through whichever checks below are enabled to mark attendance.</p>

                  {qrEnabled && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1.5 uppercase tracking-wider">QR Rotation Interval</label>
                        <select
                          value={qrRotationSeconds}
                          onChange={e => setQrRotationSeconds(parseInt(e.target.value, 10))}
                          className="w-full px-4 py-3 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-nexus-primary)]/20 focus:border-[var(--color-nexus-primary)] transition-all"
                        >
                          {QR_ROTATION_CHOICES.map(s => <option key={s} value={s}>{s} seconds</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1.5 uppercase tracking-wider">QR Geofence Radius (Meters)</label>
                        <input
                          type="number" min="0" value={qrGeofenceRadiusMeters} onChange={e => setQrGeofenceRadiusMeters(e.target.value)}
                          className="w-full px-4 py-3 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-nexus-primary)]/20 focus:border-[var(--color-nexus-primary)] transition-all"
                          placeholder="Leave blank to reuse the office geofence radius"
                        />
                      </div>
                      <div className="md:col-span-2 flex flex-wrap gap-4">
                        <label className="flex items-center gap-2 cursor-pointer text-xs text-[var(--color-nexus-ink)] bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-lg px-3 py-1.5">
                          <input type="checkbox" checked={qrRequireGps} onChange={e => setQrRequireGps(e.target.checked)} className="accent-[var(--color-nexus-primary)]" />
                          Require GPS
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer text-xs text-[var(--color-nexus-ink)] bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-lg px-3 py-1.5">
                          <input type="checkbox" checked={qrRequireFace} onChange={e => setQrRequireFace(e.target.checked)} className="accent-[var(--color-nexus-primary)]" />
                          Require Face Verification
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer text-xs text-[var(--color-nexus-ink)] bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-lg px-3 py-1.5">
                          <input type="checkbox" checked={qrRequireWifi} onChange={e => setQrRequireWifi(e.target.checked)} className="accent-[var(--color-nexus-primary)]" />
                          Require Corporate Wi-Fi
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer text-xs text-[var(--color-nexus-ink)] bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-lg px-3 py-1.5">
                          <input type="checkbox" checked={qrRequireDeviceTrust} onChange={e => setQrRequireDeviceTrust(e.target.checked)} className="accent-[var(--color-nexus-primary)]" />
                          Require Registered Device
                        </label>
                      </div>
                      <p className="text-[10px] text-[var(--color-nexus-muted)] md:col-span-2 -mt-2">Corporate Wi-Fi and Registered Device reuse the exact same checks as office check-in above — same corporate IP / device-pinning, not a separate system.</p>
                    </div>
                  )}

                  <div className="flex justify-end mt-4">
                    <button
                      type="submit"
                      disabled={qrConfigSaving}
                      className="bg-[var(--color-nexus-primary)] text-white rounded-xl px-8 py-3.5 font-bold text-xs uppercase tracking-wider hover:bg-[var(--color-nexus-primary-hover)] transition-colors disabled:opacity-50 shadow-sm"
                    >
                      {qrConfigSaving ? 'Saving...' : 'Save QR Policy'}
                    </button>
                  </div>
                </form>

                {/* Holiday Calendar — its own section since it's a list, not a single form submit */}
                <div className="mt-8 p-5 bg-[var(--color-nexus-surface-alt)] rounded-2xl border border-[var(--color-nexus-border)]">
                  <h3 className="text-sm font-semibold text-[var(--color-nexus-ink)] mb-1">Holiday Calendar</h3>
                  <p className="text-[11px] text-[var(--color-nexus-muted)] mb-4">Days marked here show as "Holiday" instead of "Absent" in attendance status, for everyone in the organization.</p>
                  <form onSubmit={handleAddHoliday} className="flex flex-col sm:flex-row gap-3 mb-4">
                    <input
                      type="date"
                      value={newHolidayDate}
                      onChange={e => setNewHolidayDate(e.target.value)}
                      className="px-4 py-2.5 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-nexus-primary)]/20 focus:border-[var(--color-nexus-primary)]"
                      required
                    />
                    <input
                      type="text"
                      value={newHolidayName}
                      onChange={e => setNewHolidayName(e.target.value)}
                      placeholder="e.g. Independence Day"
                      className="flex-1 px-4 py-2.5 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-nexus-primary)]/20 focus:border-[var(--color-nexus-primary)]"
                      required
                    />
                    <button
                      type="submit"
                      disabled={loading}
                      className="bg-[var(--color-nexus-primary)] text-white rounded-xl px-6 py-2.5 font-bold text-xs uppercase tracking-wider hover:bg-[var(--color-nexus-primary-hover)] transition-colors disabled:opacity-50 shrink-0"
                    >
                      Add
                    </button>
                  </form>
                  {holidaysList.length === 0 ? (
                    <p className="text-xs text-[var(--color-nexus-muted)] text-center py-4">No holidays configured yet.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {holidaysList.map((h) => (
                        <div key={h.id} className="flex items-center justify-between px-4 py-2 bg-[var(--color-nexus-surface)] rounded-lg border border-[var(--color-nexus-border)]">
                          <span className="text-xs text-[var(--color-nexus-ink)]"><span className="font-mono font-bold">{h.date}</span> — {h.name}</span>
                          <button
                            onClick={() => handleDeleteHoliday(h.id)}
                            disabled={loading}
                            className="text-[10px] font-bold uppercase text-[var(--color-nexus-error)] hover:text-[var(--color-nexus-error)] disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Tab: Recruitment */}
            {activeTab === 'recruitment' && (
              <div className="space-y-8">
                {/* One-time "you just created a role" prompt — dismissible;
                    it's a convenience nudge, not the only place this ever
                    surfaces (see the persistent list right below it). */}
                {newRolePrompt && (
                  <div className="rounded-2xl border border-[var(--color-nexus-primary)]/30 bg-[var(--color-nexus-primary-fixed)] p-5 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-bold text-[var(--color-nexus-ink)]">You just created a new role "{newRolePrompt}" — set up its permissions and salary.</p>
                      <p className="text-xs text-[var(--color-nexus-muted)] mt-1">It's already usable with whatever was granted at this hire — this just makes it official and repeatable for the next person in this role. You can do this now or later.</p>
                      <div className="flex flex-wrap gap-3 mt-3">
                        <button type="button" onClick={() => navigate(`/tenant/roles?role=${encodeURIComponent(newRolePrompt)}`)} className="text-xs font-bold uppercase tracking-wider text-[var(--color-nexus-primary)] hover:underline">
                          Set Permissions →
                        </button>
                        <button type="button" onClick={() => navigate(`/tenant/payroll?section=roles&role=${encodeURIComponent(newRolePrompt)}`)} className="text-xs font-bold uppercase tracking-wider text-[var(--color-nexus-primary)] hover:underline">
                          Set Salary →
                        </button>
                      </div>
                    </div>
                    <button type="button" onClick={() => setNewRolePrompt(null)} className="text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)] p-1 shrink-0">
                      <X size={16} />
                    </button>
                  </div>
                )}

                {/* Persistent — recomputed fresh from real data every time
                    this loads, so it's still here next session even if the
                    one-time prompt above was dismissed or never seen. */}
                {rolesNeedingPayrollSetup.length > 0 && (
                  <div className="rounded-2xl border border-[var(--color-nexus-secondary)]/30 bg-[var(--color-nexus-secondary-container)] p-5">
                    <p className="text-sm font-bold text-[var(--color-nexus-ink)]">Roles without a standard salary package yet</p>
                    <p className="text-xs text-[var(--color-nexus-muted)] mt-1 mb-3">Anyone in these roles is only paid whatever was set individually at hire — set a role default so every future hire into it inherits the same package automatically.</p>
                    <div className="flex flex-wrap gap-2">
                      {rolesNeedingPayrollSetup.map((roleName) => (
                        <button
                          key={roleName}
                          type="button"
                          onClick={() => navigate(`/tenant/payroll?section=roles&role=${encodeURIComponent(roleName)}`)}
                          className="rounded-full bg-white border border-[var(--color-nexus-secondary)]/40 px-3.5 py-1.5 text-xs font-bold text-[var(--color-nexus-ink)] hover:bg-[var(--color-nexus-secondary-container)] transition-colors"
                        >
                          {roleName} →
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recruit User Form */}
                <div className="nexus-card rounded-3xl p-6">
                  <h2 className="text-base font-bold text-[var(--color-nexus-ink)] mb-4 font-sans">Recruit Team Member</h2>
                  <form onSubmit={handleHireUser} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1.5 uppercase tracking-wider">Full Name</label>
                        <input 
                          type="text"
                          value={newUserName}
                          onChange={e => setNewUserName(e.target.value)}
                          className="w-full px-4 py-3 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-sm focus:outline-none"
                          placeholder="John Doe"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1.5 uppercase tracking-wider">Email Address</label>
                        <input 
                          type="email"
                          value={newUserEmail}
                          onChange={e => setNewUserEmail(e.target.value)}
                          className="w-full px-4 py-3 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-sm focus:outline-none"
                          placeholder="john@company.com"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1.5 uppercase tracking-wider">Organization Role</label>
                        <input
                          type="text"
                          list="role-suggestions"
                          value={newUserRole}
                          onChange={e => setNewUserRole(e.target.value)}
                          className="w-full px-4 py-3 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-sm focus:outline-none text-[var(--color-nexus-ink)] font-medium"
                          placeholder="e.g. Employee, Manager, HR, GM, Intern..."
                          required
                        />
                        <datalist id="role-suggestions">
                          <option value="Employee" />
                          <option value="Intern" />
                          <option value="Team Lead" />
                          <option value="L1 Manager" />
                          <option value="L2 Manager" />
                          <option value="Manager" />
                          <option value="Senior Manager" />
                          <option value="Assistant Manager" />
                          <option value="Supervisor" />
                          <option value="Coordinator" />
                          <option value="HR" />
                          <option value="HR Manager" />
                          <option value="GM" />
                          <option value="Receptionist" />
                          <option value="Security" />
                          <option value="HM" />
                        </datalist>
                        <p className="text-[10px] text-[var(--color-nexus-muted)] mt-1">Any role name is accepted — it doesn't need to match the suggestions above.</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1.5 uppercase tracking-wider">Branch</label>
                        {hireBranches.length === 0 ? (
                          <p className="text-xs text-[var(--color-nexus-muted)] px-4 py-3 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl">
                            No branches yet — <button type="button" onClick={() => navigate('/tenant/branches')} className="text-[var(--color-nexus-primary)] font-bold hover:underline">create one first</button>.
                          </p>
                        ) : (
                          <select
                            value={newUserBranchId}
                            onChange={(e) => setNewUserBranchId(e.target.value)}
                            className="w-full px-4 py-3 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-sm focus:outline-none"
                            required
                          >
                            {hireBranches.map((b: any) => (
                              <option key={b.id} value={b.id}>{b.name}</option>
                            ))}
                          </select>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1.5 uppercase tracking-wider">Shift</label>
                        {hireShifts.length === 0 ? (
                          <p className="text-xs text-[var(--color-nexus-muted)] px-4 py-3 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl">
                            {newUserBranchId ? 'This branch has no shifts yet — add one in Branches.' : 'Pick a branch first.'}
                          </p>
                        ) : (
                          <select
                            value={newUserShiftId}
                            onChange={(e) => setNewUserShiftId(e.target.value)}
                            className="w-full px-4 py-3 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-sm focus:outline-none"
                            required
                          >
                            {hireShifts.map((s: any) => (
                              <option key={s.id} value={s.id}>{s.name} ({s.checkInTime}–{s.checkOutTime})</option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>

                    <div className="p-4 bg-[var(--color-nexus-surface-alt)] rounded-xl border border-[var(--color-nexus-border)]">
                      <span className="block text-xs font-bold text-[var(--color-nexus-muted)] uppercase tracking-wider mb-1">Additional RBAC Privileges</span>
                      <p className="text-[10px] text-[var(--color-nexus-muted)] mb-3">On top of whatever this role gets by default. Every role — including custom ones — can always clock in, take breaks, and complete KYC regardless of these toggles. You can only grant a privilege you hold yourself — power can only pass downward, never up. Organization policies (shift times, geofence, break budget, network rules) can never be delegated; only the tenant admin account can change those.</p>
                      <div className="flex flex-wrap gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={newUserPrivileges.includes('employee.create') && newUserPrivileges.includes('employee.read')} 
                            onChange={() => { togglePrivilege('employee.create'); togglePrivilege('employee.read'); }}
                            className="accent-[var(--color-nexus-primary)]"
                          />
                          <span className="text-xs text-[var(--color-nexus-ink)]">Manage Employees (hire, view roster)</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={newUserPrivileges.includes('settings.edit')} 
                            onChange={() => togglePrivilege('settings.edit')}
                            className="accent-[var(--color-nexus-primary)]"
                          />
                          <span className="text-xs text-[var(--color-nexus-ink)]">Approve Device Change Requests</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={newUserPrivileges.includes('reports.view')} 
                            onChange={() => togglePrivilege('reports.view')}
                            className="accent-[var(--color-nexus-primary)]"
                          />
                          <span className="text-xs text-[var(--color-nexus-ink)]">View Reports &amp; Audit Ledger</span>
                        </label>
                      </div>
                      <div className="flex flex-wrap gap-4 mt-3 pt-3 border-t border-[var(--color-nexus-border)]">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={newUserPrivileges.includes('alerts.receive')} 
                            onChange={() => togglePrivilege('alerts.receive')}
                            className="accent-[var(--color-nexus-primary)]"
                          />
                          <span className="text-xs text-[var(--color-nexus-ink)]">Receive Timing/Break Violation Alerts</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={newUserPrivileges.includes('alerts.accept')} 
                            onChange={() => togglePrivilege('alerts.accept')}
                            className="accent-[var(--color-nexus-primary)]"
                          />
                          <span className="text-xs text-[var(--color-nexus-ink)]">Accept Alerts</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newUserPrivileges.includes('alerts.reject')}
                            onChange={() => togglePrivilege('alerts.reject')}
                            className="accent-[var(--color-nexus-primary)]"
                          />
                          <span className="text-xs text-[var(--color-nexus-ink)]">Reject Alerts</span>
                        </label>
                      </div>
                      {/* Dynamic QR Attendance — permissions alone decide who can
                          generate/display/close a QR session; no role name is
                          ever hardcoded here, matching every other toggle above. */}
                      <div className="flex flex-wrap gap-4 mt-3 pt-3 border-t border-[var(--color-nexus-border)]">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newUserPrivileges.includes('attendance.qr.generate')}
                            onChange={() => togglePrivilege('attendance.qr.generate')}
                            className="accent-[var(--color-nexus-primary)]"
                          />
                          <span className="text-xs text-[var(--color-nexus-ink)]">Generate QR Attendance Sessions</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newUserPrivileges.includes('attendance.qr.display')}
                            onChange={() => togglePrivilege('attendance.qr.display')}
                            className="accent-[var(--color-nexus-primary)]"
                          />
                          <span className="text-xs text-[var(--color-nexus-ink)]">Display QR Attendance Screen</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newUserPrivileges.includes('attendance.qr.close')}
                            onChange={() => togglePrivilege('attendance.qr.close')}
                            className="accent-[var(--color-nexus-primary)]"
                          />
                          <span className="text-xs text-[var(--color-nexus-ink)]">Close QR Attendance Sessions</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newUserPrivileges.includes('attendance.qr.override')}
                            onChange={() => togglePrivilege('attendance.qr.override')}
                            className="accent-[var(--color-nexus-primary)]"
                          />
                          <span className="text-xs text-[var(--color-nexus-ink)]">Override Failed QR Scans</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newUserPrivileges.includes('attendance.qr.view_logs')}
                            onChange={() => togglePrivilege('attendance.qr.view_logs')}
                            className="accent-[var(--color-nexus-primary)]"
                          />
                          <span className="text-xs text-[var(--color-nexus-ink)]">View QR Attendance Logs</span>
                        </label>
                      </div>
                      <p className="text-[10px] text-[var(--color-nexus-muted)] mt-2">Scanning a code to mark one's own attendance needs no special toggle — every clock-in-capable role can already do that, the same as the existing camera check-in.</p>
                    </div>

                    <button 
                      type="submit"
                      disabled={loading}
                      className="bg-[var(--color-nexus-primary)] text-white rounded-xl py-3 px-6 font-bold text-xs uppercase tracking-wider hover:bg-[var(--color-nexus-primary-hover)] transition-colors disabled:opacity-50"
                    >
                      {loading ? 'Adding...' : 'Register User'}
                    </button>
                  </form>
                </div>

                {/* Team Members List */}
                <div className="nexus-card rounded-3xl p-6">
                  <h2 className="text-base font-bold text-[var(--color-nexus-ink)] mb-4 font-sans">Organization Directory</h2>
                  <DataTable
                    data={recruitedUsers}
                    columns={directoryColumns}
                    searchPlaceholder="Search by name or email..."
                    globalFilterColumnIds={['name', 'email']}
                    filterColumn={{ id: 'role', label: 'Roles', options: directoryRoleOptions }}
                    initialPinning={{ left: ['name'] }}
                    pageSize={10}
                    emptyMessage="No employees registered yet."
                  />
                </div>
              </div>
            )}

            {/* Tab: Device approvals */}
            {activeTab === 'administration' && adminSubTab === 'devices' && (
              <div className="nexus-card rounded-3xl p-6">
                <h2 className="text-lg font-bold text-gradient mb-6 font-sans">Pending Device Migrations</h2>
                {deviceRequests.length === 0 ? (
                  <p className="text-sm text-[var(--color-nexus-muted)] text-center py-12">No pending device approvals found.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] text-[10px] text-[var(--color-nexus-muted)] font-bold uppercase tracking-wider">
                          <th className="py-3 px-4">Employee</th>
                          <th className="py-3 px-4">Email</th>
                          <th className="py-3 px-4">New Device ID</th>
                          <th className="py-3 px-4">Requested Date</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deviceRequests.map((req) => (
                          <tr key={req.id} className="border-b border-[var(--color-nexus-border)] text-xs hover:bg-[var(--color-nexus-primary-fixed)]/50 transition-colors">
                            <td className="py-4 px-4 font-semibold text-[var(--color-nexus-ink)]">{req.userName}</td>
                            <td className="py-4 px-4 text-[var(--color-nexus-muted)] font-mono">{req.userEmail}</td>
                            <td className="py-4 px-4 font-mono text-[10px]">{req.newDeviceId.substring(0, 20)}...</td>
                            <td className="py-4 px-4 text-[var(--color-nexus-muted)]">{new Date(req.createdAt).toLocaleDateString()}</td>
                            <td className="py-4 px-4 text-right flex justify-end gap-2">
                              <button 
                                onClick={() => handleDeviceAction(req.id, 'reject')}
                                className="bg-[var(--color-nexus-error-soft)] hover:brightness-95 text-[var(--color-nexus-error)] font-bold text-xs uppercase tracking-wider py-1 px-3 rounded-lg transition-all"
                              >
                                Deny
                              </button>
                              <button 
                                onClick={() => handleDeviceAction(req.id, 'approve')}
                                className="bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white font-bold text-xs uppercase tracking-wider py-1 px-3 rounded-lg transition-colors"
                              >
                                Approve
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Unified Notifications Tab — super_admin reaches it directly via
            its own 'notifications' nav item; everyone else reaches it as an
            Administration sub-section. */}
        {((user.role === 'super_admin' && activeTab === 'notifications') || (activeTab === 'administration' && adminSubTab === 'notifications')) && (
          <div className="nexus-card rounded-3xl p-6">
            <h2 className="text-lg font-bold text-gradient mb-6 font-sans">System Notifications</h2>
            {notifications.length === 0 ? (
              <p className="text-sm text-[var(--color-nexus-muted)] text-center py-12">No notifications found.</p>
            ) : (
              <div className="space-y-4">
                {notifications.map((notif) => (
                  <div key={notif.id} className="p-4 bg-[var(--color-nexus-surface-alt)] rounded-2xl border border-[var(--color-nexus-border)] flex justify-between items-start gap-4">
                    <div>
                      <h4 className="text-xs font-bold text-[var(--color-nexus-ink)] uppercase tracking-wider">{notif.title}</h4>
                      <p className="text-xs text-[var(--color-nexus-muted)] mt-1">{notif.message}</p>
                      <span className="text-[10px] text-[var(--color-nexus-muted)] mt-2 block">{new Date(notif.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Immutable Audit Ledger Tab */}
        {activeTab === 'administration' && adminSubTab === 'ledger' && (
          <div className="space-y-6">
            <div className="nexus-card rounded-3xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-gradient font-sans">Immutable Cryptographic Audit Ledger</h2>
                  <span className="px-2 py-0.5 bg-[color:var(--color-nexus-success-text)]/10 text-[var(--color-nexus-success-text)] text-[10px] uppercase font-bold rounded-md border border-[color:var(--color-nexus-success-text)]/20 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M2.166 11.37h7.478l2.5-8.333a1 1 0 011.902.008L15.344 7.62h2.49a1 1 0 110 2H14.656a1 1 0 01-.95-.678L12.5 5.03l-2.5 8.333a1 1 0 01-1.902-.008L6.804 9.38H2.166a1 1 0 110-2z" clipRule="evenodd" /></svg>
                    SHA-256 Chained
                  </span>
                </div>
                <p className="text-xs text-[var(--color-nexus-muted)] mt-1">Verify that database logs have not been tampered with or modified since creation.</p>
              </div>
              <div className="flex gap-2 self-start md:self-auto">
                <button
                  onClick={handleExportLedgerCsv}
                  className="bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] text-[var(--color-nexus-ink)] font-bold text-xs uppercase tracking-wider py-3 px-5 rounded-xl hover:bg-[var(--color-nexus-primary-fixed)] transition-colors flex items-center gap-2"
                >
                  <Download size={14} />
                  Export CSV
                </button>
                <button
                  onClick={verifyLedgerIntegrity}
                  disabled={ledgerVerifying}
                  className="bg-[var(--color-nexus-primary)] text-white font-bold text-xs uppercase tracking-wider py-3 px-6 rounded-xl hover:bg-[var(--color-nexus-primary-hover)] transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {ledgerVerifying ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                      Scanning Chain...
                    </>
                  ) : 'Verify Chain Integrity'}
                </button>
              </div>
            </div>

            {ledgerVerificationResult && (
              <div className={`p-5 rounded-3xl border flex items-start gap-4 ${ledgerVerificationResult.isValid ? 'bg-[color:var(--color-nexus-success-text)]/10 border-[color:var(--color-nexus-success-text)]/20 text-[var(--color-nexus-success-text)]' : 'bg-[var(--color-nexus-error-soft)] border-[var(--color-nexus-error)]/20 text-[var(--color-nexus-error)]'}`}>
                <div className={`p-2 rounded-2xl ${ledgerVerificationResult.isValid ? 'bg-[color:var(--color-nexus-success-text)]/10' : 'bg-[var(--color-nexus-error-soft)]'}`}>
                  {ledgerVerificationResult.isValid ? (
                    <svg className="w-6 h-6 text-[var(--color-nexus-success-text)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                  ) : (
                    <svg className="w-6 h-6 text-[var(--color-nexus-error)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                  )}
                </div>
                <div>
                  <h4 className="font-bold text-sm">{ledgerVerificationResult.isValid ? 'Ledger Verification Succeeded' : 'Ledger Verification Failed!'}</h4>
                  <p className="text-xs opacity-90 mt-0.5">
                    {ledgerVerificationResult.isValid 
                      ? `Cryptographic chain matches root block. Scanned ${ledgerVerificationResult.verifiedBlocksCount} operational entries. Zero tempering detected.` 
                      : `Alert! Tampering detected. Signature mismatch at log blocks: [${ledgerVerificationResult.invalidBlocks.join(', ')}].`
                    }
                  </p>
                </div>
              </div>
            )}

            <div className="nexus-card rounded-3xl p-6">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] text-[10px] text-[var(--color-nexus-muted)] font-bold uppercase tracking-wider">
                      <th className="py-3 px-4">Timestamp</th>
                      <th className="py-3 px-4">Actor</th>
                      <th className="py-3 px-4">Security Action</th>
                      <th className="py-3 px-4">Context</th>
                      <th className="py-3 px-4 font-mono">Block Hash</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((log) => {
                      const isFraud = log.action.startsWith('FRAUD') || log.action.includes('VIOLATION');
                      return (
                        <tr key={log.id} className="border-b border-[var(--color-nexus-border)] text-xs hover:bg-[var(--color-nexus-primary-fixed)]/50 transition-colors">
                          <td className="py-4 px-4 text-[var(--color-nexus-muted)] whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</td>
                          <td className="py-4 px-4">
                            <span className="font-semibold text-[var(--color-nexus-ink)] block">{log.actorName}</span>
                            <span className="text-[10px] text-[var(--color-nexus-muted)] font-mono">ID: #{log.actorId || 'SYS'}</span>
                          </td>
                          <td className="py-4 px-4">
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                              isFraud ? 'bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)]' :
                              log.action.startsWith('WFH_') ? 'bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)]' :
                              log.action === 'CHECK_IN' ? 'bg-[color:var(--color-nexus-success-text)]/10 text-[var(--color-nexus-success-text)]' :
                              log.action === 'CHECK_OUT' ? 'bg-[var(--color-nexus-secondary-container)] text-[var(--color-nexus-secondary)]' :
                              'bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-ink)]'
                            }`}>
                              {log.action}
                            </span>
                          </td>
                          <td className="py-4 px-4">
                            <span className="text-[var(--color-nexus-muted)] block">{log.ipAddress || 'No IP'}</span>
                            <span className="text-[10px] text-[var(--color-nexus-muted)] block truncate max-w-[200px]">{log.deviceInfo || 'System Agent'}</span>
                          </td>
                          <td className="py-4 px-4 font-mono text-[10px] text-[var(--color-nexus-muted)]" title={log.hash}>
                            {log.hash.substring(0, 8)}...
                          </td>
                        </tr>
                      );
                    })}
                    {ledger.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-12 text-center text-[var(--color-nexus-muted)] text-sm">No ledger block records created yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Feature Access Modal — grants/revokes the delegable QR + WFH
            permission strings for one already-hired employee. */}
        {accessEditingUser && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-6">
            <div className="nexus-card rounded-3xl p-8 max-w-md w-full shadow-2xl">
              <h3 className="text-lg font-bold text-[var(--color-nexus-ink)] mb-1 font-sans">Feature Access</h3>
              <p className="text-xs text-[var(--color-nexus-muted)] mb-6">Grant or revoke delegable features for <strong>{accessEditingUser.name}</strong>.</p>
              <div className="space-y-3 mb-8">
                {ACCESS_OPTIONS.map(opt => (
                  <label key={opt.key} className="flex items-center gap-3 p-3 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl cursor-pointer hover:bg-[var(--color-nexus-primary-fixed)]/50 transition-colors">
                    <input
                      type="checkbox"
                      checked={accessDraft.includes(opt.key)}
                      onChange={() => toggleAccessDraft(opt.key)}
                      className="w-4 h-4 accent-[var(--color-nexus-primary)]"
                    />
                    <span className="text-xs font-bold text-[var(--color-nexus-ink)]">{opt.label}</span>
                  </label>
                ))}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setAccessEditingUser(null)}
                  className="flex-1 bg-[var(--color-nexus-surface-alt)] hover:bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-ink)] rounded-xl py-3 text-xs font-bold uppercase tracking-wider transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => saveAccess(accessEditingUser.id)}
                  disabled={accessSaving}
                  className="flex-1 bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white rounded-xl py-3 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
                >
                  {accessSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Stat-card drill-down modal — shows the actual people behind a
            clicked stat, rendered through the shared DataTable. */}
        {drillDown && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 sm:p-6" onClick={() => setDrillDown(null)}>
            <div className="nexus-card rounded-3xl p-6 max-w-3xl w-full shadow-2xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-[var(--color-nexus-ink)] font-sans">{drillDown.title} <span className="text-[var(--color-nexus-muted)] font-normal text-sm">({drillDown.rows.length})</span></h3>
                <button onClick={() => setDrillDown(null)} className="text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)] p-1"><X size={18} /></button>
              </div>
              <DataTable
                data={drillDown.rows}
                columns={drillDown.columns}
                searchPlaceholder="Search by name..."
                globalFilterColumnIds={drillDown.searchIds || ['name']}
                filterColumn={drillDown.roleFilter ? { id: 'role', label: 'Roles', options: [...new Set(drillDown.rows.map((r: any) => r.role))].filter(Boolean).sort() as string[] } : undefined}
                initialPinning={{ left: ['name'] }}
                pageSize={10}
                emptyMessage="No one in this category right now."
              />
            </div>
          </div>
        )}

        {detailUserId !== null && (
          <EmployeeDetailPanel userId={detailUserId} onClose={() => setDetailUserId(null)} />
        )}

    </PortalShell>
  );
}
