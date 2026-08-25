import React, { useState } from 'react';
import type { User } from '../lib/auth';
import AdminWorkspaceLayout from '../components/AdminWorkspaceLayout';
import StatutoryRulesView from '../components/compliance/StatutoryRulesView';
import CompanyPolicyConfig from '../components/compliance/CompanyPolicyConfig';
import { ShieldCheck, Scale, Settings2, FileCheck } from 'lucide-react';

export default function CompliancePage({ user, onLogout }: { user: User; onLogout?: () => void }) {
  const [tab, setTab] = useState<'catalog' | 'company_policy'>('catalog');

  return (
    <AdminWorkspaceLayout
      user={user}
      onLogout={onLogout}
      title="India Payroll Legal & Statutory Compliance"
      subtitle="Effective-dated statutory rule catalog, company compliance policy, and tax law engine"
    >
      <div className="space-y-6">
        {/* Navigation Sub-Header */}
        <div className="nexus-card rounded-2xl p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <span className="font-bold text-sm text-slate-900 dark:text-slate-100">Compliance & Statutory Governance</span>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setTab('catalog')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                tab === 'catalog'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              <Scale className="w-4 h-4" />
              Statutory Rules Catalog (Layer A)
            </button>

            <button
              onClick={() => setTab('company_policy')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                tab === 'company_policy'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              <Settings2 className="w-4 h-4" />
              Company Payroll Policy (Layer B)
            </button>
          </div>
        </div>

        {/* Tab View Component */}
        {tab === 'catalog' ? <StatutoryRulesView /> : <CompanyPolicyConfig />}
      </div>
    </AdminWorkspaceLayout>
  );
}
