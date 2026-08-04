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

// ═══════════════════════════════════════════════════════════════════════
// Smart Teams EMS — Enterprise Attendance Preferences & Policy Engine
// Fully restored master administration console with ALL settings & options.
// ═══════════════════════════════════════════════════════════════════════

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

const WORKFLOW_GROUPS = [
  { id: 'policy', title: 'Attendance Policy', description: 'Sessions, shift rules, and grace periods', icon: Clock },
  { id: 'verification', title: 'Verification & Security', description: 'Biometric, GPS, Wi-Fi, and Liveness rules', icon: Shield },
  { id: 'work_rules', title: 'Work Rules & Breaks', description: 'Break policies, categories, and overtime', icon: Coffee },
  { id: 'experience', title: 'Employee Experience', description: 'Dashboard timers, notes, and portal controls', icon: Eye },
  { id: 'mobile', title: 'Mobile & Device Settings', description: 'Camera, offline sync, and location tracking', icon: Smartphone },
  { id: 'automation', title: 'Automation & Presence', description: 'Multi-signal presence engine & auto checkout', icon: Activity },
  { id: 'audit', title: 'Audit & History', description: 'Policy versions and field-level change log', icon: History },
] as const;

type WorkflowId = typeof WORKFLOW_GROUPS[number]['id'];

export default function AttendancePreferencesPage({ user, onLogout }: { user: User; onLogout?: () => void }) {
  const navigate = useNavigate();
  const token = localStorage.getItem('auth_token');

  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowId>('policy');
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

  const [openAccordions, setOpenAccordions] = useState<Record<string, boolean>>({
    sessions: true, shifts: true, methods: true, verification: true,
    breaks: true, overtime: true, presence: true, experience: true, mobile: true,
  });

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

  const toggleAccordion = (id: string) => {
    setOpenAccordions((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const fieldError = (field: string) => validationErrors.find((e) => e.field === field)?.message;
  const enabledMethodsCount = Array.isArray(prefs.enabledMethods) ? prefs.enabledMethods.length : 0;
  const activeVerificationsCount = [
    prefs.requireFaceMatch, prefs.requireLivenessDetection, prefs.requireGps,
    prefs.requireOfficeWifi, prefs.requireGeoFence, prefs.requireDeviceVerification
  ].filter(Boolean).length;

  const StatusBadge = ({ active, label }: { active: boolean; label?: string }) => (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
      active ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20' : 'bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)] border border-[var(--color-nexus-border)]'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`} />
      {label || (active ? 'Active' : 'Disabled')}
    </span>
  );

  const VisualRadioGroup = ({
    field, label, description, options
  }: {
    field: string; label: string; description?: string; options: Array<{ value: any; label: string; sub?: string }>
  }) => (
    <div className={`p-3 rounded-xl border transition-colors ${fieldError(field) ? 'border-red-400 bg-red-50/50' : 'border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)]'}`}>
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="text-xs font-bold text-[var(--color-nexus-ink)]">{label}</span>
        {description && <Info size={12} className="text-[var(--color-nexus-muted)]" />}
      </div>
      {description && <p className="text-[11px] text-[var(--color-nexus-muted)] mb-2">{description}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {options.map((opt) => {
          const selected = prefs[field] === opt.value;
          return (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => updatePref(field, opt.value)}
              className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                selected
                  ? 'border-[var(--color-nexus-primary)] bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] font-bold'
                  : 'border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] hover:border-[var(--color-nexus-primary)]/40 text-[var(--color-nexus-ink)]'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs">{opt.label}</span>
                {selected && <CheckCircle2 size={13} className="text-[var(--color-nexus-primary)] shrink-0" />}
              </div>
              {opt.sub && <span className="text-[9px] text-[var(--color-nexus-muted)] mt-0.5 block">{opt.sub}</span>}
            </button>
          );
        })}
      </div>
      {fieldError(field) && <p className="text-[10px] text-red-600 mt-1">{fieldError(field)}</p>}
    </div>
  );

  const VisualToggle = ({ field, label, description, example }: { field: string; label: string; description: string; example?: string }) => {
    const active = !!prefs[field];
    return (
      <div className="p-3 rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-[var(--color-nexus-ink)]">{label}</span>
            <StatusBadge active={active} />
          </div>
          <p className="text-[11px] text-[var(--color-nexus-muted)] leading-normal">{description}</p>
          {example && <div className="mt-1 text-[10px] font-mono text-[var(--color-nexus-secondary)]">💡 {example}</div>}
        </div>
        <button
          type="button"
          onClick={() => updatePref(field, !active)}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
            active ? 'bg-[var(--color-nexus-primary)]' : 'bg-gray-300'
          }`}
        >
          <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
            active ? 'translate-x-4' : 'translate-x-0'
          }`} />
        </button>
      </div>
    );
  };

  const NumberInput = ({ field, label, description, min, max, placeholder }: { field: string; label: string; description?: string; min?: number; max?: number; placeholder?: string }) => (
    <div className={`p-3 rounded-xl border transition-colors ${fieldError(field) ? 'border-red-400 bg-red-50/50' : 'border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)]'}`}>
      <label className="block text-xs font-bold text-[var(--color-nexus-ink)] mb-1">{label}</label>
      {description && <p className="text-[11px] text-[var(--color-nexus-muted)] mb-2">{description}</p>}
      <input
        type="number"
        min={min}
        max={max}
        value={prefs[field] ?? ''}
        onChange={(e) => updatePref(field, e.target.value === '' ? null : Number(e.target.value))}
        placeholder={placeholder}
        className="w-full px-3 py-1.5 rounded-lg border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] text-xs text-[var(--color-nexus-ink)] font-mono focus:outline-none focus:border-[var(--color-nexus-primary)]"
      />
      {fieldError(field) && <p className="text-[10px] text-red-600 mt-1">{fieldError(field)}</p>}
    </div>
  );

  const AccordionSection = ({ id, title, badge, children }: { id: string; title: string; badge?: string; children: React.ReactNode }) => {
    const isOpen = openAccordions[id] !== false;
    return (
      <div className="rounded-xl border border-[var(--color-nexus-border)] overflow-hidden bg-[var(--color-nexus-surface)] shadow-xs">
        <button
          type="button"
          onClick={() => toggleAccordion(id)}
          className="w-full px-4 py-3 bg-[var(--color-nexus-surface)] hover:bg-[var(--color-nexus-surface-alt)]/50 flex items-center justify-between text-left transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-bold text-[var(--color-nexus-ink)]">{title}</h3>
            {badge && <span className="px-2 py-0.5 rounded bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] text-[9px] font-bold uppercase">{badge}</span>}
          </div>
          <ChevronDown size={16} className={`text-[var(--color-nexus-muted)] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        {isOpen && <div className="p-4 border-t border-[var(--color-nexus-border)] space-y-3">{children}</div>}
      </div>
    );
  };

  if (loading) {
    return (
      <AdminWorkspaceLayout user={user} onLogout={onLogout}>
        <div className="p-8 text-center text-xs font-mono text-[var(--color-nexus-muted)]">Loading preferences...</div>
      </AdminWorkspaceLayout>
    );
  }

  return (
    <AdminWorkspaceLayout user={user} onLogout={onLogout}>
      <div className="space-y-4 pb-20">
        {/* ── Compact Sticky Action & Status Bar ── */}
        <div className="p-3 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl flex flex-wrap items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3 text-xs">
            <span className="font-bold text-[var(--color-nexus-ink)] flex items-center gap-1.5">
              <Clock size={14} className="text-[var(--color-nexus-primary)]" /> Attendance Preferences
            </span>
            <span className="px-2 py-0.5 rounded bg-[var(--color-nexus-primary)] text-white text-[10px] font-mono font-bold">Policy v2.3</span>
            <span className="text-[11px] text-[var(--color-nexus-muted)] hidden sm:inline">Applied to: <strong>All Employees</strong></span>
          </div>

          <div className="flex items-center gap-2">
            {hasChanges && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500 text-white animate-pulse">Unsaved Changes</span>}
            <button
              type="button"
              onClick={handleReset}
              disabled={saving}
              className="px-3 py-1.5 text-xs font-semibold text-[var(--color-nexus-secondary)] hover:bg-[var(--color-nexus-surface-alt)] rounded-lg transition-colors cursor-pointer"
            >
              Restore Defaults
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !hasChanges}
              className="px-4 py-1.5 text-xs font-bold text-white bg-[var(--color-nexus-primary)] hover:opacity-90 disabled:opacity-40 rounded-lg shadow-xs flex items-center gap-1.5 cursor-pointer"
            >
              <Save size={13} /> {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>

        {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">{error}</div>}
        {success && <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">{success}</div>}

        {/* ── Compact 3-Column Layout ── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Sub Navigation */}
          <div className="lg:col-span-3 space-y-1">
            {WORKFLOW_GROUPS.map((group) => {
              const Icon = group.icon;
              const active = activeWorkflow === group.id;
              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => setActiveWorkflow(group.id)}
                  className={`w-full p-2.5 rounded-xl border text-left transition-all flex items-center justify-between cursor-pointer ${
                    active
                      ? 'border-[var(--color-nexus-primary)] bg-[var(--color-nexus-surface)] shadow-xs text-[var(--color-nexus-ink)] font-bold'
                      : 'border-transparent hover:bg-[var(--color-nexus-surface)] text-[var(--color-nexus-muted)]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon size={16} className={active ? 'text-[var(--color-nexus-primary)]' : 'text-[var(--color-nexus-muted)]'} />
                    <span className="text-xs truncate">{group.title}</span>
                  </div>
                  {active && <span className="w-1.5 h-4 rounded-full bg-[var(--color-nexus-primary)]" />}
                </button>
              );
            })}
          </div>

          {/* Workflow Content */}
          <div className="lg:col-span-6 space-y-4">
            {activeWorkflow === 'policy' && (
              <div className="space-y-4">
                <AccordionSection id="sessions" title="Multiple Attendance Sessions" badge={prefs.allowMultipleSessions ? 'Enabled' : 'Single Session'}>
                  <VisualToggle
                    field="allowMultipleSessions"
                    label="Allow Multiple Sessions Per Day"
                    description="Permits employees to check in multiple times per day (split shifts)."
                    example="09:00→13:00, 17:00→21:00"
                  />

                  {prefs.allowMultipleSessions && (
                    <>
                      <VisualRadioGroup
                        field="maxSessionsPerDay"
                        label="Maximum Sessions Per Day"
                        options={[
                          { value: 1, label: 'Single (1)' },
                          { value: 2, label: '2 Sessions' },
                          { value: 3, label: '3 Sessions' },
                          { value: 0, label: 'Unlimited' },
                        ]}
                      />

                      <VisualRadioGroup
                        field="minGapBetweenSessionsMins"
                        label="Minimum Rest Gap"
                        options={[
                          { value: 0, label: 'No Gap' },
                          { value: 15, label: '15 mins' },
                          { value: 30, label: '30 mins' },
                          { value: 60, label: '1 hour' },
                        ]}
                      />

                      <VisualToggle
                        field="requireCheckoutBeforeNewCheckin"
                        label="Require Checkout Before New Check-in"
                        description="Prevents starting a new session while an existing attendance session is open."
                      />

                      <VisualToggle
                        field="autoCloseOpenSessions"
                        label="Automatically Close Open Sessions at End of Day"
                        description="System automatically closes open sessions at shift end boundary."
                      />
                    </>
                  )}
                </AccordionSection>

                <AccordionSection id="shifts" title="Shift & Duration Rules" badge={`${prefs.maxSessionDurationHours || 14}h Cap`}>
                  <VisualRadioGroup
                    field="maxSessionDurationHours"
                    label="Maximum Session Duration (Hours)"
                    options={[
                      { value: 0, label: 'No Limit' },
                      { value: 12, label: '12 Hours' },
                      { value: 14, label: '14 Hours' },
                      { value: 16, label: '16 Hours' },
                    ]}
                  />

                  <VisualToggle field="allowEarlyCheckin" label="Allow Early Check-in" description="Permits checking in prior to shift start." />
                  {prefs.allowEarlyCheckin && (
                    <NumberInput field="earlyCheckinBufferMins" label="Early Check-in Buffer (minutes)" description="Allowed arrival buffer before shift." min={0} max={120} />
                  )}

                  <VisualToggle field="allowLateCheckout" label="Allow Late Checkout" description="Permits staying checked in past shift end." />
                  {prefs.allowLateCheckout && (
                    <NumberInput field="maxOvertimeMins" label="Maximum Overtime Cap (minutes)" description="Leave blank for unlimited." placeholder="Unlimited" min={0} />
                  )}

                  <VisualToggle field="allowCrossMidnightSessions" label="Allow Cross-Midnight Sessions" description="Supports night shifts spanning past 12:00 AM." />
                  <VisualToggle field="autoSplitAtMidnight" label="Automatically Split Sessions at Midnight" description="Splits attendance logs at 12:00 AM." />
                </AccordionSection>
              </div>
            )}

            {activeWorkflow === 'verification' && (
              <div className="space-y-4">
                <AccordionSection id="methods" title="Attendance Methods Catalog" badge={`${enabledMethodsCount} Active`}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {methods.map((m) => {
                      const enabled = Array.isArray(prefs.enabledMethods) && prefs.enabledMethods.includes(m.key);
                      const IconComp = METHOD_ICONS[m.icon] || ScanFace;
                      return (
                        <div
                          key={m.key}
                          onClick={() => toggleMethod(m.key)}
                          className={`p-3 rounded-lg border transition-all cursor-pointer flex items-center justify-between ${
                            enabled ? 'border-[var(--color-nexus-primary)] bg-[var(--color-nexus-surface)]' : 'border-[var(--color-nexus-border)] opacity-60'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <IconComp size={15} className={enabled ? 'text-[var(--color-nexus-primary)]' : 'text-gray-400'} />
                            <span className="text-xs font-bold">{m.label}</span>
                          </div>
                          <StatusBadge active={enabled} />
                        </div>
                      );
                    })}
                  </div>

                  <div className="pt-2">
                    <label className="block text-xs font-bold text-[var(--color-nexus-ink)] mb-1">Default Attendance Method</label>
                    <select
                      value={prefs.defaultMethod || 'face_recognition'}
                      onChange={(e) => updatePref('defaultMethod', e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] text-xs text-[var(--color-nexus-ink)]"
                    >
                      {methods.map((m) => (
                        <option key={m.key} value={m.key}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                </AccordionSection>

                <AccordionSection id="verification" title="Security & Verification Controls" badge={`${activeVerificationsCount} Active Checks`}>
                  <VisualToggle field="requireFaceMatch" label="Require Face Match" description="Verifies face against enrolled photo." />
                  <VisualToggle field="requireLivenessDetection" label="Require Liveness Detection" description="Prevents photo/video spoofing." />
                  <VisualToggle field="requireGps" label="Require GPS Proximity" description="Captures and verifies location." />
                  <VisualToggle field="requireOfficeWifi" label="Require Corporate Wi-Fi" description="Must connect to corporate network." />
                  <VisualToggle field="requireGeoFence" label="Require Geo-Fence Radius" description="Must be within registered office geofence." />
                  <VisualToggle field="requireDeviceVerification" label="Require Device Trust (WebAuthn)" description="Only registered hardware devices can mark attendance." />
                  <VisualToggle field="enableFaceEvaluation" label="Enable Face Signal in Presence Engine" description="Feeds face freshness scores to presence engine." />
                  <VisualToggle field="enableGpsEvaluation" label="Enable GPS Signal in Presence Engine" description="Feeds GPS location to presence engine." />
                  <VisualToggle field="enableWifiEvaluation" label="Enable Wi-Fi Signal in Presence Engine" description="Feeds Wi-Fi connectivity to presence engine." />
                </AccordionSection>
              </div>
            )}

            {activeWorkflow === 'work_rules' && (
              <div className="space-y-4">
                <AccordionSection id="breaks" title="Break Management Policies" badge={prefs.enableBreaks ? 'Enabled' : 'No Breaks'}>
                  <VisualToggle field="enableBreaks" label="Enable Break Management" description="Tracks breaks during shifts." />
                  {prefs.enableBreaks && (
                    <>
                      <VisualToggle field="allowMultipleBreaks" label="Allow Multiple Breaks" description="Permits taking multiple breaks per session." />
                      <VisualToggle field="allowBreakTracking" label="Track Break Duration & Budget" description="Monitors break duration against allowed budget." />
                      <VisualRadioGroup
                        field="maxBreaks"
                        label="Maximum Breaks Per Session"
                        options={[
                          { value: 1, label: '1 Break' },
                          { value: 2, label: '2 Breaks' },
                          { value: 3, label: '3 Breaks' },
                          { value: null, label: 'Unlimited' },
                        ]}
                      />
                      <div className="p-3 rounded-lg border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] space-y-2">
                        <span className="text-xs font-bold block">Authorized Break Categories</span>
                        <div className="flex flex-wrap gap-1.5">
                          {(Array.isArray(prefs.breakCategories) ? prefs.breakCategories : []).map((cat: string) => (
                            <span key={cat} className="px-2.5 py-1 rounded bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] text-xs font-bold flex items-center gap-1">
                              {cat}
                              <button type="button" onClick={() => updatePref('breakCategories', prefs.breakCategories.filter((c: string) => c !== cat))} className="hover:text-red-600">&times;</button>
                            </span>
                          ))}
                        </div>
                        <div className="flex gap-2 pt-1">
                          <input
                            type="text"
                            value={newBreakCategoryInput}
                            onChange={(e) => setNewBreakCategoryInput(e.target.value)}
                            placeholder="Add category..."
                            className="flex-1 px-2.5 py-1.5 rounded border text-xs bg-[var(--color-nexus-surface)]"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const trimmed = newBreakCategoryInput.trim();
                              if (trimmed && !prefs.breakCategories.includes(trimmed)) {
                                updatePref('breakCategories', [...prefs.breakCategories, trimmed]);
                                setNewBreakCategoryInput('');
                              }
                            }}
                            className="px-3 py-1.5 rounded bg-[var(--color-nexus-primary)] text-white text-xs font-bold"
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </AccordionSection>

                <AccordionSection id="overtime" title="Overtime Rules" badge="Shift Boundary">
                  <VisualRadioGroup
                    field="overtimeThresholdMins"
                    label="Overtime Start Buffer"
                    description="Minutes past shift end required before entering Overtime."
                    options={[
                      { value: 0, label: 'Immediate (0m)' },
                      { value: 15, label: '15 mins' },
                      { value: 30, label: '30 mins' },
                      { value: 60, label: '1 hour' },
                    ]}
                  />
                </AccordionSection>
              </div>
            )}

            {activeWorkflow === 'experience' && (
              <div className="space-y-4">
                <AccordionSection id="experience" title="Employee Portal & Dashboard Controls">
                  <VisualToggle field="showRunningTimer" label="Show Running Count-Up Timer" description="Live count-up timer ticker during active shift." />
                  <VisualToggle field="showWorkingHoursLive" label="Show Live Working Hours" description="Calculates live working hours on dashboard." />
                  <VisualToggle field="showAttendanceTimeline" label="Show Attendance Timeline" description="Renders visual attendance event timeline." />
                  <VisualToggle field="allowAttendanceRegularization" label="Allow Attendance Regularization" description="Lets employees request attendance correction." />
                  <VisualToggle field="allowEmployeeNotes" label="Allow Check-in Notes" description="Permits adding reason notes during check-in." />
                  <VisualToggle field="allowManualCheckout" label="Allow Manual Checkout" description="Provides manual checkout button to employee." />
                  <VisualToggle field="requireCheckoutReason" label="Require Checkout Reason" description="Requires employees to enter a reason when checking out." />
                </AccordionSection>
              </div>
            )}

            {activeWorkflow === 'mobile' && (
              <div className="space-y-4">
                <AccordionSection id="mobile" title="Mobile App & Hardware Settings">
                  <VisualToggle field="useCameraForFace" label="Use Front Camera for Face Match" description="Defaults to front-facing camera." />
                  <VisualToggle field="requireRearCamera" label="Require Rear Camera for Site Verification" description="Forces rear camera for location/site verification photos." />
                  <VisualToggle field="allowOfflineAttendance" label="Allow Offline Check-in Queuing" description="Queues check-ins when offline and syncs when reconnected." />
                  <VisualToggle field="offlineSync" label="Enable Background Offline Auto-Sync" description="Syncs queued offline attendance automatically in background." />
                  <VisualToggle field="backgroundGps" label="Continuous Background GPS Verification" description="Verifies location during shift via background service." />
                </AccordionSection>
              </div>
            )}

            {activeWorkflow === 'automation' && (
              <div className="space-y-4">
                <AccordionSection id="presence" title="Multi-Signal Presence Engine" badge={prefs.presenceEngineEnabled ? 'Active' : 'Disabled'}>
                  <VisualToggle field="presenceEngineEnabled" label="Enable Presence Detection Engine" description="Replaces fixed midnight checkout with multi-signal scoring." />
                  {prefs.presenceEngineEnabled && (
                    <>
                      <VisualRadioGroup
                        field="presenceGracePeriodMins"
                        label="Shift End Grace Period"
                        options={[
                          { value: 15, label: '15 mins' },
                          { value: 30, label: '30 mins' },
                          { value: 45, label: '45 mins' },
                          { value: 60, label: '60 mins' },
                        ]}
                      />
                      <VisualRadioGroup
                        field="autoCheckoutDelayMins"
                        label="Pre-Checkout Warning Countdown"
                        options={[
                          { value: 5, label: '5 mins' },
                          { value: 10, label: '10 mins' },
                          { value: 15, label: '15 mins' },
                          { value: 30, label: '30 mins' },
                        ]}
                      />
                      <VisualRadioGroup
                        field="autoCheckoutConfidenceThreshold"
                        label="Confidence Threshold (%)"
                        options={[
                          { value: 20, label: '20%' },
                          { value: 30, label: '30%' },
                          { value: 40, label: '40%' },
                          { value: 50, label: '50%' },
                        ]}
                      />
                      <VisualToggle field="enableBrowserHeartbeat" label="Enable Client Heartbeat" description="Periodic in-app heartbeat worker." />
                      <VisualToggle field="enableBrowserActivityTracking" label="Track In-App EMS Interactions" description="Monitors user activity strictly within EMS application." />
                      <VisualToggle field="ignoreGpsDuringBreak" label="Ignore GPS Exits During Approved Break" description="Prevents false auto-checkouts when leaving office on break." />
                    </>
                  )}
                </AccordionSection>
              </div>
            )}

            {activeWorkflow === 'audit' && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] space-y-3">
                  <h3 className="text-xs font-bold text-[var(--color-nexus-ink)]">Policy Change Log</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono">
                      <thead>
                        <tr className="border-b border-[var(--color-nexus-border)] text-[var(--color-nexus-muted)]">
                          <th className="py-1.5 px-2">Date</th>
                          <th className="py-1.5 px-2">Field</th>
                          <th className="py-1.5 px-2">Old Value</th>
                          <th className="py-1.5 px-2">New Value</th>
                          <th className="py-1.5 px-2">Changed By</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--color-nexus-border)]">
                        {history.map((h) => (
                          <tr key={h.id}>
                            <td className="py-2 px-2">{new Date(h.createdAt).toLocaleDateString()}</td>
                            <td className="py-2 px-2 font-bold">{h.fieldName}</td>
                            <td className="py-2 px-2 text-red-500">{h.oldValue || '—'}</td>
                            <td className="py-2 px-2 text-emerald-600 font-bold">{h.newValue || '—'}</td>
                            <td className="py-2 px-2">{h.changedByName}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Contextual Guidance */}
          <div className="lg:col-span-3 space-y-3">
            <div className="p-4 rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] space-y-2">
              <div className="flex items-center gap-1.5 text-[var(--color-nexus-primary)] font-bold text-xs">
                <HelpCircle size={15} /> Policy Help
              </div>
              <p className="text-xs text-[var(--color-nexus-secondary)] leading-relaxed">
                Changes saved here instantly reflect across employee mobile and web interfaces.
              </p>
            </div>
          </div>
        </div>
      </div>
    </AdminWorkspaceLayout>
  );
}
