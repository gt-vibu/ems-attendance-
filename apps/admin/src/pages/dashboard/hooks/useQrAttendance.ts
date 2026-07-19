import { useState } from 'react';

// Dynamic QR Attendance policy — its own PUT /api/qr/config endpoint (not
// bundled into handleSaveConfig/`/api/tenant/config/update`), so its own
// form/state/save handler, same pattern as the Holiday Calendar section.
// Also owns QR access probing + session history/scan logs + override.
// Extracted verbatim from Dashboard.tsx.
export const QR_ROTATION_CHOICES = [15, 30, 60, 120];

export function useQrAttendance(
  token: string | null,
  setLoading: (v: boolean) => void,
  setError: (v: string) => void,
  setSuccess: (v: string) => void,
) {
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

  return {
    qrEnabled, setQrEnabled,
    qrRotationSeconds, setQrRotationSeconds,
    qrRequireGps, setQrRequireGps,
    qrRequireWifi, setQrRequireWifi,
    qrRequireFace, setQrRequireFace,
    qrGeofenceRadiusMeters, setQrGeofenceRadiusMeters,
    qrRequireDeviceTrust, setQrRequireDeviceTrust,
    qrConfigSaving,
    fetchQrConfig,
    handleSaveQrConfig,
    hasQrAccess,
    hasQrLogsAccess,
    qrSessionHistory,
    qrScanLogs,
    fetchQrAccess,
    fetchQrLogs,
    handleOverrideQrScan,
  };
}
