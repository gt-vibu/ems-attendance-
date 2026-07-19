import { useState, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { User } from '../lib/auth';
import PageChrome from '../components/PageChrome';
import AuroraField from '../three/AuroraField';

// Lazy so Leaflet is code-split out of the main bundle, same convention as
// Dashboard.tsx's use of this component.
const LocationPicker = lazy(() => import('../components/LocationPicker'));

interface BranchDraft {
  name: string;
  address: string;
  locationLat: number | null;
  locationLng: number | null;
  locationRadiusMeters: number;
  shiftStart: string;
  shiftEnd: string;
  gracePeriodMins: number;
  halfDayMins: number;
  dailyBreakBudgetMins: number;
  minAttendancePercent: number;
  wifiSsid: string;
  officeIp: string;
  wifiCheckEnabled: boolean;
  qrEnabled: boolean;
}

// Location/radius are always distinct per branch. Every other policy field
// is what "Apply to all branches" copies across cards — see POLICY_KEYS.
const POLICY_KEYS: (keyof BranchDraft)[] = [
  'shiftStart', 'shiftEnd', 'gracePeriodMins', 'halfDayMins', 'dailyBreakBudgetMins',
  'minAttendancePercent', 'wifiSsid', 'officeIp', 'wifiCheckEnabled', 'qrEnabled',
];

function newDraft(name: string): BranchDraft {
  return {
    name,
    address: '',
    locationLat: null,
    locationLng: null,
    locationRadiusMeters: 100,
    shiftStart: '09:00',
    shiftEnd: '18:00',
    gracePeriodMins: 15,
    halfDayMins: 240,
    dailyBreakBudgetMins: 60,
    minAttendancePercent: 75,
    wifiSsid: '',
    officeIp: '',
    wifiCheckEnabled: false,
    qrEnabled: false,
  };
}

export default function BranchSetupWizard({ user, updateSession }: { user: User; updateSession: (u: User) => void }) {
  const navigate = useNavigate();
  const token = localStorage.getItem('auth_token');
  const [step, setStep] = useState<'ask' | 'branches'>('ask');
  const [drafts, setDrafts] = useState<BranchDraft[]>([newDraft('')]);
  const [geocoding, setGeocoding] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const updateDraft = (index: number, patch: Partial<BranchDraft>) => {
    setDrafts(prev => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  };

  const addBranch = () => setDrafts(prev => [...prev, newDraft('')]);
  const removeBranch = (index: number) => setDrafts(prev => prev.filter((_, i) => i !== index));

  const applyToAll = (index: number) => {
    const source = drafts[index];
    setDrafts(prev => prev.map((d) => {
      const copied: Partial<BranchDraft> = {};
      for (const key of POLICY_KEYS) (copied as any)[key] = (source as any)[key];
      return { ...d, ...copied };
    }));
  };

  const searchAddress = async (index: number) => {
    const query = drafts[index].address.trim();
    if (!query) return;
    setGeocoding(index);
    setError('');
    try {
      const res = await fetch('/api/geocode/forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No matching location found');
      updateDraft(index, { locationLat: data.lat, locationLng: data.lng, address: data.displayName || query });
    } catch (err: any) {
      setError(err.message || 'Failed to search address');
    } finally {
      setGeocoding(null);
    }
  };

  const finishWizard = async (branchPayloads: any[]) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/branches/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ branches: branchPayloads }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create branches');
      const updatedUser = { ...user, branchSetupCompleted: true };
      updateSession(updatedUser);
      navigate(user.isKycCompleted === false && user.kycEnabled !== false ? '/employee/kyc' : '/dashboard');
    } catch (err: any) {
      setError(err.message || 'Failed to complete branch setup');
      setLoading(false);
    }
  };

  // Whichever answer they give, the tenant_admin still has to fill in and
  // create at least one real branch themselves — nothing is ever silently
  // auto-created on their behalf. Both paths land on the same form; "Yes"
  // just nudges them toward "+ Add Another Branch" once they're there.
  const startBranchForm = () => {
    setDrafts([newDraft('')]);
    setStep('branches');
  };

  const handleSubmitBranches = () => {
    for (const d of drafts) {
      if (!d.name.trim()) { setError('Every branch needs a name.'); return; }
      if (d.locationLat == null || d.locationLng == null) { setError(`"${d.name}" needs a location — search an address or pick it on the map.`); return; }
    }
    finishWizard(drafts.map(d => ({
      name: d.name.trim(),
      address: d.address || null,
      locationLat: d.locationLat,
      locationLng: d.locationLng,
      locationRadiusMeters: d.locationRadiusMeters,
      shiftStart: d.shiftStart,
      shiftEnd: d.shiftEnd,
      gracePeriodMins: d.gracePeriodMins,
      halfDayMins: d.halfDayMins,
      dailyBreakBudgetMins: d.dailyBreakBudgetMins,
      minAttendancePercent: d.minAttendancePercent,
      wifiSsid: d.wifiSsid || null,
      officeIp: d.officeIp || null,
      wifiCheckEnabled: d.wifiCheckEnabled,
      qrEnabled: d.qrEnabled,
    })));
  };

  const inputClasses = "w-full px-3 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-nexus-primary)]/20 focus:border-[var(--color-nexus-primary)] transition-all font-medium text-[var(--color-nexus-ink)]";
  const labelClasses = "block text-[11px] font-semibold text-[var(--color-nexus-muted)] mb-1 uppercase tracking-wider";

  return (
    <div className="min-h-screen premium-mesh-bg flex items-center justify-center p-6 font-sans relative overflow-hidden">
      <AuroraField />
      <PageChrome fallbackHref="/" />
      <div className="max-w-3xl w-full nexus-card rounded-3xl p-8 relative z-10">
        {step === 'ask' && (
          <div>
            <div className="text-center mb-8">
              <h1 className="font-sans text-2xl font-bold tracking-tight text-gradient inline-block">Set Up Your Company</h1>
              <p className="text-sm text-[var(--color-nexus-muted)] mt-2 font-medium">Does your company have multiple outlets or branches?</p>
            </div>
            {error && <div className="bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)] text-xs p-3 rounded-lg mb-6 border border-[var(--color-nexus-error)]/20 font-medium">{error}</div>}
            <div className="flex gap-4 justify-center">
              <button
                onClick={startBranchForm}
                className="px-8 py-3.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-[var(--color-nexus-primary)] text-white hover:bg-[var(--color-nexus-primary-hover)] transition-colors shadow-[0_8px_24px_rgba(37,99,235,0.3)]"
              >
                Yes, multiple branches
              </button>
              <button
                onClick={startBranchForm}
                className="px-8 py-3.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] text-[var(--color-nexus-ink)] hover:bg-[var(--color-nexus-primary-fixed)] transition-colors"
              >
                No, single location
              </button>
            </div>
          </div>
        )}

        {step === 'branches' && (
          <div>
            <div className="text-center mb-6">
              <h1 className="font-sans text-2xl font-bold tracking-tight text-gradient inline-block">Add Your Branches</h1>
              <p className="text-sm text-[var(--color-nexus-muted)] mt-2 font-medium">Location and radius must be set for each branch — everything else can be copied across branches.</p>
            </div>
            {error && <div className="bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)] text-xs p-3 rounded-lg mb-6 border border-[var(--color-nexus-error)]/20 font-medium">{error}</div>}

            <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-1">
              {drafts.map((d, i) => (
                <div key={i} className="p-5 bg-[var(--color-nexus-surface-alt)] rounded-2xl border border-[var(--color-nexus-border)]">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-sm font-bold text-[var(--color-nexus-ink)]">Branch {i + 1}</h3>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => applyToAll(i)} className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary)] hover:text-white transition-colors">
                        Apply policies to all branches
                      </button>
                      {drafts.length > 1 && (
                        <button type="button" onClick={() => removeBranch(i)} className="text-[11px] font-semibold px-2.5 py-1 rounded-lg text-[var(--color-nexus-error)] hover:bg-[var(--color-nexus-error-soft)] transition-colors">
                          Remove
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                    <div>
                      <label className={labelClasses}>Branch Name</label>
                      <input className={inputClasses} value={d.name} onChange={e => updateDraft(i, { name: e.target.value })} placeholder="e.g. Downtown Outlet" />
                    </div>
                    <div>
                      <label className={labelClasses}>Radius (meters)</label>
                      <input type="number" className={inputClasses} value={d.locationRadiusMeters} onChange={e => updateDraft(i, { locationRadiusMeters: parseInt(e.target.value, 10) || 0 })} />
                    </div>
                  </div>

                  <div className="mb-4">
                    <label className={labelClasses}>Search Address</label>
                    <div className="flex gap-2">
                      <input
                        className={inputClasses}
                        value={d.address}
                        onChange={e => updateDraft(i, { address: e.target.value })}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); searchAddress(i); } }}
                        placeholder="Type an address and search, or pick on the map below"
                      />
                      <button type="button" onClick={() => searchAddress(i)} disabled={geocoding === i} className="px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider bg-[var(--color-nexus-primary)] text-white hover:bg-[var(--color-nexus-primary-hover)] transition-colors disabled:opacity-50 shrink-0">
                        {geocoding === i ? 'Searching…' : 'Search'}
                      </button>
                    </div>
                  </div>

                  <Suspense fallback={<div className="h-[220px] flex items-center justify-center text-xs text-[var(--color-nexus-muted)]">Loading map…</div>}>
                    <LocationPicker
                      lat={d.locationLat}
                      lng={d.locationLng}
                      radius={d.locationRadiusMeters}
                      onChange={(lat, lng) => updateDraft(i, { locationLat: lat, locationLng: lng })}
                      height={220}
                    />
                  </Suspense>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                    <div>
                      <label className={labelClasses}>Shift Start</label>
                      <input type="time" className={inputClasses} value={d.shiftStart} onChange={e => updateDraft(i, { shiftStart: e.target.value })} />
                    </div>
                    <div>
                      <label className={labelClasses}>Shift End</label>
                      <input type="time" className={inputClasses} value={d.shiftEnd} onChange={e => updateDraft(i, { shiftEnd: e.target.value })} />
                    </div>
                    <div>
                      <label className={labelClasses}>Grace (mins)</label>
                      <input type="number" className={inputClasses} value={d.gracePeriodMins} onChange={e => updateDraft(i, { gracePeriodMins: parseInt(e.target.value, 10) || 0 })} />
                    </div>
                    <div>
                      <label className={labelClasses}>Min Attendance %</label>
                      <input type="number" className={inputClasses} value={d.minAttendancePercent} onChange={e => updateDraft(i, { minAttendancePercent: parseInt(e.target.value, 10) || 0 })} />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                    <div>
                      <label className={labelClasses}>Office Wi-Fi SSID (optional)</label>
                      <input className={inputClasses} value={d.wifiSsid} onChange={e => updateDraft(i, { wifiSsid: e.target.value })} />
                    </div>
                    <div>
                      <label className={labelClasses}>Office Public IP (optional)</label>
                      <input className={inputClasses} value={d.officeIp} onChange={e => updateDraft(i, { officeIp: e.target.value })} />
                    </div>
                  </div>

                  <label className="flex items-center gap-2.5 mt-3 cursor-pointer select-none">
                    <input type="checkbox" checked={d.wifiCheckEnabled} onChange={e => updateDraft(i, { wifiCheckEnabled: e.target.checked })} className="w-4 h-4 rounded border-[var(--color-nexus-border)]" />
                    <span className="text-xs font-semibold text-[var(--color-nexus-ink)]">Require corporate network for check-in</span>
                  </label>
                </div>
              ))}
            </div>

            <div className="flex justify-between items-center mt-6">
              <button type="button" onClick={addBranch} className="text-xs font-bold uppercase tracking-wider text-[var(--color-nexus-primary)] hover:underline">
                + Add Another Branch
              </button>
              <div className="flex gap-3">
                <button type="button" onClick={() => setStep('ask')} className="px-5 py-3 rounded-xl text-xs font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)] transition-colors">
                  Back
                </button>
                <button type="button" onClick={handleSubmitBranches} disabled={loading} className="px-8 py-3 rounded-xl font-bold text-xs uppercase tracking-wider bg-[var(--color-nexus-primary)] text-white hover:bg-[var(--color-nexus-primary-hover)] transition-colors disabled:opacity-50 shadow-[0_8px_24px_rgba(37,99,235,0.3)]">
                  {loading ? 'Saving…' : 'Save Branches & Continue'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
