import { useState, useEffect, lazy, Suspense } from 'react';
import { X } from 'lucide-react';
import TimeSelect from './TimeSelect';

interface PlaceSuggestion {
  lat: number;
  lng: number;
  displayName: string;
}

// Lazy so Leaflet is code-split out of the main bundle.
const LocationPicker = lazy(() => import('./LocationPicker'));

export interface BranchFormValue {
  id?: number;
  name: string;
  address: string;
  locationLat: number | null;
  locationLng: number | null;
  locationRadiusMeters: number;
  gracePeriodMins: number;
  halfDayMins: number;
  dailyBreakBudgetMins: number;
  minAttendancePercent: number;
  wifiSsid: string;
  officeIp: string;
  wifiCheckEnabled: boolean;
  qrEnabled: boolean;
  // Empty string = inherit the tenant's Attendance Policy default (see
  // apps/admin/api/services/attendancePolicy.ts) — only set these when this
  // branch genuinely needs to diverge from the org-wide setting.
  arrivalPolicy: '' | 'strict' | 'buffered' | 'flexible';
  workingHoursPolicy: '' | 'fixed_shift_end' | 'complete_required_hours' | 'hybrid';
  requiredWorkingMins: string;
  hybridMaxCheckoutTime: string;
}

const EMPTY: BranchFormValue = {
  name: '',
  address: '',
  locationLat: null,
  locationLng: null,
  locationRadiusMeters: 100,
  gracePeriodMins: 15,
  halfDayMins: 240,
  dailyBreakBudgetMins: 60,
  minAttendancePercent: 75,
  wifiSsid: '',
  officeIp: '',
  wifiCheckEnabled: false,
  qrEnabled: false,
  arrivalPolicy: '',
  workingHoursPolicy: '',
  requiredWorkingMins: '',
  hybridMaxCheckoutTime: '',
};

export function branchToFormValue(b: any): BranchFormValue {
  return {
    id: b.id,
    name: b.name || '',
    address: b.address || '',
    locationLat: b.locationLat ?? null,
    locationLng: b.locationLng ?? null,
    locationRadiusMeters: b.locationRadiusMeters ?? 100,
    gracePeriodMins: b.gracePeriodMins ?? 15,
    halfDayMins: b.halfDayMins ?? 240,
    dailyBreakBudgetMins: b.dailyBreakBudgetMins ?? 60,
    minAttendancePercent: b.minAttendancePercent ?? 75,
    wifiSsid: b.wifiSsid || '',
    officeIp: b.officeIp || '',
    wifiCheckEnabled: !!b.wifiCheckEnabled,
    qrEnabled: !!b.qrEnabled,
    arrivalPolicy: b.arrivalPolicy || '',
    workingHoursPolicy: b.workingHoursPolicy || '',
    requiredWorkingMins: b.requiredWorkingMins != null ? String(b.requiredWorkingMins) : '',
    hybridMaxCheckoutTime: b.hybridMaxCheckoutTime || '',
  };
}

export default function BranchFormModal({
  mode,
  initial,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: BranchFormValue;
  onClose: () => void;
  onSaved: (branch: any) => void;
}) {
  const token = localStorage.getItem('auth_token');
  const [value, setValue] = useState<BranchFormValue>(initial || EMPTY);
  const [geocoding, setGeocoding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Bumped whenever a location is set from search/suggestion pick, so the
  // (otherwise self-contained) map re-centers/zooms onto it — same signal
  // the "Use Current Location" button already sends internally.
  const [focusTrigger, setFocusTrigger] = useState(0);

  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);

  const update = (patch: Partial<BranchFormValue>) => setValue(prev => ({ ...prev, ...patch }));

  // Live autocomplete as the admin types — debounced so it doesn't fire a
  // Nominatim request on every keystroke.
  useEffect(() => {
    const query = value.address.trim();
    if (query.length < 3) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSuggestLoading(true);
      try {
        const res = await fetch(`/api/geocode/search?q=${encodeURIComponent(query)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!cancelled) setSuggestions(res.ok && Array.isArray(data.results) ? data.results : []);
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setSuggestLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.address]);

  const selectSuggestion = (s: PlaceSuggestion) => {
    update({ locationLat: s.lat, locationLng: s.lng, address: s.displayName });
    setSuggestions([]);
    setShowSuggestions(false);
    setFocusTrigger(n => n + 1);
  };

  const searchAddress = async () => {
    const query = value.address.trim();
    if (!query) return;
    setGeocoding(true);
    setError('');
    setShowSuggestions(false);
    try {
      const res = await fetch('/api/geocode/forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No matching location found');
      update({ locationLat: data.lat, locationLng: data.lng, address: data.displayName || query });
      setFocusTrigger(n => n + 1);
    } catch (err: any) {
      setError(err.message || 'Failed to search address');
    } finally {
      setGeocoding(false);
    }
  };

  const handleSave = async () => {
    if (!value.name.trim()) { setError('Branch name is required.'); return; }
    if (value.locationLat == null || value.locationLng == null) { setError('A location is required — search an address or pick it on the map.'); return; }
    setSaving(true);
    setError('');
    const payload = {
      name: value.name.trim(),
      address: value.address || null,
      locationLat: value.locationLat,
      locationLng: value.locationLng,
      locationRadiusMeters: value.locationRadiusMeters,
      gracePeriodMins: value.gracePeriodMins,
      halfDayMins: value.halfDayMins,
      dailyBreakBudgetMins: value.dailyBreakBudgetMins,
      minAttendancePercent: value.minAttendancePercent,
      wifiSsid: value.wifiSsid || null,
      officeIp: value.officeIp || null,
      wifiCheckEnabled: value.wifiCheckEnabled,
      qrEnabled: value.qrEnabled,
      arrivalPolicy: value.arrivalPolicy || null,
      workingHoursPolicy: value.workingHoursPolicy || null,
      requiredWorkingMins: value.requiredWorkingMins ? parseInt(value.requiredWorkingMins, 10) : null,
      hybridMaxCheckoutTime: value.hybridMaxCheckoutTime || null,
    };
    try {
      const url = mode === 'create' ? '/api/branches' : `/api/branches/${value.id}`;
      const res = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to ${mode === 'create' ? 'create' : 'update'} branch`);
      onSaved(data.branch);
    } catch (err: any) {
      setError(err.message || `Failed to ${mode === 'create' ? 'create' : 'update'} branch`);
    } finally {
      setSaving(false);
    }
  };

  const inputClasses = "w-full px-3 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-nexus-primary)]/20 focus:border-[var(--color-nexus-primary)] transition-all font-medium text-[var(--color-nexus-ink)]";
  const labelClasses = "block text-[11px] font-semibold text-[var(--color-nexus-muted)] mb-1 uppercase tracking-wider";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="max-w-2xl w-full max-h-[90vh] overflow-y-auto nexus-card rounded-3xl p-6 relative"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-sans text-xl font-bold text-[var(--color-nexus-ink)]">
            {mode === 'create' ? 'Add Branch' : `Edit ${initial?.name || 'Branch'}`}
          </h2>
          <button onClick={onClose} className="text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)] transition-colors">
            <X size={20} />
          </button>
        </div>

        {error && <div className="bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)] text-xs p-3 rounded-lg mb-4 border border-[var(--color-nexus-error)]/20 font-medium">{error}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          <div>
            <label className={labelClasses}>Branch Name</label>
            <input className={inputClasses} value={value.name} onChange={e => update({ name: e.target.value })} placeholder="e.g. Downtown Outlet" />
          </div>
          <div>
            <label className={labelClasses}>Radius (meters)</label>
            <input type="number" className={inputClasses} value={value.locationRadiusMeters} onChange={e => update({ locationRadiusMeters: parseInt(e.target.value, 10) || 0 })} />
          </div>
        </div>

        <div className="mb-4 relative">
          <label className={labelClasses}>Search Address</label>
          <div className="flex gap-2">
            <input
              className={inputClasses}
              value={value.address}
              onChange={e => { update({ address: e.target.value }); setShowSuggestions(true); }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); searchAddress(); } }}
              placeholder="e.g. JP Nagar, Bengaluru — type to search, or pick on the map below"
            />
            <button type="button" onClick={searchAddress} disabled={geocoding} className="px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider bg-[var(--color-nexus-primary)] text-white hover:bg-[var(--color-nexus-primary-hover)] transition-colors disabled:opacity-50 shrink-0">
              {geocoding ? 'Searching…' : 'Search'}
            </button>
          </div>
          {showSuggestions && (suggestions.length > 0 || suggestLoading) && (
            <div className="absolute z-10 left-0 right-[88px] mt-1 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-lg shadow-lg overflow-hidden">
              {suggestLoading && suggestions.length === 0 && (
                <div className="px-3 py-2 text-xs text-[var(--color-nexus-muted)]">Searching…</div>
              )}
              {suggestions.map((s, i) => (
                <button
                  type="button"
                  key={`${s.lat},${s.lng},${i}`}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => selectSuggestion(s)}
                  className="block w-full text-left px-3 py-2 text-xs text-[var(--color-nexus-ink)] hover:bg-[var(--color-nexus-surface-alt)] transition-colors border-b border-[var(--color-nexus-border)] last:border-b-0"
                >
                  {s.displayName}
                </button>
              ))}
            </div>
          )}
        </div>

        <Suspense fallback={<div className="h-[220px] flex items-center justify-center text-xs text-[var(--color-nexus-muted)]">Loading map…</div>}>
          <LocationPicker
            lat={value.locationLat}
            lng={value.locationLng}
            radius={value.locationRadiusMeters}
            onChange={(lat, lng) => update({ locationLat: lat, locationLng: lng })}
            height={220}
            focusTrigger={focusTrigger}
          />
        </Suspense>

        <div className="mb-4">
          <label className={labelClasses}>Attendance Policy Override (optional — leave as "Use organization default" to inherit)</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select className={inputClasses} value={value.arrivalPolicy} onChange={e => update({ arrivalPolicy: e.target.value as typeof value.arrivalPolicy })}>
              <option value="">Arrival Policy — Use organization default</option>
              <option value="strict">Strict</option>
              <option value="buffered">Buffered</option>
              <option value="flexible">Flexible</option>
            </select>
            <select className={inputClasses} value={value.workingHoursPolicy} onChange={e => update({ workingHoursPolicy: e.target.value as typeof value.workingHoursPolicy })}>
              <option value="">Working Hours Policy — Use organization default</option>
              <option value="fixed_shift_end">Fixed Shift End</option>
              <option value="complete_required_hours">Complete Required Hours</option>
              <option value="hybrid">Hybrid</option>
            </select>
            {(value.workingHoursPolicy === 'complete_required_hours' || value.workingHoursPolicy === 'hybrid') && (
              <input type="number" className={inputClasses} placeholder="Required Working Minutes (blank = org default)" value={value.requiredWorkingMins} onChange={e => update({ requiredWorkingMins: e.target.value })} />
            )}
            {value.workingHoursPolicy === 'hybrid' && (
              <TimeSelect value={value.hybridMaxCheckoutTime} onChange={(v) => update({ hybridMaxCheckoutTime: v })} />
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <div>
            <label className={labelClasses}>Grace (mins)</label>
            <input type="number" className={inputClasses} value={value.gracePeriodMins} onChange={e => update({ gracePeriodMins: parseInt(e.target.value, 10) || 0 })} />
          </div>
          <div>
            <label className={labelClasses}>Half Day (mins)</label>
            <input type="number" className={inputClasses} value={value.halfDayMins} onChange={e => update({ halfDayMins: parseInt(e.target.value, 10) || 0 })} />
          </div>
          <div>
            <label className={labelClasses}>Break Budget (mins)</label>
            <input type="number" className={inputClasses} value={value.dailyBreakBudgetMins} onChange={e => update({ dailyBreakBudgetMins: parseInt(e.target.value, 10) || 0 })} />
          </div>
          <div>
            <label className={labelClasses}>Min Attendance %</label>
            <input type="number" className={inputClasses} value={value.minAttendancePercent} onChange={e => update({ minAttendancePercent: parseInt(e.target.value, 10) || 0 })} />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <div>
            <label className={labelClasses}>Office Wi-Fi SSID (optional)</label>
            <input className={inputClasses} value={value.wifiSsid} onChange={e => update({ wifiSsid: e.target.value })} />
          </div>
          <div>
            <label className={labelClasses}>Office Public IP (optional)</label>
            <input className={inputClasses} value={value.officeIp} onChange={e => update({ officeIp: e.target.value })} />
          </div>
        </div>

        <div className="flex flex-wrap gap-4 mt-3">
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input type="checkbox" checked={value.wifiCheckEnabled} onChange={e => update({ wifiCheckEnabled: e.target.checked })} className="w-4 h-4 rounded border-[var(--color-nexus-border)]" />
            <span className="text-xs font-semibold text-[var(--color-nexus-ink)]">Require corporate network for check-in</span>
          </label>
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input type="checkbox" checked={value.qrEnabled} onChange={e => update({ qrEnabled: e.target.checked })} className="w-4 h-4 rounded border-[var(--color-nexus-border)]" />
            <span className="text-xs font-semibold text-[var(--color-nexus-ink)]">Enable QR Attendance for this branch</span>
          </label>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button type="button" onClick={onClose} className="px-5 py-3 rounded-xl text-xs font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)] transition-colors">
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving} className="px-8 py-3 rounded-xl font-bold text-xs uppercase tracking-wider bg-[var(--color-nexus-primary)] text-white hover:bg-[var(--color-nexus-primary-hover)] transition-colors disabled:opacity-50 shadow-[0_8px_24px_rgba(37,99,235,0.3)]">
            {saving ? 'Saving…' : mode === 'create' ? 'Create Branch' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
