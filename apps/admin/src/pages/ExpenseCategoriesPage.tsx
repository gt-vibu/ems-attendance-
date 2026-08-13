import { useEffect, useState } from 'react';
import {
  FileText, Plus, Edit2, CheckCircle2, XCircle, Search, Filter, ShieldAlert, X
} from 'lucide-react';
import type { User } from '../lib/auth';
import AdminWorkspaceLayout from '../components/AdminWorkspaceLayout';

export interface ExpenseCategory {
  id: number;
  tenantId: number;
  name: string;
  code: string;
  description: string | null;
  maxLimit: number | null;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export default function ExpenseCategoriesPage({ user, onLogout }: { user: User; onLogout?: () => void }) {
  const token = localStorage.getItem('auth_token');
  const authHeaders = { Authorization: `Bearer ${token}` };

  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'active' | 'inactive'>('ALL');

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ExpenseCategory | null>(null);
  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formMaxLimit, setFormMaxLimit] = useState('');
  const [formStatus, setFormStatus] = useState<'active' | 'inactive'>('active');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchCategories = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/expenses/categories?includeInactive=true', { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.categories)) {
          setCategories(data.categories);
        }
      }
    } catch (err) {
      console.error('Failed to fetch categories:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const resetForm = () => {
    setEditingCategory(null);
    setFormName('');
    setFormCode('');
    setFormDescription('');
    setFormMaxLimit('');
    setFormStatus('active');
    setErrorMsg(null);
  };

  const handleOpenAddModal = () => {
    resetForm();
    setShowModal(true);
  };

  const handleOpenEditModal = (cat: ExpenseCategory) => {
    setEditingCategory(cat);
    setFormName(cat.name);
    setFormCode(cat.code || '');
    setFormDescription(cat.description || '');
    setFormMaxLimit(cat.maxLimit ? cat.maxLimit.toString() : '');
    setFormStatus(cat.status);
    setErrorMsg(null);
    setShowModal(true);
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setErrorMsg('Category name is required.');
      return;
    }

    setSaving(true);
    setErrorMsg(null);

    try {
      const isEdit = !!editingCategory;
      const url = isEdit ? `/api/tenant/expenses/categories/${editingCategory.id}` : '/api/tenant/expenses/categories';
      const method = isEdit ? 'PUT' : 'POST';

      const payload = {
        name: formName.trim(),
        code: formCode.trim() || undefined,
        description: formDescription.trim() || undefined,
        maxLimit: formMaxLimit ? parseFloat(formMaxLimit) : null,
        status: formStatus,
      };

      const res = await fetch(url, {
        method,
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to save category.');
        return;
      }

      setShowModal(false);
      resetForm();
      fetchCategories();
    } catch {
      setErrorMsg('Network error saving category.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (cat: ExpenseCategory) => {
    try {
      const res = await fetch(`/api/tenant/expenses/categories/${cat.id}/toggle-status`, {
        method: 'PATCH',
        headers: authHeaders,
      });

      if (res.ok) {
        fetchCategories();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to update category status.');
      }
    } catch {
      alert('Error toggling category status.');
    }
  };

  const filteredCategories = categories.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.description && c.description.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus = statusFilter === 'ALL' || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <AdminWorkspaceLayout
      user={user}
      onLogout={onLogout}
      title="Expense Categories Governance"
      subtitle="Configure and manage tenant-scoped expense categories for employee submissions and financial reporting."
    >
      <div className="space-y-6">
        {/* Top Control Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] shadow-2xs">
          <div className="flex flex-wrap items-center gap-3 flex-1">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-nexus-muted)]" />
              <input
                type="text"
                placeholder="Search category name or code..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[var(--color-nexus-bg)] border border-[var(--color-nexus-border)] rounded-xl pl-9 pr-3 py-2 text-xs text-[var(--color-nexus-ink)] font-medium focus:ring-indigo-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-[var(--color-nexus-muted)]" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="bg-[var(--color-nexus-bg)] border border-[var(--color-nexus-border)] rounded-xl px-3 py-2 text-xs font-bold text-[var(--color-nexus-ink)]"
              >
                <option value="ALL">All Statuses</option>
                <option value="active">Active Only</option>
                <option value="inactive">Inactive Only</option>
              </select>
            </div>
          </div>

          <button
            type="button"
            onClick={handleOpenAddModal}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-xs flex items-center gap-2 transition-all shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Category</span>
          </button>
        </div>

        {/* Categories Table */}
        <div className="rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] overflow-hidden shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--color-nexus-border)] bg-[var(--color-nexus-bg)] text-[var(--color-nexus-muted)] font-mono uppercase tracking-wider text-[10px]">
                  <th className="py-3.5 px-4 font-bold">Category Name & Code</th>
                  <th className="py-3.5 px-4 font-bold">Description</th>
                  <th className="py-3.5 px-4 font-bold text-right">Max Limit (₹)</th>
                  <th className="py-3.5 px-4 font-bold text-center">Status</th>
                  <th className="py-3.5 px-4 font-bold text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-nexus-border)] font-medium text-[var(--color-nexus-ink)]">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-[var(--color-nexus-muted)]">
                      Loading expense categories...
                    </td>
                  </tr>
                ) : filteredCategories.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-[var(--color-nexus-muted)]">
                      No expense categories found matching your search.
                    </td>
                  </tr>
                ) : (
                  filteredCategories.map((cat) => (
                    <tr key={cat.id} className="hover:bg-[var(--color-nexus-bg)] transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900">{cat.name}</div>
                        <div className="text-[10px] font-mono text-slate-400 uppercase">{cat.code}</div>
                      </td>
                      <td className="py-3.5 px-4 max-w-xs truncate text-slate-600">
                        {cat.description || <span className="italic text-slate-400">No description</span>}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900">
                        {cat.maxLimit ? `₹${cat.maxLimit.toLocaleString('en-IN')}` : 'No Limit'}
                      </td>
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                            cat.status === 'active'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-slate-100 text-slate-500 border-slate-200'
                          }`}
                        >
                          {cat.status === 'active' ? (
                            <>
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Active
                            </>
                          ) : (
                            <>
                              <XCircle className="w-3 h-3 text-slate-400" /> Inactive
                            </>
                          )}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(cat)}
                            className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 transition-all cursor-pointer"
                            title="Edit Category"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleToggleStatus(cat)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
                              cat.status === 'active'
                                ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                                : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                            }`}
                          >
                            {cat.status === 'active' ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Add / Edit Category Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-lg font-black text-slate-900">
                  {editingCategory ? 'Edit Expense Category' : 'Create Expense Category'}
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  {editingCategory ? 'Modify category parameters and limits' : 'Add a new category for tenant expense claims'}
                </p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="w-8 h-8 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleSaveCategory} className="space-y-4 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Category Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Computer Accessories"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-bold focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Category Code (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. COMP_ACC"
                  value={formCode}
                  onChange={(e) => setFormCode(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-mono font-bold focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Description</label>
                <textarea
                  rows={2}
                  placeholder="Brief policy guidelines or description for this category..."
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-medium focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Max Limit per Claim (₹)</label>
                  <input
                    type="number"
                    step="1"
                    placeholder="Optional"
                    value={formMaxLimit}
                    onChange={(e) => setFormMaxLimit(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-bold focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Status</label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-bold focus:ring-indigo-500"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs hover:bg-slate-200 transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-xs transition-all cursor-pointer disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingCategory ? 'Update Category' : 'Create Category'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminWorkspaceLayout>
  );
}
