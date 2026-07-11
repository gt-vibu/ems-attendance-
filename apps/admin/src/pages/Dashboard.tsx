import { useState, useEffect, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { User } from '../lib/auth';
import PageChrome from '../components/PageChrome';
import DataTable from '../components/DataTable';
import type { ColumnDef } from '@tanstack/react-table';
import QrAttendanceDisplay from '../components/dashboard/QrAttendanceDisplay';
// Lazy so Leaflet is code-split out of the main bundle.
const LocationPicker = lazy(() => import('../components/LocationPicker'));
import {
  LayoutDashboard, Users, Building2, ShieldCheck, Bell, Fingerprint,
  ScrollText, LogOut, AlertTriangle, Smartphone, Menu, X, ClipboardCheck, Home, Clock, MapPin, Download,
  QrCode, ScanLine
} from 'lucide-react';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer
} from 'recharts';

export default function Dashboard({ user, onLogout }: { user: User, onLogout: () => void }) {
  const navigate = useNavigate();
  const token = localStorage.getItem('auth_token');

  // Unified notifications list
  const [notifications, setNotifications] = useState<any[]>([]);

  // Tab selection:
  // For Super Admin: 'requests' | 'notifications'
  // For Tenant Admin: 'settings' | 'recruitment' | 'devices' | 'notifications'
  const [activeTab, setActiveTab] = useState<string>('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

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
  const WFH_ROLE_OPTIONS = ['employee', 'manager', 'HR', 'GM'];
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
  const [newUserRole, setNewUserRole] = useState('employee');
  const [newUserPrivileges, setNewUserPrivileges] = useState<string[]>([]);
  const [hasRecruitmentAccess, setHasRecruitmentAccess] = useState(false);

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
          privileges: newUserPrivileges
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to register employee');

      setSuccess(`Employee "${newUserName}" hired successfully. Temporary credentials sent.`);
      setNewUserEmail('');
      setNewUserName('');
      setNewUserRole('employee');
      setNewUserPrivileges([]);
      
      fetchTenantAdminData();
      
      setTimeout(() => setSuccess(''), 4000);
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

  // Initialize data depending on user role. Land on the role-aware tile
  // Home view rather than jumping straight into a specific section — which
  // tiles actually show up is computed from navItems below, so this
  // automatically reflects whatever this user's role/privileges unlock.
  useEffect(() => {
    if (user.role === 'super_admin') {
      setActiveTab('home');
      fetchSuperAdminData();
    } else {
      setActiveTab('home');
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

  const togglePrivilege = (priv: string) => {
    if (newUserPrivileges.includes(priv)) {
      setNewUserPrivileges(newUserPrivileges.filter(p => p !== priv));
    } else {
      setNewUserPrivileges([...newUserPrivileges, priv]);
    }
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
      cell: ({ getValue }) => <span className="font-semibold text-slate-900">{getValue() as string}</span>,
    },
    {
      accessorKey: 'email',
      header: 'Email',
      cell: ({ getValue }) => <span className="text-slate-500 font-mono">{getValue() as string}</span>,
    },
    {
      accessorKey: 'role',
      header: 'Role',
      filterFn: 'equalsString',
      cell: ({ getValue }) => <span className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">{getValue() as string}</span>,
    },
    {
      id: 'kyc',
      accessorFn: (emp: any) => (emp.isKycCompleted ? 'Completed' : 'Pending'),
      header: 'KYC State',
      cell: ({ row }) => (
        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${row.original.isKycCompleted ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
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
        <span className="font-mono text-[10px] text-slate-400">
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
          className="text-[10px] font-bold uppercase tracking-wider text-violet-700 bg-violet-50 hover:bg-violet-100 px-2.5 py-1 rounded-lg transition-colors"
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
      cell: ({ getValue }) => <span className="font-semibold text-slate-900">{getValue() as string}</span>,
    },
    {
      accessorKey: 'role',
      header: 'Role',
      filterFn: 'equalsString',
      cell: ({ getValue }) => <span className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">{getValue() as string}</span>,
    },
    {
      accessorKey: 'date',
      header: 'Date',
      cell: ({ getValue }) => <span className="text-slate-600">{new Date(getValue() as string).toLocaleDateString()}</span>,
    },
    {
      id: 'checkInTime',
      accessorKey: 'checkInTime',
      header: 'Check-In',
      cell: ({ getValue }) => <span className="font-mono text-[11px] text-slate-500">{new Date(getValue() as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ getValue }) => {
        const s = getValue() as string;
        return (
          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${s === 'approved' ? 'bg-emerald-100 text-emerald-800' : s === 'pending' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'}`}>
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
        return <span className="text-slate-500 text-[11px]">{d == null ? '—' : `${Math.round(d)}m`}</span>;
      },
    },
    {
      accessorKey: 'wfhReason',
      header: 'Reason',
      enableSorting: false,
      cell: ({ getValue }) => <span className="text-slate-500 text-[11px] truncate max-w-[220px] block">{(getValue() as string) || '—'}</span>,
    },
  ];

  const qrSessionColumns: ColumnDef<any, any>[] = [
    {
      accessorKey: 'generatedByName',
      header: 'Started By',
      cell: ({ getValue }) => <span className="font-semibold text-slate-900">{getValue() as string}</span>,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ getValue }) => {
        const s = getValue() as string;
        return <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${s === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{s}</span>;
      },
    },
    {
      accessorKey: 'rotationSeconds',
      header: 'Rotation',
      cell: ({ getValue }) => <span className="text-slate-500 font-mono">{getValue() as number}s</span>,
    },
    { accessorKey: 'scansCount', header: 'Scans', cell: ({ getValue }) => <span className="text-slate-700">{getValue() as number}</span> },
    { accessorKey: 'successCount', header: 'Success', cell: ({ getValue }) => <span className="text-emerald-700">{getValue() as number}</span> },
    { accessorKey: 'failCount', header: 'Failed', cell: ({ getValue }) => <span className="text-rose-700">{getValue() as number}</span> },
    {
      accessorKey: 'createdAt',
      header: 'Started',
      cell: ({ getValue }) => <span className="text-slate-400 text-[11px]">{new Date(getValue() as string).toLocaleString()}</span>,
    },
  ];

  const qrScanColumns: ColumnDef<any, any>[] = [
    {
      accessorKey: 'userName',
      header: 'Employee',
      cell: ({ row }) => (
        <div>
          <span className="font-semibold text-slate-900 block">{row.original.userName}</span>
          <span className="text-[10px] text-slate-400 uppercase font-bold">{row.original.userRole}</span>
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
          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${s === 'success' ? 'bg-emerald-100 text-emerald-700' : s === 'failed' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
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
          <span className="font-mono text-[10px] text-slate-500">
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
      cell: ({ getValue }) => <span className="text-slate-500">{(getValue() as string) || '—'}</span>,
    },
    {
      accessorKey: 'ipAddress',
      header: 'IP',
      enableSorting: false,
      cell: ({ getValue }) => <span className="text-slate-400 font-mono text-[10px]">{(getValue() as string) || '—'}</span>,
    },
    {
      accessorKey: 'createdAt',
      header: 'Time',
      cell: ({ getValue }) => <span className="text-slate-400 text-[11px]">{new Date(getValue() as string).toLocaleString()}</span>,
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
            className="bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-bold uppercase tracking-wider py-1 px-3 rounded-lg transition-colors"
          >
            Override
          </button>
        ) : null
      ),
    },
  ];

  // --- Stat-card drill-down column sets ---
  const roleCell = ({ getValue }: any) => <span className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">{getValue() as string}</span>;
  const nameCell = ({ getValue }: any) => <span className="font-semibold text-slate-900">{getValue() as string}</span>;
  const modeBadge = ({ getValue }: any) => {
    const m = (getValue() as string) || 'office';
    return <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${m === 'wfh' ? 'bg-violet-100 text-violet-700' : m === 'qr' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600'}`}>{m}</span>;
  };
  const statusBadge = ({ getValue }: any) => {
    const s = (getValue() as string) || '';
    return <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${s === 'approved' ? 'bg-emerald-100 text-emerald-800' : s === 'pending' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'}`}>{s}</span>;
  };
  const timeCell = ({ getValue }: any) => {
    const v = getValue();
    return <span className="font-mono text-[11px] text-slate-500">{v ? new Date(v as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</span>;
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
    { accessorKey: 'newLocation', header: 'Requested Location', enableSorting: false, cell: ({ getValue }) => <span className="text-slate-600 text-[11px]">{(getValue() as string) || '—'}</span> },
    { accessorKey: 'reason', header: 'Reason', enableSorting: false, cell: ({ getValue }) => <span className="text-slate-500 text-[11px] truncate max-w-[200px] block">{(getValue() as string) || '—'}</span> },
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

  const tenantAdminNav = [
    ...(user.role === 'tenant_admin' ? [{ id: 'settings', label: 'Workspace Boundaries', icon: ShieldCheck, description: 'GPS geofence, Wi-Fi lock, shift timing, break budget.' }] : []),
    ...(hasRecruitmentAccess ? [{ id: 'recruitment', label: 'Dynamic Recruitment', icon: Users, count: recruitedUsers.length, description: 'Add employees and assign roles/privileges.' }] : []),
    ...(hasDevicesAccess ? [{ id: 'devices', label: 'Device Approvals', icon: Smartphone, count: deviceRequests.length, description: 'Approve device-migration requests.' }] : []),
    ...(hasCorrectionsAccess ? [{ id: 'corrections', label: 'Attendance Corrections', icon: ClipboardCheck, count: corrections.filter(c => c.status === 'pending').length, description: 'Review missed check-in/out requests.' }] : []),
    ...(hasAttendanceApprovalAccess ? [{ id: 'late-arrivals', label: 'Late Arrivals & WFH', icon: Clock, count: pendingAttendance.length, description: 'Approve or reject pending late check-ins and Work From Home requests.' }] : []),
    ...(hasWfhLocationAccess ? [{ id: 'wfh-locations', label: 'WFH Location Requests', icon: MapPin, count: wfhLocationRequests.length, description: 'Approve or reject home-location change requests.' }] : []),
    ...(hasWfhLedgerAccess ? [{ id: 'wfh-ledger', label: 'WFH Ledger', icon: ClipboardCheck, count: wfhLedger.length, description: 'Who worked from home, on what day, with reason and status.' }] : []),
    ...(hasQrAccess ? [{ id: 'qr-attendance', label: 'QR Attendance', icon: QrCode, description: 'Display a rotating QR code for employees to scan and mark attendance.' }] : []),
    ...(hasQrLogsAccess ? [{ id: 'qr-logs', label: 'QR Attendance Logs', icon: ScanLine, count: qrScanLogs.filter(s => s.status === 'failed').length, description: 'Session history, scan attempts, and failure reasons.' }] : []),
    ...(hasAlertsAccess ? [{ id: 'violations', label: 'Timing Violations', icon: AlertTriangle, count: attendanceAlerts.filter(a => a.status === 'pending').length, description: 'Break overstays and geofence exits.' }] : []),
    { id: 'notifications', label: 'Alert Inbox', icon: Bell, count: notifications.length, description: 'Your notifications and system messages.' },
    { id: 'ledger', label: 'Audit Ledger', icon: ScrollText, count: ledger.length, description: 'Immutable, cryptographically-chained activity log.' },
  ];

  const navItems = user.role === 'super_admin' ? superAdminNav : tenantAdminNav;
  const roleLabel = user.role === 'super_admin' ? 'Super Admin'
    : user.role === 'tenant_admin' ? 'Tenant Admin'
    : user.role.toUpperCase() === user.role ? user.role // already an acronym like 'HR', 'GM'
    : user.role.charAt(0).toUpperCase() + user.role.slice(1);
  const activeNavLabel = activeTab === 'home' ? 'Home' : (navItems.find(n => n.id === activeTab)?.label || 'Dashboard');

  const SidebarContent = () => (
    <>
      <div className="px-6 py-6 flex items-center gap-2.5 border-b border-slate-200">
        <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center shrink-0">
          <Fingerprint className="w-4.5 h-4.5 text-white" size={18} />
        </div>
        <div className="min-w-0">
          <span className="font-display font-bold text-sm text-slate-900 tracking-tight block truncate">Smart Teams</span>
          <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">
            {roleLabel}
          </span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <button
          onClick={() => { setActiveTab('home'); setMobileSidebarOpen(false); }}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
            activeTab === 'home' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Home size={16} className="shrink-0" />
          <span className="flex-1 text-left truncate">Home</span>
        </button>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => { setActiveTab(item.id); setMobileSidebarOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
                isActive ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon size={16} className="shrink-0" />
              <span className="flex-1 text-left truncate">{item.label}</span>
              {typeof item.count === 'number' && item.count > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'}`}>
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-slate-200">
        <div className="flex items-center gap-2.5 px-3 py-2 mb-2">
          <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600 shrink-0">
            {(user.email || '?').charAt(0).toUpperCase()}
          </div>
          <span className="text-[11px] text-slate-500 font-medium truncate">{user.email}</span>
        </div>
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition-colors"
        >
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen premium-mesh-bg font-sans text-slate-800 flex relative">

      {/* Desktop persistent sidebar */}
      <aside className="hidden md:flex md:flex-col w-64 shrink-0 bg-white border-r border-slate-200 sticky top-0 h-screen">
        <SidebarContent />
      </aside>

      {/* Mobile sidebar drawer */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileSidebarOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-white border-r border-slate-200 flex flex-col shadow-2xl">
            <button
              onClick={() => setMobileSidebarOpen(false)}
              className="absolute top-5 right-4 text-slate-400 hover:text-slate-700"
            >
              <X size={20} />
            </button>
            <SidebarContent />
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Slim top bar: mobile menu toggle + page title + notifications */}
        <header className="bg-white border-b border-slate-200 px-4 md:px-6 py-4 flex justify-between items-center sticky top-0 z-40 shadow-sm">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileSidebarOpen(true)}
              className="md:hidden text-slate-500 hover:text-slate-900 shrink-0"
            >
              <Menu size={22} />
            </button>
            <h1 className="font-display font-bold text-base md:text-lg text-slate-900 tracking-tight truncate">{activeNavLabel}</h1>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <PageChrome fallbackHref="/login" variant="compact" />
            <div className="w-px h-5 bg-slate-200" />
            <button
              onClick={() => setActiveTab('notifications')}
              className="relative text-slate-400 hover:text-slate-700 transition-colors"
              title="Notifications"
            >
              <Bell size={19} />
              {notifications.filter((n: any) => !n.isRead).length > 0 && (
                <span className="absolute -top-1 -right-1 w-2 h-2 bg-rose-500 rounded-full" />
              )}
            </button>
            <span className="hidden sm:block text-xs text-slate-500 font-semibold">{user.email}</span>
          </div>
        </header>

        <main className="max-w-5xl mx-auto p-4 md:p-6 mt-2 md:mt-6 w-full">
        
        {/* Alerts */}
        {error && <div className="bg-red-50 text-red-600 text-xs p-4 rounded-xl mb-6 border border-red-100 font-medium shadow-sm">{error}</div>}
        {success && <div className="bg-emerald-50 text-emerald-600 text-xs p-4 rounded-xl mb-6 border border-emerald-100 font-medium shadow-sm">{success}</div>}

        {/* ======================================================== */}
        {/* HOME — role-aware tile landing view. Built directly from
            navItems, so every tile here is something this specific user's
            role/privileges actually unlock; nothing is shown here that
            isn't equally reachable (and equally enforced server-side) from
            the sidebar. */}
        {/* ======================================================== */}
        {activeTab === 'home' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-extrabold font-display text-gradient inline-block">Welcome, {user.name || user.email}</h2>
              <p className="text-sm text-slate-500 mt-1">Signed in as <strong>{roleLabel}</strong>. Here's what you can do.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className="text-left glass-card card-3d rounded-2xl p-5 group"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-10 h-10 rounded-xl bg-[var(--color-premium-accent-soft)] group-hover:bg-[var(--color-premium-accent)] flex items-center justify-center transition-colors float-c">
                        <Icon size={18} className="text-[var(--color-premium-accent)] group-hover:text-white transition-colors" />
                      </div>
                      {typeof item.count === 'number' && item.count > 0 && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--color-premium-accent-soft)] text-[var(--color-premium-accent)]">{item.count}</span>
                      )}
                    </div>
                    <h3 className="font-bold text-sm text-slate-900">{item.label}</h3>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">{item.description}</p>
                  </button>
                );
              })}
            </div>
          </div>
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
                  <div className="bg-white border border-slate-200 rounded-2xl p-4">
                    <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Total Tenants</span>
                    <span className="text-2xl font-black text-slate-900 block mt-1">{superAnalytics.totalTenants}</span>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-2xl p-4">
                    <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Active Tenants</span>
                    <span className="text-2xl font-black text-emerald-600 block mt-1">{superAnalytics.activeTenants}</span>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-2xl p-4">
                    <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Suspended</span>
                    <span className="text-2xl font-black text-rose-600 block mt-1">{superAnalytics.suspendedTenants}</span>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-2xl p-4">
                    <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Total Staff (All Tenants)</span>
                    <span className="text-2xl font-black text-slate-900 block mt-1">{superAnalytics.totalEmployees}</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-white border border-slate-200 rounded-2xl p-5">
                    <h3 className="text-sm font-bold text-slate-900 mb-1">This Month, Across All Tenants</h3>
                    <p className="text-[10px] text-slate-400 mb-3">Approved check-ins vs. rejected verification attempts</p>
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
                              <Cell fill="#059669" />
                              <Cell fill="#e11d48" />
                            </Pie>
                            <RechartsTooltip />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400 text-center py-16">No attendance events recorded yet this month.</p>
                    )}
                    <div className="flex justify-center gap-6 mt-2">
                      <span className="text-xs text-slate-600 flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block" /> Approved ({superAnalytics.monthlyCheckInEvents})</span>
                      <span className="text-xs text-slate-600 flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-rose-600 inline-block" /> Rejected ({superAnalytics.monthlyRejectedEvents})</span>
                    </div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-2xl p-5">
                    <h3 className="text-sm font-bold text-slate-900 mb-1">Plan Breakdown</h3>
                    <p className="text-[10px] text-slate-400 mb-3">Tenants grouped by subscription plan</p>
                    {Object.keys(superAnalytics.planBreakdown || {}).length > 0 ? (
                      <div style={{ width: '100%', height: 200 }}>
                        <ResponsiveContainer>
                          <BarChart data={Object.entries(superAnalytics.planBreakdown || {}).map(([plan, count]) => ({ plan, count }))}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="plan" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                            <RechartsTooltip cursor={{ fill: '#f8fafc' }} />
                            <Bar dataKey="count" fill="#0f172a" radius={[6, 6, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400 text-center py-16">No tenants onboarded yet.</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Manage Tenants: suspend / reactivate */}
            {activeTab === 'tenants' && (
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
                <h2 className="text-lg font-bold text-slate-900 mb-6 font-display">All Tenants</h2>
                {allTenants.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-12">No tenants onboarded yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-100 text-slate-400 text-[10px] uppercase font-bold tracking-wider">
                          <th className="py-3 px-4">Company Name</th>
                          <th className="py-3 px-4">Plan</th>
                          <th className="py-3 px-4">Staff</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allTenants.map((t) => (
                          <tr key={t.id} className="border-b border-slate-100 text-sm hover:bg-slate-50 transition-colors">
                            <td className="py-4 px-4 font-semibold text-slate-900">{t.name}</td>
                            <td className="py-4 px-4">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">{t.plan}</span>
                            </td>
                            <td className="py-4 px-4 font-semibold">{t.employeeCount}</td>
                            <td className="py-4 px-4">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${(t.status || 'active') === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                {t.status || 'active'}
                              </span>
                            </td>
                            <td className="py-4 px-4 text-right">
                              <button
                                onClick={() => handleToggleTenantStatus(t.id, t.status || 'active')}
                                className={`font-bold text-xs uppercase tracking-wider py-1.5 px-4 rounded-lg transition-colors ${(t.status || 'active') === 'active' ? 'bg-rose-600 hover:bg-rose-700 text-white' : 'bg-emerald-600 hover:bg-emerald-700 text-white'}`}
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
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
                <h2 className="text-lg font-bold text-slate-900 mb-6 font-display">Inbound Tenant Registrations</h2>
                {tenancyRequests.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-12">No pending registration requests found.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-100 text-slate-400 text-[10px] uppercase font-bold tracking-wider">
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
                          <tr key={req.id} className="border-b border-slate-100 text-sm hover:bg-slate-50 transition-colors">
                            <td className="py-4 px-4 font-semibold text-slate-900">{req.companyName}</td>
                            <td className="py-4 px-4 text-slate-500 font-mono text-xs">{req.email}</td>
                            <td className="py-4 px-4">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${req.plan === 'Enterprise' ? 'bg-purple-100 text-purple-700' : req.plan === 'Professional' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700'}`}>
                                {req.plan}
                              </span>
                            </td>
                            <td className="py-4 px-4 font-semibold">{req.numEmployees}</td>
                            <td className="py-4 px-4">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${req.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                {req.status}
                              </span>
                            </td>
                            <td className="py-4 px-4 text-right">
                              {req.status === 'pending' && (
                                <button 
                                  onClick={() => handleOpenApproveModal(req)}
                                  className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs uppercase tracking-wider py-1.5 px-4 rounded-lg transition-colors"
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
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200">
                <h2 className="text-lg font-bold text-slate-900 mb-6 font-display">Admin Inbox</h2>
                {notifications.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-12">No notifications found.</p>
                ) : (
                  <div className="space-y-4">
                    {notifications.map((notif) => (
                      <div key={notif.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex justify-between items-start gap-4">
                        <div>
                          <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">{notif.title}</h4>
                          <p className="text-xs text-slate-600 mt-1">{notif.message}</p>
                          <span className="text-[10px] text-slate-400 mt-2 block">{new Date(notif.createdAt).toLocaleString()}</span>
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
          <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm z-50 flex items-center justify-center p-6">
            <div className="bg-white rounded-3xl p-8 max-w-md w-full border border-slate-100 shadow-2xl">
              <h3 className="text-lg font-bold text-slate-900 mb-2 font-display">Approve Tenancy Onboarding</h3>
              <p className="text-xs text-slate-500 mb-6">Assign feature capabilities and privileges for <strong>{selectedRequest.companyName}</strong>.</p>

              <div className="mb-6">
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Subscription Plan</label>
                <select
                  value={selectedPlanOverride}
                  onChange={e => setSelectedPlanOverride(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none text-slate-700 font-medium"
                >
                  <option value="Basic">Basic</option>
                  <option value="Standard">Standard</option>
                  <option value="Professional">Professional</option>
                  <option value="Enterprise">Enterprise</option>
                </select>
                <p className="text-[10px] text-slate-400 mt-1">Requested: <strong>{selectedRequest.plan}</strong> — you can change it before onboarding.</p>
              </div>

              <div className="space-y-4 mb-8">
                <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Features Package</span>
                
                <label className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl cursor-pointer hover:bg-slate-100/50 transition-colors">
                  <input 
                    type="checkbox" 
                    checked={selectedFeatures.includes('kyc')} 
                    onChange={() => toggleFeature('kyc')}
                    className="w-4 h-4 accent-slate-900"
                  />
                  <div>
                    <span className="block text-xs font-bold text-slate-950">KYC Biometrics Check</span>
                    <span className="text-[10px] text-slate-500">Requires camera face embeddings matching</span>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl cursor-pointer hover:bg-slate-100/50 transition-colors">
                  <input 
                    type="checkbox" 
                    checked={selectedFeatures.includes('gps_geofence')} 
                    onChange={() => toggleFeature('gps_geofence')}
                    className="w-4 h-4 accent-slate-900"
                  />
                  <div>
                    <span className="block text-xs font-bold text-slate-950">GPS Geofencing Bounds</span>
                    <span className="text-[10px] text-slate-500">Limits checking in to office coordinate radius</span>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl cursor-pointer hover:bg-slate-100/50 transition-colors">
                  <input 
                    type="checkbox" 
                    checked={selectedFeatures.includes('wifi_lock')} 
                    onChange={() => toggleFeature('wifi_lock')}
                    className="w-4 h-4 accent-slate-900"
                  />
                  <div>
                    <span className="block text-xs font-bold text-slate-950">Corporate Wi-Fi IP Security</span>
                    <span className="text-[10px] text-slate-500">Validates corporate public network IP addresses</span>
                  </div>
                </label>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => setShowApprovalModal(false)}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs uppercase tracking-wider py-3.5 rounded-xl transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleApproveRequest}
                  disabled={loading}
                  className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs uppercase tracking-wider py-3.5 rounded-xl transition-all disabled:opacity-50"
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
            {/* Live snapshot — cards drill down to the actual people when the
                viewer has reporting/directory access (tenantAnalytics.breakdown). */}
            {tenantAnalytics && (() => {
              const bd = tenantAnalytics.breakdown;
              const clickable = !!bd;
              const cardClass = (extra: string) => `text-left glass-card card-3d rounded-2xl p-4 ${clickable ? 'cursor-pointer' : 'cursor-default'} ${extra}`;
              return (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                <button type="button" disabled={!clickable} onClick={() => bd && openDrillDown('All Staff', bd.total, simplePersonColumns, { searchIds: ['name'], roleFilter: true })} className={cardClass('')}>
                  <span className="text-[9px] text-slate-400 uppercase font-bold tracking-wider block">Total Staff</span>
                  <span className="text-xl font-black text-slate-900 block mt-1">{tenantAnalytics.totalStaff}</span>
                </button>
                <button type="button" disabled={!clickable} onClick={() => bd && openDrillDown('Present Today', bd.present, attendancePersonColumns, { searchIds: ['name'], roleFilter: true })} className={cardClass('')}>
                  <span className="text-[9px] text-slate-400 uppercase font-bold tracking-wider block">Present Today</span>
                  <span className="text-xl font-black text-emerald-600 block mt-1">{tenantAnalytics.presentToday}</span>
                </button>
                <button type="button" disabled={!clickable} onClick={() => bd && openDrillDown('Absent Today', bd.absent, simplePersonColumns, { searchIds: ['name'], roleFilter: true })} className={cardClass('')}>
                  <span className="text-[9px] text-slate-400 uppercase font-bold tracking-wider block">Absent Today</span>
                  <span className="text-xl font-black text-slate-700 block mt-1">{tenantAnalytics.absentToday}</span>
                </button>
                <button type="button" disabled={!clickable} onClick={() => bd && openDrillDown('Late Today', bd.late, attendancePersonColumns, { searchIds: ['name'], roleFilter: true })} className={cardClass('')}>
                  <span className="text-[9px] text-slate-400 uppercase font-bold tracking-wider block">Late Today</span>
                  <span className="text-xl font-black text-amber-600 block mt-1">{tenantAnalytics.lateToday}</span>
                </button>
                <button type="button" disabled={!clickable} onClick={() => bd && openDrillDown('Rejected Today', bd.rejected, attendancePersonColumns, { searchIds: ['name'], roleFilter: true })} className={cardClass('')}>
                  <span className="text-[9px] text-slate-400 uppercase font-bold tracking-wider block">Rejected Today</span>
                  <span className="text-xl font-black text-rose-600 block mt-1">{tenantAnalytics.rejectedToday}</span>
                </button>
              </div>
              );
            })()}

            {/* Work From Home snapshot — mirrors the office snapshot above;
                only appears for users with 'reports.view' (the same
                privilege already gating the audit ledger). */}
            {wfhStats && (() => {
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
              const wfhCard = 'text-left glass-card card-3d rounded-2xl p-4 cursor-pointer';
              return (
              <div className="mb-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <button type="button" onClick={() => openDrillDown('WFH Today', wfhTodayRows, attendancePersonColumns, { searchIds: ['name'], roleFilter: true })} className={wfhCard}>
                    <span className="text-[9px] text-slate-400 uppercase font-bold tracking-wider block">WFH Today</span>
                    <span className="text-xl font-black text-violet-600 block mt-1">{wfhStats.todayWfhCount}</span>
                  </button>
                  <button type="button" onClick={() => openDrillDown('WFH This Month', wfhMonthRows, attendancePersonColumns, { searchIds: ['name'], roleFilter: true })} className={wfhCard}>
                    <span className="text-[9px] text-slate-400 uppercase font-bold tracking-wider block">WFH This Month</span>
                    <span className="text-xl font-black text-violet-600 block mt-1">{wfhStats.monthlyWfhCount}</span>
                  </button>
                  <button type="button" onClick={() => openDrillDown('Pending WFH Approvals', pendingWfhRows, attendancePersonColumns, { searchIds: ['name'], roleFilter: true })} className={wfhCard}>
                    <span className="text-[9px] text-slate-400 uppercase font-bold tracking-wider block">Pending WFH Approvals</span>
                    <span className="text-xl font-black text-amber-600 block mt-1">{wfhStats.pendingWfhApprovals}</span>
                  </button>
                  <button type="button" onClick={() => openDrillDown('Pending Location Requests', locationRows, locationRequestColumns, { searchIds: ['name'], roleFilter: true })} className={wfhCard}>
                    <span className="text-[9px] text-slate-400 uppercase font-bold tracking-wider block">Pending Location Requests</span>
                    <span className="text-xl font-black text-amber-600 block mt-1">{wfhStats.pendingLocationChangeRequests}</span>
                  </button>
                </div>

                {(wfhStats.officeVsWfh30d.office > 0 || wfhStats.officeVsWfh30d.wfh > 0) && (
                  <div className="bg-white border border-slate-200 rounded-2xl p-5 mt-3">
                    <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">Office vs. Work From Home (Last 30 Days)</h3>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={[{ name: 'Check-ins', Office: wfhStats.officeVsWfh30d.office, WFH: wfhStats.officeVsWfh30d.wfh }]} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                        <XAxis type="number" allowDecimals={false} />
                        <YAxis type="category" dataKey="name" width={70} />
                        <RechartsTooltip />
                        <Bar dataKey="Office" fill="#0f172a" radius={[0, 4, 4, 0]} />
                        <Bar dataKey="WFH" fill="#7B5CFA" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
              );
            })()}

            {/* Tab: Attendance Corrections (regularization requests) */}
            {activeTab === 'corrections' && (
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)] mb-8">
                <h2 className="text-lg font-bold text-slate-900 mb-2 font-display">Attendance Corrections</h2>
                <p className="text-xs text-slate-400 mb-6">Requests from staff to regularize a missed check-in/out or flag a wrong location. Approving here does not silently rewrite the original record — it's logged as its own reviewed decision.</p>
                {corrections.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-8">No correction requests yet.</p>
                ) : (
                  <div className="space-y-3">
                    {corrections.map((c) => (
                      <div key={c.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-bold text-slate-900">{c.userName}</span>
                            <span className="text-[10px] text-slate-400 uppercase font-bold">{c.userRole}</span>
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase bg-slate-200 text-slate-700">
                              {c.requestType.replace('_', ' ')}
                            </span>
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${c.status === 'pending' ? 'bg-amber-100 text-amber-700' : c.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                              {c.status}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600">
                            {c.requestedDate}{c.requestedTime ? ` at ${c.requestedTime}` : ''} — {c.reason}
                          </p>
                          <p className="text-[10px] text-slate-400 mt-1">Submitted {new Date(c.createdAt).toLocaleString()}</p>
                        </div>
                        {c.status === 'pending' && (
                          <div className="flex gap-2 shrink-0 ml-4">
                            <button
                              onClick={() => handleResolveCorrection(c.id, 'approve')}
                              disabled={loading}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold uppercase tracking-wider py-1.5 px-4 rounded-lg transition-colors disabled:opacity-50"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleResolveCorrection(c.id, 'reject')}
                              disabled={loading}
                              className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold uppercase tracking-wider py-1.5 px-4 rounded-lg transition-colors disabled:opacity-50"
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
            {activeTab === 'late-arrivals' && (
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)] mb-8">
                <h2 className="text-lg font-bold text-slate-900 mb-2 font-display">Late Arrivals &amp; Work From Home</h2>
                <p className="text-xs text-slate-400 mb-6">Late check-ins with an explanation, and WFH check-ins awaiting approval, both land here. Approving finalizes the check-in; rejecting marks the day absent.</p>
                {pendingAttendance.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-8">Nothing awaiting approval.</p>
                ) : (
                  <div className="space-y-3">
                    {pendingAttendance.map((l) => (
                      <div key={l.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-bold text-slate-900">{l.userName}</span>
                            <span className="text-[10px] text-slate-400 uppercase font-bold">{l.userRole}</span>
                            {l.attendanceMode === 'wfh' ? (
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase bg-violet-100 text-violet-700">
                                🏠 WFH
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase bg-amber-100 text-amber-700">
                                late arrival
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-600">
                            {l.attendanceMode === 'wfh'
                              ? <>Checked in {new Date(l.createdAt).toLocaleString()} — {Math.round(l.distanceFromHomeMeters ?? 0)}m from home{l.wfhReason ? ` — "${l.wfhReason}"` : ''}</>
                              : <>Checked in {new Date(l.createdAt).toLocaleString()} — {l.explanation}</>}
                          </p>
                        </div>
                        <div className="flex gap-2 shrink-0 ml-4">
                          <button
                            onClick={() => handleResolveAttendance(l.id, 'approve')}
                            disabled={loading}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold uppercase tracking-wider py-1.5 px-4 rounded-lg transition-colors disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleResolveAttendance(l.id, 'reject')}
                            disabled={loading}
                            className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold uppercase tracking-wider py-1.5 px-4 rounded-lg transition-colors disabled:opacity-50"
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
            {activeTab === 'wfh-locations' && (
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)] mb-8">
                <h2 className="text-lg font-bold text-slate-900 mb-2 font-display">WFH Home Location Requests</h2>
                <p className="text-xs text-slate-400 mb-6">Employees cannot change their registered Work From Home location themselves — approving one of these replaces it going forward.</p>
                {wfhLocationRequests.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-8">No home-location change requests awaiting review.</p>
                ) : (
                  <div className="space-y-3">
                    {wfhLocationRequests.map((r) => (
                      <div key={r.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-bold text-slate-900">{r.userName}</span>
                            <span className="text-[10px] text-slate-400 uppercase font-bold">{r.userRole}</span>
                          </div>
                          <p className="text-xs text-slate-600">
                            New location: {r.newAddress || `${r.newLatitude.toFixed(5)}, ${r.newLongitude.toFixed(5)}`}
                            {r.reason ? ` — "${r.reason}"` : ''}
                          </p>
                          <p className="text-[10px] text-slate-400 mt-1">{new Date(r.createdAt).toLocaleString()}</p>
                        </div>
                        <div className="flex gap-2 shrink-0 ml-4">
                          <button
                            onClick={() => handleResolveWfhLocationRequest(r.id, 'approve')}
                            disabled={loading}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold uppercase tracking-wider py-1.5 px-4 rounded-lg transition-colors disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleResolveWfhLocationRequest(r.id, 'reject')}
                            disabled={loading}
                            className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold uppercase tracking-wider py-1.5 px-4 rounded-lg transition-colors disabled:opacity-50"
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
            {activeTab === 'wfh-ledger' && (
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)] mb-8">
                <h2 className="text-lg font-bold text-slate-900 mb-2 font-display">Work From Home Ledger</h2>
                <p className="text-xs text-slate-400 mb-6">Every WFH check-in over the last 90 days — search by employee, sort or filter by role/date, and page through the records.</p>
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
            {activeTab === 'qr-attendance' && (
              <QrAttendanceDisplay />
            )}

            {/* Tab: QR Attendance session history + scan logs */}
            {activeTab === 'qr-logs' && (
              <div className="space-y-6">
                <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
                  <h2 className="text-lg font-bold text-slate-900 mb-2 font-display">QR Session History</h2>
                  <p className="text-xs text-slate-400 mb-6">Every Start/Stop session, most recent first — search by who started it, sort any column, page through.</p>
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

                <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
                  <h2 className="text-lg font-bold text-slate-900 mb-2 font-display">QR Scan Attempts</h2>
                  <p className="text-xs text-slate-400 mb-6">Every scan attempt — successful, failed, or expired — traceable by employee, device, and IP.</p>
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
            {activeTab === 'violations' && (
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)] mb-8">
                <h2 className="text-lg font-bold text-slate-900 mb-2 font-display">Timing &amp; Break Violations</h2>
                <p className="text-xs text-slate-400 mb-6">Raised automatically when someone exceeds the daily break budget or returns from break outside the office boundary. Only visible to people granted &quot;Receive Alerts&quot;; accepting/rejecting requires the matching privilege.</p>
                {attendanceAlerts.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-8">No violations recorded.</p>
                ) : (
                  <div className="space-y-3">
                    {attendanceAlerts.map((a) => (
                      <div key={a.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-bold text-slate-900">{a.userName}</span>
                            <span className="text-[10px] text-slate-400 uppercase font-bold">{a.userRole}</span>
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${a.status === 'pending' ? 'bg-amber-100 text-amber-700' : a.status === 'accepted' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                              {a.status}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600">{a.message}</p>
                          <p className="text-[10px] text-slate-400 mt-1">{new Date(a.createdAt).toLocaleString()}</p>
                        </div>
                        {a.status === 'pending' && (
                          <div className="flex gap-2 shrink-0 ml-4">
                            <button
                              onClick={() => handleResolveAlert(a.id, 'accept')}
                              disabled={loading}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold uppercase tracking-wider py-1.5 px-4 rounded-lg transition-colors disabled:opacity-50"
                            >
                              Accept
                            </button>
                            <button
                              onClick={() => handleResolveAlert(a.id, 'reject')}
                              disabled={loading}
                              className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold uppercase tracking-wider py-1.5 px-4 rounded-lg transition-colors disabled:opacity-50"
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

            {/* Tab: Settings */}
            {activeTab === 'settings' && (
              <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200">
                <div className="mb-8">
                  <h2 className="text-xl font-bold text-slate-900 font-display">Office Boundary Rules</h2>
                  <p className="text-sm text-slate-500 mt-1">Configure Geofence coordinates and public network IP values.</p>
                </div>
                
                <form onSubmit={handleSaveConfig} className="space-y-6">
                  {/* Network Requirement */}
                  <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100">
                    <h3 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
                      Corporate Network Locking
                    </h3>
                    <p className="text-[11px] text-slate-500 mb-4 leading-relaxed">
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
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase tracking-wider">Wi-Fi Network Name (Reference Only)</label>
                        <input 
                          type="text"
                          value={wifiSsid}
                          onChange={e => setWifiSsid(e.target.value)}
                          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500/20 focus:border-slate-500 transition-all"
                          placeholder="e.g. SmartTeams_Office"
                        />
                        <p className="text-[10px] text-slate-400 mt-1">A label for your own reference — not technically enforced. The IP address to the right is what's actually checked.</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase tracking-wider">Office Public IP Address (Enforced)</label>
                        <input 
                          type="text"
                          value={officeIp}
                          onChange={e => setOfficeIp(e.target.value)}
                          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500/20 focus:border-slate-500 transition-all font-mono"
                          placeholder="e.g. 122.161.44.89 (or 127.0.0.1 for local host)"
                        />
                        <p className="text-[10px] text-slate-400 mt-1">Find this by searching "what is my IP" from a device connected to office Wi-Fi.</p>
                      </div>
                    </div>
                    <label className="flex items-center gap-2.5 mt-4 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={wifiCheckEnabled}
                        onChange={e => setWifiCheckEnabled(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500/30"
                      />
                      <span className="text-xs font-semibold text-slate-700">Require corporate network for check-in/out</span>
                    </label>
                    <p className="text-[10px] text-slate-400 mt-1 ml-6">When off, employees can clock in from any network — Wi-Fi is shown as its own step during check-in only if this is on.</p>
                  </div>

                  {/* Geofence Requirement */}
                  <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-sm font-semibold text-slate-900">Geofence Coordinates</h3>
                      <button 
                        type="button" 
                        onClick={handleGetCurrentLocation}
                        className="text-xs bg-white border border-slate-200 text-slate-700 font-semibold px-3 py-1.5 rounded-lg hover:bg-slate-50 transition-colors shadow-sm"
                      >
                        Fetch Coordinates
                      </button>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase tracking-wider">Latitude</label>
                        <input 
                          type="number"
                          step="any"
                          value={lat}
                          onChange={e => setLat(e.target.value)}
                          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500/20 focus:border-slate-500 transition-all font-mono"
                          placeholder="13.0827"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase tracking-wider">Longitude</label>
                        <input 
                          type="number"
                          step="any"
                          value={lng}
                          onChange={e => setLng(e.target.value)}
                          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500/20 focus:border-slate-500 transition-all font-mono"
                          placeholder="80.2707"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase tracking-wider">Allowed Radius (Meters)</label>
                        <input
                          type="number"
                          value={radius}
                          onChange={e => setRadius(e.target.value)}
                          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500/20 focus:border-slate-500 transition-all"
                          placeholder="100"
                        />
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {[25, 50, 75, 100, 150, 200, 300, 500].map(m => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setRadius(String(m))}
                              className={`text-[11px] px-2.5 py-1 rounded-lg border font-semibold transition-colors ${radius === String(m) ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
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
                        <Suspense fallback={<div className="h-[300px] rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center text-xs text-slate-400">Loading map…</div>}>
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
                  <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100">
                    <h3 className="text-sm font-semibold text-slate-900 mb-4">Attendance &amp; Break Policy</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase tracking-wider">Shift Start Time</label>
                        <input 
                          type="time"
                          value={shiftStart}
                          onChange={e => setShiftStart(e.target.value)}
                          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500/20 focus:border-slate-500 transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase tracking-wider">Shift End Time</label>
                        <input 
                          type="time"
                          value={shiftEnd}
                          onChange={e => setShiftEnd(e.target.value)}
                          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500/20 focus:border-slate-500 transition-all"
                        />
                        <p className="text-[10px] text-slate-400 mt-1">Expected clock-out time. Used for out-time and overtime calculations.</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase tracking-wider">Grace Period (Minutes)</label>
                        <input 
                          type="number"
                          min="0"
                          value={gracePeriodMins}
                          onChange={e => setGracePeriodMins(e.target.value)}
                          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500/20 focus:border-slate-500 transition-all"
                          placeholder="15"
                        />
                        <p className="text-[10px] text-slate-400 mt-1">Arrivals after Shift Start + Grace are marked Late.</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase tracking-wider">Half-Day Threshold (Minutes Worked)</label>
                        <input 
                          type="number"
                          min="0"
                          value={halfDayMins}
                          onChange={e => setHalfDayMins(e.target.value)}
                          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500/20 focus:border-slate-500 transition-all"
                          placeholder="240"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase tracking-wider">Daily Break Budget (Minutes)</label>
                        <input 
                          type="number"
                          min="0"
                          value={dailyBreakBudgetMins}
                          onChange={e => setDailyBreakBudgetMins(e.target.value)}
                          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500/20 focus:border-slate-500 transition-all"
                          placeholder="60"
                        />
                        <p className="text-[10px] text-slate-400 mt-1">Breaks exceeding this budget escalate to you automatically.</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase tracking-wider">Minimum Attendance %</label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={minAttendancePercent}
                          onChange={e => setMinAttendancePercent(e.target.value)}
                          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500/20 focus:border-slate-500 transition-all"
                          placeholder="75"
                        />
                        <p className="text-[10px] text-slate-400 mt-1">Below this monthly percentage, alert emails go to the employee and their reporting hierarchy.</p>
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase tracking-wider">Weekend Days</label>
                        <div className="flex flex-wrap gap-3">
                          {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(day => (
                            <label key={day} className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-1.5">
                              <input
                                type="checkbox"
                                checked={weekendConfig.includes(day)}
                                onChange={() => toggleWeekendDay(day)}
                                className="accent-slate-900"
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
                  <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100">
                    <label className="flex items-center gap-2.5 cursor-pointer select-none mb-4">
                      <input
                        type="checkbox"
                        checked={wfhEnabled}
                        onChange={e => setWfhEnabled(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500/30"
                      />
                      <span className="text-sm font-semibold text-slate-900">Enable Work From Home</span>
                    </label>

                    {wfhEnabled && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                          <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase tracking-wider">Allowed Roles</label>
                          <div className="flex flex-wrap gap-3">
                            {WFH_ROLE_OPTIONS.map(role => (
                              <label key={role} className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-1.5">
                                <input type="checkbox" checked={wfhAllowedRoles.includes(role)} onChange={() => toggleWfhRole(role)} className="accent-slate-900" />
                                {role}
                              </label>
                            ))}
                          </div>
                          <p className="text-[10px] text-slate-400 mt-1">Leave all unchecked to allow every clock-in-capable role (any custom roles you've created too).</p>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase tracking-wider">Max WFH Days / Month</label>
                          <input
                            type="number" min="0" value={wfhMaxDaysPerMonth} onChange={e => setWfhMaxDaysPerMonth(e.target.value)}
                            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500/20 focus:border-slate-500 transition-all"
                            placeholder="Leave blank for unlimited"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase tracking-wider">Allowed Radius From Home (Meters)</label>
                          <input
                            type="number" min="0" value={wfhRadiusMeters} onChange={e => setWfhRadiusMeters(e.target.value)}
                            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500/20 focus:border-slate-500 transition-all"
                            placeholder="200"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase tracking-wider">WFH Late-Login Grace (Minutes)</label>
                          <input
                            type="number" min="0" value={wfhLateLoginGraceMins} onChange={e => setWfhLateLoginGraceMins(e.target.value)}
                            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500/20 focus:border-slate-500 transition-all"
                            placeholder={`Leave blank to reuse office grace (${gracePeriodMins}m)`}
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase tracking-wider">Allowed Weekdays</label>
                          <div className="flex flex-wrap gap-3">
                            {WEEKDAY_OPTIONS.map(day => (
                              <label key={day} className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-1.5">
                                <input type="checkbox" checked={wfhAllowedWeekdays.includes(day)} onChange={() => toggleWfhWeekday(day)} className="accent-slate-900" />
                                {day}
                              </label>
                            ))}
                          </div>
                        </div>
                        <label className="flex items-center gap-2.5 cursor-pointer select-none">
                          <input type="checkbox" checked={wfhApprovalRequired} onChange={e => setWfhApprovalRequired(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500/30" />
                          <span className="text-xs font-semibold text-slate-700">Require manager approval for every WFH check-in</span>
                        </label>
                        <label className="flex items-center gap-2.5 cursor-pointer select-none">
                          <input type="checkbox" checked={wfhRequireReason} onChange={e => setWfhRequireReason(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500/30" />
                          <span className="text-xs font-semibold text-slate-700">Require a reason for each WFH day</span>
                        </label>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={loading}
                      className="bg-slate-900 text-white rounded-xl px-8 py-3.5 font-bold text-xs uppercase tracking-wider hover:bg-slate-800 transition-colors disabled:opacity-50 shadow-sm"
                    >
                      {loading ? 'Saving...' : 'Save Policies'}
                    </button>
                  </div>
                </form>

                {/* Dynamic QR Attendance Policy — its own form/endpoint
                    (PUT /api/qr/config), separate from the office/WFH
                    policy form above. Disabled by default so existing
                    tenants see no change until this is explicitly turned on. */}
                <form onSubmit={handleSaveQrConfig} className="mt-8 p-5 bg-slate-50 rounded-2xl border border-slate-100">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none mb-4">
                    <input
                      type="checkbox"
                      checked={qrEnabled}
                      onChange={e => setQrEnabled(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500/30"
                    />
                    <span className="text-sm font-semibold text-slate-900">Enable Dynamic QR Attendance</span>
                  </label>
                  <p className="text-[11px] text-slate-500 mb-4 -mt-2">A privileged employee (see "QR Attendance" permissions above) displays a rotating QR code; any employee scans it with their own device and goes through whichever checks below are enabled to mark attendance.</p>

                  {qrEnabled && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase tracking-wider">QR Rotation Interval</label>
                        <select
                          value={qrRotationSeconds}
                          onChange={e => setQrRotationSeconds(parseInt(e.target.value, 10))}
                          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500/20 focus:border-slate-500 transition-all"
                        >
                          {QR_ROTATION_CHOICES.map(s => <option key={s} value={s}>{s} seconds</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase tracking-wider">QR Geofence Radius (Meters)</label>
                        <input
                          type="number" min="0" value={qrGeofenceRadiusMeters} onChange={e => setQrGeofenceRadiusMeters(e.target.value)}
                          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500/20 focus:border-slate-500 transition-all"
                          placeholder="Leave blank to reuse the office geofence radius"
                        />
                      </div>
                      <div className="md:col-span-2 flex flex-wrap gap-4">
                        <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-1.5">
                          <input type="checkbox" checked={qrRequireGps} onChange={e => setQrRequireGps(e.target.checked)} className="accent-slate-900" />
                          Require GPS
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-1.5">
                          <input type="checkbox" checked={qrRequireFace} onChange={e => setQrRequireFace(e.target.checked)} className="accent-slate-900" />
                          Require Face Verification
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-1.5">
                          <input type="checkbox" checked={qrRequireWifi} onChange={e => setQrRequireWifi(e.target.checked)} className="accent-slate-900" />
                          Require Corporate Wi-Fi
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-1.5">
                          <input type="checkbox" checked={qrRequireDeviceTrust} onChange={e => setQrRequireDeviceTrust(e.target.checked)} className="accent-slate-900" />
                          Require Registered Device
                        </label>
                      </div>
                      <p className="text-[10px] text-slate-400 md:col-span-2 -mt-2">Corporate Wi-Fi and Registered Device reuse the exact same checks as office check-in above — same corporate IP / device-pinning, not a separate system.</p>
                    </div>
                  )}

                  <div className="flex justify-end mt-4">
                    <button
                      type="submit"
                      disabled={qrConfigSaving}
                      className="bg-violet-700 text-white rounded-xl px-8 py-3.5 font-bold text-xs uppercase tracking-wider hover:bg-violet-800 transition-colors disabled:opacity-50 shadow-sm"
                    >
                      {qrConfigSaving ? 'Saving...' : 'Save QR Policy'}
                    </button>
                  </div>
                </form>

                {/* Holiday Calendar — its own section since it's a list, not a single form submit */}
                <div className="mt-8 p-5 bg-slate-50 rounded-2xl border border-slate-100">
                  <h3 className="text-sm font-semibold text-slate-900 mb-1">Holiday Calendar</h3>
                  <p className="text-[11px] text-slate-500 mb-4">Days marked here show as "Holiday" instead of "Absent" in attendance status, for everyone in the organization.</p>
                  <form onSubmit={handleAddHoliday} className="flex flex-col sm:flex-row gap-3 mb-4">
                    <input
                      type="date"
                      value={newHolidayDate}
                      onChange={e => setNewHolidayDate(e.target.value)}
                      className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500/20 focus:border-slate-500"
                      required
                    />
                    <input
                      type="text"
                      value={newHolidayName}
                      onChange={e => setNewHolidayName(e.target.value)}
                      placeholder="e.g. Independence Day"
                      className="flex-1 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500/20 focus:border-slate-500"
                      required
                    />
                    <button
                      type="submit"
                      disabled={loading}
                      className="bg-slate-900 text-white rounded-xl px-6 py-2.5 font-bold text-xs uppercase tracking-wider hover:bg-slate-800 transition-colors disabled:opacity-50 shrink-0"
                    >
                      Add
                    </button>
                  </form>
                  {holidaysList.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-4">No holidays configured yet.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {holidaysList.map((h) => (
                        <div key={h.id} className="flex items-center justify-between px-4 py-2 bg-white rounded-lg border border-slate-100">
                          <span className="text-xs text-slate-700"><span className="font-mono font-bold">{h.date}</span> — {h.name}</span>
                          <button
                            onClick={() => handleDeleteHoliday(h.id)}
                            disabled={loading}
                            className="text-[10px] font-bold uppercase text-rose-500 hover:text-rose-700 disabled:opacity-50"
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
                {/* Recruit User Form */}
                <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200">
                  <h2 className="text-base font-bold text-slate-900 mb-4 font-display">Recruit Team Member</h2>
                  <form onSubmit={handleHireUser} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase tracking-wider">Full Name</label>
                        <input 
                          type="text"
                          value={newUserName}
                          onChange={e => setNewUserName(e.target.value)}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none"
                          placeholder="John Doe"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase tracking-wider">Email Address</label>
                        <input 
                          type="email"
                          value={newUserEmail}
                          onChange={e => setNewUserEmail(e.target.value)}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none"
                          placeholder="john@company.com"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase tracking-wider">Organization Role</label>
                        <input
                          type="text"
                          list="role-suggestions"
                          value={newUserRole}
                          onChange={e => setNewUserRole(e.target.value)}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none text-slate-700 font-medium"
                          placeholder="e.g. Employee, Manager, HR, GM, Intern..."
                          required
                        />
                        <datalist id="role-suggestions">
                          <option value="Employee" />
                          <option value="Manager" />
                          <option value="HR" />
                          <option value="GM" />
                          <option value="Intern" />
                          <option value="HM" />
                        </datalist>
                        <p className="text-[10px] text-slate-400 mt-1">Any role name is accepted — it doesn't need to match the suggestions above.</p>
                      </div>
                    </div>

                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                      <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Additional RBAC Privileges</span>
                      <p className="text-[10px] text-slate-400 mb-3">On top of whatever this role gets by default. Every role — including custom ones — can always clock in, take breaks, and complete KYC regardless of these toggles. You can only grant a privilege you hold yourself — power can only pass downward, never up. Organization policies (shift times, geofence, break budget, network rules) can never be delegated; only the tenant admin account can change those.</p>
                      <div className="flex flex-wrap gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={newUserPrivileges.includes('employee.create') && newUserPrivileges.includes('employee.read')} 
                            onChange={() => { togglePrivilege('employee.create'); togglePrivilege('employee.read'); }}
                            className="accent-slate-900"
                          />
                          <span className="text-xs text-slate-700">Manage Employees (hire, view roster)</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={newUserPrivileges.includes('settings.edit')} 
                            onChange={() => togglePrivilege('settings.edit')}
                            className="accent-slate-900"
                          />
                          <span className="text-xs text-slate-700">Approve Device Change Requests</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={newUserPrivileges.includes('reports.view')} 
                            onChange={() => togglePrivilege('reports.view')}
                            className="accent-slate-900"
                          />
                          <span className="text-xs text-slate-700">View Reports &amp; Audit Ledger</span>
                        </label>
                      </div>
                      <div className="flex flex-wrap gap-4 mt-3 pt-3 border-t border-slate-200">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={newUserPrivileges.includes('alerts.receive')} 
                            onChange={() => togglePrivilege('alerts.receive')}
                            className="accent-slate-900"
                          />
                          <span className="text-xs text-slate-700">Receive Timing/Break Violation Alerts</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={newUserPrivileges.includes('alerts.accept')} 
                            onChange={() => togglePrivilege('alerts.accept')}
                            className="accent-slate-900"
                          />
                          <span className="text-xs text-slate-700">Accept Alerts</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newUserPrivileges.includes('alerts.reject')}
                            onChange={() => togglePrivilege('alerts.reject')}
                            className="accent-slate-900"
                          />
                          <span className="text-xs text-slate-700">Reject Alerts</span>
                        </label>
                      </div>
                      {/* Dynamic QR Attendance — permissions alone decide who can
                          generate/display/close a QR session; no role name is
                          ever hardcoded here, matching every other toggle above. */}
                      <div className="flex flex-wrap gap-4 mt-3 pt-3 border-t border-slate-200">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newUserPrivileges.includes('attendance.qr.generate')}
                            onChange={() => togglePrivilege('attendance.qr.generate')}
                            className="accent-slate-900"
                          />
                          <span className="text-xs text-slate-700">Generate QR Attendance Sessions</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newUserPrivileges.includes('attendance.qr.display')}
                            onChange={() => togglePrivilege('attendance.qr.display')}
                            className="accent-slate-900"
                          />
                          <span className="text-xs text-slate-700">Display QR Attendance Screen</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newUserPrivileges.includes('attendance.qr.close')}
                            onChange={() => togglePrivilege('attendance.qr.close')}
                            className="accent-slate-900"
                          />
                          <span className="text-xs text-slate-700">Close QR Attendance Sessions</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newUserPrivileges.includes('attendance.qr.override')}
                            onChange={() => togglePrivilege('attendance.qr.override')}
                            className="accent-slate-900"
                          />
                          <span className="text-xs text-slate-700">Override Failed QR Scans</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newUserPrivileges.includes('attendance.qr.view_logs')}
                            onChange={() => togglePrivilege('attendance.qr.view_logs')}
                            className="accent-slate-900"
                          />
                          <span className="text-xs text-slate-700">View QR Attendance Logs</span>
                        </label>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-2">Scanning a code to mark one's own attendance needs no special toggle — every clock-in-capable role can already do that, the same as the existing camera check-in.</p>
                    </div>

                    <button 
                      type="submit"
                      disabled={loading}
                      className="bg-slate-900 text-white rounded-xl py-3 px-6 font-bold text-xs uppercase tracking-wider hover:bg-slate-800 transition-colors disabled:opacity-50"
                    >
                      {loading ? 'Adding...' : 'Register User'}
                    </button>
                  </form>
                </div>

                {/* Team Members List */}
                <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200">
                  <h2 className="text-base font-bold text-slate-900 mb-4 font-display">Organization Directory</h2>
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
            {activeTab === 'devices' && (
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200">
                <h2 className="text-lg font-bold text-slate-900 mb-6 font-display">Pending Device Migrations</h2>
                {deviceRequests.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-12">No pending device approvals found.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-100 text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                          <th className="py-3 px-4">Employee</th>
                          <th className="py-3 px-4">Email</th>
                          <th className="py-3 px-4">New Device ID</th>
                          <th className="py-3 px-4">Requested Date</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deviceRequests.map((req) => (
                          <tr key={req.id} className="border-b border-slate-100 text-xs">
                            <td className="py-4 px-4 font-semibold text-slate-900">{req.userName}</td>
                            <td className="py-4 px-4 text-slate-500 font-mono">{req.userEmail}</td>
                            <td className="py-4 px-4 font-mono text-[10px]">{req.newDeviceId.substring(0, 20)}...</td>
                            <td className="py-4 px-4 text-slate-400">{new Date(req.createdAt).toLocaleDateString()}</td>
                            <td className="py-4 px-4 text-right flex justify-end gap-2">
                              <button 
                                onClick={() => handleDeviceAction(req.id, 'reject')}
                                className="bg-red-50 hover:bg-red-100 text-red-700 font-bold text-xs uppercase tracking-wider py-1 px-3 rounded-lg transition-colors"
                              >
                                Deny
                              </button>
                              <button 
                                onClick={() => handleDeviceAction(req.id, 'approve')}
                                className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs uppercase tracking-wider py-1 px-3 rounded-lg transition-colors"
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

        {/* Unified Notifications Tab */}
        {activeTab === 'notifications' && (
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200">
            <h2 className="text-lg font-bold text-slate-900 mb-6 font-display">System Notifications</h2>
            {notifications.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-12">No notifications found.</p>
            ) : (
              <div className="space-y-4">
                {notifications.map((notif) => (
                  <div key={notif.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex justify-between items-start gap-4">
                    <div>
                      <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">{notif.title}</h4>
                      <p className="text-xs text-slate-600 mt-1">{notif.message}</p>
                      <span className="text-[10px] text-slate-400 mt-2 block">{new Date(notif.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Immutable Audit Ledger Tab */}
        {activeTab === 'ledger' && (
          <div className="space-y-6">
            <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-slate-900 font-display">Immutable Cryptographic Audit Ledger</h2>
                  <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] uppercase font-bold rounded-md border border-emerald-100 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M2.166 11.37h7.478l2.5-8.333a1 1 0 011.902.008L15.344 7.62h2.49a1 1 0 110 2H14.656a1 1 0 01-.95-.678L12.5 5.03l-2.5 8.333a1 1 0 01-1.902-.008L6.804 9.38H2.166a1 1 0 110-2z" clipRule="evenodd" /></svg>
                    SHA-256 Chained
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">Verify that database logs have not been tampered with or modified since creation.</p>
              </div>
              <div className="flex gap-2 self-start md:self-auto">
                <button
                  onClick={handleExportLedgerCsv}
                  className="bg-white border border-slate-200 text-slate-700 font-bold text-xs uppercase tracking-wider py-3 px-5 rounded-xl hover:bg-slate-50 transition-colors flex items-center gap-2"
                >
                  <Download size={14} />
                  Export CSV
                </button>
                <button
                  onClick={verifyLedgerIntegrity}
                  disabled={ledgerVerifying}
                  className="bg-slate-950 text-white font-bold text-xs uppercase tracking-wider py-3 px-6 rounded-xl hover:bg-slate-800 transition-colors disabled:opacity-50 flex items-center gap-2"
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
              <div className={`p-5 rounded-3xl border flex items-start gap-4 ${ledgerVerificationResult.isValid ? 'bg-emerald-50 border-emerald-100 text-emerald-800' : 'bg-rose-50 border-rose-100 text-rose-800'}`}>
                <div className={`p-2 rounded-2xl ${ledgerVerificationResult.isValid ? 'bg-emerald-100' : 'bg-rose-100'}`}>
                  {ledgerVerificationResult.isValid ? (
                    <svg className="w-6 h-6 text-emerald-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                  ) : (
                    <svg className="w-6 h-6 text-rose-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
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

            <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 text-[10px] text-slate-400 font-bold uppercase tracking-wider">
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
                        <tr key={log.id} className="border-b border-slate-100 text-xs hover:bg-slate-50/50 transition-colors">
                          <td className="py-4 px-4 text-slate-500 whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</td>
                          <td className="py-4 px-4">
                            <span className="font-semibold text-slate-900 block">{log.actorName}</span>
                            <span className="text-[10px] text-slate-400 font-mono">ID: #{log.actorId || 'SYS'}</span>
                          </td>
                          <td className="py-4 px-4">
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                              isFraud ? 'bg-rose-100 text-rose-700' :
                              log.action.startsWith('WFH_') ? 'bg-violet-100 text-violet-700' :
                              log.action === 'CHECK_IN' ? 'bg-emerald-100 text-emerald-700' :
                              log.action === 'CHECK_OUT' ? 'bg-blue-100 text-blue-700' :
                              'bg-slate-100 text-slate-700'
                            }`}>
                              {log.action}
                            </span>
                          </td>
                          <td className="py-4 px-4">
                            <span className="text-slate-600 block">{log.ipAddress || 'No IP'}</span>
                            <span className="text-[10px] text-slate-400 block truncate max-w-[200px]">{log.deviceInfo || 'System Agent'}</span>
                          </td>
                          <td className="py-4 px-4 font-mono text-[10px] text-slate-400" title={log.hash}>
                            {log.hash.substring(0, 8)}...
                          </td>
                        </tr>
                      );
                    })}
                    {ledger.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-12 text-center text-slate-400 text-sm">No ledger block records created yet.</td>
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
          <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm z-50 flex items-center justify-center p-6">
            <div className="bg-white rounded-3xl p-8 max-w-md w-full border border-slate-100 shadow-2xl">
              <h3 className="text-lg font-bold text-slate-900 mb-1 font-display">Feature Access</h3>
              <p className="text-xs text-slate-500 mb-6">Grant or revoke delegable features for <strong>{accessEditingUser.name}</strong>.</p>
              <div className="space-y-3 mb-8">
                {ACCESS_OPTIONS.map(opt => (
                  <label key={opt.key} className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl cursor-pointer hover:bg-slate-100/50 transition-colors">
                    <input
                      type="checkbox"
                      checked={accessDraft.includes(opt.key)}
                      onChange={() => toggleAccessDraft(opt.key)}
                      className="w-4 h-4 accent-violet-700"
                    />
                    <span className="text-xs font-bold text-slate-700">{opt.label}</span>
                  </label>
                ))}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setAccessEditingUser(null)}
                  className="flex-1 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-xl py-3 text-xs font-bold uppercase tracking-wider transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => saveAccess(accessEditingUser.id)}
                  disabled={accessSaving}
                  className="flex-1 bg-violet-700 hover:bg-violet-800 text-white rounded-xl py-3 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
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
          <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 sm:p-6" onClick={() => setDrillDown(null)}>
            <div className="bg-white rounded-3xl p-6 max-w-3xl w-full border border-slate-100 shadow-2xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900 font-display">{drillDown.title} <span className="text-slate-400 font-normal text-sm">({drillDown.rows.length})</span></h3>
                <button onClick={() => setDrillDown(null)} className="text-slate-400 hover:text-slate-700 p-1"><X size={18} /></button>
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

      </main>
      </div>
    </div>
  );
}
