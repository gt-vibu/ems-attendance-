import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { User } from '../lib/auth';
import { Bell, Mail, Smartphone, FileText, Clock, CheckCircle2, XCircle, Send, RotateCcw, Layers, GitBranch } from 'lucide-react';
import AdminWorkspaceLayout from '../components/AdminWorkspaceLayout';

interface NotificationPoliciesPageProps {
  user: User;
  onLogout?: () => void;
}

// Human-readable labels for every event type currently wired to notify()
// (services/notificationService.ts's DEFAULT_POLICIES) — keeping this list
// in sync with that file is a manual step for now (no shared export of
// labels between the two), same tradeoff every other admin config screen
// in this app already makes for event/category labels.
const EVENT_LABELS: Record<string, string> = {
  attendance_auto_absent: 'Auto Absent',
  attendance_missed_checkout: 'Missed Checkout',
  attendance_correction_requested: 'Attendance Correction Requested',
  attendance_correction_decided: 'Attendance Correction Decided',
  late_arrival_requested: 'Late Arrival Requested',
  late_arrival_decided: 'Late Arrival Decided',
  leave_requested: 'Leave Applied',
  leave_decided: 'Leave Approved / Rejected',
  leave_encashment_requested: 'Leave Encashment Requested',
  leave_encashment_decided: 'Leave Encashment Approved / Rejected',
  wfh_requested: 'WFH Requested',
  wfh_decided: 'WFH Approved / Rejected',
  shift_assigned: 'Shift Assigned',
  shift_changed: 'Shift Changed',
  shift_swap_requested: 'Shift Swap Requested',
  shift_swap_decided: 'Shift Swap Approved / Rejected',
  payroll_generated: 'Payroll Generated',
  payroll_salary_changed: 'Salary Changed',
  payroll_batch_calculated: 'Payroll Batch Calculated',
  payroll_batch_approved: 'Payroll Approved',
  payroll_batch_released: 'Payroll Released',
  salary_revised: 'Salary Revision Approved',
  bonus_added: 'Bonus Added',
  loan_approved: 'Loan Approved',
  reimbursement_approved: 'Reimbursement Approved / Rejected',
  payroll_adjustment_created: 'Payroll Adjustment Created',
  report_generation_completed: 'Scheduled Report Delivered',
  notification_delivery_failed: 'Notification Delivery Failed (Critical)',
  payroll_batch_calculation_failed: 'Payroll Batch Calculation Failed (Critical)',
};

type DeliveryMode = 'immediate' | 'digest' | 'none';
type Priority = 'critical' | 'high' | 'medium' | 'low' | 'silent';

interface Policy {
  eventType: string;
  notifyEmployee: boolean;
  notifyManager: boolean;
  notifyHR: boolean;
  notifyAdmin: boolean;
  channels: string[];
  scopeHrToDepartment: boolean;
  employeeMode: DeliveryMode;
  managerMode: DeliveryMode;
  hrMode: DeliveryMode;
  adminMode: DeliveryMode;
  priority: Priority;
}

const MODE_OPTIONS: { value: DeliveryMode; label: string }[] = [
  { value: 'immediate', label: 'Immediate' },
  { value: 'digest', label: 'Digest' },
  { value: 'none', label: 'None' },
];

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'silent', label: 'Silent (in-app only)' },
];

interface Template {
  eventType: string;
  channel: string;
  subject: string | null;
  body: string;
}

interface RecipientGroup {
  id: number;
  name: string;
  notifyEmployee: boolean;
  notifyManager: boolean;
  notifyHR: boolean;
  notifyAdmin: boolean;
  channels: string[];
}

// Exposes the existing notification_policies AND notification_templates
// tables through one settings screen (Recipients tab was built first;
// Templates tab reuses GET/PUT /api/tenant/notification-templates, which
// already existed server-side — services/notificationTemplates.ts renders
// a tenant's custom subject/body over the generic default whenever one is
// saved here, no new backend logic).
export default function NotificationPoliciesPage({ user, onLogout }: NotificationPoliciesPageProps) {
  const token = localStorage.getItem('auth_token');
  const authHeaders = { Authorization: `Bearer ${token}` };

  const [activeTab, setActiveTab] = useState<'recipients' | 'digests' | 'escalation' | 'templates' | 'history'>('recipients');

  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [policies, setPolicies] = useState<Record<string, Policy>>({});
  const [loading, setLoading] = useState(true);
  const [savingEvent, setSavingEvent] = useState<string | null>(null);
  const [testingEvent, setTestingEvent] = useState<string | null>(null);
  const [testSentFor, setTestSentFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const defaultPolicy = (eventType: string): Policy => ({
    eventType, notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], scopeHrToDepartment: false,
    employeeMode: 'immediate', managerMode: 'immediate', hrMode: 'immediate', adminMode: 'immediate', priority: 'medium',
  });

  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tenant/notification-policies', { headers: authHeaders });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Failed to load.'); return; }
      const map: Record<string, Policy> = {};
      for (const et of (d.eventTypes || [])) map[et] = defaultPolicy(et);
      for (const p of (d.policies || [])) map[p.eventType] = {
        eventType: p.eventType, notifyEmployee: p.notifyEmployee, notifyManager: p.notifyManager, notifyHR: p.notifyHR, notifyAdmin: p.notifyAdmin,
        channels: Array.isArray(p.channels) ? p.channels : ['in_app', 'email'], scopeHrToDepartment: !!p.scopeHrToDepartment,
        employeeMode: p.employeeMode || 'immediate', managerMode: p.managerMode || 'immediate', hrMode: p.hrMode || 'immediate', adminMode: p.adminMode || 'immediate',
        priority: p.priority || 'medium',
      };
      setEventTypes(d.eventTypes || []);
      setPolicies(map);
    } finally {
      setLoading(false);
    }
  }, []);

  const sendTest = async (eventType: string) => {
    setTestingEvent(eventType);
    setTestSentFor(null);
    try {
      const res = await fetch('/api/tenant/notifications/test', {
        method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType }),
      });
      if (res.ok) { setTestSentFor(eventType); setTimeout(() => setTestSentFor(null), 3000); }
      else { const d = await res.json(); setError(d.error || 'Failed to send test notification.'); }
    } finally {
      setTestingEvent(null);
    }
  };

  useEffect(() => { fetchPolicies(); }, [fetchPolicies]);

  // ---- Recipient Groups ----
  const [groups, setGroups] = useState<RecipientGroup[]>([]);
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroup, setNewGroup] = useState({ notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'] as string[] });
  const [applyingGroupTo, setApplyingGroupTo] = useState<string | null>(null);

  const fetchGroups = useCallback(async () => {
    const res = await fetch('/api/tenant/notification-recipient-groups', { headers: authHeaders });
    const d = await res.json();
    if (res.ok) setGroups(Array.isArray(d.groups) ? d.groups : []);
  }, []);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  const createGroup = async () => {
    if (!newGroupName.trim()) return;
    const res = await fetch('/api/tenant/notification-recipient-groups', {
      method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newGroupName.trim(), ...newGroup }),
    });
    if (res.ok) {
      setNewGroupName('');
      setNewGroup({ notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'] });
      setShowGroupForm(false);
      await fetchGroups();
    } else {
      const d = await res.json();
      setError(d.error || 'Failed to create group.');
    }
  };

  const deleteGroup = async (id: number) => {
    const res = await fetch(`/api/tenant/notification-recipient-groups/${id}`, { method: 'DELETE', headers: authHeaders });
    if (res.ok) await fetchGroups();
  };

  const applyGroupToEvent = async (groupId: number, eventType: string) => {
    setApplyingGroupTo(eventType);
    try {
      const res = await fetch(`/api/tenant/notification-recipient-groups/${groupId}/apply`, {
        method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventTypes: [eventType] }),
      });
      if (res.ok) await fetchPolicies();
      else { const d = await res.json(); setError(d.error || 'Failed to apply group.'); }
    } finally {
      setApplyingGroupTo(null);
    }
  };

  const updateLocal = (eventType: string, patch: Partial<Policy>) => {
    setPolicies((prev) => ({ ...prev, [eventType]: { ...(prev[eventType] || defaultPolicy(eventType)), ...patch } }));
  };

  const save = async (eventType: string) => {
    setSavingEvent(eventType);
    try {
      const policy = policies[eventType];
      const res = await fetch('/api/tenant/notification-policies', {
        method: 'PUT', headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(policy),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Failed to save.'); }
    } finally {
      setSavingEvent(null);
    }
  };

  const toggleChannel = (eventType: string, channel: string) => {
    const policy = policies[eventType] || defaultPolicy(eventType);
    const channels = policy.channels.includes(channel) ? policy.channels.filter((c) => c !== channel) : [...policy.channels, channel];
    updateLocal(eventType, { channels });
  };

  // ---- Templates tab state ----
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [editEventType, setEditEventType] = useState<string>('');
  const [editChannel, setEditChannel] = useState<'email' | 'in_app'>('email');
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);

  const fetchTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const res = await fetch('/api/tenant/notification-templates', { headers: authHeaders });
      const d = await res.json();
      if (res.ok) setTemplates(Array.isArray(d.templates) ? d.templates : []);
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => { if (activeTab === 'templates') fetchTemplates(); }, [activeTab, fetchTemplates]);

  // ---- History tab state ----
  interface LogEntry { id: number; eventType: string; channel: string; status: string; error: string | null; attempts?: number; createdAt: string; recipientName: string | null; }
  const [historyEntries, setHistoryEntries] = useState<LogEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<number | null>(null);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch('/api/tenant/notification-log', { headers: authHeaders });
      const d = await res.json();
      if (res.ok) setHistoryEntries(Array.isArray(d.entries) ? d.entries : []);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => { if (activeTab === 'history') fetchHistory(); }, [activeTab, fetchHistory]);

  const retryDelivery = async (id: number) => {
    setRetryingId(id);
    try {
      const res = await fetch(`/api/tenant/notification-log/${id}/retry`, { method: 'POST', headers: authHeaders });
      if (res.ok) await fetchHistory();
      else { const d = await res.json(); setError(d.error || 'Failed to retry delivery.'); }
    } finally {
      setRetryingId(null);
    }
  };

  // ---- Digests tab state ----
  interface DigestSubscription { id: number; digestType: string; frequency: string; timeOfDay: string; dayOfWeek: number | null; recipients: any[]; active: boolean; lastRunAt: string | null; }
  const [subscriptions, setSubscriptions] = useState<DigestSubscription[]>([]);
  const [subscriptionsLoading, setSubscriptionsLoading] = useState(true);
  const [savingSubscription, setSavingSubscription] = useState<number | null>(null);

  const DIGEST_LABELS: Record<string, string> = {
    manager_daily: 'Manager Digest (Daily)', manager_weekly: 'Manager Digest (Weekly)',
    hr_daily: 'HR Digest (Daily)', hr_weekly: 'HR Digest (Weekly)',
    executive_daily: 'Executive Summary (Daily)', executive_weekly: 'Executive Summary (Weekly)',
  };

  const fetchSubscriptions = useCallback(async () => {
    setSubscriptionsLoading(true);
    try {
      const res = await fetch('/api/tenant/notification-digest-subscriptions', { headers: authHeaders });
      const d = await res.json();
      if (res.ok) setSubscriptions(Array.isArray(d.subscriptions) ? d.subscriptions : []);
    } finally {
      setSubscriptionsLoading(false);
    }
  }, []);

  useEffect(() => { if (activeTab === 'digests') fetchSubscriptions(); }, [activeTab, fetchSubscriptions]);

  const updateSubscriptionLocal = (id: number, patch: Partial<DigestSubscription>) => {
    setSubscriptions((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const saveSubscription = async (sub: DigestSubscription) => {
    setSavingSubscription(sub.id);
    try {
      const res = await fetch(`/api/tenant/notification-digest-subscriptions/${sub.id}`, {
        method: 'PUT', headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ frequency: sub.frequency, timeOfDay: sub.timeOfDay, dayOfWeek: sub.dayOfWeek, recipients: sub.recipients, active: sub.active }),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Failed to save digest subscription.'); }
      else await fetchSubscriptions();
    } finally {
      setSavingSubscription(null);
    }
  };

  // Same "fetch the full tenant employee list once, filter client-side"
  // pattern DelegationPage.tsx already uses for its own recipient picker —
  // no dedicated employee-search endpoint/component exists in this app yet
  // to build against instead.
  interface EmployeeOption { id: number; name: string; email: string; role: string }
  const [employeeOptions, setEmployeeOptions] = useState<EmployeeOption[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState<Record<number, string>>({});

  useEffect(() => {
    if (activeTab !== 'digests') return;
    fetch('/api/tenant/employees', { headers: authHeaders })
      .then((r) => r.json())
      .then((d) => setEmployeeOptions(Array.isArray(d.employees) ? d.employees : []))
      .catch(() => setEmployeeOptions([]));
  }, [activeTab]);

  const addNamedRecipient = (sub: DigestSubscription, employee: EmployeeOption) => {
    const already = sub.recipients.some((r: any) => r.type === 'user' && r.userId === employee.id);
    if (already) return;
    updateSubscriptionLocal(sub.id, { recipients: [...sub.recipients, { type: 'user', userId: employee.id, name: employee.name, email: employee.email }] });
    setEmployeeSearch((prev) => ({ ...prev, [sub.id]: '' }));
  };

  const removeRecipient = (sub: DigestSubscription, index: number) => {
    updateSubscriptionLocal(sub.id, { recipients: sub.recipients.filter((_: any, i: number) => i !== index) });
  };

  const toggleRoleRecipient = (sub: DigestSubscription, role: string) => {
    const idx = sub.recipients.findIndex((r: any) => r.type === 'role' && r.role === role);
    const next = idx >= 0 ? sub.recipients.filter((_: any, i: number) => i !== idx) : [...sub.recipients, { type: 'role', role }];
    updateSubscriptionLocal(sub.id, { recipients: next });
  };

  useEffect(() => {
    if (!editEventType) { setEditSubject(''); setEditBody(''); return; }
    const existing = templates.find((t) => t.eventType === editEventType && t.channel === editChannel);
    setEditSubject(existing?.subject || '');
    setEditBody(existing?.body || '');
  }, [editEventType, editChannel, templates]);

  const saveTemplate = async () => {
    if (!editEventType || !editBody.trim()) return;
    setTemplateSaving(true);
    setTemplateSaved(false);
    try {
      const res = await fetch('/api/tenant/notification-templates', {
        method: 'PUT', headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType: editEventType, channel: editChannel, subject: editSubject.trim() || null, body: editBody }),
      });
      if (res.ok) {
        setTemplateSaved(true);
        await fetchTemplates();
        setTimeout(() => setTemplateSaved(false), 2500);
      } else {
        const d = await res.json();
        setError(d.error || 'Failed to save template.');
      }
    } finally {
      setTemplateSaving(false);
    }
  };

  const customizedFor = (eventType: string) => templates.some((t) => t.eventType === eventType);

  return (
    <AdminWorkspaceLayout
      user={user}
      onLogout={onLogout}
      title="Notification Center & Policies"
      subtitle="Choose who gets notified, how, and what the message says across organization events."
    >
      <div className="space-y-6 font-sans">

      <div className="flex gap-1 mb-5 border-b border-slate-200 overflow-x-auto">
        <button onClick={() => setActiveTab('recipients')} className={`flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2.5 -mb-px border-b-2 transition whitespace-nowrap ${activeTab === 'recipients' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
          <Bell className="w-3.5 h-3.5" /> Recipients & Channels
        </button>
        <button onClick={() => setActiveTab('digests')} className={`flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2.5 -mb-px border-b-2 transition whitespace-nowrap ${activeTab === 'digests' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
          <Layers className="w-3.5 h-3.5" /> Digests
        </button>
        <button onClick={() => setActiveTab('escalation')} className={`flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2.5 -mb-px border-b-2 transition whitespace-nowrap ${activeTab === 'escalation' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
          <GitBranch className="w-3.5 h-3.5" /> Escalation
        </button>
        <button onClick={() => setActiveTab('templates')} className={`flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2.5 -mb-px border-b-2 transition whitespace-nowrap ${activeTab === 'templates' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
          <FileText className="w-3.5 h-3.5" /> Message Templates
        </button>
        <button onClick={() => setActiveTab('history')} className={`flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2.5 -mb-px border-b-2 transition whitespace-nowrap ${activeTab === 'history' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
          <Clock className="w-3.5 h-3.5" /> History
        </button>
      </div>

      {error && <div className="mb-4 p-3 rounded-lg bg-rose-50 text-rose-700 text-xs">{error}</div>}

      {activeTab === 'recipients' && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Recipient Groups</h2>
              <p className="text-[11px] text-slate-400 mt-0.5">Reusable presets — save a recipient/channel combination once, then apply it to any event's row below instead of re-checking the same boxes.</p>
            </div>
            <button onClick={() => setShowGroupForm((v) => !v)} className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:border-indigo-300 shrink-0">
              {showGroupForm ? 'Cancel' : '+ New Group'}
            </button>
          </div>

          {showGroupForm && (
            <div className="mb-3 p-3 rounded-lg border border-slate-100 bg-slate-50 flex flex-wrap items-center gap-3">
              <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="Group name (e.g. Payroll Group)" className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 flex-1 min-w-[160px]" />
              {([['notifyEmployee', 'Employee'], ['notifyManager', 'Manager'], ['notifyHR', 'HR'], ['notifyAdmin', 'Tenant Admin']] as const).map(([k, label]) => (
                <label key={k} className="flex items-center gap-1 text-[11px] font-medium text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={(newGroup as any)[k]} onChange={(e) => setNewGroup((g) => ({ ...g, [k]: e.target.checked }))} className="rounded text-indigo-600" />
                  {label}
                </label>
              ))}
              {(['in_app', 'email'] as const).map((ch) => (
                <label key={ch} className="flex items-center gap-1 text-[11px] font-medium text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={newGroup.channels.includes(ch)} onChange={() => setNewGroup((g) => ({ ...g, channels: g.channels.includes(ch) ? g.channels.filter((c) => c !== ch) : [...g.channels, ch] }))} className="rounded text-indigo-600" />
                  {ch === 'in_app' ? 'In-App' : 'Email'}
                </label>
              ))}
              <button onClick={createGroup} disabled={!newGroupName.trim()} className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">Save Group</button>
            </div>
          )}

          {groups.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {groups.map((g) => (
                <span key={g.id} className="inline-flex items-center gap-1.5 text-[11px] font-medium bg-slate-50 border border-slate-200 rounded-full pl-2.5 pr-1.5 py-1 text-slate-600">
                  {g.name}
                  <button onClick={() => deleteGroup(g.id)} className="text-slate-400 hover:text-rose-600 font-bold px-1">×</button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-slate-400">No groups saved yet.</p>
          )}
        </div>
      )}

      {activeTab === 'recipients' && (
        loading ? (
          <div className="p-10 text-center text-xs text-slate-400">Loading…</div>
        ) : eventTypes.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-400">No configurable events found, or Unified Notifications isn't enabled for your organization.</div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {/* Wrapped in its own horizontal scroll container so a 9-column
                table never forces the whole PAGE to scroll/zoom sideways on
                a narrow screen — only the table itself scrolls. */}
            <div className="overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[720px]">
              <thead>
                <tr className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b border-slate-200">
                  <th className="p-3">Event</th>
                  <th className="p-3 text-center">Employee</th>
                  <th className="p-3 text-center">Manager</th>
                  <th className="p-3 text-center">HR</th>
                  <th className="p-3 text-center">Tenant Admin</th>
                  <th className="p-3 text-center"><Bell className="w-3.5 h-3.5 inline" /> In-App</th>
                  <th className="p-3 text-center"><Mail className="w-3.5 h-3.5 inline" /> Email</th>
                  <th className="p-3 text-center text-slate-300"><Smartphone className="w-3.5 h-3.5 inline" /> SMS (future)</th>
                  <th className="p-3">Priority</th>
                  <th className="p-3"></th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {eventTypes.map((et) => {
                  const p = policies[et] || defaultPolicy(et);
                  const modeSelect = (recipientKey: 'employeeMode' | 'managerMode' | 'hrMode' | 'adminMode', enabled: boolean) => enabled && (
                    <select
                      value={p[recipientKey]}
                      onChange={(e) => updateLocal(et, { [recipientKey]: e.target.value as DeliveryMode } as Partial<Policy>)}
                      className="block mt-1 text-[9px] border border-slate-200 rounded px-1 py-0.5 bg-white text-slate-500 w-full"
                      title="Immediate = sent right away. Digest = batched into the recipient's next scheduled rollup. None = this recipient gets nothing for this event."
                    >
                      {MODE_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  );
                  return (
                    <tr key={et}>
                      <td className="p-3 font-medium text-slate-700">{EVENT_LABELS[et] || et}</td>
                      <td className="p-3 text-center align-top">
                        <input type="checkbox" checked={p.notifyEmployee} onChange={(e) => updateLocal(et, { notifyEmployee: e.target.checked })} className="rounded text-indigo-600" />
                        {modeSelect('employeeMode', p.notifyEmployee)}
                      </td>
                      <td className="p-3 text-center align-top">
                        <input type="checkbox" checked={p.notifyManager} onChange={(e) => updateLocal(et, { notifyManager: e.target.checked })} className="rounded text-indigo-600" />
                        {modeSelect('managerMode', p.notifyManager)}
                      </td>
                      <td className="p-3 text-center align-top">
                        <input type="checkbox" checked={p.notifyHR} onChange={(e) => updateLocal(et, { notifyHR: e.target.checked })} className="rounded text-indigo-600" />
                        {p.notifyHR && (
                          <label className="block mt-1 text-[9px] text-slate-400 font-normal cursor-pointer" title="Only notify HR in the employee's own department, not every HR-privileged user tenant-wide.">
                            <input type="checkbox" checked={p.scopeHrToDepartment} onChange={(e) => updateLocal(et, { scopeHrToDepartment: e.target.checked })} className="rounded text-indigo-600 w-2.5 h-2.5 align-middle mr-0.5" />
                            own dept.
                          </label>
                        )}
                        {modeSelect('hrMode', p.notifyHR)}
                      </td>
                      <td className="p-3 text-center align-top">
                        <input type="checkbox" checked={p.notifyAdmin} onChange={(e) => updateLocal(et, { notifyAdmin: e.target.checked })} className="rounded text-indigo-600" />
                        {modeSelect('adminMode', p.notifyAdmin)}
                      </td>
                      <td className="p-3 text-center"><input type="checkbox" checked={p.channels.includes('in_app')} onChange={() => toggleChannel(et, 'in_app')} className="rounded text-indigo-600" /></td>
                      <td className="p-3 text-center"><input type="checkbox" checked={p.channels.includes('email')} onChange={() => toggleChannel(et, 'email')} className="rounded text-indigo-600" /></td>
                      <td className="p-3 text-center"><input type="checkbox" disabled className="rounded opacity-30" /></td>
                      <td className="p-3">
                        <select
                          value={p.priority}
                          onChange={(e) => updateLocal(et, { priority: e.target.value as Priority })}
                          className="text-[10px] border border-slate-200 rounded-lg px-1.5 py-1 bg-white text-slate-600 w-full"
                          title="Critical always sends immediately and bypasses quiet hours. Silent forces in-app only."
                        >
                          {PRIORITY_OPTIONS.map((pr) => <option key={pr.value} value={pr.value}>{pr.label}</option>)}
                        </select>
                      </td>
                      <td className="p-3">
                        {groups.length > 0 && (
                          <select
                            value=""
                            onChange={(e) => { if (e.target.value) applyGroupToEvent(Number(e.target.value), et); }}
                            disabled={applyingGroupTo === et}
                            className="text-[10px] border border-slate-200 rounded-lg px-1.5 py-1 bg-white text-slate-500"
                          >
                            <option value="">Apply group…</option>
                            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                          </select>
                        )}
                      </td>
                      <td className="p-3 text-right whitespace-nowrap">
                        <button onClick={() => sendTest(et)} disabled={testingEvent === et} title="Send a real test notification to yourself only" className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-slate-200 text-slate-600 hover:border-indigo-300 disabled:opacity-50 mr-1.5 inline-flex items-center gap-1">
                          <Send className="w-3 h-3" /> {testingEvent === et ? '…' : testSentFor === et ? 'Sent ✓' : 'Test'}
                        </button>
                        <button onClick={() => save(et)} disabled={savingEvent === et} className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                          {savingEvent === et ? 'Saving…' : 'Save'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
        )
      )}

      {activeTab === 'digests' && (
        subscriptionsLoading ? (
          <div className="p-10 text-center text-xs text-slate-400">Loading…</div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-slate-500 -mt-1 mb-2">
              Events set to "Digest" in Recipients & Channels are batched here instead of sent immediately. Each rollup below controls how often it's summarized, at what time, and who receives it — role-based recipients (e.g. "every Manager") update automatically as people join or change roles; named employees are fixed additions.
            </p>
            {subscriptions.map((sub) => (
              <div key={sub.id} className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={sub.active} onChange={(e) => updateSubscriptionLocal(sub.id, { active: e.target.checked })} className="rounded text-indigo-600" />
                      <span className="text-sm font-semibold text-slate-700">{DIGEST_LABELS[sub.digestType] || sub.digestType}</span>
                    </label>
                  </div>
                  <button onClick={() => saveSubscription(sub)} disabled={savingSubscription === sub.id} className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                    {savingSubscription === sub.id ? 'Saving…' : 'Save'}
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <select value={sub.frequency} onChange={(e) => updateSubscriptionLocal(sub.id, { frequency: e.target.value, dayOfWeek: e.target.value === 'weekly' ? (sub.dayOfWeek ?? 1) : null })} className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700">
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                  </select>
                  {sub.frequency === 'weekly' && (
                    <select value={sub.dayOfWeek ?? 1} onChange={(e) => updateSubscriptionLocal(sub.id, { dayOfWeek: Number(e.target.value) })} className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700">
                      {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => <option key={i} value={i}>{d}</option>)}
                    </select>
                  )}
                  <input type="time" value={sub.timeOfDay} onChange={(e) => updateSubscriptionLocal(sub.id, { timeOfDay: e.target.value })} className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5" />
                  {sub.lastRunAt && <span className="text-[11px] text-slate-400">Last sent {new Date(sub.lastRunAt).toLocaleString()}</span>}
                </div>

                <div className="mb-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Recipients</div>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {(['manager', 'HR', 'tenant_admin'] as const).map((role) => {
                      const active = sub.recipients.some((r: any) => r.type === 'role' && r.role === role);
                      return (
                        <button key={role} onClick={() => toggleRoleRecipient(sub, role)} className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition ${active ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-white border-slate-200 text-slate-500'}`}>
                          {active ? '✓ ' : '+ '}Every {role === 'tenant_admin' ? 'Tenant Admin' : role}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {sub.recipients.filter((r: any) => r.type === 'user').map((r: any, idx: number) => {
                      const realIdx = sub.recipients.indexOf(r);
                      return (
                        <span key={`${r.userId}-${idx}`} className="inline-flex items-center gap-1.5 text-[11px] font-medium bg-slate-50 border border-slate-200 rounded-full pl-2.5 pr-1.5 py-1 text-slate-600">
                          {r.name || employeeOptions.find((e) => e.id === r.userId)?.name || `User #${r.userId}`}
                          <button onClick={() => removeRecipient(sub, realIdx)} className="text-slate-400 hover:text-rose-600 font-bold px-1">×</button>
                        </span>
                      );
                    })}
                  </div>
                  <div className="relative max-w-xs">
                    <input
                      type="text"
                      value={employeeSearch[sub.id] || ''}
                      onChange={(e) => setEmployeeSearch((prev) => ({ ...prev, [sub.id]: e.target.value }))}
                      placeholder="Add a specific employee (e.g. COO)…"
                      className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5"
                    />
                    {(employeeSearch[sub.id] || '').trim().length > 1 && (
                      <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {employeeOptions
                          .filter((e) => `${e.name} ${e.email}`.toLowerCase().includes((employeeSearch[sub.id] || '').toLowerCase()))
                          .slice(0, 8)
                          .map((e) => (
                            <button key={e.id} onClick={() => addNamedRecipient(sub, e)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 flex items-center justify-between gap-2">
                              <span className="font-medium text-slate-700">{e.name}</span>
                              <span className="text-slate-400 text-[10px]">{e.role}</span>
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {activeTab === 'escalation' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <p className="text-sm text-slate-600 mb-3">
            When a Leave Request, Ticket, or Attendance Alert sits unactioned for 24 hours, it automatically escalates one level up (Manager → GM → Tenant Admin) and re-notifies the new assignee through this same Notification Center — visible in the History tab as <code className="bg-slate-100 px-1 rounded text-[11px]">*_escalated</code> events.
          </p>
          <p className="text-sm text-slate-600 mb-4">
            Configurable approval-routing rules (who approves what, by category/department/branch) live on their own screen:
          </p>
          <Link to="/tenant/approval-routing" className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
            Open Approval Routing <GitBranch className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      {activeTab === 'templates' && (
        <div className="space-y-5">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Event</label>
                <select value={editEventType} onChange={(e) => setEditEventType(e.target.value)} className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-2 bg-white text-slate-700">
                  <option value="">Select an event…</option>
                  {(eventTypes.length > 0 ? eventTypes : Object.keys(EVENT_LABELS)).map((et) => (
                    <option key={et} value={et}>{(EVENT_LABELS[et] || et)}{customizedFor(et) ? ' (customized)' : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Channel</label>
                <select value={editChannel} onChange={(e) => setEditChannel(e.target.value as 'email' | 'in_app')} className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-2 bg-white text-slate-700">
                  <option value="email">Email</option>
                  <option value="in_app">In-App</option>
                </select>
              </div>
            </div>

            {editEventType ? (
              <>
                {editChannel === 'email' && (
                  <div className="mb-3">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Subject</label>
                    <input value={editSubject} onChange={(e) => setEditSubject(e.target.value)} placeholder={`Notification: ${(EVENT_LABELS[editEventType] || editEventType).toLowerCase()}`} className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2" />
                  </div>
                )}
                <div className="mb-3">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Body</label>
                  <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={6} placeholder="Hello {{subjectName}}, ..." className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 font-mono" />
                </div>
                <p className="text-[11px] text-slate-400 mb-4">
                  <code className="bg-slate-100 px-1 rounded">{'{{subjectName}}'}</code> is always available (the employee this notification is about). Every other field the event was triggered with is also available by name — e.g. <code className="bg-slate-100 px-1 rounded">{'{{date}}'}</code>, <code className="bg-slate-100 px-1 rounded">{'{{amountDelta}}'}</code>, <code className="bg-slate-100 px-1 rounded">{'{{reason}}'}</code> depending on the event. Leaving Subject/Body blank falls back to the built-in default message.
                </p>

                {editBody.trim() && (
                  <div className="mb-4 rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Preview</div>
                    {editChannel === 'email' && editSubject.trim() && (
                      <div className="text-xs font-semibold text-slate-700 mb-1">{editSubject}</div>
                    )}
                    <div className="text-xs text-slate-600 whitespace-pre-wrap">{editBody}</div>
                  </div>
                )}

                <button onClick={saveTemplate} disabled={templateSaving || !editBody.trim()} className="text-xs font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                  {templateSaving ? 'Saving…' : templateSaved ? 'Saved ✓' : 'Save Template'}
                </button>
              </>
            ) : (
              <p className="text-xs text-slate-400">Pick an event above to customize its message, or leave it as-is to keep the built-in default.</p>
            )}
          </div>

          {!templatesLoading && templates.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100">Customized Templates</div>
              <div className="divide-y divide-slate-100">
                {templates.map((t) => (
                  <button key={`${t.eventType}-${t.channel}`} onClick={() => { setEditEventType(t.eventType); setEditChannel(t.channel as 'email' | 'in_app'); }} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-slate-700">{EVENT_LABELS[t.eventType] || t.eventType}</span>
                    <span className="text-[10px] uppercase font-bold text-slate-400">{t.channel === 'email' ? 'Email' : 'In-App'}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        historyLoading ? (
          <div className="p-10 text-center text-xs text-slate-400">Loading…</div>
        ) : historyEntries.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-400">No deliveries recorded yet — this fills in as notify() actually fires.</div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[600px]">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b border-slate-200">
                    <th className="p-3">Event</th>
                    <th className="p-3">Recipient</th>
                    <th className="p-3">Channel</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-center">Attempts</th>
                    <th className="p-3">When</th>
                    <th className="p-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {historyEntries.map((e) => (
                    <tr key={e.id}>
                      <td className="p-3 font-medium text-slate-700">{EVENT_LABELS[e.eventType] || e.eventType}</td>
                      <td className="p-3 text-slate-600">{e.recipientName || '—'}</td>
                      <td className="p-3 text-slate-500">{e.channel === 'email' ? 'Email' : 'In-App'}</td>
                      <td className="p-3">
                        {e.status === 'sent' ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" /> Sent</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-rose-700" title={e.error || undefined}><XCircle className="w-3.5 h-3.5" /> Failed</span>
                        )}
                      </td>
                      <td className="p-3 text-center text-slate-500">{e.attempts ?? 1}</td>
                      <td className="p-3 text-slate-400">{new Date(e.createdAt).toLocaleString()}</td>
                      <td className="p-3 text-right">
                        {e.status === 'failed' && (
                          <button onClick={() => retryDelivery(e.id)} disabled={retryingId === e.id} className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-slate-200 text-slate-600 hover:border-indigo-300 disabled:opacity-50 inline-flex items-center gap-1">
                            <RotateCcw className="w-3 h-3" /> {retryingId === e.id ? '…' : 'Retry now'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      <p className="text-[11px] text-slate-400 mt-4">
        Note: this schema tracks Employee / Manager / HR / Tenant Admin as recipient categories — there is no separate "Finance" recipient today (Finance-specific payroll events already route to Tenant Admin). SMS and Push are reserved columns, not yet wired to a delivery provider.
      </p>
      </div>
    </AdminWorkspaceLayout>
  );
}
