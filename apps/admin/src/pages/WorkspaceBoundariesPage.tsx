import { useEffect, useState, useCallback } from 'react';
import { ShieldCheck, MapPin, Wifi, Plus, Save, Trash2, CheckCircle2, AlertTriangle, Info, RefreshCw } from 'lucide-react';
import { User } from '../lib/auth';
import AdminWorkspaceLayout from '../components/AdminWorkspaceLayout';

interface BranchBoundary {
  id: number;
  name: string;
  code: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number | null;
  geofenceEnabled: boolean;
  wifiEnabled: boolean;
  officeWifiSsid: string | null;
  officeWifiBssid: string | null;
}

export default function WorkspaceBoundariesPage({ user, onLogout }: { user: User; onLogout?: () => void }) {
  const token = localStorage.getItem('auth_token');
  const [branches, setBranches] = useState<BranchBoundary[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchBoundaries = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/tenant/my-branches', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load branch boundaries');
      const list: BranchBoundary[] = Array.isArray(data.branches) ? data.branches.map((b: any) => ({
        id: b.id,
        name: b.name,
        code: b.code || '',
        address: b.address || '',
        latitude: b.latitude ?? 12.9716,
        longitude: b.longitude ?? 77.5946,
        radiusMeters: b.radiusMeters ?? 200,
        geofenceEnabled: b.geofenceEnabled !== false,
        wifiEnabled: b.wifiEnabled === true,
        officeWifiSsid: b.officeWifiSsid || '',
        officeWifiBssid: b.officeWifiBssid || '',
      })) : [];
      setBranches(list);
    } catch (err: any) {
      setError(err.message || 'Error fetching workspace boundaries.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchBoundaries();
  }, [fetchBoundaries]);

  const updateBranchField = (id: number, field: keyof BranchBoundary, value: any) => {
    setBranches(prev => prev.map(b => b.id === id ? { ...b, [field]: value } : b));
  };

  const handleSaveBranchBoundary = async (branch: BranchBoundary) => {
    try {
      setSavingId(branch.id);
      setError('');
      setSuccess('');
      const res = await fetch(`/api/tenant/branches/${branch.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          latitude: branch.latitude,
          longitude: branch.longitude,
          radiusMeters: branch.radiusMeters,
          geofenceEnabled: branch.geofenceEnabled,
          wifiEnabled: branch.wifiEnabled,
          officeWifiSsid: branch.officeWifiSsid,
          officeWifiBssid: branch.officeWifiBssid,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save boundary rules');
      setSuccess(`Updated workspace boundary for ${branch.name}.`);
      setTimeout(() => setSuccess(''), 3500);
    } catch (err: any) {
      setError(err.message || 'Failed to save boundary');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <AdminWorkspaceLayout
      user={user}
      onLogout={onLogout}
      title="Workspace Boundaries & Geofencing"
      subtitle="Define GPS radiuses, corporate Wi-Fi networks, and site perimeters for attendance verification."
    >
      <div className="space-y-6">
        {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">{error}</div>}
        {success && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">{success}</div>}

        {loading ? (
          <div className="p-8 text-center text-xs font-mono text-[var(--color-nexus-muted)]">
            Loading location boundaries &amp; geofence perimeters...
          </div>
        ) : branches.length === 0 ? (
          <div className="p-8 text-center bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-2xl space-y-2">
            <ShieldCheck size={32} className="mx-auto text-[var(--color-nexus-muted)]" />
            <h3 className="text-sm font-bold text-[var(--color-nexus-ink)]">No Branch Boundaries Found</h3>
            <p className="text-xs text-[var(--color-nexus-muted)]">Please add branches first under Administration → Branches.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {branches.map((b) => (
              <div key={b.id} className="p-5 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-2xl space-y-4 shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--color-nexus-border)] pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-[var(--color-nexus-ink)]">{b.name}</h3>
                      {b.code && <span className="px-2 py-0.5 rounded bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] font-mono text-[10px] text-[var(--color-nexus-muted)]">{b.code}</span>}
                    </div>
                    <p className="text-xs text-[var(--color-nexus-muted)] mt-0.5">{b.address || 'Registered Office Location'}</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleSaveBranchBoundary(b)}
                    disabled={savingId === b.id}
                    className="px-4 py-1.5 text-xs font-bold text-white bg-[var(--color-nexus-primary)] hover:opacity-90 disabled:opacity-40 rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <Save size={13} /> {savingId === b.id ? 'Saving...' : 'Save Rules'}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* GPS & Geofence Section */}
                  <div className="p-4 rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)]/40 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[var(--color-nexus-ink)] flex items-center gap-1.5">
                        <MapPin size={14} className="text-[var(--color-nexus-primary)]" /> GPS Geofence Perimeter
                      </span>
                      <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold">
                        <input
                          type="checkbox"
                          checked={b.geofenceEnabled}
                          onChange={(e) => updateBranchField(b.id, 'geofenceEnabled', e.target.checked)}
                          className="rounded border-gray-300 text-[var(--color-nexus-primary)]"
                        />
                        Enable Geofence
                      </label>
                    </div>

                    {b.geofenceEnabled && (
                      <div className="grid grid-cols-3 gap-2 pt-1">
                        <div>
                          <label className="block text-[10px] font-mono text-[var(--color-nexus-muted)] mb-1">Latitude</label>
                          <input
                            type="number"
                            step="0.0001"
                            value={b.latitude ?? ''}
                            onChange={(e) => updateBranchField(b.id, 'latitude', parseFloat(e.target.value) || 0)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] text-xs font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-mono text-[var(--color-nexus-muted)] mb-1">Longitude</label>
                          <input
                            type="number"
                            step="0.0001"
                            value={b.longitude ?? ''}
                            onChange={(e) => updateBranchField(b.id, 'longitude', parseFloat(e.target.value) || 0)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] text-xs font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-mono text-[var(--color-nexus-muted)] mb-1">Radius (Meters)</label>
                          <input
                            type="number"
                            min="10"
                            max="5000"
                            value={b.radiusMeters ?? ''}
                            onChange={(e) => updateBranchField(b.id, 'radiusMeters', parseInt(e.target.value) || 100)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] text-xs font-mono"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Wi-Fi Verification Section */}
                  <div className="p-4 rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)]/40 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[var(--color-nexus-ink)] flex items-center gap-1.5">
                        <Wifi size={14} className="text-emerald-600" /> Corporate Wi-Fi Network
                      </span>
                      <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold">
                        <input
                          type="checkbox"
                          checked={b.wifiEnabled}
                          onChange={(e) => updateBranchField(b.id, 'wifiEnabled', e.target.checked)}
                          className="rounded border-gray-300 text-emerald-600"
                        />
                        Require Wi-Fi
                      </label>
                    </div>

                    {b.wifiEnabled && (
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <div>
                          <label className="block text-[10px] font-mono text-[var(--color-nexus-muted)] mb-1">Wi-Fi SSID (Name)</label>
                          <input
                            type="text"
                            value={b.officeWifiSsid || ''}
                            onChange={(e) => updateBranchField(b.id, 'officeWifiSsid', e.target.value)}
                            placeholder="e.g. Corp_Office_5G"
                            className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] text-xs"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-mono text-[var(--color-nexus-muted)] mb-1">BSSID / MAC (Optional)</label>
                          <input
                            type="text"
                            value={b.officeWifiBssid || ''}
                            onChange={(e) => updateBranchField(b.id, 'officeWifiBssid', e.target.value)}
                            placeholder="e.g. 00:11:22:33:44:55"
                            className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] text-xs font-mono"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminWorkspaceLayout>
  );
}
