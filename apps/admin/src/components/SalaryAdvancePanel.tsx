import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Wallet, Plus, Clock, CheckCircle2, XCircle, AlertCircle, Calendar, ArrowRight, X, ChevronDown, ChevronUp, ShieldCheck, RefreshCw, FileText } from 'lucide-react';
import { User } from '../lib/auth';
import StatusPill from './StatusPill';

interface SalaryAdvancePanelProps {
  user: User;
  onRefresh?: () => void;
}

export default function SalaryAdvancePanel({ user }: SalaryAdvancePanelProps) {
  const token = localStorage.getItem('auth_token');
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const [advances, setAdvances] = useState<any[]>([]);
  const [eligibility, setEligibility] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Request Modal State
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestAmount, setRequestAmount] = useState<number>(5000);
  const [recoveryMethod, setRecoveryMethod] = useState<'full_next_payroll' | 'installment'>('full_next_payroll');
  const [installments, setInstallments] = useState<number>(1);
  const [targetYear, setTargetYear] = useState<number>(() => {
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    return nextMonth.getFullYear();
  });
  const [targetMonth, setTargetMonth] = useState<number>(() => {
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    return nextMonth.getMonth() + 1;
  });
  const [reason, setReason] = useState('');
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const [advancesRes, eligibilityRes] = await Promise.all([
        fetch('/api/tenant/payroll/salary-advances/my', { headers: authHeaders }),
        fetch('/api/tenant/payroll/salary-advances/eligibility', { headers: authHeaders }),
      ]);

      const advData = await advancesRes.json();
      const eligData = await eligibilityRes.json();

      if (advancesRes.ok) setAdvances(advData.advances || []);
      if (eligibilityRes.ok) {
        setEligibility(eligData);
        if (eligData.availableAdvance > 0 && requestAmount > eligData.availableAdvance) {
          setRequestAmount(Math.min(5000, eligData.availableAdvance));
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load salary advance information.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleOpenRequestModal = () => {
    if (eligibility && eligibility.availableAdvance > 0) {
      setRequestAmount(Math.min(10000, eligibility.availableAdvance));
    }
    setShowRequestModal(true);
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/tenant/payroll/salary-advances/request', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestedAmount: requestAmount,
          reason,
          remarks,
          recoveryMethod,
          recoveryInstallments: recoveryMethod === 'installment' ? installments : 1,
          startYear: targetYear,
          startMonth: targetMonth,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit salary advance request.');

      setSuccess('Salary advance request submitted successfully.');
      setShowRequestModal(false);
      setReason('');
      setRemarks('');
      await fetchData();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setError(err.message || 'Failed to submit request.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelRequest = async (id: number) => {
    if (!confirm('Are you sure you want to cancel this salary advance request?')) return;
    try {
      const res = await fetch(`/api/tenant/payroll/salary-advances/${id}/cancel`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Cancelled by employee' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to cancel request.');
      setSuccess('Advance request cancelled.');
      await fetchData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to cancel request.');
    }
  };

  const estimatedMonthlyDeduction = useMemo(() => {
    if (!requestAmount || requestAmount <= 0) return 0;
    const count = recoveryMethod === 'installment' ? Math.max(1, installments) : 1;
    return Math.round((requestAmount / count) * 100) / 100;
  }, [requestAmount, recoveryMethod, installments]);

  const targetPeriodLabel = useMemo(() => {
    return new Date(targetYear, targetMonth - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
  }, [targetYear, targetMonth]);

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

  const formatStatusLabel = (status: string) => {
    switch (status) {
      case 'pending_approval':
        return 'Pending Approval';
      case 'pending_disbursement':
        return 'Pending Disbursement';
      case 'partially_recovered':
        return 'In Recovery';
      case 'fully_recovered':
        return 'Fully Recovered';
      default:
        return status.replace('_', ' ').toUpperCase();
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)] text-xs p-4 rounded-xl border border-[var(--color-nexus-error)]/20 font-medium">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-[var(--color-nexus-secondary-container)] text-[var(--color-nexus-secondary)] text-xs p-4 rounded-xl border border-[var(--color-nexus-secondary)]/30 font-medium">
          {success}
        </div>
      )}

      {/* KPI Overview Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="nexus-card rounded-xl p-5 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-[var(--color-nexus-muted)] uppercase tracking-wider block">Available Advance</span>
            <span className="text-2xl font-extrabold text-[var(--color-nexus-ink)] mt-1 block">
              ₹{Number(eligibility?.availableAdvance || 0).toLocaleString()}
            </span>
            <span className="text-[10px] text-[var(--color-nexus-muted)] mt-0.5 block">
              Max limit: ₹{Number(eligibility?.maxAllowed || 0).toLocaleString()}
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-[var(--color-nexus-primary-fixed)] flex items-center justify-center text-[var(--color-nexus-primary)]">
            <Wallet size={24} />
          </div>
        </div>

        <div className="nexus-card rounded-xl p-5 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-[var(--color-nexus-muted)] uppercase tracking-wider block">Outstanding Balance</span>
            <span className="text-2xl font-extrabold text-[var(--color-nexus-warning)] mt-1 block">
              ₹{Number(eligibility?.currentOutstanding || 0).toLocaleString()}
            </span>
            <span className="text-[10px] text-[var(--color-nexus-muted)] mt-0.5 block">
              Active advances: {eligibility?.activeAdvancesCount || 0}
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-[var(--color-nexus-warning-soft)] flex items-center justify-center text-[var(--color-nexus-warning)]">
            <Clock size={24} />
          </div>
        </div>

        <div className="nexus-card rounded-xl p-5 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] flex flex-col justify-center">
          <button
            type="button"
            onClick={handleOpenRequestModal}
            disabled={!eligibility?.eligible || eligibility?.availableAdvance <= 0}
            className="w-full py-3 px-4 rounded-xl bg-[var(--color-nexus-primary)] text-white font-bold text-xs hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
          >
            <Plus size={16} /> Request Salary Advance
          </button>
          {!eligibility?.eligible && eligibility?.reasons?.[0] && (
            <span className="text-[10px] text-[var(--color-nexus-error)] text-center mt-2 leading-tight">
              {eligibility.reasons[0]}
            </span>
          )}
        </div>
      </div>

      {/* Advance History Section */}
      <div className="nexus-card rounded-xl overflow-hidden border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)]">
        <div className="p-4 border-b border-[var(--color-nexus-border)] flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-[var(--color-nexus-ink)]">My Salary Advance History</h3>
            <p className="text-xs text-[var(--color-nexus-muted)] mt-0.5">Track your requests, approval status, and payroll recovery schedules.</p>
          </div>
          <button
            type="button"
            onClick={fetchData}
            className="p-1.5 rounded-lg border border-[var(--color-nexus-border)] hover:bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)] transition"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {advances.length === 0 ? (
          <div className="p-12 text-center text-xs text-[var(--color-nexus-muted)]">
            <Wallet size={36} className="mx-auto mb-2 opacity-40 text-[var(--color-nexus-muted)]" />
            <p className="font-medium">No salary advance requests found.</p>
            <p className="text-[11px] mt-1 opacity-70">When you request a salary advance, its recovery schedule and status will appear here.</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-nexus-border)]">
            {advances.map((adv) => {
              const isExpanded = expandedId === adv.id;
              const total = Number(adv.disbursedAmount || adv.requestedAmount || 0);
              const recovered = Number(adv.recoveredAmount || 0);
              const progressPercent = total > 0 ? Math.min(100, Math.round((recovered / total) * 100)) : 0;

              return (
                <div key={adv.id} className="p-4 hover:bg-[var(--color-nexus-surface-alt)]/50 transition">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-extrabold text-sm text-[var(--color-nexus-ink)]">
                          ₹{Number(adv.requestedAmount).toLocaleString()}
                        </span>
                        <StatusPill tone={getStatusTone(adv.status)} dot>
                          {formatStatusLabel(adv.status)}
                        </StatusPill>
                        <span className="text-[10px] text-[var(--color-nexus-muted)] font-mono">
                          #{adv.id} • {new Date(adv.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--color-nexus-muted)]">
                        Recovery starting: <strong className="text-[var(--color-nexus-ink)]">{new Date(adv.startRecoveryYear, adv.startRecoveryMonth - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' })}</strong> • Method: {adv.recoveryMethod === 'installment' ? `${adv.recoveryInstallments} Installments` : 'Next Payroll'}
                      </p>
                      {adv.reason && <p className="text-[11px] text-[var(--color-nexus-muted)] italic">"{adv.reason}"</p>}
                    </div>

                    <div className="flex items-center gap-3 self-end sm:self-center">
                      {(adv.status === 'disbursed' || adv.status === 'partially_recovered' || adv.status === 'fully_recovered' || adv.status === 'closed') && (
                        <div className="w-28 text-right hidden sm:block">
                          <span className="text-[10px] text-[var(--color-nexus-muted)] block">Recovered: ₹{recovered.toLocaleString()}</span>
                          <div className="w-full bg-[var(--color-nexus-border)] h-1.5 rounded-full overflow-hidden mt-1">
                            <div className="bg-[var(--color-nexus-primary)] h-full transition-all" style={{ width: `${progressPercent}%` }} />
                          </div>
                        </div>
                      )}

                      {adv.status === 'pending_approval' && (
                        <button
                          type="button"
                          onClick={() => handleCancelRequest(adv.id)}
                          className="px-2.5 py-1 rounded-lg border border-[var(--color-nexus-error)]/30 text-[var(--color-nexus-error)] text-[10px] font-bold hover:bg-[var(--color-nexus-error-soft)] transition"
                        >
                          Cancel
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : adv.id)}
                        className="flex items-center gap-1 text-xs font-bold text-[var(--color-nexus-primary)] hover:underline p-1"
                      >
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        <span>{isExpanded ? 'Hide Schedule' : 'View Schedule'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Expanded Recovery Schedule */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-4 pt-3 border-t border-[var(--color-nexus-border)] overflow-hidden"
                      >
                        <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] mb-2 flex items-center gap-1.5">
                          <Calendar size={13} /> Recovery Schedule & Deductions
                        </h4>

                        {!adv.schedule || adv.schedule.length === 0 ? (
                          <div className="text-xs text-[var(--color-nexus-muted)] bg-[var(--color-nexus-surface-alt)] p-3 rounded-lg text-center">
                            Schedule will be generated upon approval and disbursement.
                          </div>
                        ) : (
                          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2">
                            {adv.schedule.map((rec: any, idx: number) => {
                              const isRecovered = rec.status === 'recovered';
                              const monthName = new Date(rec.scheduledYear, rec.scheduledMonth - 1, 1).toLocaleString('default', { month: 'short', year: 'numeric' });

                              return (
                                <div
                                  key={rec.id || idx}
                                  className={`p-2.5 rounded-lg border text-xs flex items-center justify-between ${
                                    isRecovered
                                      ? 'bg-[color:var(--color-nexus-success-text)]/5 border-[color:var(--color-nexus-success-text)]/30'
                                      : 'bg-[var(--color-nexus-surface-alt)] border-[var(--color-nexus-border)]'
                                  }`}
                                >
                                  <div>
                                    <span className="font-bold text-[var(--color-nexus-ink)] block">{monthName}</span>
                                    <span className="text-[10px] text-[var(--color-nexus-muted)]">
                                      Installment {rec.installmentNumber}/{rec.totalInstallments}
                                    </span>
                                  </div>
                                  <div className="text-right">
                                    <span className="font-extrabold text-[var(--color-nexus-ink)] block">
                                      ₹{Number(rec.scheduledAmount).toLocaleString()}
                                    </span>
                                    <span className={`text-[9px] font-bold uppercase ${isRecovered ? 'text-[var(--color-nexus-success-text)]' : 'text-[var(--color-nexus-muted)]'}`}>
                                      {isRecovered ? 'Recovered' : 'Scheduled'}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Request Advance Modal */}
      <AnimatePresence>
        {showRequestModal && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl"
            >
              <div className="p-5 border-b border-[var(--color-nexus-border)] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] flex items-center justify-center">
                    <Wallet size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[var(--color-nexus-ink)]">Request Salary Advance</h3>
                    <p className="text-[11px] text-[var(--color-nexus-muted)]">Available limit: ₹{Number(eligibility?.availableAdvance || 0).toLocaleString()}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowRequestModal(false)}
                  className="p-1 rounded-lg text-[var(--color-nexus-muted)] hover:bg-[var(--color-nexus-surface-alt)]"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSubmitRequest} className="p-5 space-y-4">
                {/* Amount Input */}
                <div>
                  <label className="block text-xs font-bold text-[var(--color-nexus-ink)] mb-1">
                    Advance Amount (₹)
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      min={eligibility?.policy?.advanceMinRecoveryAmount || 1000}
                      max={eligibility?.availableAdvance || 50000}
                      step={500}
                      value={requestAmount}
                      onChange={(e) => setRequestAmount(Number(e.target.value))}
                      required
                      className="w-full px-3 py-2 text-base font-extrabold rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-ink)] focus:outline-[var(--color-nexus-primary)]"
                    />
                  </div>
                  <input
                    type="range"
                    min={eligibility?.policy?.advanceMinRecoveryAmount || 1000}
                    max={eligibility?.availableAdvance || 50000}
                    step={500}
                    value={requestAmount}
                    onChange={(e) => setRequestAmount(Number(e.target.value))}
                    className="w-full mt-2 accent-[var(--color-nexus-primary)]"
                  />
                  <div className="flex justify-between text-[10px] text-[var(--color-nexus-muted)]">
                    <span>Min: ₹{Number(eligibility?.policy?.advanceMinRecoveryAmount || 1000).toLocaleString()}</span>
                    <span>Max: ₹{Number(eligibility?.availableAdvance || 0).toLocaleString()}</span>
                  </div>
                </div>

                {/* Recovery Method & Installments */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-[var(--color-nexus-ink)] mb-1">
                      Recovery Method
                    </label>
                    <select
                      value={recoveryMethod}
                      onChange={(e: any) => setRecoveryMethod(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-ink)]"
                    >
                      <option value="full_next_payroll">Full Next Payroll</option>
                      <option value="installment">Installments</option>
                    </select>
                  </div>

                  {recoveryMethod === 'installment' ? (
                    <div>
                      <label className="block text-xs font-bold text-[var(--color-nexus-ink)] mb-1">
                        Installments
                      </label>
                      <select
                        value={installments}
                        onChange={(e) => setInstallments(Number(e.target.value))}
                        className="w-full px-3 py-2 text-xs rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-ink)]"
                      >
                        {[2, 3, 4, 5, 6].map((num) => (
                          <option key={num} value={num}>{num} Months</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-bold text-[var(--color-nexus-ink)] mb-1">
                        Recovery Cycle
                      </label>
                      <input
                        type="text"
                        disabled
                        value={targetPeriodLabel}
                        className="w-full px-3 py-2 text-xs rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)] font-bold opacity-80"
                      />
                    </div>
                  )}
                </div>

                {/* Target Period Picker */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-[var(--color-nexus-ink)] mb-1">
                      Recovery Start Month
                    </label>
                    <select
                      value={targetMonth}
                      onChange={(e) => setTargetMonth(Number(e.target.value))}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-ink)]"
                    >
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                        <option key={m} value={m}>
                          {new Date(2026, m - 1, 1).toLocaleString('default', { month: 'long' })}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[var(--color-nexus-ink)] mb-1">
                      Recovery Start Year
                    </label>
                    <select
                      value={targetYear}
                      onChange={(e) => setTargetYear(Number(e.target.value))}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-ink)]"
                    >
                      {[new Date().getFullYear(), new Date().getFullYear() + 1].map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Reason & Remarks */}
                <div>
                  <label className="block text-xs font-bold text-[var(--color-nexus-ink)] mb-1">
                    Reason for Advance
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Medical emergency, family assistance, travel"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-ink)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[var(--color-nexus-ink)] mb-1">
                    Additional Remarks (Optional)
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Any additional notes for management"
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-ink)] resize-none"
                  />
                </div>

                {/* Real-time Calculation Simulation Preview */}
                <div className="bg-[var(--color-nexus-primary-fixed)]/20 border border-[var(--color-nexus-primary)]/20 p-3 rounded-xl space-y-1.5 text-xs text-[var(--color-nexus-ink)]">
                  <div className="flex justify-between font-medium">
                    <span>Requested Advance:</span>
                    <span className="font-bold">₹{requestAmount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between font-medium">
                    <span>Recovery Target:</span>
                    <span className="font-bold">{targetPeriodLabel}</span>
                  </div>
                  <div className="flex justify-between font-medium">
                    <span>Estimated Deduction:</span>
                    <span className="font-extrabold text-[var(--color-nexus-primary)]">
                      ₹{estimatedMonthlyDeduction.toLocaleString()}/mo {recoveryMethod === 'installment' ? `(${installments} installments)` : ''}
                    </span>
                  </div>
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowRequestModal(false)}
                    className="px-4 py-2 text-xs font-bold rounded-xl border border-[var(--color-nexus-border)] text-[var(--color-nexus-muted)] hover:bg-[var(--color-nexus-surface-alt)] transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || requestAmount <= 0}
                    className="px-5 py-2 text-xs font-bold rounded-xl bg-[var(--color-nexus-primary)] text-white hover:opacity-90 disabled:opacity-50 transition cursor-pointer"
                  >
                    {submitting ? 'Submitting…' : 'Submit Request'}
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
