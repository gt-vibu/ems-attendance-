import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User } from '../lib/auth';
import AdminWorkspaceLayout from '../components/AdminWorkspaceLayout';
import {
  getCompanyIdentity,
  saveCompanyIdentity,
  CompanyIdentity,
} from '../lib/companyIdentity';
import {
  Building2,
  Globe,
  Mail,
  Phone,
  MapPin,
  Sparkles,
  Upload,
  Check,
  FileText,
  Shield,
  Palette,
  Award,
} from 'lucide-react';

interface CompanyProfilePageProps {
  user: User;
  onLogout?: () => void;
}

export default function CompanyProfilePage({ user, onLogout }: CompanyProfilePageProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'basic' | 'address' | 'branding' | 'reports' | 'compliance'>('basic');
  const [savedSuccess, setSavedSuccess] = useState(false);

  const [identity, setIdentity] = useState<CompanyIdentity>(getCompanyIdentity());
  const [logoPreview, setLogoPreview] = useState<string | null>(identity.logo);

  const handleSaveCompany = (e: React.FormEvent) => {
    e.preventDefault();
    const updated = saveCompanyIdentity({
      ...identity,
      logo: logoPreview,
    });
    setIdentity(updated);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        alert('File size exceeds 2MB limit.');
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

  return (
    <AdminWorkspaceLayout user={user} onLogout={onLogout}>
      <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">
        {/* Top Header Card */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-2xl p-6 shadow-xs">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-[var(--color-nexus-primary)] text-white flex items-center justify-center font-black text-2xl shadow-md overflow-hidden">
              {logoPreview ? (
                <img src={logoPreview} alt="Logo" className="w-full h-full object-contain p-1.5" />
              ) : (
                identity.companyName.charAt(0)
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-extrabold text-[var(--color-nexus-ink)] tracking-tight">{identity.companyName}</h1>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] border border-[var(--color-nexus-primary)]/20">
                  Tenant Admin Verified
                </span>
              </div>
              <p className="text-xs text-[var(--color-nexus-muted)] mt-0.5 italic">
                "{identity.tagline}"
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => navigate('/tenant/admin')}
            className="px-4 py-2 rounded-xl text-xs font-bold text-[var(--color-nexus-muted)] bg-[var(--color-nexus-surface-alt)] hover:text-[var(--color-nexus-ink)] transition-colors border border-[var(--color-nexus-border)]"
          >
            ← Back to Administration Hub
          </button>
        </div>

        {savedSuccess && (
          <div className="p-4 rounded-xl bg-[color:var(--color-nexus-success-text)]/10 border border-[color:var(--color-nexus-success-text)]/20 text-[var(--color-nexus-success-text)] text-xs font-bold flex items-center gap-2 animate-in fade-in duration-200">
            <Check size={16} />
            Organization branding and details updated globally across the platform.
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-1 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-2xl p-3 space-y-1 h-fit shadow-xs">
            {[
              { id: 'basic', label: 'Company Identity', icon: Building2 },
              { id: 'address', label: 'Address & Region', icon: MapPin },
              { id: 'branding', label: 'Logo & Colors', icon: Palette },
              { id: 'reports', label: 'Report Branding', icon: FileText },
              { id: 'compliance', label: 'Tax & Compliance ID', icon: Shield },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-bold text-left transition-all ${
                    isActive
                      ? 'bg-[var(--color-nexus-primary)] text-white shadow-xs'
                      : 'text-[var(--color-nexus-muted)] hover:bg-[var(--color-nexus-surface-alt)] hover:text-[var(--color-nexus-ink)]'
                  }`}
                >
                  <Icon size={16} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="lg:col-span-3 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-2xl p-6 shadow-xs">
            <form onSubmit={handleSaveCompany} className="space-y-6">
              {activeTab === 'basic' && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-base font-extrabold text-[var(--color-nexus-ink)] font-sans">Company Information</h2>
                    <p className="text-xs text-[var(--color-nexus-muted)] mt-0.5">Primary organization profile displayed in headers, dashboards, and official documents.</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                        placeholder="e.g. Building Tomorrow Together"
                        className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-medium"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Website</label>
                      <input
                        type="text"
                        value={identity.website}
                        onChange={(e) => setIdentity({ ...identity, website: e.target.value })}
                        placeholder="https://yourcompany.com"
                        className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-medium"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Support Email</label>
                      <input
                        type="email"
                        value={identity.supportEmail}
                        onChange={(e) => setIdentity({ ...identity, supportEmail: e.target.value })}
                        placeholder="support@yourcompany.com"
                        className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-medium"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'address' && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-base font-extrabold text-[var(--color-nexus-ink)] font-sans">Address &amp; Regional Settings</h2>
                    <p className="text-xs text-[var(--color-nexus-muted)] mt-0.5">Corporate headquarters address and legal currency standards.</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Registered Corporate Address</label>
                      <input
                        type="text"
                        value={identity.address}
                        onChange={(e) => setIdentity({ ...identity, address: e.target.value })}
                        placeholder="Registered Corporate Address"
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

              {activeTab === 'branding' && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-base font-extrabold text-[var(--color-nexus-ink)] font-sans">Logo &amp; Brand Colors</h2>
                    <p className="text-xs text-[var(--color-nexus-muted)] mt-0.5">Upload organization logo and manage visual assets.</p>
                  </div>

                  <div className="flex items-center gap-6 p-4 bg-[var(--color-nexus-surface-alt)] rounded-2xl border border-[var(--color-nexus-border)]">
                    <div className="w-20 h-20 rounded-2xl bg-white border border-[var(--color-nexus-border)] flex items-center justify-center shadow-xs overflow-hidden shrink-0">
                      {logoPreview ? (
                        <img src={logoPreview} alt="Logo Preview" className="w-full h-full object-contain p-2" />
                      ) : (
                        <span className="text-2xl font-black text-[var(--color-nexus-primary)]">{identity.companyName.charAt(0)}</span>
                      )}
                    </div>
                    <div className="space-y-2">
                      <label className="px-4 py-2 rounded-xl bg-[var(--color-nexus-primary)] text-white text-xs font-bold cursor-pointer hover:bg-[var(--color-nexus-primary-hover)] transition-colors inline-flex items-center gap-2 shadow-xs">
                        <Upload size={14} />
                        Upload New Logo
                        <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                      </label>
                      <p className="text-[10px] text-[var(--color-nexus-muted)]">PNG, SVG, or JPG (min 300x300px recommended).</p>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'reports' && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-base font-extrabold text-[var(--color-nexus-ink)] font-sans">Report Header Preview</h2>
                    <p className="text-xs text-[var(--color-nexus-muted)] mt-0.5">Preview generated report branding.</p>
                  </div>

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
                        <p className="text-xs font-bold text-slate-900 mt-1">MONTHLY ATTENDANCE SUMMARY</p>
                        <p className="text-[9.5px] text-slate-500 font-mono mt-0.5">Ref: REF-2026-8801</p>
                      </div>
                    </div>

                    <div className="py-6 text-center text-xs text-slate-400 font-mono border-y border-dashed border-slate-200">
                      [ Report Data Content Table ]
                    </div>

                    <div className="flex items-center justify-between text-[9px] text-slate-400 font-mono pt-2">
                      <span>{identity.companyName}</span>
                      <span>Generated by Smart Teams EMS • Confidential</span>
                      <span>Page 1 of 1</span>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'compliance' && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-base font-extrabold text-[var(--color-nexus-ink)] font-sans">Tax &amp; Compliance Identifiers</h2>
                    <p className="text-xs text-[var(--color-nexus-muted)] mt-0.5">Official corporate numbers.</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Tax Identification Number (Tax ID / GST)</label>
                      <input
                        type="text"
                        value={identity.taxId}
                        onChange={(e) => setIdentity({ ...identity, taxId: e.target.value })}
                        className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-mono font-medium"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1 uppercase tracking-wider">Corporate Registration Number</label>
                      <input
                        type="text"
                        value={identity.regNumber}
                        onChange={(e) => setIdentity({ ...identity, regNumber: e.target.value })}
                        className="w-full px-4 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-mono font-medium"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-6 border-t border-[var(--color-nexus-border)] flex items-center justify-end">
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-xl bg-[var(--color-nexus-primary)] text-white text-xs font-extrabold uppercase tracking-wider hover:bg-[var(--color-nexus-primary-hover)] transition-colors shadow-sm"
                >
                  Save Company Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </AdminWorkspaceLayout>
  );
}
