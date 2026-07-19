import { useState } from 'react';

export const WEEKDAY_OPTIONS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Tenant boundary/network/shift/WFH policy configuration — the big
// Administration > Settings form, saved via POST /api/tenant/config/update.
// Extracted verbatim from Dashboard.tsx. `hydrateFromConfig` is called by
// the aggregate fetchTenantAdminData() in Dashboard.tsx with the fetched
// `configData.tenant` object (unchanged behavior, just relocated).
export function useTenantConfig(
  token: string | null,
  setLoading: (v: boolean) => void,
  setError: (v: string) => void,
  setSuccess: (v: string) => void,
) {
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

  // Work From Home (WFH) policy — additive; mirrors the office policy fields
  // above and is saved via the same /api/tenant/config/update call. Allowed-
  // roles options come from `allRoleNames` (this tenant's real, possibly
  // custom role list) rather than a hardcoded list, passed in by the caller.
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
  const toggleWeekendDay = (day: string) => {
    setWeekendConfig(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  };

  // Populates all of the above from the `/api/tenant/config` response's
  // `.tenant` object — called by Dashboard's aggregate fetchTenantAdminData().
  const hydrateFromConfig = (tenant: any) => {
    if (!tenant) return;
    setWifiSsid(tenant.wifiSsid || '');
    setOfficeIp(tenant.officeIp || '');
    setWifiCheckEnabled(!!tenant.wifiCheckEnabled);
    setLat(tenant.locationLat ? tenant.locationLat.toString() : '');
    setLng(tenant.locationLng ? tenant.locationLng.toString() : '');
    setRadius(tenant.locationRadiusMeters ? tenant.locationRadiusMeters.toString() : '100');
    setShiftStart(tenant.shiftStart || '09:00');
    setShiftEnd(tenant.shiftEnd || '18:00');
    setGracePeriodMins(tenant.gracePeriodMins != null ? tenant.gracePeriodMins.toString() : '15');
    setHalfDayMins(tenant.halfDayMins != null ? tenant.halfDayMins.toString() : '240');
    setDailyBreakBudgetMins(tenant.dailyBreakBudgetMins != null ? tenant.dailyBreakBudgetMins.toString() : '60');
    setMinAttendancePercent(tenant.minAttendancePercent != null ? tenant.minAttendancePercent.toString() : '75');
    if (Array.isArray(tenant.weekendConfig)) setWeekendConfig(tenant.weekendConfig);

    setWfhEnabled(!!tenant.wfhEnabled);
    if (Array.isArray(tenant.wfhAllowedRoles)) setWfhAllowedRoles(tenant.wfhAllowedRoles);
    setWfhMaxDaysPerMonth(tenant.wfhMaxDaysPerMonth != null ? tenant.wfhMaxDaysPerMonth.toString() : '');
    if (Array.isArray(tenant.wfhAllowedWeekdays)) setWfhAllowedWeekdays(tenant.wfhAllowedWeekdays);
    setWfhRadiusMeters(tenant.wfhRadiusMeters != null ? tenant.wfhRadiusMeters.toString() : '200');
    setWfhApprovalRequired(tenant.wfhApprovalRequired !== false);
    setWfhRequireReason(tenant.wfhRequireReason !== false);
    setWfhLateLoginGraceMins(tenant.wfhLateLoginGraceMins != null ? tenant.wfhLateLoginGraceMins.toString() : '');
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

  return {
    wifiSsid, setWifiSsid,
    officeIp, setOfficeIp,
    wifiCheckEnabled, setWifiCheckEnabled,
    lat, setLat,
    lng, setLng,
    radius, setRadius,
    shiftStart, setShiftStart,
    shiftEnd, setShiftEnd,
    gracePeriodMins, setGracePeriodMins,
    halfDayMins, setHalfDayMins,
    dailyBreakBudgetMins, setDailyBreakBudgetMins,
    weekendConfig, setWeekendConfig,
    minAttendancePercent, setMinAttendancePercent,
    wfhEnabled, setWfhEnabled,
    wfhAllowedRoles, setWfhAllowedRoles,
    wfhMaxDaysPerMonth, setWfhMaxDaysPerMonth,
    wfhAllowedWeekdays, setWfhAllowedWeekdays,
    wfhRadiusMeters, setWfhRadiusMeters,
    wfhApprovalRequired, setWfhApprovalRequired,
    wfhRequireReason, setWfhRequireReason,
    wfhLateLoginGraceMins, setWfhLateLoginGraceMins,
    toggleWfhRole,
    toggleWfhWeekday,
    toggleWeekendDay,
    hydrateFromConfig,
    handleSaveConfig,
    handleGetCurrentLocation,
  };
}
