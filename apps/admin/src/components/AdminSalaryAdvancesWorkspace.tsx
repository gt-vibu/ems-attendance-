import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Wallet, Plus, Clock, CheckCircle2, XCircle, AlertCircle, Calendar,
  ArrowRight, X, ChevronDown, ChevronUp, ShieldCheck, RefreshCw,
  Search, Filter, User as UserIcon, DollarSign, FileText, Send, Building,
  CreditCard, Check, Ban
} from 'lucide-react';
import { User } from '../lib/auth';
import StatusPill from './StatusPill';

interface AdminSalaryAdvancesWorkspaceProps {
  user: User;
}

export default function AdminSalaryAdvancesWorkspace({ user }: AdminSalaryAdvancesWorkspaceProps) {
  const token = localStorage.getItem('auth_token');
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const [advances, setAdvances] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any>({
    pendingCount: 0,
    approvedCount: 0,
    disbursedCount: 0,
    totalOutstanding: 0,
    closedCount: 0,
    totalCount: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [originFilter, setOriginFilter] = useState('all');
  const [selectedYear, setSelectedYear] = useState<number | ''>('');
  const [selectedMonth, setSelectedMonth] = useState<number | ''>('');

  // Modals
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showDisburseModal, setShowDisburseModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [selectedAdvance, setSelectedAdvance] = useState<any>(null);

  // Assign Form State
  const [employees, setEmployees] = useState<any[]>([]);
  const [assignUserId, setAssignUserId] = useState<number | ''>('');
  const [assignAmount, setAssignAmount] = useState<number>(10000);
  const [assignRecoveryMethod, setAssignRecoveryMethod] = useState<'full_next_payroll' | 'installment'>('full_next_payroll');
  const [assignInstallments, setAssignInstallments] = useState<number>(1);
  const [assignStartYear, setAssignStartYear] = useState<number>(() => {
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    return nextMonth.getFullYear();
  });
  const [assignStartMonth, setAssignStartMonth] = useState<number>(() => {
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    return nextMonth.getMonth() + 1;
  });
  const [assignReason, setAssignReason] = useState('');
  const [assignRemarks, setAssignRemarks] = useState('');
  const [assignAutoApprove, setAssignAutoApprove] = useState(true);
  const [assignEligibility, setAssignEligibility] = useState<any>(null);
  const [checkingEligibility, setCheckingEligibility] = useState(false);
  const [submittingAssign, setSubmittingAssign] = useState(false);

  // Review Form State
  const [reviewApprovedAmount, setReviewApprovedAmount] = useState<number>(0);
  const [reviewRemarks, setReviewRemarks] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [actionInProgress, setActionInProgress] = useState(false);

  // Disburse Form State
  const [disburseAmount, setDisburseAmount] = useState<number>(0);
  const [disburseMethod, setDisburseMethod] = useState('bank_transfer');
  const [disburseReference, setDisburseReference] = useState('');
  const [disbursing, setDisbursing] = useState(false);

  // Fetch Advances
  const fetchAdvances = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.append('status', statusFilter);
      if (originFilter !== 'all') params.append('origin', originFilter);
      if (selectedYear) params.append('startYear', String(selectedYear));
      if (selectedMonth) params.append('startMonth', String(selectedMonth));
      if (search.trim()) params.append('search', search.trim());

      const res = await fetch(`/api/tenant/payroll/salary-advances?${params.toString()}`, { headers: authHeaders });
      const data = await res.json();
      if (res.ok) {
        setAdvances(data.advances || []);
        if (data.metrics) setMetrics(data.metrics);
      } else {
        throw new Error(data.error || 'Failed to fetch salary advances.');
      }
    } catch (err: any) {
      setError(err.message || 'Error loading advances.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, originFilter, selectedYear, selectedMonth, search, authHeaders]);

  // Fetch Employees for Assign Modal
  const fetchEmployees = async () => {
    try {
      const res = await fetch('/api/tenant/users', { headers: authHeaders });
      const data = await res.json();
      if (res.ok && Array.isArray(data.users)) {
        setEmployees(data.users.filter((u: any) => u.role !== 'tenant_admin' && u.employeeStatus !== 'terminated'));
      }
    } catch {
      // Non-blocking
    }
  };

  useEffect(() => {
    fetchAdvances();
  }, [fetchAdvances]);

  useEffect(() => {
    fetchEmployees();
  }, []);

  // When selected user changes in Assign modal, fetch their live eligibility
  useEffect(() => {
    if (!assignUserId) {
      setAssignEligibility(null);
      return;
    }
    let active = true;
    setCheckingEligibility(true);
    fetch(`/api/tenant/payroll/salary-advances/eligibility?userId=${assignUserId}&amount=${assignAmount}&recoveryMonths=${assignRecoveryMethod === 'installment' ? assignInstallments : 1}`, {
      headers: authHeaders,
    })
      .then((res) => res.json())
      .then((data) => {
        if (active) setAssignEligibility(data);
      })
      .catch(() => {
        if (active) setAssignEligibility(null);
      })
      .finally(() => {
        if (active) setCheckingEligibility(false);
      });

    return () => {
      active = false;
    };
  }, [assignUserId, assignAmount, assignRecoveryMethod, assignInstallments, authHeaders]);

  // Open Review Modal
  const handleOpenReview = (adv: any) => {
    setSelectedAdvance(adv);
    setReviewApprovedAmount(Number(adv.approvedAmount || adv.requestedAmount || 0));
    setReviewRemarks(adv.remarks || '');
    setRejectionReason('');
    setShowReviewModal(true);
  };

  // Open Disburse Modal
  const handleOpenDisburse = (adv: any) => {
    setSelectedAdvance(adv);
    setDisburseAmount(Number(adv.approvedAmount || adv.requestedAmount || 0));
    setDisburseMethod(adv.disbursementMethod || 'bank_transfer');
    setDisburseReference('');
    setShowDisburseModal(true);
  };

  // Open Schedule Modal
  const handleOpenSchedule = async (adv: any) => {
    try {
      const res = await fetch(`/api/tenant/payroll/salary-advances/${adv.id}`, { headers: authHeaders });
      const data = await res.json();
      if (res.ok && data.advance) {
        setSelectedAdvance(data.advance);
      } else {
        setSelectedAdvance(adv);
      }
      setShowScheduleModal(true);
    } catch {
      setSelectedAdvance(adv);
      setShowScheduleModal(true);
    }
  };

  // Handle Approve Action
  const handleApprove = async () => {
    if (!selectedAdvance) return;
    setActionInProgress(true);
    setError('');
    try {
      const res = await fetch(`/api/tenant/payroll/salary-advances/${selectedAdvance.id}/approve`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvedAmount: reviewApprovedAmount,
          remarks: reviewRemarks,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to approve salary advance.');
      setSuccess(`Salary advance #${selectedAdvance.id} approved successfully.`);
      setShowReviewModal(false);
      await fetchAdvances();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Error approving advance.');
    } finally {
      setActionInProgress(false);
    }
  };

  // Handle Reject Action
  const handleReject = async () => {
    if (!selectedAdvance) return;
    if (!rejectionReason.trim()) {
      setError('Please provide a reason for rejecting this advance request.');
      return;
    }
    setActionInProgress(true);
    setError('');
    try {
      const res = await fetch(`/api/tenant/payroll/salary-advances/${selectedAdvance.id}/reject`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectionReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reject salary advance.');
      setSuccess(`Salary advance #${selectedAdvance.id} rejected.`);
      setShowReviewModal(false);
      await fetchAdvances();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Error rejecting advance.');
    } finally {
      setActionInProgress(false);
    }
  };

  // Handle Disburse Action
  const handleDisburse = async () => {
    if (!selectedAdvance) return;
    setDisbursing(true);
    setError('');
    try {
      const res = await fetch(`/api/tenant/payroll/salary-advances/${selectedAdvance.id}/disburse`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          disbursedAmount: disburseAmount,
          disbursementMethod: disburseMethod,
          disbursementReference: disburseReference || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to disburse salary advance.');
      setSuccess(`Salary advance #${selectedAdvance.id} marked as disbursed.`);
      setShowDisburseModal(false);
      await fetchAdvances();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Error disbursing advance.');
    } finally {
      setDisbursing(false);
    }
  };

  // Handle Direct Assign
  const handleAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignUserId) return;
    setSubmittingAssign(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/payroll/salary-advances/assign', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: Number(assignUserId),
          amount: assignAmount,
          reason: assignReason || 'Assigned by management',
          remarks: assignRemarks,
          recoveryMethod: assignRecoveryMethod,
          recoveryInstallments: assignRecoveryMethod === 'installment' ? assignInstallments : 1,
          startYear: assignStartYear,
          startMonth: assignStartMonth,
          autoApprove: assignAutoApprove,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to assign salary advance.');
      setSuccess('Salary advance assigned successfully.');
      setShowAssignModal(false);
      setAssignUserId('');
      setAssignReason('');
      setAssignRemarks('');
      await fetchAdvances();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Error assigning salary advance.');
    } finally {
      setSubmittingAssign(false);
    }
  };

  const getStatusTone = (status: string) => {
    switch (status) {
      case 'disbursed':
      case 'partially_recovered':
        return 'warning';
      case 'fully_recovered':
      case 'closed':
        return 'success';
      case 'approved':
      case 'pending_disbursement':
        return 'info';
      case 'pending_approval':
      case 'draft':
        return 'warning';
      case 'rejected':
      case 'cancelled':
      case 'voided':
        return 'error';
      default:
        return 'neutral';
    }
  };

  return (
    <div className="space-y-6 font-sans">
      {error && (
        <div className="bg-rose-50 text-rose-800 text-xs p-4 rounded-xl border border-rose-200 font-medium">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-emerald-50 text-emerald-800 text-xs p-4 rounded-xl border border-emerald-200 font-medium">
          {success}
        </div>
      )}

      {/* Top Metrics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Pending Approval</span>
          <span className="text-xl font-extrabold text-amber-600 mt-1 block">{metrics.pendingCount}</span>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Awaiting Disbursal</span>
          <span className="text-xl font-extrabold text-indigo-600 mt-1 block">{metrics.approvedCount}</span>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Active / Disbursed</span>
          <span className="text-xl font-extrabold text-blue-600 mt-1 block">{metrics.disbursedCount}</span>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Outstanding</span>
          <span className="text-xl font-extrabold text-slate-900 mt-1 block">₹{Number(metrics.totalOutstanding || 0).toLocaleString()}</span>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Fully Recovered</span>
          <span className="text-xl font-extrabold text-emerald-600 mt-1 block">{metrics.closedCount}</span>
        </div>
      </div>

      {/* Control Bar: Filters & Action */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap flex-1">
          <div className="relative min-w-[200px] flex-1">
            <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search by employee name or reason…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-indigo-500"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-700 bg-white"
          >
            <option value="all">All Statuses</option>
            <option value="pending_approval">Pending Approval</option>
            <option value="approved">Approved</option>
            <option value="disbursed">Disbursed</option>
            <option value="partially_recovered">In Recovery</option>
            <option value="closed">Closed / Recovered</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>

          <select
            value={originFilter}
            onChange={(e) => setOriginFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-700 bg-white"
          >
            <option value="all">All Origins</option>
            <option value="EMPLOYEE_REQUEST">Employee Requested</option>
            <option value="ADMIN_ASSIGNED">Admin Assigned</option>
          </select>

          <button
            type="button"
            onClick={fetchAdvances}
            className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
            title="Refresh List"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <button
          type="button"
          onClick={() => setShowAssignModal(true)}
          className="px-3.5 py-2 rounded-lg bg-indigo-600 text-white font-semibold text-xs hover:bg-indigo-700 transition flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
        >
          <Plus size={15} /> Assign Salary Advance
        </button>
      </div>

      {/* Advances Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
        {advances.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400">
            <Wallet size={36} className="mx-auto mb-2 text-slate-300" />
            <p className="font-medium text-slate-600">No salary advance records match your filter criteria.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b border-slate-200">
                  <th className="p-3">Employee</th>
                  <th className="p-3">Requested</th>
                  <th className="p-3">Approved / Disbursed</th>
                  <th className="p-3">Outstanding</th>
                  <th className="p-3">Recovery Plan</th>
                  <th className="p-3">Origin</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {advances.map((adv) => {
                  const emp = adv.employee || {};
                  const isPending = adv.status === 'pending_approval';
                  const isApproved = adv.status === 'approved';
                  const isDisbursed = adv.status === 'disbursed' || adv.status === 'partially_recovered';

                  return (
                    <tr key={adv.id} className="hover:bg-slate-50/70 transition">
                      <td className="p-3">
                        <span className="font-bold text-slate-900 block">{emp.name || `User #${adv.userId}`}</span>
                        <span className="text-[11px] text-slate-400 block">{emp.email || emp.department || ''}</span>
                      </td>
                      <td className="p-3">
                        <span className="font-extrabold text-slate-900 block">₹{Number(adv.requestedAmount).toLocaleString()}</span>
                        <span className="text-[10px] text-slate-400">{new Date(adv.createdAt).toLocaleDateString()}</span>
                      </td>
                      <td className="p-3">
                        <span className="font-medium text-slate-700">
                          {adv.disbursedAmount ? `₹${Number(adv.disbursedAmount).toLocaleString()}` : adv.approvedAmount ? `₹${Number(adv.approvedAmount).toLocaleString()}` : '—'}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className="font-extrabold text-amber-700">₹{Number(adv.outstandingAmount).toLocaleString()}</span>
                        {Number(adv.recoveredAmount) > 0 && (
                          <span className="text-[10px] text-emerald-600 block">Rec: ₹{Number(adv.recoveredAmount).toLocaleString()}</span>
                        )}
                      </td>
                      <td className="p-3">
                        <span className="font-medium text-slate-800 block">
                          {new Date(adv.startRecoveryYear, adv.startRecoveryMonth - 1, 1).toLocaleString('default', { month: 'short', year: 'numeric' })}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {adv.recoveryMethod === 'installment' ? `${adv.recoveryInstallments} installments` : 'Full recovery'}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600 uppercase">
                          {adv.origin === 'ADMIN_ASSIGNED' ? 'Admin' : 'Employee'}
                        </span>
                      </td>
                      <td className="p-3">
                        <StatusPill tone={getStatusTone(adv.status)} dot>
                          {adv.status.replace('_', ' ').toUpperCase()}
                        </StatusPill>
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {isPending && (
                            <button
                              type="button"
                              onClick={() => handleOpenReview(adv)}
                              className="px-2.5 py-1 text-[11px] font-bold rounded-md bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition"
                            >
                              Review
                            </button>
                          )}
                          {isApproved && (
                            <button
                              type="button"
                              onClick={() => handleOpenDisburse(adv)}
                              className="px-2.5 py-1 text-[11px] font-bold rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition"
                            >
                              Disburse
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleOpenSchedule(adv)}
                            className="px-2 py-1 text-[11px] font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded transition"
                          >
                            Schedule
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Review Modal */}
      <AnimatePresence>
        {showReviewModal && selectedAdvance && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl"
            >
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                    <ShieldCheck size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Review Salary Advance #{selectedAdvance.id}</h3>
                    <p className="text-[11px] text-slate-500">{selectedAdvance.employee?.name || `User #${selectedAdvance.userId}`}</p>
                  </div>
                </div>
                <button type="button" onClick={() => setShowReviewModal(false)} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100">
                  <X size={18} />
                </button>
              </div>

              <div className="p-5 space-y-4 text-xs">
                <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-mono block">Requested Amount</span>
                    <strong className="text-slate-900 text-sm">₹{Number(selectedAdvance.requestedAmount).toLocaleString()}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-mono block">Recovery Target</span>
                    <strong className="text-slate-900 text-sm">
                      {new Date(selectedAdvance.startRecoveryYear, selectedAdvance.startRecoveryMonth - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' })}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-mono block">Recovery Method</span>
                    <span className="text-slate-700 font-medium">{selectedAdvance.recoveryMethod === 'installment' ? `${selectedAdvance.recoveryInstallments} Monthly Installments` : 'Full Next Payroll'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-mono block">Origin</span>
                    <span className="text-slate-700 font-medium">{selectedAdvance.origin}</span>
                  </div>
                </div>

                {selectedAdvance.reason && (
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Reason Given</span>
                    <p className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 text-slate-700">{selectedAdvance.reason}</p>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    Approved Amount (₹)
                  </label>
                  <input
                    type="number"
                    value={reviewApprovedAmount}
                    onChange={(e) => setReviewApprovedAmount(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 font-extrabold text-slate-900 focus:outline-indigo-500"
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">You can adjust the approved amount before decision.</span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    Review Remarks / Comments
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Approved per policy limit"
                    value={reviewRemarks}
                    onChange={(e) => setReviewRemarks(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    Rejection Reason (Required only if rejecting)
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Enter reason if rejecting request…"
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-slate-800 resize-none"
                  />
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleReject}
                    disabled={actionInProgress}
                    className="px-4 py-2 text-xs font-bold rounded-lg border border-rose-200 text-rose-700 bg-rose-50 hover:bg-rose-100 transition"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={handleApprove}
                    disabled={actionInProgress || reviewApprovedAmount <= 0}
                    className="px-5 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition"
                  >
                    Approve Advance
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Disburse Modal */}
      <AnimatePresence>
        {showDisburseModal && selectedAdvance && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl"
            >
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                    <DollarSign size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Disburse Salary Advance #{selectedAdvance.id}</h3>
                    <p className="text-[11px] text-slate-500">{selectedAdvance.employee?.name || `User #${selectedAdvance.userId}`}</p>
                  </div>
                </div>
                <button type="button" onClick={() => setShowDisburseModal(false)} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100">
                  <X size={18} />
                </button>
              </div>

              <div className="p-5 space-y-4 text-xs">
                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    Disbursed Amount (₹)
                  </label>
                  <input
                    type="number"
                    value={disburseAmount}
                    onChange={(e) => setDisburseAmount(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 font-extrabold text-slate-900 focus:outline-emerald-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-800 mb-1">
                      Payment Method
                    </label>
                    <select
                      value={disburseMethod}
                      onChange={(e) => setDisburseMethod(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 text-slate-800"
                    >
                      <option value="bank_transfer">Bank Transfer (NEFT/IMPS)</option>
                      <option value="upi">UPI</option>
                      <option value="cash">Cash</option>
                      <option value="check">Check</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-800 mb-1">
                      Payment Reference / UTR #
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. UTR12345678"
                      value={disburseReference}
                      onChange={(e) => setDisburseReference(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 text-slate-800"
                    />
                  </div>
                </div>

                <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-emerald-900 space-y-1">
                  <span className="font-bold block">Recovery Commitment:</span>
                  <p className="text-[11px]">
                    Disbursement will activate recovery of <strong>₹{disburseAmount.toLocaleString()}</strong> starting in <strong>{new Date(selectedAdvance.startRecoveryYear, selectedAdvance.startRecoveryMonth - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' })}</strong> across {selectedAdvance.recoveryInstallments} installment(s).
                  </p>
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDisburseModal(false)}
                    className="px-4 py-2 text-xs font-bold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDisburse}
                    disabled={disbursing || disburseAmount <= 0}
                    className="px-5 py-2 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition"
                  >
                    {disbursing ? 'Disbursing…' : 'Confirm Disbursement'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Schedule Drilldown Modal */}
      <AnimatePresence>
        {showScheduleModal && selectedAdvance && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white border border-slate-200 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl"
            >
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                    <Calendar size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Recovery Schedule — Advance #{selectedAdvance.id}</h3>
                    <p className="text-[11px] text-slate-500">{selectedAdvance.employee?.name || `User #${selectedAdvance.userId}`}</p>
                  </div>
                </div>
                <button type="button" onClick={() => setShowScheduleModal(false)} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100">
                  <X size={18} />
                </button>
              </div>

              <div className="p-5 space-y-4 text-xs">
                <div className="grid grid-cols-3 gap-2 text-center bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-mono block">Total Disbursed</span>
                    <strong className="text-slate-900 text-sm">₹{Number(selectedAdvance.disbursedAmount || selectedAdvance.requestedAmount || 0).toLocaleString()}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-mono block">Recovered</span>
                    <strong className="text-emerald-600 text-sm">₹{Number(selectedAdvance.recoveredAmount || 0).toLocaleString()}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-mono block">Outstanding</span>
                    <strong className="text-amber-600 text-sm">₹{Number(selectedAdvance.outstandingAmount || 0).toLocaleString()}</strong>
                  </div>
                </div>

                {!selectedAdvance.schedule || selectedAdvance.schedule.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 border border-dashed border-slate-200 rounded-xl">
                    No recovery schedule entries generated yet. Schedule is created upon disbursement.
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b border-slate-200">
                          <th className="p-2.5">Installment</th>
                          <th className="p-2.5">Period</th>
                          <th className="p-2.5">Scheduled</th>
                          <th className="p-2.5">Recovered</th>
                          <th className="p-2.5">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selectedAdvance.schedule.map((rec: any) => (
                          <tr key={rec.id} className="hover:bg-slate-50">
                            <td className="p-2.5 font-bold">{rec.installmentNumber} of {rec.totalInstallments}</td>
                            <td className="p-2.5 text-slate-700">
                              {new Date(rec.scheduledYear, rec.scheduledMonth - 1, 1).toLocaleString('default', { month: 'short', year: 'numeric' })}
                            </td>
                            <td className="p-2.5 font-semibold text-slate-900">₹{Number(rec.scheduledAmount).toLocaleString()}</td>
                            <td className="p-2.5 text-emerald-600 font-semibold">₹{Number(rec.recoveredAmount || 0).toLocaleString()}</td>
                            <td className="p-2.5">
                              <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded ${rec.status === 'recovered' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                                {rec.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowScheduleModal(false)}
                    className="px-4 py-2 text-xs font-bold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
                  >
                    Close
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Assign Modal */}
      <AnimatePresence>
        {showAssignModal && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl"
            >
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                    <Plus size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Assign Salary Advance</h3>
                    <p className="text-[11px] text-slate-500">Create an administrative salary advance for an employee</p>
                  </div>
                </div>
                <button type="button" onClick={() => setShowAssignModal(false)} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100">
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleAssignSubmit} className="p-5 space-y-4 text-xs">
                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">Select Employee</label>
                  <select
                    required
                    value={assignUserId}
                    onChange={(e) => setAssignUserId(Number(e.target.value) || '')}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-slate-800 bg-white"
                  >
                    <option value="">-- Choose Employee --</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name} ({emp.email || emp.department || `#${emp.id}`})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Eligibility preview */}
                {assignEligibility && (
                  <div className={`p-3 rounded-xl border ${assignEligibility.eligible ? 'bg-indigo-50/50 border-indigo-100 text-indigo-950' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
                    <div className="flex justify-between font-bold text-xs mb-1">
                      <span>Available Advance Limit:</span>
                      <span>₹{Number(assignEligibility.availableAdvance || 0).toLocaleString()}</span>
                    </div>
                    <div className="text-[11px] text-slate-600 flex justify-between">
                      <span>Current Outstanding: ₹{Number(assignEligibility.currentOutstanding || 0).toLocaleString()}</span>
                      <span>Tenure: {assignEligibility.tenureMonths} month(s)</span>
                    </div>
                    {!assignEligibility.eligible && assignEligibility.reasons?.length > 0 && (
                      <div className="mt-2 text-[11px] text-rose-700">
                        Warning: {assignEligibility.reasons.join(' ')}
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">Advance Amount (₹)</label>
                  <input
                    type="number"
                    min={100}
                    step={500}
                    required
                    value={assignAmount}
                    onChange={(e) => setAssignAmount(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 font-extrabold text-slate-900"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-800 mb-1">Recovery Method</label>
                    <select
                      value={assignRecoveryMethod}
                      onChange={(e: any) => setAssignRecoveryMethod(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 text-slate-800 bg-white"
                    >
                      <option value="full_next_payroll">Full Next Payroll</option>
                      <option value="installment">Installments</option>
                    </select>
                  </div>

                  {assignRecoveryMethod === 'installment' && (
                    <div>
                      <label className="block text-xs font-bold text-slate-800 mb-1">Installments (Months)</label>
                      <select
                        value={assignInstallments}
                        onChange={(e) => setAssignInstallments(Number(e.target.value))}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 text-slate-800 bg-white"
                      >
                        {[2, 3, 4, 5, 6].map((num) => (
                          <option key={num} value={num}>{num} Months</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-800 mb-1">Target Start Month</label>
                    <select
                      value={assignStartMonth}
                      onChange={(e) => setAssignStartMonth(Number(e.target.value))}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 text-slate-800 bg-white"
                    >
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                        <option key={m} value={m}>
                          {new Date(2026, m - 1, 1).toLocaleString('default', { month: 'long' })}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-800 mb-1">Target Start Year</label>
                    <select
                      value={assignStartYear}
                      onChange={(e) => setAssignStartYear(Number(e.target.value))}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 text-slate-800 bg-white"
                    >
                      {[new Date().getFullYear(), new Date().getFullYear() + 1].map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">Reason / Purpose</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Festival assistance, emergency allowance"
                    value={assignReason}
                    onChange={(e) => setAssignReason(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 text-slate-800"
                  />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="autoApprove"
                    checked={assignAutoApprove}
                    onChange={(e) => setAssignAutoApprove(e.target.checked)}
                    className="rounded text-indigo-600"
                  />
                  <label htmlFor="autoApprove" className="text-xs font-medium text-slate-700 cursor-pointer">
                    Auto-approve immediately (moves straight to Awaiting Disbursal)
                  </label>
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAssignModal(false)}
                    className="px-4 py-2 text-xs font-bold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingAssign || !assignUserId}
                    className="px-5 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition"
                  >
                    {submittingAssign ? 'Assigning…' : 'Confirm Assignment'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
