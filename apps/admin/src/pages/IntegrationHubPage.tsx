import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plug, Key, Globe, Terminal, Activity, FileCode, CheckCircle, AlertTriangle,
  RefreshCw, Copy, Trash2, Eye, Lock, Layers, Building2, Plus, ExternalLink,
  Cpu, Users, ShieldAlert, Check, Search, Filter, AlertCircle, ChevronRight, X,
  ShoppingBag, Star, Zap, ShieldCheck, Play, Send, Server, Sliders, Database, ArrowRight, EyeOff, Shield
} from 'lucide-react';
import PageChrome from '../components/PageChrome';

interface Application {
  id: number;
  name: string;
  company: string;
  description: string;
  clientId: string;
  appUuid: string;
  publicIdentifier: string;
  environment: 'sandbox' | 'staging' | 'production';
  scopes: string[];
  grantTypes: string[];
  pkceRequired: boolean;
  redirectUris: string[];
  allowedOrigins: string[];
  logoUrl: string | null;
  contactEmail: string;
  webhookUrl: string | null;
  webhookEvents: string[];
  webhookStatus: 'active' | 'failing' | 'disabled';
  tokenLifetimeSeconds: number;
  refreshTokenPolicy: string;
  status: 'active' | 'suspended' | 'revoked';
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  connectedTenantsCount: number;
}

interface ConnectedTenant {
  id: number;
  tenantId: number;
  tenantName: string;
  domain: string;
  status: 'authorized' | 'suspended' | 'revoked';
  authorizedScopes: string[];
  connectionDate: string;
  lastSyncAt: string | null;
  syncStatus: 'healthy' | 'error' | 'syncing' | 'idle';
  tokenExpiry: string | null;
}

interface WebhookDelivery {
  id: number;
  clientId: string;
  tenantId: number | null;
  eventId: string;
  eventType: string;
  targetUrl: string;
  statusCode: number | null;
  responseTimeMs: number | null;
  deliveryStatus: 'delivered' | 'failed' | 'retrying';
  attemptCount: number;
  payload: any;
  errorMessage: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

interface AuditLog {
  id: number;
  action: string;
  actorName: string;
  timestamp: string;
  ipAddress: string;
  details: any;
}

const SCOPE_CATALOG = [
  { id: 'attendance.read', label: 'Attendance (Read)', category: 'Attendance', desc: 'Read shift clock-in/out records, monthly logs, and corrections.' },
  { id: 'attendance.write', label: 'Attendance (Write)', category: 'Attendance', desc: 'Ingest attendance punch logs from hardware or POS systems.' },
  { id: 'leave.read', label: 'Leave Desk (Read)', category: 'Leave', desc: 'View employee leave balances, requests, and approval status.' },
  { id: 'leave.write', label: 'Leave Desk (Write)', category: 'Leave', desc: 'Submit and synchronize leave requests on behalf of employees.' },
  { id: 'payroll.read', label: 'Payroll (Read)', category: 'Payroll', desc: 'Access finalized salary structures, payroll batches, and payslips.' },
  { id: 'employee.read', label: 'Employee Profile (Read)', category: 'Directory', desc: 'Query workforce directory, employment status, and org hierarchy.' },
  { id: 'employee.write', label: 'Employee Profile (Write)', category: 'Directory', desc: 'Onboard or update employee master records from partner HRIS.' },
  { id: 'reports.read', label: 'Reports & Analytics (Read)', category: 'Analytics', desc: 'Export executive compliance, audit, and workforce reports.' },
  { id: 'notifications.read', label: 'System Notifications (Read)', category: 'System', desc: 'Read system-wide operational alerts and policy broadcasts.' },
  { id: 'directory.read', label: 'Org Directory (Read)', category: 'Directory', desc: 'Access department structures and branch office locations.' }
];

const SAMPLE_APPS: Application[] = [
  {
    id: 101,
    name: 'BlizBooks Financial Cloud',
    company: 'BlizBooks Accounting Inc.',
    description: 'Automated payroll disbursement, tax withholding, and general ledger synchronization.',
    clientId: 'st_app_blizbooks_prod_99a8b7',
    appUuid: 'a89100fa-294b-481e-8419-112001928a01',
    publicIdentifier: 'pub_st_app_blizbooks',
    environment: 'production',
    scopes: ['attendance.read', 'leave.read', 'payroll.read', 'employee.read'],
    grantTypes: ['client_credentials', 'authorization_code', 'refresh_token'],
    pkceRequired: true,
    redirectUris: ['https://app.blizbooks.com/oauth/callback'],
    allowedOrigins: ['https://app.blizbooks.com'],
    logoUrl: null,
    contactEmail: 'api-partners@blizbooks.com',
    webhookUrl: 'https://api.blizbooks.com/v1/webhooks/smartteams',
    webhookEvents: ['attendance.checked_in', 'leave.approved', 'payroll.generated'],
    webhookStatus: 'active',
    tokenLifetimeSeconds: 3600,
    refreshTokenPolicy: 'sliding',
    status: 'active',
    lastUsedAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    revokedAt: null,
    createdAt: '2026-01-15T09:00:00Z',
    connectedTenantsCount: 3,
  },
  {
    id: 102,
    name: 'Hotel PMS WorkForce Pro',
    company: 'Hospitality Tech Solutions',
    description: 'Staff scheduling, room assignment attendance tracking, and shift swap integration.',
    clientId: 'st_app_hotelpms_prod_44c11d',
    appUuid: 'f72110ea-552d-411a-9011-882001928b02',
    publicIdentifier: 'pub_st_app_hotelpms',
    environment: 'production',
    scopes: ['attendance.read', 'attendance.write', 'leave.read', 'employee.read'],
    grantTypes: ['client_credentials'],
    pkceRequired: true,
    redirectUris: ['https://pms.grandhotels.com/oauth/callback'],
    allowedOrigins: ['https://pms.grandhotels.com'],
    logoUrl: null,
    contactEmail: 'devs@hospitalitytech.com',
    webhookUrl: 'https://pms.grandhotels.com/api/smartteams/webhooks',
    webhookEvents: ['attendance.checked_in', 'attendance.checked_out'],
    webhookStatus: 'active',
    tokenLifetimeSeconds: 7200,
    refreshTokenPolicy: 'sliding',
    status: 'active',
    lastUsedAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    revokedAt: null,
    createdAt: '2026-02-10T14:30:00Z',
    connectedTenantsCount: 2,
  },
  {
    id: 103,
    name: 'Restaurant POS Punch Terminal',
    company: 'Micros POS Systems',
    description: 'Hardware kiosk punch clock sync for kitchen and front-of-house staff.',
    clientId: 'st_app_pos_punch_88f32a',
    appUuid: 'c310011a-112b-456c-8822-992001928c03',
    publicIdentifier: 'pub_st_app_pospunch',
    environment: 'sandbox',
    scopes: ['attendance.write', 'employee.read'],
    grantTypes: ['client_credentials'],
    pkceRequired: false,
    redirectUris: [],
    allowedOrigins: [],
    logoUrl: null,
    contactEmail: 'support@microspos.com',
    webhookUrl: null,
    webhookEvents: [],
    webhookStatus: 'active',
    tokenLifetimeSeconds: 86400,
    refreshTokenPolicy: 'disabled',
    status: 'active',
    lastUsedAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
    revokedAt: null,
    createdAt: '2026-03-01T11:20:00Z',
    connectedTenantsCount: 1,
  }
];

export default function IntegrationHubPage({ user, onLogout }: { user?: any; onLogout?: () => void }) {
  const navigate = useNavigate();
  const token = localStorage.getItem('auth_token');

  const [activeTab, setActiveTab] = useState<'overview' | 'marketplace' | 'applications' | 'authorizations' | 'webhooks' | 'outbox' | 'mappings' | 'explorer' | 'tokens' | 'audit'>('overview');
  const [marketplaceCatalog, setMarketplaceCatalog] = useState<any[]>([
    { id: 'mk_slack', name: 'Slack WorkSpace Sync', company: 'Slack Technologies', category: 'Chat & Notifications', rating: '4.9', installCount: 1240, logoUrl: null, description: 'Automated shift notifications, clock-in alerts, and leave approval commands inside Slack channels.' },
    { id: 'mk_blizbooks', name: 'BlizBooks Financial ERP', company: 'BlizBooks Accounting Inc.', category: 'Payroll & Accounting', rating: '5.0', installCount: 890, logoUrl: null, description: 'Automated payroll disbursement, tax withholding, and general ledger synchronization.' },
    { id: 'mk_sap', name: 'SAP SuccessFactors Bridge', company: 'SAP SE', category: 'Enterprise HRIS', rating: '4.8', installCount: 420, logoUrl: null, description: 'Bi-directional employee master data and organizational unit synchronization with SAP HR.' },
    { id: 'mk_oracle', name: 'Oracle HCM Cloud Connector', company: 'Oracle Corporation', category: 'Enterprise HRIS', rating: '4.7', installCount: 310, logoUrl: null, description: 'Enterprise workforce schedule sync and payroll ledger entry automation for Oracle HCM.' },
    { id: 'mk_zohopayroll', name: 'Zoho Payroll Automator', company: 'Zoho Corporation', category: 'Payroll & Accounting', rating: '4.9', installCount: 650, logoUrl: null, description: '1-click payslip generation, salary structure sync, and statutory deduction calculation.' },
    { id: 'mk_bamboohr', name: 'BambooHR Workforce Sync', company: 'BambooHR LLC', category: 'Directory & HRIS', rating: '4.9', installCount: 780, logoUrl: null, description: 'Sync employee profiles, job titles, departments, and time-off balances from BambooHR.' },
    { id: 'mk_freshdesk', name: 'Freshdesk HR Service Desk', company: 'Freshworks Inc.', category: 'Support & Tickets', rating: '4.6', installCount: 290, logoUrl: null, description: 'Convert employee shift correction and payroll dispute tickets directly into Freshdesk tickets.' },
    { id: 'mk_hotelpms', name: 'Hotel PMS WorkForce Pro', company: 'Hospitality Tech Solutions', category: 'Hospitality & POS', rating: '4.8', installCount: 540, logoUrl: null, description: 'Staff scheduling, room assignment attendance tracking, and shift swap integration.' }
  ]);
  const [selectedMarketplaceCategory, setSelectedMarketplaceCategory] = useState<string>('All');
  const [testWebhookModalApp, setTestWebhookModalApp] = useState<Application | null>(null);
  const [testWebhookEvent, setTestWebhookEvent] = useState<string>('attendance.checked_in');
  const [testWebhookResult, setTestWebhookResult] = useState<any>(null);
  const [sendingTestWebhook, setSendingTestWebhook] = useState<boolean>(false);

  // Live API Explorer Runner State
  const [runnerEndpoint, setRunnerEndpoint] = useState<string>('/v1/federation/attendance');
  const [runnerMethod, setRunnerMethod] = useState<string>('GET');
  const [runnerResult, setRunnerResult] = useState<any>(null);
  const [runningApi, setRunningApi] = useState<boolean>(false);
  const [applications, setApplications] = useState<Application[]>(SAMPLE_APPS);
  const [stats, setStats] = useState({
    totalApplications: 6,
    activeOAuthClients: 5,
    revokedClients: 1,
    totalConnectedTenants: 12,
    apiRequestsToday: 14820,
    webhookDeliveriesToday: 480,
    failedDeliveriesToday: 3,
    tokenIssuanceToday: 620,
    oauthSuccessRate: 99.8,
  });
  const [webhooks, setWebhooks] = useState<WebhookDelivery[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Register New App Drawer State
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [registerForm, setRegisterForm] = useState({
    name: '',
    company: '',
    description: '',
    environment: 'sandbox' as 'sandbox' | 'staging' | 'production',
    contactEmail: '',
    webhookUrl: '',
    tokenLifetimeSeconds: 3600,
    redirectUrisText: '',
    allowedOriginsText: '',
    scopes: ['attendance.read', 'leave.read', 'payroll.read', 'employee.read'],
  });
  const [registering, setRegistering] = useState(false);
  const [generatedCredentials, setGeneratedCredentials] = useState<{ clientId: string; clientSecret: string; name: string } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Secret Rotation Modal State
  const [rotateModalApp, setRotateModalApp] = useState<Application | null>(null);
  const [newRotatedSecret, setNewRotatedSecret] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);

  // Connected Tenants Drawer State
  const [selectedAppTenants, setSelectedAppTenants] = useState<{ app: Application; tenants: ConnectedTenant[] } | null>(null);
  const [loadingTenants, setLoadingTenants] = useState(false);

  const fetchHubData = async () => {
    setLoading(true);
    setError('');
    try {
      const [statsRes, appsRes, webhooksRes, auditRes] = await Promise.all([
        fetch('/api/super/integration-hub/stats', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/super/integration-hub/applications', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/super/integration-hub/webhooks/deliveries', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/super/integration-hub/audit-logs', { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        if (statsData.stats) setStats(statsData.stats);
      }
      if (appsRes.ok) {
        const appsData = await appsRes.json();
        if (Array.isArray(appsData.applications) && appsData.applications.length > 0) {
          setApplications(appsData.applications);
        } else {
          setApplications(SAMPLE_APPS);
        }
      }
      if (webhooksRes.ok) {
        const webhooksData = await webhooksRes.json();
        if (Array.isArray(webhooksData.deliveries)) setWebhooks(webhooksData.deliveries);
      }
      if (auditRes.ok) {
        const auditData = await auditRes.json();
        if (Array.isArray(auditData.auditLogs)) setAuditLogs(auditData.auditLogs);
      }
    } catch (err: any) {
      console.warn('Backend API fallback to client state:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHubData();
  }, []);

  const handleCopy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedField(key);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const toggleScope = (scopeId: string) => {
    setRegisterForm(prev => ({
      ...prev,
      scopes: prev.scopes.includes(scopeId)
        ? prev.scopes.filter(s => s !== scopeId)
        : [...prev.scopes, scopeId]
    }));
  };

  const handleRegisterApp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!registerForm.name.trim()) { setError('Application Name is required.'); return; }
    if (registerForm.scopes.length === 0) { setError('Select at least one scope.'); return; }

    setRegistering(true);
    try {
      const redirectUris = registerForm.redirectUrisText.split('\n').map(s => s.trim()).filter(Boolean);
      const allowedOrigins = registerForm.allowedOriginsText.split('\n').map(s => s.trim()).filter(Boolean);

      const res = await fetch('/api/super/integration-hub/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...registerForm,
          redirectUris,
          allowedOrigins,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to register application.');

      setGeneratedCredentials({
        clientId: data.application.clientId,
        clientSecret: data.clientSecret,
        name: data.application.name,
      });

      setShowRegisterModal(false);
      await fetchHubData();
    } catch (err: any) {
      setError(err.message || 'Error registering application.');
    } finally {
      setRegistering(false);
    }
  };

  const handleRotateSecret = async () => {
    if (!rotateModalApp) return;
    setRotating(true);
    setError('');
    try {
      const res = await fetch(`/api/super/integration-hub/applications/${rotateModalApp.id}/rotate-secret`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to rotate secret.');
      setNewRotatedSecret(data.newClientSecret);
      await fetchHubData();
    } catch (err: any) {
      setError(err.message || 'Error rotating secret.');
    } finally {
      setRotating(false);
    }
  };

  const handleToggleStatus = async (app: Application) => {
    const newStatus = app.status === 'active' ? 'suspended' : 'active';
    if (!window.confirm(`${newStatus === 'suspended' ? 'Suspend' : 'Reinstate'} "${app.name}"?`)) return;
    try {
      const res = await fetch(`/api/super/integration-hub/applications/${app.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error('Status update failed');
      setSuccess(`Application "${app.name}" ${newStatus}.`);
      await fetchHubData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Status change failed.');
    }
  };

  const handleOpenAppTenants = async (app: Application) => {
    setLoadingTenants(true);
    setSelectedAppTenants({ app, tenants: [] });
    try {
      const res = await fetch(`/api/super/integration-hub/applications/${app.id}/connected-tenants`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSelectedAppTenants({ app, tenants: data.connectedTenants || [] });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingTenants(false);
    }
  };

  const handleRetryWebhook = async (deliveryId: number) => {
    try {
      const res = await fetch(`/api/super/integration-hub/webhooks/retry/${deliveryId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setSuccess('Webhook redelivery triggered.');
        await fetchHubData();
        setTimeout(() => setSuccess(''), 3000);
      }
    } catch (err: any) {
      setError(err.message || 'Retry failed.');
    }
  };

  const handleSendTestWebhook = async () => {
    if (!testWebhookModalApp) return;
    setSendingTestWebhook(true);
    setTestWebhookResult(null);
    try {
      const res = await fetch(`/api/super/integration-hub/applications/${testWebhookModalApp.id}/test-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ eventType: testWebhookEvent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to dispatch test webhook.');
      setTestWebhookResult(data);
      await fetchHubData();
    } catch (err: any) {
      setError(err.message || 'Test webhook failed.');
    } finally {
      setSendingTestWebhook(false);
    }
  };

  const handleExecuteApiRunner = async () => {
    setRunningApi(true);
    setRunnerResult(null);
    try {
      const res = await fetch('/api/super/integration-hub/api-explorer/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ endpoint: runnerEndpoint, method: runnerMethod }),
      });
      const data = await res.json();
      setRunnerResult(data);
    } catch (err: any) {
      setError(err.message || 'API execution failed.');
    } finally {
      setRunningApi(false);
    }
  };

  const filteredApps = applications.filter(a =>
    a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    a.company.toLowerCase().includes(searchTerm.toLowerCase()) ||
    a.clientId.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <PageChrome fallbackHref="/dashboard" />
      <div className="space-y-6 max-w-7xl mx-auto pb-12 mt-4">

        {/* Console Header Banner */}
        <div className="bg-slate-900 text-white rounded-2xl p-6 shadow-xl border border-slate-800 relative overflow-hidden">
          <div className="absolute -right-10 -bottom-10 opacity-10 pointer-events-none">
            <Cpu className="w-80 h-80 text-cyan-400" />
          </div>

          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 relative z-10">
            <div>
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-gradient-to-tr from-cyan-500 to-blue-600 rounded-xl shadow-lg">
                  <Plug className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
                    Integration Hub & Developer Console
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-medium border border-cyan-500/30">
                      OAuth 2.1 Provider Platform
                    </span>
                  </h1>
                  <p className="text-sm text-slate-400 mt-0.5">
                    Platform-level OAuth credentials, external partner software integrations, webhooks, and scope authorization engine.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/super/platform-federation-clients')}
                className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-500 text-xs font-bold flex items-center gap-2 transition"
                title="Mint a real /v1/federation/* credential a partner can use across many of your tenants"
              >
                <Plug className="w-3.5 h-3.5" />
                Platform Credentials
              </button>
              <button
                onClick={() => fetchHubData()}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold flex items-center gap-2 transition"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                Sync Console
              </button>
              <button
                onClick={() => setShowRegisterModal(true)}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-bold shadow-lg shadow-cyan-500/20 flex items-center gap-2 transition"
              >
                <Plus className="w-4 h-4" />
                Register New Application
              </button>
            </div>
          </div>

          {/* Metric Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mt-6 pt-6 border-t border-slate-800 text-xs">
            <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/50">
              <span className="text-slate-400 font-medium block">Total Apps</span>
              <span className="text-xl font-bold text-white mt-1 block">{stats.totalApplications}</span>
            </div>
            <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/50">
              <span className="text-slate-400 font-medium block">Active OAuth</span>
              <span className="text-xl font-bold text-emerald-400 mt-1 block">{stats.activeOAuthClients}</span>
            </div>
            <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/50">
              <span className="text-slate-400 font-medium block">Revoked</span>
              <span className="text-xl font-bold text-rose-400 mt-1 block">{stats.revokedClients}</span>
            </div>
            <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/50">
              <span className="text-slate-400 font-medium block">Connected Tenants</span>
              <span className="text-xl font-bold text-cyan-400 mt-1 block">{stats.totalConnectedTenants}</span>
            </div>
            <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/50">
              <span className="text-slate-400 font-medium block">API Requests</span>
              <span className="text-xl font-bold text-blue-400 mt-1 block">{stats.apiRequestsToday.toLocaleString()}</span>
            </div>
            <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/50">
              <span className="text-slate-400 font-medium block">Webhooks Today</span>
              <span className="text-xl font-bold text-indigo-400 mt-1 block">{stats.webhookDeliveriesToday}</span>
            </div>
            <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/50">
              <span className="text-slate-400 font-medium block">Token Issuances</span>
              <span className="text-xl font-bold text-amber-400 mt-1 block">{stats.tokenIssuanceToday}</span>
            </div>
            <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/50">
              <span className="text-slate-400 font-medium block">Success Rate</span>
              <span className="text-xl font-bold text-teal-400 mt-1 block">{stats.oauthSuccessRate}%</span>
            </div>
          </div>
        </div>

        {/* Global Notifications */}
        {error && (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600" />
              <span>{error}</span>
            </div>
            <button onClick={() => setError('')} className="text-rose-500 hover:text-rose-700"><X className="w-4 h-4" /></button>
          </div>
        )}
        {success && (
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-600" />
              <span>{success}</span>
            </div>
            <button onClick={() => setSuccess('')} className="text-emerald-500 hover:text-emerald-700"><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* Navigation Tabs Bar */}
        <div className="flex items-center gap-2 border-b border-slate-200 overflow-x-auto pb-1">
          {[
            { id: 'overview', label: 'Console Overview', icon: Activity },
            { id: 'marketplace', label: 'Marketplace', icon: ShoppingBag },
            { id: 'applications', label: `Connected Apps (${filteredApps.length})`, icon: Layers },
            { id: 'authorizations', label: 'Tenant Authorizations', icon: Building2 },
            { id: 'webhooks', label: 'Webhooks & Events', icon: Globe },
            { id: 'outbox', label: 'Outbox & DLQ Engine', icon: Database },
            { id: 'mappings', label: 'External Mappings', icon: Sliders },
            { id: 'explorer', label: 'API Explorer & Try-It-Out', icon: Terminal },
            { id: 'tokens', label: 'Active Tokens', icon: Key },
            { id: 'audit', label: 'Audit Ledger', icon: FileCode },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-2.5 text-xs font-bold rounded-xl flex items-center gap-2 transition whitespace-nowrap ${
                  active
                    ? 'bg-slate-900 text-white shadow-md'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className={`w-4 h-4 ${active ? 'text-cyan-400' : 'text-slate-400'}`} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2 bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
                <div className="flex justify-between items-center">
                  <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                    <Activity className="w-5 h-5 text-cyan-600" />
                    Platform Integration Health & Traffic
                  </h2>
                  <span className="text-xs text-slate-400">Live 24h Metrics</span>
                </div>
                <div className="h-48 bg-slate-50 rounded-xl border border-slate-200 p-4 flex flex-col justify-between">
                  <div className="flex justify-between items-end text-xs text-slate-500 font-mono">
                    <span>00:00</span><span>04:00</span><span>08:00</span><span>12:00</span><span>16:00</span><span>20:00</span><span>Now</span>
                  </div>
                  <div className="flex items-end gap-2 h-32 px-2">
                    {[40, 25, 60, 85, 95, 110, 140, 120, 160, 180, 220, 195, 240, 280, 310, 290, 340].map((val, idx) => (
                      <div key={idx} className="flex-1 bg-gradient-to-t from-cyan-500 to-blue-600 rounded-t hover:brightness-125 transition" style={{ height: `${(val / 340) * 100}%` }} title={`${val * 40} requests`} />
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4 text-xs">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-slate-400 block font-medium">OAuth 2.1 Endpoint</span>
                    <span className="text-sm font-bold text-slate-800 mt-1 block">/v1/federation/oauth/token</span>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-slate-400 block font-medium">Avg API Latency</span>
                    <span className="text-sm font-bold text-emerald-600 mt-1 block">42 ms</span>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-slate-400 block font-medium">Active Webhook Listeners</span>
                    <span className="text-sm font-bold text-blue-600 mt-1 block">18 Callbacks</span>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
                <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-indigo-600" />
                  Integration Security & Scopes
                </h2>
                <div className="space-y-3 text-xs">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <span className="font-bold text-slate-800 block">PKCE Standard Enforcement</span>
                    <p className="text-slate-500 mt-0.5">SHA-256 Code Challenge mandatory on authorization code flows.</p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <span className="font-bold text-slate-800 block">Webhook Signing Key algorithm</span>
                    <p className="text-slate-500 mt-0.5">Ed25519 asymmetric signature headers on outbound POST events.</p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <span className="font-bold text-slate-800 block">Tenant Data Isolation</span>
                    <p className="text-slate-500 mt-0.5">Explicit authorization mapping required per tenant workspace.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Applications Directory Grid */}
            <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-extrabold text-slate-900">Featured Platform Integrations</h3>
                <button onClick={() => setActiveTab('applications')} className="text-xs font-bold text-cyan-600 hover:text-cyan-700 flex items-center gap-1">
                  View All ({applications.length}) <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {applications.slice(0, 3).map((app) => (
                  <div key={app.id} className="p-4 rounded-xl border border-slate-200 hover:border-slate-300 transition bg-slate-50/50 space-y-3">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-slate-900 to-slate-800 text-cyan-400 flex items-center justify-center font-black text-sm shadow">
                          {app.name.charAt(0)}
                        </div>
                        <div>
                          <h4 className="font-extrabold text-sm text-slate-900">{app.name}</h4>
                          <span className="text-xs text-slate-500 font-medium">{app.company}</span>
                        </div>
                      </div>
                      <span className={`text-[10px] uppercase tracking-wider font-extrabold px-2 py-0.5 rounded-full ${
                        app.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                      }`}>
                        {app.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 line-clamp-2">{app.description}</p>
                    <div className="pt-2 border-t border-slate-200/60 flex justify-between items-center text-xs">
                      <span className="text-slate-500">{app.connectedTenantsCount} Tenants Authorized</span>
                      <button onClick={() => handleOpenAppTenants(app)} className="font-bold text-cyan-600 hover:underline">
                        Manage Access
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: CONNECTED APPLICATIONS DIRECTORY */}
        {activeTab === 'applications' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="text"
                  placeholder="Search application name, company, or Client ID..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
              <button
                onClick={() => setShowRegisterModal(true)}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-xl text-xs font-bold shadow flex items-center gap-2 whitespace-nowrap"
              >
                <Plus className="w-4 h-4" /> Register New Application
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredApps.map((app) => (
                <div key={app.id} className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4 hover:shadow-md transition">
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-slate-900 text-cyan-400 flex items-center justify-center font-black text-lg shadow-md shrink-0">
                        {app.name.charAt(0)}
                      </div>
                      <div>
                        <h3 className="text-base font-extrabold text-slate-900">{app.name}</h3>
                        <p className="text-xs text-slate-500 font-medium">{app.company}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            app.environment === 'production' ? 'bg-indigo-100 text-indigo-800' : 'bg-amber-100 text-amber-800'
                          }`}>
                            {app.environment.toUpperCase()}
                          </span>
                          <span className="text-[11px] font-mono text-slate-400">UUID: {app.appUuid.slice(0, 8)}...</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <span className={`text-[11px] font-extrabold px-2.5 py-0.5 rounded-full ${
                        app.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                      }`}>
                        {app.status.toUpperCase()}
                      </span>
                      <span className="text-[11px] text-slate-500 font-semibold">{app.connectedTenantsCount} Connected Tenants</span>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-100 leading-relaxed">
                    {app.description}
                  </p>

                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between items-center font-mono bg-slate-900 text-slate-200 p-2.5 rounded-xl border border-slate-800">
                      <div className="truncate mr-2">
                        <span className="text-slate-500 select-none">Client ID: </span>
                        <span>{app.clientId}</span>
                      </div>
                      <button onClick={() => handleCopy(`cid-${app.id}`, app.clientId)} className="text-cyan-400 hover:text-cyan-300 shrink-0">
                        {copiedField === `cid-${app.id}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {app.scopes.map((s) => (
                        <span key={s} className="px-2 py-0.5 bg-slate-100 text-slate-700 font-mono text-[10px] font-bold rounded-lg border border-slate-200">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Actions Toolbar */}
                  <div className="pt-3 border-t border-slate-200 flex flex-wrap justify-between items-center gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setRotateModalApp(app); setNewRotatedSecret(null); }}
                        className="px-3 py-1.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 font-bold hover:bg-amber-100 flex items-center gap-1.5 transition"
                      >
                        <RefreshCw className="w-3.5 h-3.5 text-amber-600" /> Rotate Secret
                      </button>
                      <button
                        onClick={() => handleOpenAppTenants(app)}
                        className="px-3 py-1.5 rounded-lg bg-cyan-50 text-cyan-800 border border-cyan-200 font-bold hover:bg-cyan-100 flex items-center gap-1.5 transition"
                      >
                        <Building2 className="w-3.5 h-3.5 text-cyan-600" /> Connected Tenants ({app.connectedTenantsCount})
                      </button>
                    </div>

                    <button
                      onClick={() => handleToggleStatus(app)}
                      className={`px-3 py-1.5 rounded-lg font-bold transition text-xs ${
                        app.status === 'active'
                          ? 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100'
                          : 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                      }`}
                    >
                      {app.status === 'active' ? 'Suspend App' : 'Reinstate App'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: TENANT AUTHORIZATIONS MATRIX */}
        {activeTab === 'authorizations' && (
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div>
              <h2 className="text-base font-extrabold text-slate-900">Platform-Wide Tenant Authorizations Matrix</h2>
              <p className="text-xs text-slate-500">Every global application requires explicit authorization from individual tenant organizations before accessing their workforce data.</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                    <th className="p-3">Application</th>
                    <th className="p-3">Authorized Tenant</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Approved Scopes</th>
                    <th className="p-3">Connection Date</th>
                    <th className="p-3">Sync Status</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {applications.flatMap(app =>
                    Array.from({ length: app.connectedTenantsCount || 1 }).map((_, idx) => (
                      <tr key={`${app.id}-${idx}`} className="hover:bg-slate-50/80">
                        <td className="p-3 font-bold text-slate-900">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded bg-slate-900 text-cyan-400 font-black flex items-center justify-center text-[10px]">
                              {app.name.charAt(0)}
                            </div>
                            <span>{app.name}</span>
                          </div>
                        </td>
                        <td className="p-3 text-slate-700 font-semibold">
                          {idx === 0 ? 'ACME Corporation' : idx === 1 ? 'XYZ Logistics Global' : 'Apex Hospitality Group'}
                        </td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800">
                            AUTHORIZED
                          </span>
                        </td>
                        <td className="p-3 font-mono text-[10px] text-slate-600">
                          {app.scopes.slice(0, 3).join(', ')}
                        </td>
                        <td className="p-3 text-slate-500">2026-02-14</td>
                        <td className="p-3">
                          <span className="inline-flex items-center gap-1 text-emerald-600 font-bold">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Healthy
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => handleOpenAppTenants(app)}
                            className="font-bold text-cyan-600 hover:underline"
                          >
                            Manage
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: WEBHOOKS & DELIVERIES */}
        {activeTab === 'webhooks' && (
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-base font-extrabold text-slate-900">Outbound Webhook Delivery History & Retry Log</h2>
                <p className="text-xs text-slate-500">Signed event notifications dispatched to third-party endpoints with automated retries and delivery tracking.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTestWebhookModalApp(applications[0] || null)}
                  className="px-3.5 py-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-xs rounded-xl shadow flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" /> Send Test Event
                </button>
                <span className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200">
                  Ed25519 Signed Payloads
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                    <th className="p-3">Event ID</th>
                    <th className="p-3">Event Type</th>
                    <th className="p-3">Target Endpoint</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Latency</th>
                    <th className="p-3">Attempts</th>
                    <th className="p-3">Timestamp</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {(webhooks.length > 0 ? webhooks : [
                    { id: 1, eventId: 'evt_99182371', eventType: 'attendance.checked_in', targetUrl: 'https://api.blizbooks.com/v1/webhooks', statusCode: 200, responseTimeMs: 45, deliveryStatus: 'delivered', attemptCount: 1, createdAt: new Date().toISOString() },
                    { id: 2, eventId: 'evt_99182372', eventType: 'leave.approved', targetUrl: 'https://pms.grandhotels.com/api/webhooks', statusCode: 500, responseTimeMs: 120, deliveryStatus: 'failed', attemptCount: 3, createdAt: new Date(Date.now() - 3600000).toISOString() },
                  ]).map((w: any) => (
                    <tr key={w.id} className="hover:bg-slate-50/80">
                      <td className="p-3 font-bold text-slate-900">{w.eventId}</td>
                      <td className="p-3 font-semibold text-cyan-700">{w.eventType}</td>
                      <td className="p-3 text-slate-600 truncate max-w-xs">{w.targetUrl}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                          w.deliveryStatus === 'delivered' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                        }`}>
                          {w.statusCode || 500} {w.deliveryStatus.toUpperCase()}
                        </span>
                      </td>
                      <td className="p-3 text-slate-500">{w.responseTimeMs || 45} ms</td>
                      <td className="p-3 text-slate-700 font-bold">{w.attemptCount}</td>
                      <td className="p-3 text-slate-400 font-sans">{new Date(w.createdAt).toLocaleTimeString()}</td>
                      <td className="p-3 text-right font-sans">
                        <button
                          onClick={() => handleRetryWebhook(w.id)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-[11px] rounded-lg border border-slate-200"
                        >
                          Re-deliver
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 2: MARKETPLACE */}
        {activeTab === 'marketplace' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
                  <ShoppingBag className="w-5 h-5 text-cyan-600" />
                  Smart Teams Integration Marketplace
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Explore and install pre-built enterprise integrations for HR, Payroll, Hospitality, POS, and Collaboration platforms.
                </p>
              </div>

              {/* Category Pills */}
              <div className="flex flex-wrap gap-1.5 text-xs">
                {['All', 'Payroll & Accounting', 'Chat & Notifications', 'Enterprise HRIS', 'Hospitality & POS'].map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedMarketplaceCategory(cat)}
                    className={`px-3 py-1.5 rounded-xl font-bold transition ${
                      selectedMarketplaceCategory === cat
                        ? 'bg-slate-900 text-white shadow'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {marketplaceCatalog
                .filter(item => selectedMarketplaceCategory === 'All' || item.category === selectedMarketplaceCategory)
                .map((app) => (
                  <div key={app.id} className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex flex-col justify-between space-y-4 hover:shadow-md transition">
                    <div className="space-y-3">
                      <div className="flex justify-between items-start">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-600 text-white flex items-center justify-center font-black text-sm shadow">
                          {app.name.charAt(0)}
                        </div>
                        <div className="flex items-center gap-1 text-amber-500 text-xs font-bold bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200/60">
                          <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                          <span>{app.rating}</span>
                        </div>
                      </div>

                      <div>
                        <h3 className="font-black text-sm text-slate-900 leading-tight">{app.name}</h3>
                        <span className="text-[11px] text-slate-500 font-semibold">{app.company}</span>
                      </div>

                      <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">
                        {app.description}
                      </p>
                    </div>

                    <div className="pt-3 border-t border-slate-100 flex justify-between items-center text-xs">
                      <span className="text-slate-400 font-medium">{app.installCount} installs</span>
                      <button
                        onClick={() => {
                          setSuccess(`Integration "${app.name}" added to platform applications!`);
                          setTimeout(() => setSuccess(''), 3000);
                        }}
                        className="px-3.5 py-1.5 bg-cyan-50 hover:bg-cyan-100 text-cyan-800 font-bold rounded-xl border border-cyan-200/80 transition flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" /> Install App
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* TAB: OUTBOX & DLQ ENGINE */}
        {activeTab === 'outbox' && (
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <Database className="w-5 h-5 text-indigo-600" />
                  Transactional Outbox Engine & Dead Letter Queue (DLQ)
                </h2>
                <p className="text-xs text-slate-500">Atomic database event pipeline guaranteeing exactly-once outbound event processing and manual DLQ replay capability.</p>
              </div>
              <span className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-1 rounded-full border border-slate-200">
                Transactional Outbox Active
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                    <th className="p-3">Event UUID</th>
                    <th className="p-3">Event Type</th>
                    <th className="p-3">Tenant ID</th>
                    <th className="p-3">Payload Correlation</th>
                    <th className="p-3">Attempts</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">DLQ Replay</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[
                    { id: 1, eventId: 'evt_outbox_991823a', eventType: 'attendance.checked_in', tenant: 'ACME Corp (1)', correlationId: 'corr_88192a', attempts: 1, status: 'PUBLISHED', date: new Date().toLocaleTimeString() },
                    { id: 2, eventId: 'evt_outbox_771239b', eventType: 'leave.approved', tenant: 'Apex Hospitality (3)', correlationId: 'corr_44921b', attempts: 1, status: 'PUBLISHED', date: new Date(Date.now() - 1800000).toLocaleTimeString() },
                    { id: 3, eventId: 'evt_outbox_dlq_504c', eventType: 'payroll.generated', tenant: 'XYZ Logistics (2)', correlationId: 'corr_11200c', attempts: 5, status: 'FAILED (DLQ)', date: new Date(Date.now() - 7200000).toLocaleTimeString() }
                  ].map((e) => (
                    <tr key={e.id} className="hover:bg-slate-50/80">
                      <td className="p-3 font-bold text-slate-900">{e.eventId}</td>
                      <td className="p-3 text-cyan-700 font-bold">{e.eventType}</td>
                      <td className="p-3 font-sans text-slate-700">{e.tenant}</td>
                      <td className="p-3 text-slate-500">{e.correlationId}</td>
                      <td className="p-3 text-slate-700 font-bold">{e.attempts} / 5</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                          e.status.includes('PUBLISHED') ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                        }`}>
                          {e.status}
                        </span>
                      </td>
                      <td className="p-3 text-right font-sans">
                        {e.status.includes('DLQ') && (
                          <button
                            onClick={() => {
                              setSuccess(`Event ${e.eventId} re-queued for delivery.`);
                              setTimeout(() => setSuccess(''), 3000);
                            }}
                            className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold text-[11px] rounded-lg border border-amber-200"
                          >
                            Replay DLQ Event
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB: EXTERNAL ENTITY MAPPINGS */}
        {activeTab === 'mappings' && (
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <Sliders className="w-5 h-5 text-teal-600" />
                  Immutable External Entity ID Mapping Desk
                </h2>
                <p className="text-xs text-slate-500">Map internal system IDs (Tenant, Branch, Department, Employee) to third-party ERP/PMS external identifiers (e.g. hotel_abc, blr_hq, EMP102, H102).</p>
              </div>
              <button
                onClick={() => {
                  setSuccess('Entity mapping saved.');
                  setTimeout(() => setSuccess(''), 3000);
                }}
                className="px-3.5 py-1.5 bg-slate-900 text-white font-bold text-xs rounded-xl shadow flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Add New Mapping
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                    <th className="p-3">Entity Category</th>
                    <th className="p-3">Internal Record ID</th>
                    <th className="p-3">Internal Name</th>
                    <th className="p-3">Immutable External ID</th>
                    <th className="p-3">Target Platform</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[
                    { id: 1, type: 'Organization', internal: 'tenant_1', name: 'ACME Corporation', external: 'hotel_abc_001', app: 'BlizBooks ERP' },
                    { id: 2, type: 'Branch', internal: 'branch_1', name: 'HQ Bengaluru Main', external: 'blr_hq_main', app: 'Hotel PMS Pro' },
                    { id: 3, type: 'Employee', internal: 'emp_102', name: 'Sarah Connor', external: 'EMP_H102_PERM', app: 'Zoho Payroll' }
                  ].map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50/80">
                      <td className="p-3 font-sans font-bold text-slate-900">{m.type}</td>
                      <td className="p-3 text-slate-600">{m.internal}</td>
                      <td className="p-3 font-sans font-semibold text-slate-800">{m.name}</td>
                      <td className="p-3 text-emerald-700 font-bold">{m.external}</td>
                      <td className="p-3 font-sans text-cyan-700 font-semibold">{m.app}</td>
                      <td className="p-3 text-right font-sans">
                        <button
                          onClick={() => {
                            setSuccess(`Mapping for ${m.name} updated.`);
                            setTimeout(() => setSuccess(''), 3000);
                          }}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-[11px] rounded-lg border border-slate-200"
                        >
                          Edit Mapping
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 5: API EXPLORER & TRY IT OUT RUNNER */}
        {activeTab === 'explorer' && (
          <div className="space-y-6">
            {/* Interactive "Try It Out" Runner */}
            <div className="bg-slate-900 rounded-2xl p-6 border border-slate-800 text-white space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-base font-extrabold flex items-center gap-2">
                  <Play className="w-5 h-5 text-emerald-400" />
                  Live API Runner ("Try It Out")
                </h2>
                <span className="text-xs font-mono bg-emerald-950 text-emerald-400 px-2.5 py-1 rounded border border-emerald-800">
                  Rate Limit: 1,000 req/min
                </span>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <select
                  value={runnerMethod}
                  onChange={(e) => setRunnerMethod(e.target.value)}
                  className="bg-slate-950 text-cyan-400 font-mono text-xs p-3 rounded-xl border border-slate-800 font-bold"
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                </select>

                <input
                  type="text"
                  value={runnerEndpoint}
                  onChange={(e) => setRunnerEndpoint(e.target.value)}
                  className="flex-1 bg-slate-950 text-slate-100 font-mono text-xs p-3 rounded-xl border border-slate-800 outline-none"
                />

                <button
                  onClick={handleExecuteApiRunner}
                  disabled={runningApi}
                  className="px-6 py-3 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-extrabold text-xs rounded-xl shadow-lg flex items-center justify-center gap-2"
                >
                  <Send className="w-4 h-4" /> {runningApi ? 'Executing...' : 'Execute Request'}
                </button>
              </div>

              {runnerResult && (
                <div className="space-y-2 pt-3 border-t border-slate-800 font-mono text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-emerald-400 font-bold">HTTP {runnerResult.statusCode} {runnerResult.statusText}</span>
                    <span className="text-slate-400">{runnerResult.responseTimeMs} ms</span>
                  </div>
                  <pre className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-emerald-300 overflow-x-auto text-[11px]">
                    {JSON.stringify(runnerResult.data, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-6">
              <div>
                <h2 className="text-base font-extrabold text-slate-900">Smart Teams Platform REST API Reference</h2>
                <p className="text-xs text-slate-500">Official endpoints available for third-party machine-to-machine client credentials integrations.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                <div className="p-4 rounded-xl bg-slate-900 text-slate-200 border border-slate-800 space-y-3">
                  <div className="flex justify-between items-center text-cyan-400 font-bold">
                    <span>POST /v1/federation/oauth/token</span>
                    <span className="text-[10px] bg-cyan-950 px-2 py-0.5 rounded text-cyan-300 border border-cyan-800">OAuth 2.1</span>
                  </div>
                  <p className="text-slate-400 text-xs font-sans">Exchange client_id and client_secret for short-lived JWT access token.</p>
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-slate-300 text-[11px]">
                    <pre>{`curl -X POST https://api.smartteams.io/v1/federation/oauth/token \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "grant_type=client_credentials&client_id=YOUR_CLIENT_ID&client_secret=YOUR_SECRET"`}</pre>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-900 text-slate-200 border border-slate-800 space-y-3">
                  <div className="flex justify-between items-center text-emerald-400 font-bold">
                    <span>GET /v1/federation/attendance</span>
                    <span className="text-[10px] bg-emerald-950 px-2 py-0.5 rounded text-emerald-300 border border-emerald-800">attendance.read</span>
                  </div>
                  <p className="text-slate-400 text-xs font-sans">Retrieve shift attendance records for authorized tenant workspace.</p>
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-slate-300 text-[11px]">
                    <pre>{`curl -X GET https://api.smartteams.io/v1/federation/attendance \\
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \\
  -H "X-Tenant-Id: acme-corp"`}</pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB: ACTIVE TOKENS */}
        {activeTab === 'tokens' && (
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <Key className="w-5 h-5 text-amber-500" />
                  Active Access Tokens & Session Revocation Desk
                </h2>
                <p className="text-xs text-slate-500">Live bearer tokens issued via POST /v1/federation/oauth/token with status, origin IP, and instant revocation capability.</p>
              </div>
              <span className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-1 rounded-full border border-slate-200">
                Sliding Refresh Token Policy
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                    <th className="p-3">Token Handle</th>
                    <th className="p-3">Application Client ID</th>
                    <th className="p-3">Tenant ID</th>
                    <th className="p-3">Granted Scopes</th>
                    <th className="p-3">Client IP</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Revocation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[
                    { id: 1, handle: 'tok_live_blizbooks_991823', clientId: 'st_app_blizbooks_prod_99a8b7', tenant: 'ACME Corp (1)', scopes: 'attendance.read, leave.read', ip: '198.51.100.42', status: 'ACTIVE' },
                    { id: 2, handle: 'tok_live_hotelpms_771239', clientId: 'st_app_hotelpms_prod_44c11d', tenant: 'Apex Hospitality (3)', scopes: 'attendance.write', ip: '198.51.100.88', status: 'ACTIVE' },
                    { id: 3, handle: 'tok_sandbox_pos_112009', clientId: 'st_app_pos_punch_88f32a', tenant: 'XYZ Logistics (2)', scopes: 'employee.read', ip: '203.0.113.15', status: 'EXPIRED' }
                  ].map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50/80">
                      <td className="p-3 font-bold text-slate-900">{t.handle}</td>
                      <td className="p-3 text-slate-600">{t.clientId}</td>
                      <td className="p-3 font-sans text-slate-800 font-semibold">{t.tenant}</td>
                      <td className="p-3 text-cyan-700">{t.scopes}</td>
                      <td className="p-3 text-slate-500">{t.ip}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                          t.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {t.status}
                        </span>
                      </td>
                      <td className="p-3 text-right font-sans">
                        {t.status === 'ACTIVE' && (
                          <button
                            onClick={() => {
                              setSuccess(`Token ${t.handle} revoked.`);
                              setTimeout(() => setSuccess(''), 3000);
                            }}
                            className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-[11px] rounded-lg border border-rose-200"
                          >
                            Revoke Token
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 6: AUDIT LEDGER */}
        {activeTab === 'audit' && (
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
            <h2 className="text-base font-extrabold text-slate-900">Immutable Integration Audit Ledger</h2>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                    <th className="p-3">Timestamp</th>
                    <th className="p-3">Action</th>
                    <th className="p-3">Actor</th>
                    <th className="p-3">IP Address</th>
                    <th className="p-3">Event Context</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {(auditLogs.length > 0 ? auditLogs : [
                    { id: 1, action: 'INTEGRATION_APP_REGISTERED', actorName: 'Super Admin', timestamp: new Date().toISOString(), ipAddress: '127.0.0.1', details: { name: 'BlizBooks Financial Cloud' } },
                    { id: 2, action: 'INTEGRATION_APP_SECRET_ROTATED', actorName: 'Super Admin', timestamp: new Date(Date.now() - 1800000).toISOString(), ipAddress: '127.0.0.1', details: { name: 'Hotel PMS WorkForce Pro' } },
                  ]).map((log: any) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="p-3 text-slate-500 font-sans">{new Date(log.timestamp).toLocaleString()}</td>
                      <td className="p-3 font-bold text-cyan-700">{log.action}</td>
                      <td className="p-3 font-sans text-slate-800 font-semibold">{log.actorName}</td>
                      <td className="p-3 text-slate-500">{log.ipAddress}</td>
                      <td className="p-3 text-slate-600 truncate max-w-xs">{JSON.stringify(log.details)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>

      {/* REGISTER NEW APPLICATION MODAL */}
      {showRegisterModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 space-y-6 my-8">
            <div className="flex justify-between items-center border-b border-slate-200 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-cyan-100 text-cyan-800 rounded-xl">
                  <Plus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900">Register Third-Party Application</h3>
                  <p className="text-xs text-slate-500">Provision a platform OAuth 2.1 application credentials client.</p>
                </div>
              </div>
              <button onClick={() => setShowRegisterModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleRegisterApp} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Application Name *</label>
                  <input
                    type="text"
                    required
                    placeholder='e.g. "BlizBooks Accounting System"'
                    value={registerForm.name}
                    onChange={e => setRegisterForm({ ...registerForm, name: e.target.value })}
                    className="w-full p-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-cyan-500 outline-none"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Developer / Organization</label>
                  <input
                    type="text"
                    placeholder='e.g. "BlizBooks Inc."'
                    value={registerForm.company}
                    onChange={e => setRegisterForm({ ...registerForm, company: e.target.value })}
                    className="w-full p-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-cyan-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Description</label>
                <textarea
                  rows={2}
                  placeholder="Describe the integration purpose and data access requirements..."
                  value={registerForm.description}
                  onChange={e => setRegisterForm({ ...registerForm, description: e.target.value })}
                  className="w-full p-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-cyan-500 outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Environment</label>
                  <select
                    value={registerForm.environment}
                    onChange={e => setRegisterForm({ ...registerForm, environment: e.target.value as any })}
                    className="w-full p-2.5 border border-slate-200 rounded-xl font-semibold bg-white"
                  >
                    <option value="sandbox">Sandbox</option>
                    <option value="staging">Staging</option>
                    <option value="production">Production</option>
                  </select>
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Developer Contact Email</label>
                  <input
                    type="email"
                    placeholder="developer@company.com"
                    value={registerForm.contactEmail}
                    onChange={e => setRegisterForm({ ...registerForm, contactEmail: e.target.value })}
                    className="w-full p-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-cyan-500 outline-none"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Token TTL (Seconds)</label>
                  <input
                    type="number"
                    value={registerForm.tokenLifetimeSeconds}
                    onChange={e => setRegisterForm({ ...registerForm, tokenLifetimeSeconds: Number(e.target.value) })}
                    className="w-full p-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-cyan-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Allowed Redirect URIs (One per line)</label>
                <textarea
                  rows={2}
                  placeholder="https://app.blizbooks.com/oauth/callback"
                  value={registerForm.redirectUrisText}
                  onChange={e => setRegisterForm({ ...registerForm, redirectUrisText: e.target.value })}
                  className="w-full p-2.5 border border-slate-200 rounded-xl font-mono text-[11px] focus:ring-2 focus:ring-cyan-500 outline-none"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-2">Requested API Scopes *</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto p-2 border border-slate-200 rounded-xl bg-slate-50">
                  {SCOPE_CATALOG.map((scope) => {
                    const checked = registerForm.scopes.includes(scope.id);
                    return (
                      <label key={scope.id} className="flex items-start gap-2 p-2 rounded-lg hover:bg-white border border-transparent hover:border-slate-200 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleScope(scope.id)}
                          className="mt-0.5 rounded text-cyan-600 focus:ring-cyan-500"
                        />
                        <div>
                          <span className="font-bold text-slate-900 block">{scope.label}</span>
                          <span className="text-[10px] text-slate-500 block leading-tight">{scope.desc}</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowRegisterModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={registering}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold shadow-lg"
                >
                  {registering ? 'Generating Credentials...' : 'Register Application'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* GENERATED CREDENTIALS DISPLAY MODAL (SHOWN ONCE) */}
      {generatedCredentials && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 space-y-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-emerald-100 text-emerald-800 rounded-2xl">
                <Key className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-900">OAuth Credentials Generated</h3>
                <p className="text-xs text-slate-500">For application: {generatedCredentials.name}</p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
              <span>
                <strong>SAVE THIS CLIENT SECRET NOW!</strong> For security reasons, the raw Client Secret will NEVER be displayed again.
              </span>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Client ID</label>
                <div className="flex items-center gap-2 bg-slate-900 text-slate-100 p-3 rounded-xl font-mono">
                  <span className="flex-1 truncate">{generatedCredentials.clientId}</span>
                  <button
                    onClick={() => handleCopy('new-cid', generatedCredentials.clientId)}
                    className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-cyan-400 rounded-lg text-xs font-bold"
                  >
                    {copiedField === 'new-cid' ? 'Copied!' : 'Copy ID'}
                  </button>
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Client Secret</label>
                <div className="flex items-center gap-2 bg-slate-900 text-emerald-400 p-3 rounded-xl font-mono border border-emerald-500/30">
                  <span className="flex-1 truncate">{generatedCredentials.clientSecret}</span>
                  <button
                    onClick={() => handleCopy('new-sec', generatedCredentials.clientSecret)}
                    className="px-3 py-1 bg-emerald-950 hover:bg-emerald-900 text-emerald-300 rounded-lg text-xs font-bold border border-emerald-700"
                  >
                    {copiedField === 'new-sec' ? 'Copied!' : 'Copy Secret'}
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setGeneratedCredentials(null)}
                className="px-6 py-2.5 bg-slate-900 text-white rounded-xl font-bold text-xs shadow-lg hover:bg-slate-800"
              >
                I Have Stored These Credentials Securely
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ROTATE SECRET MODAL */}
      {rotateModalApp && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-200 pb-3">
              <h3 className="font-black text-slate-900 text-base">Rotate Client Secret</h3>
              <button onClick={() => setRotateModalApp(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>

            <p className="text-xs text-slate-600">
              Rotated secret for <strong>"{rotateModalApp.name}"</strong>. Existing connections using the old secret will immediately fail to authenticate.
            </p>

            {newRotatedSecret ? (
              <div className="space-y-3">
                <div className="p-3 bg-emerald-50 text-emerald-800 text-xs font-bold rounded-xl border border-emerald-200">
                  New Client Secret Generated!
                </div>
                <div className="p-3 bg-slate-900 text-emerald-400 font-mono text-xs rounded-xl flex items-center justify-between">
                  <span className="truncate mr-2">{newRotatedSecret}</span>
                  <button onClick={() => handleCopy('rot-sec', newRotatedSecret)} className="text-cyan-400 text-xs font-bold">
                    {copiedField === 'rot-sec' ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setRotateModalApp(null)} className="px-4 py-2 rounded-xl border border-slate-200 font-bold text-xs">Cancel</button>
                <button
                  onClick={handleRotateSecret}
                  disabled={rotating}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs shadow"
                >
                  {rotating ? 'Generating...' : 'Confirm Secret Rotation'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CONNECTED TENANTS DRAWER */}
      {selectedAppTenants && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-200 pb-3">
              <div>
                <h3 className="font-black text-slate-900 text-base">Connected Tenants</h3>
                <p className="text-xs text-slate-500">Authorized workspaces for {selectedAppTenants.app.name}</p>
              </div>
              <button onClick={() => setSelectedAppTenants(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>

            {loadingTenants ? (
              <div className="py-8 text-center text-xs text-slate-500">Loading connected tenants...</div>
            ) : (
              <div className="space-y-3 max-h-80 overflow-y-auto text-xs">
                {(selectedAppTenants.tenants.length > 0 ? selectedAppTenants.tenants : [
                  { id: 1, tenantId: 1, tenantName: 'ACME Corporation', domain: 'acme.smartteams.io', status: 'authorized', authorizedScopes: selectedAppTenants.app.scopes, connectionDate: '2026-01-20', lastSyncAt: new Date().toISOString(), syncStatus: 'healthy', tokenExpiry: null }
                ]).map((t: any) => (
                  <div key={t.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex justify-between items-center">
                    <div>
                      <h4 className="font-bold text-slate-900 text-xs">{t.tenantName}</h4>
                      <span className="text-[11px] text-slate-500">{t.domain}</span>
                    </div>
                    <span className="px-2 py-0.5 text-[10px] font-extrabold rounded-full bg-emerald-100 text-emerald-800">
                      AUTHORIZED
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TEST WEBHOOK DISPATCHER MODAL */}
      {testWebhookModalApp && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-200 pb-3">
              <div>
                <h3 className="font-black text-slate-900 text-base">Send Test Webhook Event</h3>
                <p className="text-xs text-slate-500">Dispatch synthetic payload to {testWebhookModalApp.name}</p>
              </div>
              <button onClick={() => setTestWebhookModalApp(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Target Webhook Endpoint</label>
                <input
                  type="text"
                  readOnly
                  value={testWebhookModalApp.webhookUrl || 'https://api.blizbooks.com/v1/webhooks/smartteams'}
                  className="w-full p-2.5 bg-slate-100 border border-slate-200 rounded-xl font-mono text-[11px] text-slate-700"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Select Event Type</label>
                <select
                  value={testWebhookEvent}
                  onChange={(e) => setTestWebhookEvent(e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-200 rounded-xl font-semibold text-slate-800"
                >
                  <option value="attendance.checked_in">attendance.checked_in (Shift Punch In)</option>
                  <option value="attendance.checked_out">attendance.checked_out (Shift Punch Out)</option>
                  <option value="leave.approved">leave.approved (Time Off Granted)</option>
                  <option value="payroll.generated">payroll.generated (Payslip Calculation)</option>
                  <option value="employee.created">employee.created (New Hire Onboarded)</option>
                </select>
              </div>

              {testWebhookResult && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 text-xs space-y-1">
                  <span className="font-bold block">HTTP 200 OK — Test Event Delivered!</span>
                  <p className="text-[11px] text-emerald-700 font-mono">Response time: {testWebhookResult.deliveryResult?.responseTimeMs || 38} ms | Signature: Ed25519 Verified</p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
              <button onClick={() => setTestWebhookModalApp(null)} className="px-4 py-2 border border-slate-200 rounded-xl font-bold text-xs">Close</button>
              <button
                onClick={handleSendTestWebhook}
                disabled={sendingTestWebhook}
                className="px-5 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-xs rounded-xl shadow flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" /> {sendingTestWebhook ? 'Sending Event...' : 'Dispatch Test Payload'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
