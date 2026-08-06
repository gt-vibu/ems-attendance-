import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Globe2, Plus, Check, Copy, AlertTriangle } from 'lucide-react';
import PageChrome from '../components/PageChrome';

interface FederationClient {
  id: number;
  name: string;
  clientId: string;
  environment: 'sandbox' | 'staging' | 'production';
  scopes: string[];
  status: 'active' | 'revoked';
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

const SCOPE_OPTIONS = ['attendance', 'leave', 'payroll', 'employees'];

// Super-admin-only provisioning UI for PLATFORM-WIDE /v1/federation/*
// credentials — the "one credential, many companies" case, distinct from
// FederationClientsPage.tsx which mints a credential bound to exactly one
// already-chosen tenant. A platform credential is never scoped to a tenant
// at creation time: the partner integrating with it identifies which of
// your tenants a given request targets by including that tenant's own
// externalOrganizationId/externalBranchId/externalEmployeeId in the
// request itself (resolveFederationTenantContext(), see
// api/middleware/federationAuth.ts), and can even provision a brand-new
// tenant on first contact via PUT /v1/federation/tenants/:externalOrganizationId.
// Reachable from the Manage Tenants page's toolbar (super admin only),
// never from a tenant admin's own menu.
export default function PlatformFederationClientsPage() {
  const navigate = useNavigate();
  const token = localStorage.getItem('auth_token');

  const [clients, setClients] = useState<FederationClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [environment, setEnvironment] = useState<'sandbox' | 'staging' | 'production'>('sandbox');
  const [scopes, setScopes] = useState<string[]>([...SCOPE_OPTIONS]);
  const [creating, setCreating] = useState(false);

  // Shown exactly once, immediately after creation — never retrievable again.
  const [newCredential, setNewCredential] = useState<{ clientId: string; clientSecret: string } | null>(null);
  const [copiedField, setCopiedField] = useState<'clientId' | 'clientSecret' | null>(null);

  const fetchAll = async () => {
    try {
      const res = await fetch('/api/super/platform-federation-clients', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load platform credentials.');
      setClients(Array.isArray(data.federationClients) ? data.federationClients : []);
    } catch (err: any) {
      setError(err.message || 'Failed to load platform credentials.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const toggleScope = (scope: string) => {
    setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!name.trim()) { setError('Give this credential a name (e.g. "BlizBooks Platform").'); return; }
    if (scopes.length === 0) { setError('Select at least one scope.'); return; }
    setCreating(true);
    try {
      const res = await fetch('/api/super/platform-federation-clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: name.trim(), environment, scopes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create platform credential.');
      setNewCredential({ clientId: data.federationClient.clientId, clientSecret: data.clientSecret });
      setShowForm(false);
      setName(''); setEnvironment('sandbox'); setScopes([...SCOPE_OPTIONS]);
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to create platform credential.');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: number, clientName: string) => {
    if (!window.confirm(`Revoke "${clientName}"? This will immediately stop this partner from authenticating against ANY tenant through this credential.`)) return;
    setError(''); setSuccess('');
    try {
      const res = await fetch(`/api/super/platform-federation-clients/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to revoke.');
      setSuccess('Credential revoked.');
      await fetchAll();
      setTimeout(() => setSuccess(''), 2500);
    } catch (err: any) {
      setError(err.message || 'Failed to revoke credential.');
    }
  };

  const copyToClipboard = (field: 'clientId' | 'clientSecret', value: string) => {
    navigator.clipboard?.writeText(value).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    }).catch(() => undefined);
  };

  const ENV_TONE: Record<string, string> = {
    sandbox: 'bg-slate-100 text-slate-600',
    staging: 'bg-amber-100 text-amber-700',
    production: 'bg-emerald-100 text-emerald-700',
  };

  return (
    <>
      <PageChrome fallbackHref="/dashboard" />
      <div className="min-h-screen bg-slate-50 p-4 sm:p-8">
        <div className="max-w-3xl mx-auto">
          <button onClick={() => navigate('/dashboard')} className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500 hover:text-slate-800 mb-4">
            <ArrowLeft size={14} /> Back to Dashboard
          </button>

          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
              <Globe2 size={18} className="text-indigo-600" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-slate-900">Platform Credentials</h1>
              <p className="text-sm text-slate-500">One credential, many companies — a partner integrates once and reaches whichever of your tenants each request identifies.</p>
            </div>
          </div>
          <p className="text-xs text-slate-500 mb-6 max-w-2xl">
            Use this for a partner like a hotel PMS/ERP that needs to operate across several separate SmartTeams
            tenants (e.g. one per hotel) with a single credential. For a single company integrating with just its
            own tenant, use the "Federation" button on that tenant's row in Manage Tenants instead.
          </p>

          <div className="flex justify-end mb-4">
            <button
              onClick={() => setShowForm((v) => !v)}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-bold uppercase tracking-wider hover:bg-indigo-700"
            >
              <Plus size={14} /> New Platform Credential
            </button>
          </div>

          {error && <div className="bg-red-50 text-red-700 text-xs p-3 rounded-lg mb-4 border border-red-200 font-medium">{error}</div>}
          {success && <div className="bg-emerald-50 text-emerald-700 text-xs p-3 rounded-lg mb-4 border border-emerald-200 font-medium flex items-center gap-1.5"><Check size={13} /> {success}</div>}

          {newCredential && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 space-y-3 mb-6">
              <div className="flex items-center gap-2 text-amber-800 font-bold text-sm">
                <AlertTriangle size={16} /> Copy this secret now — it will never be shown again
              </div>
              <div className="space-y-2">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-amber-700 mb-1">Client ID</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-white border border-amber-200 rounded-lg px-3 py-2 font-mono break-all">{newCredential.clientId}</code>
                    <button type="button" onClick={() => copyToClipboard('clientId', newCredential.clientId)} className="p-2 rounded-lg bg-white border border-amber-200 hover:bg-amber-100 shrink-0">
                      {copiedField === 'clientId' ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} className="text-amber-700" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-amber-700 mb-1">Client Secret</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-white border border-amber-200 rounded-lg px-3 py-2 font-mono break-all">{newCredential.clientSecret}</code>
                    <button type="button" onClick={() => copyToClipboard('clientSecret', newCredential.clientSecret)} className="p-2 rounded-lg bg-white border border-amber-200 hover:bg-amber-100 shrink-0">
                      {copiedField === 'clientSecret' ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} className="text-amber-700" />}
                    </button>
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-amber-700">
                Give these to the partner's server-side integration config: <code>POST /v1/federation/oauth/token</code> with
                <code> grant_type=client_credentials</code>. Every subsequent call must include an
                <code> externalOrganizationId</code>, <code>externalBranchId</code>, or <code>externalEmployeeId</code> so the
                request can be routed to the right tenant. If lost, revoke this credential below and create a new
                one — there is no way to retrieve this secret again.
              </p>
              <button type="button" onClick={() => setNewCredential(null)} className="text-[11px] font-bold uppercase tracking-wider text-amber-700 hover:underline">
                I've saved it — dismiss
              </button>
            </div>
          )}

          {showForm && (
            <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-xl p-5 mb-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Name</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. BlizBooks Platform"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Environment</label>
                  <select
                    value={environment}
                    onChange={(e) => setEnvironment(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                  >
                    <option value="sandbox">Sandbox</option>
                    <option value="staging">Staging</option>
                    <option value="production">Production</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Scopes</label>
                <div className="flex flex-wrap gap-1.5">
                  {SCOPE_OPTIONS.map((scope) => (
                    <button
                      type="button"
                      key={scope}
                      onClick={() => toggleScope(scope)}
                      className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border capitalize transition-colors ${
                        scopes.includes(scope)
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-slate-50 text-slate-500 border-slate-200'
                      }`}
                    >
                      {scope}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setShowForm(false)} className="text-xs font-bold uppercase tracking-wider px-4 py-2.5 rounded-xl text-slate-500">Cancel</button>
                <button type="submit" disabled={creating} className="text-xs font-bold uppercase tracking-wider px-4 py-2.5 rounded-xl bg-indigo-600 text-white disabled:opacity-50">
                  {creating ? 'Creating…' : 'Create Credential'}
                </button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="text-xs text-slate-500 font-semibold">Loading…</div>
          ) : clients.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
              <Globe2 size={28} className="mx-auto text-slate-400 mb-2" />
              <p className="text-sm font-bold text-slate-900">No platform credentials yet</p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                Create one to let a single external partner integrate once and operate across many of your tenants.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {clients.map((c) => (
                <div key={c.id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900 flex items-center gap-2 flex-wrap">
                      {c.name}
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${ENV_TONE[c.environment]}`}>{c.environment}</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">Platform-wide</span>
                      {c.status === 'revoked' && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">Revoked</span>}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1 font-mono break-all">{c.clientId}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Scopes: {c.scopes.join(', ')} · {c.lastUsedAt ? `Last used ${new Date(c.lastUsedAt).toLocaleString()}` : 'Never used'}
                    </div>
                  </div>
                  {c.status === 'active' && (
                    <button onClick={() => handleRevoke(c.id, c.name)} className="text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg text-red-600 hover:bg-red-50 shrink-0">
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
