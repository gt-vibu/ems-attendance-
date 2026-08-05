import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User } from '../lib/auth';
import {
  getCompanyIdentity,
  saveCompanyIdentity,
  CompanyIdentity,
  applyTheme,
} from '../lib/companyIdentity';
import PortalShell, { PortalNavItem } from '../components/PortalShell';
import {
  Home as HomeIcon,
  Clock as ClockIcon,
  Calendar,
  DollarSign,
  Users,
  ClipboardList,
  UserCheck,
  Bell as BellIcon,
  ShieldCheck,
  User as UserIcon,
  Mail,
  Building2,
  Shield,
  Bell,
  Clock,
  Phone,
  Key,
  LogOut,
  Check,
  Globe,
  Lock,
  ArrowLeft,
  Upload,
  Palette,
  FileText,
  Sparkles,
  RotateCcw,
} from 'lucide-react';

const portalNavItems: PortalNavItem[] = [
  { id: 'home', label: 'Home', icon: HomeIcon },
  { id: 'attendance', label: 'Attendance', icon: ClockIcon },
  { id: 'leave', label: 'Leave Management', icon: Calendar },
  { id: 'payroll', label: 'Payroll', icon: DollarSign },
  { id: 'directory', label: 'Directory', icon: Users },
  { id: 'recruitment', label: 'Recruitment', icon: ClipboardList, count: 11 },
  { id: 'teams', label: 'Teams', icon: UserCheck },
  { id: 'notifications', label: 'Notifications', icon: BellIcon },
  { id: 'admin', label: 'Administration', icon: ShieldCheck },
];

interface UserProfilePageProps {
  user: User;
  onLogout?: () => void;
}

export default function UserProfilePage({ user, onLogout }: UserProfilePageProps) {
  const isTenantAdmin = user.role === 'tenant_admin' || user.role === 'super_admin';

  return isTenantAdmin ? (
    <TenantAdminProfileWorkspace user={user} onLogout={onLogout} />
  ) : (
    <EmployeeProfileWorkspace user={user} onLogout={onLogout} />
  );
}

// ============================================================================
// TENANT ADMIN PROFILE & ORGANIZATION BRANDING CENTER
// ============================================================================
function TenantAdminProfileWorkspace({ user, onLogout }: UserProfilePageProps) {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<
    'account' | 'identity' | 'business' | 'branding' | 'notifications' | 'preferences' | 'security'
  >('account');

  const [identity, setIdentity] = useState<CompanyIdentity>(getCompanyIdentity());
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(identity.logo);

  // Password Modal State
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const userInitial = user.name ? user.name.charAt(0).toUpperCase() : user.email.charAt(0).toUpperCase();

  useEffect(() => {
    setLogoPreview(identity.logo);
  }, [identity.logo]);

  const handleSaveAll = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const updated = saveCompanyIdentity({
      ...identity,
      logo: logoPreview,
    });
    setIdentity(updated);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  const handleResetPreferences = () => {
    const defaultIdentity = saveCompanyIdentity({
      theme: 'light',
      timezone: 'UTC-5 (Eastern Time)',
      dateFormat: 'YYYY-MM-DD',
    });
    setIdentity(defaultIdentity);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setIdentity((prev) => ({ ...prev, theme: newTheme }));
    applyTheme(newTheme);
    saveCompanyIdentity({ theme: newTheme });
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        alert('File size exceeds 2MB limit. Please upload a smaller image.');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        setLogoPreview(result);
        saveCompanyIdentity({ logo: result });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return;
    }
    setPasswordError('');
    setShowPasswordModal(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  const handlePortalTabChange = (tabId: string) => {
    if (tabId === 'home') navigate('/dashboard');
    else if (tabId === 'admin') navigate('/tenant/admin');
    else if (tabId === 'notifications') navigate('/dashboard?tab=notifications');
    else if (tabId === 'directory') navigate('/tenant/directory');
    else if (tabId === 'payroll') navigate('/tenant/payroll');
    else if (tabId === 'leave') navigate('/tenant/leave');
    else navigate(`/dashboard?tab=${tabId}`);
  };

  return (
    <PortalShell
      user={user}
      roleLabel="Tenant Administrator"
      navItems={portalNavItems}
      activeTab="profile"
      onTabChange={handlePortalTabChange}
      onLogout={onLogout || (() => {})}
      title="User Profile & Settings"
      subtitle="Personal details, organization identity, and workspace preferences"
    >
      <div className="space-y-6">
        {/* Header Banner */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-2xl p-6 shadow-xs">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="p-2.5 rounded-xl bg-[var(--color-nexus-surface-alt)] hover:bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-primary)] transition-colors"
              title="Back to Dashboard"
            >
              <ArrowLeft size={18} />
            </button>
            {(() => {
              const displayLogo = identity.logo || '/smart-teams-icon.png';
              return (
                <div className="w-14 h-14 rounded-2xl bg-white border border-[var(--color-nexus-border)] flex items-center justify-center shadow-md overflow-hidden shrink-0">
                  {displayLogo ? (
                    <img src={displayLogo} alt="Logo" className="w-full h-full object-contain p-1.5" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  ) : (
                    <span className="text-xl font-black text-[var(--color-nexus-primary)]">{userInitial}</span>
                  )}
                </div>
              );
            })()}
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-extrabold text-[var(--color-nexus-ink)] tracking-tight">{user.name || 'Administrator Account'}</h1>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] border border-[var(--color-nexus-primary)]/20">
                  Organization Administrator
                </span>
              </div>
              <p className="text-xs text-[var(--color-nexus-muted)] mt-0.5">
                {identity.companyName} • <span className="font-semibold">{user.email}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="px-4 py-2 rounded-xl text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 transition-colors flex items-center gap-2 border border-red-200 shadow-xs"
              >
                <LogOut size={15} />
                Sign Out
              </button>
            )}
          </div>
        </div>

      {savedSuccess && (
        <div className="p-4 rounded-xl bg-[color:var(--color-nexus-success-text)]/10 border border-[color:var(--color-nexus-success-text)]/20 text-[var(--color-nexus-success-text)] text-xs font-bold flex items-center gap-2 animate-in fade-in duration-200">
          <Check size={16} />
          Organization settings and branding updated globally.
        </div>
      )}

      {/* Main Layout Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Navigation Sidebar */}
        <div className="lg:col-span-1 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-2xl p-3 space-y-1 h-fit shadow-xs">
          {[
            { id: 'account', label: '1. Administrator Account', icon: Shield },
            { id: 'identity', label: '2. Company Identity', icon: Building2 },
            { id: 'business', label: '3. Business Information', icon: Globe },
            { id: 'branding', label: '4. Workspace Branding', icon: Palette },
            { id: 'notifications', label: '5. Notifications', icon: Bell },
            { id: 'preferences', label: '6. Workspace Preferences', icon: Clock },
            { id: 'security', label: '7. Security & Sessions', icon: Lock },
          ].map((sec) => {
            const Icon = sec.icon;
            const isActive = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => setActiveSection(sec.id as any)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-left transition-all ${
                  isActive
                    ? 'bg-[var(--color-nexus-primary)] text-white shadow-xs'
                    : 'text-[var(--color-nexus-muted)] hover:bg-[var(--color-nexus-surface-alt)] hover:text-[var(--color-nexus-ink)]'
                }`}
              >
                <Icon size={16} />
                {sec.label}
              </button>
            );
          })}
        </div>

        {/* Content Body */}
        <div className="lg:col-span-3 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-2xl p-6 shadow-xs">
          <form onSubmit={handleSaveAll} className="space-y-6">
            {/* SECTION 1: Administrator Account */}
            {activeSection === 'account' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-base font-extrabold text-[var(--color-nexus-ink)] font-sans">Administrator Account</h2>
                  <p className="text-xs text-[var(--color-nexus-muted)] mt-0.5">Primary administrator identity governing the organization workspace.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Administrator Name</label>
                    <input
                      type="text"
                      defaultValue={user.name || 'Tenant Admin'}
                      className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Work Email Address</label>
                    <input
                      type="email"
                      defaultValue={user.email}
                      className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Administrative Role</label>
                    <input
                      type="text"
                      disabled
                      value={user.role === 'super_admin' ? 'Super Administrator' : 'Tenant Administrator'}
                      className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-sunken)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-bold text-[var(--color-nexus-muted)] cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Contact Phone Number</label>
                    <input
                      type="text"
                      value={identity.supportPhone}
                      onChange={(e) => setIdentity({ ...identity, supportPhone: e.target.value })}
                      placeholder="Contact Phone Number"
                      className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-medium"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Last Login Timestamp</label>
                    <div className="p-3 bg-[var(--color-nexus-surface-alt)] rounded-xl border border-[var(--color-nexus-border)] text-xs font-mono text-[var(--color-nexus-muted)]">
                      {new Date().toLocaleString()} (Current Active Session)
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* SECTION 2: Company Identity */}
            {activeSection === 'identity' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-base font-extrabold text-[var(--color-nexus-ink)] font-sans">Company Identity &amp; Branding Center</h2>
                  <p className="text-xs text-[var(--color-nexus-muted)] mt-0.5">Centralized organization branding that automatically propagates across dashboards, headers, and reports.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-2 uppercase tracking-wider">Company Logo</label>
                    <div className="flex items-center gap-6 p-4 bg-[var(--color-nexus-surface-alt)] rounded-2xl border border-[var(--color-nexus-border)]">
                      <div className="w-20 h-20 rounded-2xl bg-white border border-[var(--color-nexus-border)] flex items-center justify-center shadow-xs overflow-hidden shrink-0">
                        {logoPreview ? (
                          <img src={logoPreview} alt="Logo" className="w-full h-full object-contain p-2" />
                        ) : (
                          <span className="text-2xl font-black text-[var(--color-nexus-primary)]">{identity.companyName.charAt(0)}</span>
                        )}
                      </div>
                      <div className="space-y-2">
                        <label className="px-4 py-2 rounded-xl bg-[var(--color-nexus-primary)] text-white text-xs font-bold cursor-pointer hover:bg-[var(--color-nexus-primary-hover)] transition-colors inline-flex items-center gap-2 shadow-xs">
                          <Upload size={14} />
                          Upload Logo (PNG/SVG/JPG)
                          <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                        </label>
                        <p className="text-[10px] text-[var(--color-nexus-muted)]">Max 2MB. Automatically updates all document headers and navigation bars.</p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Company Brand Name</label>
                    <input
                      type="text"
                      value={identity.companyName}
                      onChange={(e) => setIdentity({ ...identity, companyName: e.target.value })}
                      placeholder="e.g. Acme Technologies"
                      className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-bold"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Legal Business Name</label>
                    <input
                      type="text"
                      value={identity.legalName}
                      onChange={(e) => setIdentity({ ...identity, legalName: e.target.value })}
                      placeholder="e.g. Acme Technologies Pvt Ltd"
                      className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-medium"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Company Motto / Tagline</label>
                    <input
                      type="text"
                      value={identity.tagline}
                      onChange={(e) => setIdentity({ ...identity, tagline: e.target.value })}
                      className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Website</label>
                    <input
                      type="text"
                      value={identity.website}
                      onChange={(e) => setIdentity({ ...identity, website: e.target.value })}
                      className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Support Email</label>
                    <input
                      type="email"
                      value={identity.supportEmail}
                      onChange={(e) => setIdentity({ ...identity, supportEmail: e.target.value })}
                      className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-medium"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* SECTION 3: Business Information */}
            {activeSection === 'business' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-base font-extrabold text-[var(--color-nexus-ink)] font-sans">Business Information &amp; Legal Metadata</h2>
                  <p className="text-xs text-[var(--color-nexus-muted)] mt-0.5">Regional taxation, currency, and legal address attributes.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Industry Sector</label>
                    <input
                      type="text"
                      value={identity.industry}
                      onChange={(e) => setIdentity({ ...identity, industry: e.target.value })}
                      placeholder="e.g. Technology / Retail / Healthcare"
                      className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Organization Scale</label>
                    <input
                      type="text"
                      value={identity.orgSize}
                      onChange={(e) => setIdentity({ ...identity, orgSize: e.target.value })}
                      placeholder="e.g. 50-250 Employees"
                      className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Tax Identification Number (Tax ID / GST)</label>
                    <input
                      type="text"
                      value={identity.taxId}
                      onChange={(e) => setIdentity({ ...identity, taxId: e.target.value })}
                      placeholder="Tax ID / GST Number"
                      className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-mono font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Registration Number</label>
                    <input
                      type="text"
                      value={identity.regNumber}
                      onChange={(e) => setIdentity({ ...identity, regNumber: e.target.value })}
                      placeholder="Corporate Registration Number"
                      className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-mono font-medium"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Registered Office Address</label>
                    <input
                      type="text"
                      value={identity.address}
                      onChange={(e) => setIdentity({ ...identity, address: e.target.value })}
                      placeholder="Registered Office Address"
                      className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">City</label>
                    <input
                      type="text"
                      value={identity.city}
                      onChange={(e) => setIdentity({ ...identity, city: e.target.value })}
                      placeholder="City"
                      className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Country</label>
                    <input
                      type="text"
                      value={identity.country}
                      onChange={(e) => setIdentity({ ...identity, country: e.target.value })}
                      placeholder="Country"
                      className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-medium"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* SECTION 4: Workspace Branding */}
            {activeSection === 'branding' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-base font-extrabold text-[var(--color-nexus-ink)] font-sans">Workspace Branding Preview</h2>
                  <p className="text-xs text-[var(--color-nexus-muted)] mt-0.5">Live demonstration of branding integration across reports and exported documents.</p>
                </div>

                {/* Report Live Header Preview */}
                <div className="p-6 bg-white rounded-2xl border border-slate-200 shadow-md text-slate-900 font-sans space-y-4">
                  <div className="flex items-start justify-between pb-4 border-b-2 border-slate-900">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-blue-600 text-white font-black text-xl flex items-center justify-center shrink-0 overflow-hidden">
                        {logoPreview ? (
                          <img src={logoPreview} alt="Logo" className="w-full h-full object-contain p-1.5" />
                        ) : (
                          identity.companyName.charAt(0)
                        )}
                      </div>
                      <div>
                        <h3 className="font-extrabold text-base text-slate-900 leading-tight">{identity.companyName}</h3>
                        <p className="text-[10px] text-slate-500 mt-0.5">{identity.legalName}</p>
                        <p className="text-[9px] text-slate-400 font-mono mt-0.5">{identity.address}, {identity.city}, {identity.country}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="px-2.5 py-1 rounded bg-slate-100 text-slate-800 text-[10px] font-bold uppercase font-mono tracking-wider">Enterprise Report</span>
                      <p className="text-xs font-bold text-slate-900 mt-1">ATTENDANCE &amp; PAYROLL SUMMARY</p>
                      <p className="text-[9.5px] text-slate-500 font-mono mt-0.5">Report ID: ATT-2026-08-00023</p>
                    </div>
                  </div>

                  <div className="py-6 text-center text-xs text-slate-400 font-mono border-y border-dashed border-slate-200">
                    [ Sample Operational Table Content ]
                  </div>

                  <div className="flex items-center justify-between text-[9px] text-slate-400 font-mono pt-2">
                    <span>{identity.companyName}</span>
                    <span>Generated by Smart Teams EMS • Confidential</span>
                    <span>Page 1 of 1</span>
                  </div>
                </div>
              </div>
            )}

            {/* SECTION 5: Notification Preferences */}
            {activeSection === 'notifications' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-base font-extrabold text-[var(--color-nexus-ink)] font-sans">Notification Delivery Preferences</h2>
                  <p className="text-xs text-[var(--color-nexus-muted)] mt-0.5">Configure system alert notification channels for the administrator.</p>
                </div>

                <div className="space-y-3">
                  <label className="flex items-center justify-between p-4 bg-[var(--color-nexus-surface-alt)] rounded-xl border border-[var(--color-nexus-border)] cursor-pointer">
                    <div>
                      <span className="text-xs font-bold text-[var(--color-nexus-ink)] block">Email Notifications</span>
                      <span className="text-[11px] text-[var(--color-nexus-muted)] block">Receive critical attendance, payroll batch, and security alerts via email.</span>
                    </div>
                    <input type="checkbox" defaultChecked className="w-4 h-4 accent-[var(--color-nexus-primary)]" />
                  </label>

                  <label className="flex items-center justify-between p-4 bg-[var(--color-nexus-surface-alt)] rounded-xl border border-[var(--color-nexus-border)] cursor-pointer">
                    <div>
                      <span className="text-xs font-bold text-[var(--color-nexus-ink)] block">In-App Header Bell Alerts</span>
                      <span className="text-[11px] text-[var(--color-nexus-muted)] block">Show real-time unread badges in top navigation bell popover.</span>
                    </div>
                    <input type="checkbox" defaultChecked className="w-4 h-4 accent-[var(--color-nexus-primary)]" />
                  </label>
                </div>
              </div>
            )}

            {/* SECTION 6: Working Workspace Preferences */}
            {activeSection === 'preferences' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-base font-extrabold text-[var(--color-nexus-ink)] font-sans">Working Workspace Preferences</h2>
                  <p className="text-xs text-[var(--color-nexus-muted)] mt-0.5">Functional interface customization. Changes take effect immediately.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-2 uppercase tracking-wider">Application Theme</label>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { value: 'light', label: 'Enterprise Light', desc: 'Clean high-contrast daytime interface' },
                        { value: 'dark', label: 'Enterprise Dark', desc: 'Sleek dark mode theme' },
                        { value: 'system', label: 'Follow System', desc: 'Syncs automatically with OS settings' },
                      ].map((t) => (
                        <button
                          key={t.value}
                          type="button"
                          onClick={() => handleThemeChange(t.value as any)}
                          className={`p-4 rounded-xl border text-left transition-all ${
                            identity.theme === t.value
                              ? 'bg-[var(--color-nexus-primary-fixed)] border-[var(--color-nexus-primary)] font-bold text-[var(--color-nexus-primary)] shadow-xs'
                              : 'bg-[var(--color-nexus-surface-alt)] border-[var(--color-nexus-border)] text-[var(--color-nexus-ink)] hover:bg-[var(--color-nexus-surface)]'
                          }`}
                        >
                          <span className="block text-xs font-extrabold">{t.label}</span>
                          <span className="block text-[10px] text-[var(--color-nexus-muted)] mt-1">{t.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Default Timezone</label>
                    <select
                      value={identity.timezone}
                      onChange={(e) => setIdentity({ ...identity, timezone: e.target.value })}
                      className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-medium"
                    >
                      <option value="UTC-5 (Eastern Time)">UTC-5 (Eastern Time)</option>
                      <option value="UTC-8 (Pacific Time)">UTC-8 (Pacific Time)</option>
                      <option value="UTC+0 (GMT/UTC)">UTC+0 (GMT/UTC)</option>
                      <option value="UTC+5:30 (India Standard Time)">UTC+5:30 (IST)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Date Display Format</label>
                    <select
                      value={identity.dateFormat}
                      onChange={(e) => setIdentity({ ...identity, dateFormat: e.target.value })}
                      className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-medium"
                    >
                      <option value="YYYY-MM-DD">YYYY-MM-DD (2026-08-05)</option>
                      <option value="DD/MM/YYYY">DD/MM/YYYY (05/08/2026)</option>
                      <option value="MM/DD/YYYY">MM/DD/YYYY (08/05/2026)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* SECTION 7: Security */}
            {activeSection === 'security' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-base font-extrabold text-[var(--color-nexus-ink)] font-sans">Security &amp; Active Sessions</h2>
                  <p className="text-xs text-[var(--color-nexus-muted)] mt-0.5">Password policies and session logs.</p>
                </div>

                <div className="space-y-4">
                  <div className="p-4 bg-[var(--color-nexus-surface-alt)] rounded-xl border border-[var(--color-nexus-border)] flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-[var(--color-nexus-ink)] block">Password Safeguards</span>
                      <span className="text-[11px] text-[var(--color-nexus-muted)] block">Change your administrative account password.</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowPasswordModal(true)}
                      className="px-4 py-2 rounded-xl bg-[var(--color-nexus-primary)] text-white text-xs font-bold hover:bg-[var(--color-nexus-primary-hover)] transition-colors shadow-xs"
                    >
                      Change Password
                    </button>
                  </div>

                  <div className="p-4 bg-[var(--color-nexus-surface-alt)] rounded-xl border border-[var(--color-nexus-border)]">
                    <span className="text-xs font-bold text-[var(--color-nexus-ink)] block mb-1">Active Administrator Web Session</span>
                    <div className="flex items-center justify-between text-xs py-2 border-t border-[var(--color-nexus-border)]/60">
                      <div>
                        <span className="font-semibold block text-[var(--color-nexus-ink)]">Chrome / Windows (Current Device)</span>
                        <span className="text-[10px] text-[var(--color-nexus-muted)] font-mono">Logged in at {new Date().toLocaleTimeString()}</span>
                      </div>
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 font-bold text-[10px] rounded-full">Active Session</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* SECTION 8: Account Actions */}
            <div className="pt-6 border-t border-[var(--color-nexus-border)] flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-xl bg-[var(--color-nexus-primary)] text-white text-xs font-extrabold uppercase tracking-wider hover:bg-[var(--color-nexus-primary-hover)] transition-colors shadow-sm cursor-pointer"
                >
                  Save Changes
                </button>
                <button
                  type="button"
                  onClick={handleResetPreferences}
                  className="px-4 py-2.5 rounded-xl bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] text-xs font-bold text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)] transition-colors flex items-center gap-2"
                >
                  <RotateCcw size={14} />
                  Reset Preferences
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* Password Change Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <h3 className="text-base font-extrabold text-[var(--color-nexus-ink)]">Change Admin Password</h3>
            {passwordError && (
              <div className="p-3 rounded-lg bg-red-50 text-red-600 text-xs font-bold">{passwordError}</div>
            )}
            <form onSubmit={handleChangePassword} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1">Current Password</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-4 py-2 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-4 py-2 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1">Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-4 py-2 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs"
                  required
                />
              </div>
              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowPasswordModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-[var(--color-nexus-muted)] hover:bg-[var(--color-nexus-surface-alt)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-[var(--color-nexus-primary)] text-white text-xs font-bold"
                >
                  Update Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>
    </PortalShell>
  );
}

// ============================================================================
// EMPLOYEE SELF-SERVICE PROFILE WORKSPACE
// ============================================================================
function EmployeeProfileWorkspace({ user, onLogout }: UserProfilePageProps) {
  const navigate = useNavigate();
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [activeTab, setActiveTab] = useState<'personal' | 'contact' | 'notifications' | 'security'>('personal');

  const userInitial = user.name ? user.name.charAt(0).toUpperCase() : user.email.charAt(0).toUpperCase();

  const handleSaveEmployeeProfile = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  const handlePortalTabChange = (tabId: string) => {
    if (tabId === 'home') navigate('/employee/dashboard');
    else navigate(`/dashboard?tab=${tabId}`);
  };

  return (
    <PortalShell
      user={user}
      roleLabel={user.role}
      navItems={portalNavItems}
      activeTab="profile"
      onTabChange={handlePortalTabChange}
      onLogout={onLogout || (() => {})}
      title="Employee Profile & Settings"
      subtitle="Personal information and contact preferences"
    >
      <div className="space-y-6">
        {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-2xl p-6 shadow-xs">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => navigate('/employee/dashboard')}
            className="p-2.5 rounded-xl bg-[var(--color-nexus-surface-alt)] hover:bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-primary)] transition-colors"
            title="Back"
          >
            <ArrowLeft size={18} />
          </button>
          {(() => {
            const identityLogo = getCompanyIdentity().logo || '/smart-teams-icon.png';
            return (
              <div className="w-14 h-14 rounded-full bg-white border border-[var(--color-nexus-border)] flex items-center justify-center shadow-md overflow-hidden shrink-0">
                {identityLogo ? (
                  <img src={identityLogo} alt="Avatar" className="w-full h-full object-contain p-1.5" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                ) : (
                  <span className="text-xl font-black text-[var(--color-nexus-primary)]">{userInitial}</span>
                )}
              </div>
            );
          })()}
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-extrabold text-[var(--color-nexus-ink)] tracking-tight">{user.name || 'Employee Profile'}</h1>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-blue-50 text-blue-700 border border-blue-200">
                {user.role}
              </span>
            </div>
            <p className="text-xs text-[var(--color-nexus-muted)] mt-0.5">
              Employee ID: <span className="font-mono font-semibold text-[var(--color-nexus-ink)]">EMP-10{user.id || '1'}</span> • {user.email}
            </p>
          </div>
        </div>

        {onLogout && (
          <button
            type="button"
            onClick={onLogout}
            className="px-4 py-2 rounded-xl text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 transition-colors flex items-center gap-2 border border-red-200 shadow-xs"
          >
            <LogOut size={15} />
            Sign Out
          </button>
        )}
      </div>

      {savedSuccess && (
        <div className="p-4 rounded-xl bg-[color:var(--color-nexus-success-text)]/10 border border-[color:var(--color-nexus-success-text)]/20 text-[var(--color-nexus-success-text)] text-xs font-bold flex items-center gap-2 animate-in fade-in duration-200">
          <Check size={16} />
          Employee profile details updated.
        </div>
      )}

      {/* Tabs */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-2xl p-3 space-y-1 h-fit shadow-xs">
          {[
            { id: 'personal', label: 'Personal Information', icon: UserIcon },
            { id: 'contact', label: 'Contact Details', icon: Mail },
            { id: 'notifications', label: 'Notifications', icon: Bell },
            { id: 'security', label: 'Security & Login', icon: Lock },
          ].map((t) => {
            const Icon = t.icon;
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id as any)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-left transition-all ${
                  isActive
                    ? 'bg-[var(--color-nexus-primary)] text-white shadow-xs'
                    : 'text-[var(--color-nexus-muted)] hover:bg-[var(--color-nexus-surface-alt)] hover:text-[var(--color-nexus-ink)]'
                }`}
              >
                <Icon size={16} />
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="lg:col-span-3 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-2xl p-6 shadow-xs">
          <form onSubmit={handleSaveEmployeeProfile} className="space-y-6">
            {activeTab === 'personal' && (
              <div className="space-y-6">
                <h2 className="text-base font-extrabold text-[var(--color-nexus-ink)]">Employee Record &amp; HR Structure</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Full Name</label>
                    <input type="text" defaultValue={user.name} className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-medium" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Employee ID</label>
                    <input type="text" disabled value={`EMP-10${user.id || '1'}`} className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-sunken)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-mono font-bold text-[var(--color-nexus-muted)] cursor-not-allowed" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Designation / Role</label>
                    <input type="text" disabled value={user.role} className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-sunken)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-bold text-[var(--color-nexus-muted)] cursor-not-allowed" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Department</label>
                    <input type="text" defaultValue={user.department || ''} placeholder="e.g. Engineering / Operations" className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-medium" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Assigned Branch</label>
                    <input type="text" disabled value="Main Headquarters" className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-sunken)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-medium text-[var(--color-nexus-muted)] cursor-not-allowed" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Reporting Manager</label>
                    <input type="text" placeholder="Assigned Reporting Manager" className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-medium" />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'contact' && (
              <div className="space-y-6">
                <h2 className="text-base font-extrabold text-[var(--color-nexus-ink)]">Contact Information</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Work Email</label>
                    <input type="email" defaultValue={user.email} className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-medium" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Mobile Number</label>
                    <input type="text" placeholder="Mobile Phone Number" className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-medium" />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'notifications' && (
              <div className="space-y-6">
                <h2 className="text-base font-extrabold text-[var(--color-nexus-ink)]">Notification Preferences</h2>
                <label className="flex items-center justify-between p-4 bg-[var(--color-nexus-surface-alt)] rounded-xl border border-[var(--color-nexus-border)] cursor-pointer">
                  <span className="text-xs font-bold text-[var(--color-nexus-ink)]">Email Notifications</span>
                  <input type="checkbox" defaultChecked className="w-4 h-4 accent-[var(--color-nexus-primary)]" />
                </label>
              </div>
            )}

            {activeTab === 'security' && (
              <div className="space-y-6">
                <h2 className="text-base font-extrabold text-[var(--color-nexus-ink)]">Security Settings</h2>
                <p className="text-xs text-[var(--color-nexus-muted)]">Password &amp; device verification methods.</p>
              </div>
            )}

            <div className="pt-6 border-t border-[var(--color-nexus-border)] flex justify-start">
              <button type="submit" className="px-6 py-2.5 rounded-xl bg-[var(--color-nexus-primary)] text-white text-xs font-bold uppercase tracking-wider">
                Save Profile
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </PortalShell>
);
}
