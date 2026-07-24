import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Users, Clock, TrendingUp, Plus, Pencil, LayoutGrid, Table2,
  MapPin, Wifi, QrCode, ShieldCheck, SlidersHorizontal,
} from 'lucide-react';
import { User } from '../lib/auth';
import PageChrome from '../components/PageChrome';
import BranchFormModal, { branchToFormValue } from '../components/BranchFormModal';
import TimeSelect from '../components/TimeSelect';

type Tab = 'overview' | 'roster' | 'shifts' | 'trends' | 'settings';

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'roster', label: 'Roster', icon: Table2 },
  { id: 'shifts', label: 'Shifts', icon: Clock },
  { id: 'trends', label: 'Trends', icon: TrendingUp },
  { id: 'settings', label: 'Settings', icon: SlidersHorizontal },
];

export default function BranchDetail({ user }: { user: User }) {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const token = localStorage.getItem('auth_token');

  const [tab, setTab] = useState<Tab>('overview');
  const [detail, setDetail] = useState<any>(null);
  const [trends, setTrends] = useState<any[]>([]);
  const [trendDays, setTrendDays] = useState<7 | 30>(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);

  // Shift management
  const [shiftName, setShiftName] = useState('');
  const [shiftCheckIn, setShiftCheckIn] = useState('09:00');
  const [shiftCheckOut, setShiftCheckOut] = useState('18:00');
  const [shiftSaving, setShiftSaving] = useState(false);

  const fetchDetail = async () => {
    try {
      const res = await fetch(`/api/branches/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load branch');
      setDetail(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load branch');
    } finally {
      setLoading(false);
    }
  };

  const fetchTrends = async (days: 7 | 30) => {
    try {
      const res = await fetch(`/api/tenant/analytics/trends?branchId=${id}&days=${days}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok) setTrends(data.series || []);
    } catch (err) { console.error(err); }
  };

  useEffect(() => {
    fetchDetail();
    fetchTrends(trendDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    fetchTrends(trendDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trendDays]);

  const handleCreateShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shiftName.trim()) return;
    setShiftSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/branches/${id}/shifts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: shiftName.trim(), checkInTime: shiftCheckIn, checkOutTime: shiftCheckOut }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create shift');
      setShiftName('');
      setShiftCheckIn('09:00');
      setShiftCheckOut('18:00');
      fetchDetail();
    } catch (err: any) {
      setError(err.message || 'Failed to create shift');
    } finally {
      setShiftSaving(false);
    }
  };

  const inputClasses = "w-full px-3 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-lg text-sm focus:outline-none text-[var(--color-nexus-ink)] font-medium";
  const labelClasses = "block text-[11px] font-semibold text-[var(--color-nexus-muted)] mb-1 uppercase tracking-wider";

  if (loading) {
    return <div className="min-h-screen premium-mesh-bg flex items-center justify-center text-xs text-[var(--color-nexus-muted)] font-semibold">Loading…</div>;
  }

  if (error && !detail) {
    return (
      <div className="min-h-screen premium-mesh-bg p-6">
        <PageChrome fallbackHref="/tenant/branches" />
        <div className="max-w-3xl mx-auto mt-10 bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)] text-sm p-4 rounded-lg border border-[var(--color-nexus-error)]/20 font-medium">{error}</div>
      </div>
    );
  }

  const branch = detail?.branch;

  return (
    <div className="min-h-screen premium-mesh-bg font-sans p-6">
      <PageChrome fallbackHref="/tenant/branches" />
      <div className="max-w-5xl mx-auto">
        <button onClick={() => navigate('/tenant/branches')} className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)] mb-6 transition-colors">
          <ArrowLeft size={14} /> Back to Branches
        </button>

        {/* Hero header */}
        <div className="relative overflow-hidden rounded-3xl mb-6 p-6 bg-gradient-to-br from-[var(--color-nexus-primary)] to-[var(--color-nexus-secondary)] shadow-[0_16px_40px_rgba(37,99,235,0.3)]">
          <div className="absolute top-0 right-0 w-56 h-56 bg-white/10 rounded-full -mr-20 -mt-20 pointer-events-none" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
                  <MapPin size={16} className="text-white" />
                </div>
                {branch?.isMainBranch && (
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-white/25 text-white uppercase tracking-wider">Main Branch</span>
                )}
              </div>
              <h1 className="font-sans text-2xl font-bold text-white truncate">{branch?.name}</h1>
              <p className="text-sm text-white/80 mt-1 truncate">{branch?.address || 'No location set yet'}</p>
            </div>
            <div className="flex gap-2.5 shrink-0">
              <button
                onClick={() => setShowEditModal(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-white/15 hover:bg-white/25 backdrop-blur-sm text-white transition-colors"
              >
                <Pencil size={14} /> Edit
              </button>
              <button
                onClick={() => navigate(`/dashboard?tab=recruitment&branchId=${id}`)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-white text-[var(--color-nexus-primary)] hover:bg-white/90 transition-colors shadow-lg"
              >
                <Plus size={14} /> Onboard Employee
              </button>
            </div>
          </div>
        </div>

        {error && <div className="bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)] text-xs p-3 rounded-lg mb-6 border border-[var(--color-nexus-error)]/20 font-medium">{error}</div>}

        {/* Tab bar */}
        <div className="flex gap-1.5 mb-6 overflow-x-auto pb-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider whitespace-nowrap transition-colors ${
                  tab === t.id
                    ? 'bg-[var(--color-nexus-primary)] text-white shadow-[0_6px_16px_rgba(37,99,235,0.3)]'
                    : 'bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)]'
                }`}
              >
                <Icon size={14} /> {t.label}
              </button>
            );
          })}
        </div>

        {tab === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="nexus-card rounded-2xl p-4">
                <div className="flex items-center gap-2 text-[var(--color-nexus-muted)] text-[11px] font-semibold uppercase tracking-wider mb-1"><Users size={13} /> Headcount</div>
                <div className="text-2xl font-bold text-[var(--color-nexus-ink)]">{detail?.headcount ?? 0}</div>
              </div>
              <div className="nexus-card rounded-2xl p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-nexus-muted)] mb-1">Present Today</div>
                <div className="text-2xl font-bold text-[var(--color-nexus-ink)]">{detail?.todaysAttendance?.presentToday ?? 0}</div>
              </div>
              <div className="nexus-card rounded-2xl p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-nexus-muted)] mb-1">Late Today</div>
                <div className="text-2xl font-bold text-[var(--color-nexus-ink)]">{detail?.todaysAttendance?.lateToday ?? 0}</div>
              </div>
              <div className="nexus-card rounded-2xl p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-nexus-muted)] mb-1">Pending Approval</div>
                <div className="text-2xl font-bold text-[var(--color-nexus-ink)]">{detail?.todaysAttendance?.pendingToday ?? 0}</div>
              </div>
            </div>

            {/* Policy summary */}
            <div className="nexus-card rounded-2xl p-5">
              <h3 className="text-sm font-bold text-[var(--color-nexus-ink)] mb-4 flex items-center gap-2"><ShieldCheck size={16} className="text-[var(--color-nexus-primary)]" /> Policy Summary</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)]">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-nexus-muted)] mb-1"><MapPin size={12} /> Geofence</div>
                  <div className="text-sm font-bold text-[var(--color-nexus-ink)]">{branch?.locationRadiusMeters ?? 100}m radius</div>
                </div>
                <div className="p-3 rounded-xl bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)]">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-nexus-muted)] mb-1"><Wifi size={12} /> Corporate Wi-Fi</div>
                  <div className="text-sm font-bold text-[var(--color-nexus-ink)]">{branch?.wifiCheckEnabled ? 'Required' : 'Not required'}</div>
                </div>
                <div className="p-3 rounded-xl bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)]">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-nexus-muted)] mb-1"><QrCode size={12} /> QR Attendance</div>
                  <div className="text-sm font-bold text-[var(--color-nexus-ink)]">{branch?.qrEnabled ? 'Enabled' : 'Disabled'}</div>
                </div>
              </div>
            </div>

            {/* Staff by role */}
            <div className="nexus-card rounded-2xl p-5">
              <h3 className="text-sm font-bold text-[var(--color-nexus-ink)] mb-3">Roster by Role</h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries(detail?.staffByRole || {}).map(([role, count]: any) => (
                  <span key={role} className="text-xs font-semibold px-3 py-1.5 rounded-full bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)]">{role}: {count}</span>
                ))}
                {Object.keys(detail?.staffByRole || {}).length === 0 && (
                  <span className="text-xs text-[var(--color-nexus-muted)]">No employees yet.</span>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 'roster' && (
          <div className="nexus-card rounded-2xl p-5">
            <h3 className="text-sm font-bold text-[var(--color-nexus-ink)] mb-4">Roster</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[var(--color-nexus-muted)] uppercase tracking-wider text-[10px] border-b border-[var(--color-nexus-border)]">
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Role</th>
                    <th className="py-2 pr-4">Shift</th>
                    <th className="py-2 pr-4">Checked In Today</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail?.roster || []).map((r: any) => (
                    <tr key={r.userId} className="border-b border-[var(--color-nexus-border)]/50">
                      <td className="py-2 pr-4 font-semibold text-[var(--color-nexus-ink)]">{r.name}</td>
                      <td className="py-2 pr-4 text-[var(--color-nexus-muted)]">{r.role}</td>
                      <td className="py-2 pr-4 text-[var(--color-nexus-muted)]">{r.shift ? `${r.shift.name} (${r.shift.checkInTime}–${r.shift.checkOutTime})` : '—'}</td>
                      <td className="py-2 pr-4">{r.checkedInToday ? <span className="text-[var(--color-nexus-success-text)] font-semibold">Yes</span> : <span className="text-[var(--color-nexus-muted)]">No</span>}</td>
                    </tr>
                  ))}
                  {(detail?.roster || []).length === 0 && (
                    <tr><td colSpan={4} className="py-6 text-center text-[var(--color-nexus-muted)]">No employees at this branch yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'shifts' && (
          <div className="nexus-card rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Clock size={16} className="text-[var(--color-nexus-primary)]" />
              <h3 className="text-sm font-bold text-[var(--color-nexus-ink)]">Shifts</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
              {(detail?.shiftBreakdown || []).map((s: any) => (
                <div key={s.shiftId} className="p-3 rounded-xl bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)]">
                  <div className="font-bold text-sm text-[var(--color-nexus-ink)]">{s.name}</div>
                  <div className="text-[11px] text-[var(--color-nexus-muted)]">{s.checkInTime} – {s.checkOutTime}</div>
                  <div className="text-[11px] text-[var(--color-nexus-primary)] font-semibold mt-1">{s.employeeCount} employee{s.employeeCount === 1 ? '' : 's'}</div>
                </div>
              ))}
              {(detail?.shiftBreakdown || []).length === 0 && (
                <p className="text-xs text-[var(--color-nexus-muted)] col-span-full">No shifts yet — add one below.</p>
              )}
            </div>

            <form onSubmit={handleCreateShift} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
              <div>
                <label className={labelClasses}>New Shift Name</label>
                <input className={inputClasses} value={shiftName} onChange={e => setShiftName(e.target.value)} placeholder="e.g. Night Shift" required />
              </div>
              <div>
                <label className={labelClasses}>Check In</label>
                <TimeSelect value={shiftCheckIn} onChange={setShiftCheckIn} />
              </div>
              <div>
                <label className={labelClasses}>Check Out</label>
                <TimeSelect value={shiftCheckOut} onChange={setShiftCheckOut} />
              </div>
              <button type="submit" disabled={shiftSaving} className="px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider bg-[var(--color-nexus-primary)] text-white hover:bg-[var(--color-nexus-primary-hover)] transition-colors disabled:opacity-50">
                {shiftSaving ? 'Adding…' : 'Add Shift'}
              </button>
            </form>
          </div>
        )}

        {tab === 'trends' && (
          <div className="nexus-card rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <TrendingUp size={16} className="text-[var(--color-nexus-primary)]" />
                <h3 className="text-sm font-bold text-[var(--color-nexus-ink)]">Attendance Trends</h3>
              </div>
              <div className="flex gap-2">
                {[7, 30].map(d => (
                  <button
                    key={d}
                    onClick={() => setTrendDays(d as 7 | 30)}
                    className={`text-[11px] font-bold px-3 py-1 rounded-full transition-colors ${trendDays === d ? 'bg-[var(--color-nexus-primary)] text-white' : 'bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)]'}`}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <div className="flex items-end gap-1 h-40 min-w-max">
                {trends.map((t: any) => (
                  <div key={t.date} className="flex flex-col items-center justify-end w-6" title={`${t.date}: ${t.attendancePercent}% present, ${t.latePercent}% late`}>
                    <div
                      className="w-full rounded-t bg-gradient-to-t from-[var(--color-nexus-primary)] to-[var(--color-nexus-secondary)]"
                      style={{ height: `${Math.max(2, t.attendancePercent)}%`, opacity: 0.85 }}
                    />
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-[var(--color-nexus-muted)] mt-2">Bar height = % of staff present that day. Hover a bar for detail.</p>
            </div>
          </div>
        )}

        {tab === 'settings' && branch && (
          <div className="nexus-card rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-[var(--color-nexus-ink)]">Branch Settings</h3>
              <button
                onClick={() => setShowEditModal(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider bg-[var(--color-nexus-primary)] text-white hover:bg-[var(--color-nexus-primary-hover)] transition-colors"
              >
                <Pencil size={13} /> Edit
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div><span className="text-[var(--color-nexus-muted)] uppercase tracking-wider font-semibold block mb-1">Name</span><span className="text-[var(--color-nexus-ink)] font-semibold">{branch.name}</span></div>
              <div><span className="text-[var(--color-nexus-muted)] uppercase tracking-wider font-semibold block mb-1">Address</span><span className="text-[var(--color-nexus-ink)] font-semibold">{branch.address || '—'}</span></div>
              <div><span className="text-[var(--color-nexus-muted)] uppercase tracking-wider font-semibold block mb-1">Geofence Radius</span><span className="text-[var(--color-nexus-ink)] font-semibold">{branch.locationRadiusMeters ?? 100}m</span></div>
              <div><span className="text-[var(--color-nexus-muted)] uppercase tracking-wider font-semibold block mb-1">Grace Period</span><span className="text-[var(--color-nexus-ink)] font-semibold">{branch.gracePeriodMins ?? 15} mins</span></div>
              <div><span className="text-[var(--color-nexus-muted)] uppercase tracking-wider font-semibold block mb-1">Half Day Threshold</span><span className="text-[var(--color-nexus-ink)] font-semibold">{branch.halfDayMins ?? 240} mins</span></div>
              <div><span className="text-[var(--color-nexus-muted)] uppercase tracking-wider font-semibold block mb-1">Daily Break Budget</span><span className="text-[var(--color-nexus-ink)] font-semibold">{branch.dailyBreakBudgetMins ?? 60} mins</span></div>
              <div><span className="text-[var(--color-nexus-muted)] uppercase tracking-wider font-semibold block mb-1">Min Attendance %</span><span className="text-[var(--color-nexus-ink)] font-semibold">{branch.minAttendancePercent ?? 75}%</span></div>
              <div><span className="text-[var(--color-nexus-muted)] uppercase tracking-wider font-semibold block mb-1">Wi-Fi Lock</span><span className="text-[var(--color-nexus-ink)] font-semibold">{branch.wifiCheckEnabled ? `Required (${branch.officeIp || 'no IP set'})` : 'Off'}</span></div>
              <div><span className="text-[var(--color-nexus-muted)] uppercase tracking-wider font-semibold block mb-1">QR Attendance</span><span className="text-[var(--color-nexus-ink)] font-semibold">{branch.qrEnabled ? 'Enabled' : 'Disabled'}</span></div>
            </div>
          </div>
        )}
      </div>

      {showEditModal && branch && (
        <BranchFormModal
          mode="edit"
          initial={branchToFormValue(branch)}
          onClose={() => setShowEditModal(false)}
          onSaved={() => { setShowEditModal(false); fetchDetail(); }}
        />
      )}
    </div>
  );
}
