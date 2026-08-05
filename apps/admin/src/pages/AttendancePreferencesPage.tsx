import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { User } from '../lib/auth';
import {
  ArrowLeft, Settings, Shield, Clock, Smartphone, Coffee, Monitor,
  ScanFace, MapPin, Wifi, QrCode, Hand, Bluetooth, Nfc, Fingerprint,
  CircleDot, Save, RotateCcw, Info, CheckCircle2, AlertTriangle, History,
  ChevronRight, Zap, Eye, Timer, CalendarClock, Activity, ChevronDown,
  Layers, Lock, Sparkles, Check, HelpCircle, FileText, UserCheck, Play, Plus, Trash2
} from 'lucide-react';
import AdminWorkspaceLayout from '../components/AdminWorkspaceLayout';
import ConfigurationTemplate from '../components/templates/ConfigurationTemplate';

interface AttendanceMethod {
  key: string;
  label: string;
  icon: string;
  future?: boolean;
}

interface HistoryEntry {
  id: number;
  fieldName: string;
  fieldLabel: string;
  oldValue: string | null;
  newValue: string | null;
  changedByName: string;
  ipAddress: string | null;
  deviceInfo: string | null;
  createdAt: string;
}

const METHOD_ICONS: Record<string, any> = {
  'scan-face': ScanFace, 'map-pin': MapPin, 'wifi': Wifi, 'qr-code': QrCode,
  'hand': Hand, 'monitor': Monitor, 'bluetooth': Bluetooth, 'nfc': Nfc,
  'fingerprint': Fingerprint, 'circle-dot': CircleDot,
};

export default function AttendancePreferencesPage({ user, onLogout }: { user: User; onLogout?: () => void }) {
  const token = localStorage.getItem('auth_token');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [validationErrors, setValidationErrors] = useState<Array<{ field: string; message: string }>>([]);

  const [prefs, setPrefs] = useState<any>({});
  const [originalPrefs, setOriginalPrefs] = useState<any>({});
  const [methods, setMethods] = useState<AttendanceMethod[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [newBreakCategoryInput, setNewBreakCategoryInput] = useState('');
  const hasChanges = useMemo(() => JSON.stringify(prefs) !== JSON.stringify(originalPrefs), [prefs, originalPrefs]);

  const fetchPreferences = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/attendance-preferences', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load attendance preferences');
      const data = await res.json();
      setPrefs(data.preferences || {});
      setOriginalPrefs(data.preferences || {});
      setMethods(data.availableMethods || []);
    } catch (err: any) {
      setError(err.message || 'Could not load preferences.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  const fetchHistory = useCallback(async () => {
    try {
      setHistoryLoading(true);
      const res = await fetch('/api/attendance-preferences/history', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setHistory(data.history || []);
    } catch (err) {
      console.error(err);
    } finally {
      setHistoryLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchPreferences();
    fetchHistory();
  }, [fetchPreferences, fetchHistory]);

  const updatePref = (field: string, value: any) => {
    setPrefs((prev: any) => ({ ...prev, [field]: value }));
    setValidationErrors((prev) => prev.filter((e) => e.field !== field));
  };

  const toggleMethod = (key: string) => {
    const current: string[] = Array.isArray(prefs.enabledMethods) ? prefs.enabledMethods : [];
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    updatePref('enabledMethods', next);
    if (!next.includes(prefs.defaultMethod) && next.length > 0) {
      updatePref('defaultMethod', next[0]);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError('');
      setSuccess('');
      setValidationErrors([]);

      const res = await fetch('/api/attendance-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(prefs),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.errors) {
          setValidationErrors(data.errors);
          setError(data.message || 'Validation errors occurred. Please check fields.');
        } else {
          setError(data.error || 'Failed to save preferences.');
        }
        return;
      }

      setPrefs(data.preferences);
      setOriginalPrefs(data.preferences);
      setSuccess(`Updated successfully (${data.diffsCount} change(s)).`);
      fetchHistory();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setError(err.message || 'An error occurred while saving.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Restore attendance preferences to system defaults?')) return;
    try {
      setSaving(true);
      const res = await fetch('/api/attendance-preferences/reset', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPrefs(data.preferences);
      setOriginalPrefs(data.preferences);
      setSuccess('Restored system defaults.');
      fetchHistory();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const fieldError = (field: string) => validationErrors.find((e) => e.field === field)?.message;
  const enabledMethodsCount = Array.isArray(prefs.enabledMethods) ? prefs.enabledMethods.length : 0;
  const activeVerificationsCount = [
    prefs.requireFaceMatch, prefs.requireLivenessDetection, prefs.requireGps,
    prefs.requireOfficeWifi, prefs.requireGeoFence, prefs.requireDeviceVerification
  ].filter(Boolean).length;

  const healthMetrics = [
    {
      label: 'Policy Engine State',
      value: prefs.presenceEngineEnabled ? 'Active' : 'Basic',
      subtext: prefs.presenceEngineEnabled ? 'Multi-signal presence active' : 'Basic clock-in mode',
      icon: Activity,
    },
    {
      label: 'Clock-in Methods',
      value: `${enabledMethodsCount} / ${methods.length}`,
      subtext: `Default: ${prefs.defaultMethod || 'None'}`,
      icon: Clock,
    },
    {
      label: 'Security Enforcements',
      value: `${activeVerificationsCount} Enforced`,
      subtext: 'GPS, Face, Wi-Fi & Liveness',
      icon: Shield,
    },
    {
      label: 'Auto Checkout',
      value: prefs.autoCheckoutEnabled ? `${prefs.autoCheckoutHours || 12}h` : 'Disabled',
      subtext: 'Inactivity cutoff limit',
      icon: Timer,
    },
  ];

  // Progressive Disclosure Sections
  const configSections = [
    {
      id: 'sessions',
      title: 'Sessions & Shift Rules',
      subtitle: 'Work session boundaries, grace periods, and late check-in rules',
      icon: Clock,
      badge: 'Core Policy',
      content: (
        <div className="space-y-5 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <div>
              <label className="font-bold text-[var(--color-nexus-ink)] block mb-1.5">Standard Workday (Hours)</label>
              <input
                type="number"
                value={prefs.workdayHours || 8}
                onChange={(e) => updatePref('workdayHours', parseFloat(e.target.value))}
                className="w-full p-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-lg font-semibold text-[var(--color-nexus-ink)]"
              />
              {fieldError('workdayHours') && <p className="text-[10px] text-red-600 mt-1">{fieldError('workdayHours')}</p>}
            </div>

            <div>
              <label className="font-bold text-[var(--color-nexus-ink)] block mb-1.5">Grace Period (Minutes)</label>
              <input
                type="number"
                value={prefs.gracePeriodMinutes || 15}
                onChange={(e) => updatePref('gracePeriodMinutes', parseInt(e.target.value, 10))}
                className="w-full p-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-lg font-semibold text-[var(--color-nexus-ink)]"
              />
            </div>

            <div>
              <label className="font-bold text-[var(--color-nexus-ink)] block mb-1.5">Half-Day Threshold (Hours)</label>
              <input
                type="number"
                value={prefs.halfDayHours || 4}
                onChange={(e) => updatePref('halfDayHours', parseFloat(e.target.value))}
                className="w-full p-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-lg font-semibold text-[var(--color-nexus-ink)]"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-[var(--color-nexus-border)] flex items-center justify-between">
            <div>
              <span className="font-bold text-[var(--color-nexus-ink)] block">Allow Flexible Shift Check-In</span>
              <span className="text-[11px] text-[var(--color-nexus-muted)]">Employees can check in without rigid shift start adherence</span>
            </div>
            <input
              type="checkbox"
              checked={!!prefs.allowFlexibleShifts}
              onChange={(e) => updatePref('allowFlexibleShifts', e.target.checked)}
              className="w-4 h-4 rounded text-blue-600"
            />
          </div>
        </div>
      ),
    },
    {
      id: 'verification',
      title: 'Verification & Security Enforcements',
      subtitle: 'Biometric face matching, Liveness detection, GPS geofencing, Wi-Fi locks',
      icon: Shield,
      badge: 'Security',
      content: (
        <div className="space-y-5 text-xs">
          <div>
            <label className="font-bold text-[var(--color-nexus-ink)] block mb-2.5">Enabled Clock-in Methods</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {methods.map((m) => {
                const isEnabled = (prefs.enabledMethods || []).includes(m.key);
                const IconComp = METHOD_ICONS[m.icon] || CircleDot;
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => toggleMethod(m.key)}
                    className={`p-3 rounded-lg border text-left flex items-center gap-2.5 transition-all cursor-pointer ${
                      isEnabled
                        ? 'bg-blue-50 border-blue-300 text-blue-800 font-bold'
                        : 'bg-[var(--color-nexus-surface-alt)] border-[var(--color-nexus-border)] text-[var(--color-nexus-muted)]'
                    }`}
                  >
                    <IconComp size={16} />
                    <span className="truncate">{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-[var(--color-nexus-border)]">
            <label className="flex items-center justify-between p-3.5 rounded-lg bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] cursor-pointer">
              <div>
                <span className="font-bold text-[var(--color-nexus-ink)] block">Require Facial Recognition</span>
                <span className="text-[10.5px] text-[var(--color-nexus-muted)]">Match employee face embedding at check-in</span>
              </div>
              <input
                type="checkbox"
                checked={!!prefs.requireFaceMatch}
                onChange={(e) => updatePref('requireFaceMatch', e.target.checked)}
                className="w-4 h-4 rounded text-blue-600"
              />
            </label>

            <label className="flex items-center justify-between p-3.5 rounded-lg bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] cursor-pointer">
              <div>
                <span className="font-bold text-[var(--color-nexus-ink)] block">Liveness Active Detection</span>
                <span className="text-[10.5px] text-[var(--color-nexus-muted)]">Prevent photo/screen spoofing attempts</span>
              </div>
              <input
                type="checkbox"
                checked={!!prefs.requireLivenessDetection}
                onChange={(e) => updatePref('requireLivenessDetection', e.target.checked)}
                className="w-4 h-4 rounded text-blue-600"
              />
            </label>

            <label className="flex items-center justify-between p-3.5 rounded-lg bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] cursor-pointer">
              <div>
                <span className="font-bold text-[var(--color-nexus-ink)] block">Require GPS Geofence</span>
                <span className="text-[10.5px] text-[var(--color-nexus-muted)]">Verify location inside branch radius</span>
              </div>
              <input
                type="checkbox"
                checked={!!prefs.requireGps}
                onChange={(e) => updatePref('requireGps', e.target.checked)}
                className="w-4 h-4 rounded text-blue-600"
              />
            </label>

            <label className="flex items-center justify-between p-3.5 rounded-lg bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] cursor-pointer">
              <div>
                <span className="font-bold text-[var(--color-nexus-ink)] block">Require Office Wi-Fi</span>
                <span className="text-[10.5px] text-[var(--color-nexus-muted)]">Verify BSSID/IP matching designated office network</span>
              </div>
              <input
                type="checkbox"
                checked={!!prefs.requireOfficeWifi}
                onChange={(e) => updatePref('requireOfficeWifi', e.target.checked)}
                className="w-4 h-4 rounded text-blue-600"
              />
            </label>
          </div>
        </div>
      ),
    },
    {
      id: 'presence',
      title: 'Presence Engine & Auto Checkout',
      subtitle: 'Multi-signal heartbeat pulse, inactivity cutoff, background synchronization',
      icon: Activity,
      badge: 'Automation',
      content: (
        <div className="space-y-5 text-xs">
          <div className="flex items-center justify-between p-3.5 rounded-lg bg-blue-50/50 border border-blue-200">
            <div>
              <span className="font-bold text-blue-950 block">Enable Multi-Signal Presence Engine</span>
              <span className="text-[11px] text-blue-800">Continuously verifies presence via web & mobile telemetry</span>
            </div>
            <input
              type="checkbox"
              checked={!!prefs.presenceEngineEnabled}
              onChange={(e) => updatePref('presenceEngineEnabled', e.target.checked)}
              className="w-4 h-4 rounded text-blue-600"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="font-bold text-[var(--color-nexus-ink)] block mb-1.5">Heartbeat Pulse Interval (Minutes)</label>
              <input
                type="number"
                value={prefs.heartbeatIntervalMinutes || 15}
                onChange={(e) => updatePref('heartbeatIntervalMinutes', parseInt(e.target.value, 10))}
                className="w-full p-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-lg font-semibold text-[var(--color-nexus-ink)]"
              />
            </div>

            <div>
              <label className="font-bold text-[var(--color-nexus-ink)] block mb-1.5">Auto Checkout Threshold (Hours)</label>
              <input
                type="number"
                value={prefs.autoCheckoutHours || 12}
                onChange={(e) => updatePref('autoCheckoutHours', parseFloat(e.target.value))}
                className="w-full p-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-lg font-semibold text-[var(--color-nexus-ink)]"
              />
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'mobile',
      title: 'Mobile Policy & Device Locking',
      subtitle: 'Mobile camera enforcement, offline check-in caching, location precision',
      icon: Smartphone,
      badge: 'Mobile',
      content: (
        <div className="space-y-4 text-xs">
          <label className="flex items-center justify-between p-3.5 rounded-lg bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] cursor-pointer">
            <div>
              <span className="font-bold text-[var(--color-nexus-ink)] block">Lock Employee to Registered Device</span>
              <span className="text-[10.5px] text-[var(--color-nexus-muted)]">Prevent clocking in from unauthorized secondary phones</span>
            </div>
            <input
              type="checkbox"
              checked={!!prefs.requireDeviceVerification}
              onChange={(e) => updatePref('requireDeviceVerification', e.target.checked)}
              className="w-4 h-4 rounded text-blue-600"
            />
          </label>

          <label className="flex items-center justify-between p-3.5 rounded-lg bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] cursor-pointer">
            <div>
              <span className="font-bold text-[var(--color-nexus-ink)] block">Allow Offline Check-In Caching</span>
              <span className="text-[10.5px] text-[var(--color-nexus-muted)]">Store encrypted check-ins locally when internet drops</span>
            </div>
            <input
              type="checkbox"
              checked={!!prefs.allowOfflineCaching}
              onChange={(e) => updatePref('allowOfflineCaching', e.target.checked)}
              className="w-4 h-4 rounded text-blue-600"
            />
          </label>
        </div>
      ),
    },
  ];

  // Live Flow Preview Panel
  const previewPanel = (
    <div className="space-y-3 text-xs">
      <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center gap-2">
        <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
        <div>
          <span className="font-bold block">1. Employee initiates check-in</span>
          <span className="text-[10.5px]">App captures timestamp & device UUID</span>
        </div>
      </div>

      {prefs.requireGps && (
        <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 flex items-center gap-2">
          <MapPin size={16} className="text-blue-600 shrink-0" />
          <div>
            <span className="font-bold block">2. Geofence radius check</span>
            <span className="text-[10.5px]">Validates GPS coords vs branch location</span>
          </div>
        </div>
      )}

      {prefs.requireFaceMatch && (
        <div className="p-3 rounded-lg bg-purple-50 border border-purple-200 text-purple-800 flex items-center gap-2">
          <ScanFace size={16} className="text-purple-600 shrink-0" />
          <div>
            <span className="font-bold block">3. Biometric face verification</span>
            <span className="text-[10.5px]">
              {prefs.requireLivenessDetection ? 'Face match + Liveness active probe' : 'Standard 128D embedding match'}
            </span>
          </div>
        </div>
      )}

      <div className="p-3 rounded-lg bg-slate-900 text-white flex items-center gap-2">
        <Shield size={16} className="text-blue-400 shrink-0" />
        <div>
          <span className="font-bold block text-white">4. Attendance Logged & Signed</span>
          <span className="text-[10.5px] text-slate-300">HMAC signature appended to ledger</span>
        </div>
      </div>
    </div>
  );

  // Policy Audit Log Panel
  const auditPanel = (
    <div className="space-y-2 text-xs max-h-60 overflow-y-auto">
      {historyLoading ? (
        <div className="text-slate-400 text-center py-4 font-mono">Loading history...</div>
      ) : history.length === 0 ? (
        <div className="text-slate-400 text-center py-4">No policy changes logged yet.</div>
      ) : (
        history.slice(0, 5).map((h) => (
          <div key={h.id} className="p-2 rounded bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)]">
            <div className="flex items-center justify-between font-bold text-[var(--color-nexus-ink)]">
              <span>{h.fieldLabel || h.fieldName}</span>
              <span className="text-[9.5px] text-[var(--color-nexus-muted)] font-mono">
                {new Date(h.createdAt).toLocaleDateString()}
              </span>
            </div>
            <div className="text-[10.5px] text-[var(--color-nexus-muted)] mt-0.5">
              Changed by <strong>{h.changedByName}</strong>
            </div>
          </div>
        ))
      )}
    </div>
  );

  const primaryActions = (
    <button
      type="button"
      onClick={handleReset}
      className="px-3 py-1.5 rounded-[var(--radius-nexus-control)] border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] hover:bg-[var(--color-nexus-surface-alt)] text-xs font-semibold text-[var(--color-nexus-ink)] transition-colors flex items-center gap-1.5"
    >
      <RotateCcw size={13} /> Restore Defaults
    </button>
  );

  return (
    <AdminWorkspaceLayout user={user} onLogout={onLogout}>
      {error && <div className="p-3 mb-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">{error}</div>}
      {success && <div className="p-3 mb-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">{success}</div>}

      <ConfigurationTemplate
        title="Attendance Policy & Verification Workspace"
        subtitle="Configure workforce attendance rules, biometric facial matching, geofences, and presence engine automation."
        badge="Attendance Engine"
        healthMetrics={healthMetrics}
        sections={configSections}
        previewPanel={previewPanel}
        auditPanel={auditPanel}
        onSave={handleSave}
        saving={saving}
        hasUnsavedChanges={hasChanges}
        primaryActions={primaryActions}
      />
    </AdminWorkspaceLayout>
  );
}
