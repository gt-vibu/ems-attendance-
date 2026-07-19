import { useState, lazy, Suspense } from 'react';
import { X } from 'lucide-react';

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

  const update = (patch: Partial<BranchFormValue>) => setValue(prev => ({ ...prev, ...patch }));

  const searchAddress = async () => {
    const query = value.address.trim();
    if (!query) return;
    setGeocoding(true);
    setError('');
    try {
      const res = await fetch('/api/geocode/forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No matching location found');
      update({ locationLat: data.lat, locationLng: data.lng, address: data.displayName || query });
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

        <div className="mb-4">
          <label className={labelClasses}>Search Address</label>
          <div className="flex gap-2">
            <input
              className={inputClasses}
              value={value.address}
              onChange={e => update({ address: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); searchAddress(); } }}
              placeholder="Type an address and search, or pick on the map below"
            />
            <button type="button" onClick={searchAddress} disabled={geocoding} className="px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider bg-[var(--color-nexus-primary)] text-white hover:bg-[var(--color-nexus-primary-hover)] transition-colors disabled:opacity-50 shrink-0">
              {geocoding ? 'Searching…' : 'Search'}
            </button>
          </div>
        </div>

        <Suspense fallback={<div className="h-[220px] flex items-center justify-center text-xs text-[var(--color-nexus-muted)]">Loading map…</div>}>
          <LocationPicker
            lat={value.locationLat}
            lng={value.locationLng}
            radius={value.locationRadiusMeters}
            onChange={(lat, lng) => update({ locationLat: lat, locationLng: lng })}
            height={220}
          />
        </Suspense>

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
