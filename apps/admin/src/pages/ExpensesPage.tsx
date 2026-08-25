import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Wallet,
  IndianRupee,
  Clock,
  CheckCircle2,
  Receipt,
  Plus,
  Filter,
  Calendar,
  FileText,
  Download,
  Search,
  Eye,
  ChevronLeft,
  ChevronRight,
  X,
  Upload,
  Sparkles,
  Check,
  RotateCcw,
  ShieldAlert,
  TrendingUp,
  Tag,
  MapPin,
  CreditCard,
  Building2,
  Users,
  Info,
  FileSpreadsheet,
  FileCode,
  ArrowUpRight,
  Settings,
  History,
  AlertCircle,
} from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, PieChart, Pie, Cell, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';
import { User } from '../lib/auth';
import PortalShell from '../components/PortalShell';

interface ReimbursementTransaction {
  id: number;
  tenantId: number;
  expenseId: number;
  userId: number;
  reimbursedByUserId: number;
  amount: number;
  paymentRef: string | null;
  paymentMethod: string | null;
  previousRemainingAmount: number;
  newRemainingAmount: number;
  isPartial: boolean;
  notes: string | null;
  createdAt: string;
  reimbursedByName?: string;
  reimbursedByEmail?: string;
}

interface ExpenseItem {
  id: number;
  expenseId: string;
  userId: number;
  amount: number;
  approvedAmount?: number | null;
  reimbursedAmount?: number | null;
  remainingAmount?: number | null;
  currency: string;
  merchant: string | null;
  category: string;
  categoryId: number | null;
  description: string | null;
  location: string | null;
  paymentMethod: string;
  receiptStoragePath: string | null;
  receiptOriginalName: string | null;
  receiptMimeType: string | null;
  receiptFileSize: number | null;
  expenseDate: string;
  expenseTime: string;
  uploadTimestamp: string;
  originalOcrValues: any;
  userCorrectedValues: any;
  derivedFromUploadTimestamp: boolean;
  isOcrVerified: boolean;
  status: 'draft' | 'pending_approval' | 'approved' | 'partially_reimbursed' | 'reimbursed' | 'rejected';
  rejectionReason: string | null;
  approvedByUserId: number | null;
  approvedAt: string | null;
  reimbursedByUserId: number | null;
  reimbursedAt: string | null;
  reimbursementRef: string | null;
  policyViolationFlag: boolean;
  policyViolationDetails: string | null;
  duplicateFlag: boolean;
  duplicateDetails: string | null;
  createdAt: string;
  employeeName: string;
  employeeEmail: string;
  department: string;
  designation: string;
  approvedByName?: string | null;
  reimbursedByName?: string | null;
  reimbursementHistory?: ReimbursementTransaction[];
}

interface SummaryData {
  thisMonthTotal: number;
  thisYearTotal: number;
  pendingCount: number;
  pendingAmount: number;
  approvedCount: number;
  approvedAmount: number;
  partiallyReimbursedCount: number;
  partiallyReimbursedAmount: number;
  reimbursedCount: number;
  reimbursedAmount: number;
  outstandingReimbursementAmount: number;
  rejectedCount: number;
  draftCount: number;
  totalCount: number;
}

interface CategoryOption {
  id: number;
  name: string;
  code: string;
  description: string;
  maxLimit: number | null;
  status: string;
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  'IT & Hardware': { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200/60', dot: '#818cf8' },
  'Office Supplies': { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200/60', dot: '#60a5fa' },
  'Travel & Transport': { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200/60', dot: '#34d399' },
  'Marketing': { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200/60', dot: '#fbbf24' },
  'Meals & Entertainment': { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200/60', dot: '#f87171' },
  'Others': { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200', dot: '#94a3b8' },
};

export default function ExpensesPage({
  user,
  onLogout,
  embedded = false,
}: {
  user: User;
  onLogout?: () => void;
  embedded?: boolean;
}) {
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [summaryMetrics, setSummaryMetrics] = useState<SummaryData>({
    thisMonthTotal: 0,
    thisYearTotal: 0,
    pendingCount: 0,
    pendingAmount: 0,
    approvedCount: 0,
    approvedAmount: 0,
    partiallyReimbursedCount: 0,
    partiallyReimbursedAmount: 0,
    reimbursedCount: 0,
    reimbursedAmount: 0,
    outstandingReimbursementAmount: 0,
    rejectedCount: 0,
    draftCount: 0,
    totalCount: 0,
  });

  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);

  // Filters
  const [activeStatusFilter, setActiveStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedEmployee, setSelectedEmployee] = useState('ALL');
  const [showFilters, setShowFilters] = useState(false);

  // Drawer / Modals State
  const [selectedExpense, setSelectedExpense] = useState<ExpenseItem | null>(null);
  const [showDetailDrawer, setShowDetailDrawer] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);

  // Action modals
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionReasonInput, setRejectionReasonInput] = useState('');
  const [showReimburseModal, setShowReimburseModal] = useState(false);
  const [reimbursementAmountInput, setReimbursementAmountInput] = useState('');
  const [reimbursementRefInput, setReimbursementRefInput] = useState('');
  const [paymentMethodInput, setPaymentMethodInput] = useState('Bank Transfer');
  const [notesInput, setNotesInput] = useState('');
  const [actionProcessing, setActionProcessing] = useState(false);

  // Submit Modal Form State
  const [submitStep, setSubmitStep] = useState<'upload' | 'ocr_verify' | 'form'>('upload');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [ocrScanning, setOcrScanning] = useState(false);
  const [ocrData, setOcrData] = useState<any>(null);

  const [formAmount, setFormAmount] = useState('');
  const [formMerchant, setFormMerchant] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formTime, setFormTime] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formLocation, setFormLocation] = useState('');
  const [formPaymentMethod, setFormPaymentMethod] = useState('Personal Payment');
  const [submitting, setSubmitting] = useState(false);

  // Report Builder State
  const [reportFormat, setReportFormat] = useState<'csv' | 'excel' | 'pdf' | 'json'>('excel');
  const [selectedReportColumns, setSelectedReportColumns] = useState<string[]>([
    'expenseId',
    'employeeName',
    'expenseDate',
    'category',
    'description',
    'amount',
    'approvedAmount',
    'reimbursedAmount',
    'remainingAmount',
    'status',
  ]);
  const [reportTitle, setReportTitle] = useState('Expense Register');
  const [generatingReport, setGeneratingReport] = useState(false);

  const token = localStorage.getItem('auth_token');
  const authHeaders = { Authorization: `Bearer ${token}` };

  const currentUserId = Number(user.userId || user.id || 0);

  // Fetch initial categories & metrics
  useEffect(() => {
    fetchCategories();
    fetchSummaryMetrics();
  }, []);

  // Fetch expenses on filter/page change
  useEffect(() => {
    fetchExpenses();
  }, [page, limit, activeStatusFilter, searchQuery, selectedMonth, selectedCategory, selectedEmployee]);

  const [allScopeExpenses, setAllScopeExpenses] = useState<ExpenseItem[]>([]);

  const isCompanyAdmin = user.role === 'tenant_admin' || user.role === 'super_admin';
  const canSubmitExpense = useMemo(() => !isCompanyAdmin, [isCompanyAdmin]);

  // Permission / Privilege Capability Evaluation
  const canReadAll = useMemo(() => {
    if (user.role === 'tenant_admin' || user.role === 'super_admin' || user.role === 'gm' || user.role === 'finance') return true;
    if (Array.isArray((user as any).privileges)) {
      return (user as any).privileges.some((p: string) => ['expenses.read', 'expenses.approve', 'reports.view', 'ALL'].includes(p));
    }
    return false;
  }, [user]);

  const canApprove = useMemo(() => {
    if (user.role === 'tenant_admin' || user.role === 'super_admin' || user.role === 'manager' || user.role === 'gm') return true;
    if (Array.isArray((user as any).privileges)) {
      return (user as any).privileges.some((p: string) => ['expenses.approve', 'ALL'].includes(p));
    }
    return false;
  }, [user]);

  const canReimburse = useMemo(() => {
    if (user.role === 'tenant_admin' || user.role === 'super_admin' || user.role === 'finance') return true;
    if (Array.isArray((user as any).privileges)) {
      return (user as any).privileges.some((p: string) => ['expenses.reimburse', 'ALL'].includes(p));
    }
    return false;
  }, [user]);

  const canAllowPartialReimburse = useMemo(() => {
    if (user.role === 'tenant_admin' || user.role === 'super_admin') return true;
    if (Array.isArray((user as any).privileges)) {
      return (user as any).privileges.some((p: string) => ['expenses.reimburse.partial', 'ALL'].includes(p));
    }
    return false;
  }, [user]);

  const canViewReports = useMemo(() => {
    if (user.role === 'tenant_admin' || user.role === 'super_admin' || user.role === 'finance') return true;
    if (Array.isArray((user as any).privileges)) {
      return (user as any).privileges.some((p: string) => ['expenses.reports', 'reports.view', 'ALL'].includes(p));
    }
    return false;
  }, [user]);

  const canManageCategories = useMemo(() => {
    if (user.role === 'tenant_admin' || user.role === 'super_admin') return true;
    if (Array.isArray((user as any).privileges)) {
      return (user as any).privileges.some((p: string) => ['expenses.policy', 'settings.edit', 'ALL'].includes(p));
    }
    return false;
  }, [user]);

  const fetchCategories = async () => {
    try {
      const res = await fetch('/api/tenant/expenses/categories?includeInactive=true', { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.categories)) {
          setCategories(data.categories);
          const firstActive = data.categories.find((c: any) => c.status === 'active');
          if (firstActive) setFormCategory(firstActive.name);
        }
      }
    } catch {
      // Keep default state
    }
  };

  const fetchSummaryMetrics = async () => {
    try {
      const res = await fetch('/api/tenant/expenses/summary', { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        if (data.summary) setSummaryMetrics(data.summary);
      }
    } catch {
      // Keep state metrics
    }
  };

  const fetchExpenses = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('page', page.toString());
      params.append('limit', limit.toString());
      if (activeStatusFilter !== 'ALL') params.append('status', activeStatusFilter.toLowerCase());
      if (searchQuery.trim()) params.append('search', searchQuery.trim());
      if (selectedMonth) params.append('month', selectedMonth);
      if (selectedCategory !== 'ALL') params.append('category', selectedCategory);
      if (selectedEmployee !== 'ALL') params.append('employee', selectedEmployee);

      const res = await fetch(`/api/tenant/expenses?${params.toString()}`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setExpenses(data.expenses || []);
        setTotalRecords(data.pagination?.totalRecords || 0);
        setTotalPages(data.pagination?.totalPages || 1);
        if (data.summary) {
          setSummaryMetrics(data.summary);
        }
        if (Array.isArray(data.allScopeExpenses)) {
          setAllScopeExpenses(data.allScopeExpenses);
        }
      }
    } catch {
      setExpenses([]);
      setTotalRecords(0);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  };

  const fetchExpenseDetail = async (expId: number) => {
    try {
      const res = await fetch(`/api/tenant/expenses/${expId}`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        if (data.expense) {
          setSelectedExpense(data.expense);
        }
      }
    } catch (err) {
      console.error('Error fetching detail:', err);
    }
  };

  const handleDownloadReceipt = async (exp: ExpenseItem) => {
    try {
      const res = await fetch(`/api/tenant/expenses/${exp.id}/receipt?download=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Failed to download receipt.');
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = exp.receiptOriginalName || `receipt_${exp.expenseId}.${exp.receiptMimeType?.includes('pdf') ? 'pdf' : 'jpg'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert('Error downloading receipt attachment.');
    }
  };

  const handleOpenFullReceipt = (exp: ExpenseItem) => {
    const url = `/api/tenant/expenses/${exp.id}/receipt?token=${encodeURIComponent(token || '')}`;
    window.open(url, '_blank');
  };

  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Handle OCR file upload
  const handleFileUpload = async (file: File) => {
    setUploadedFile(file);
    setOcrScanning(true);
    setSubmitStep('ocr_verify');

    try {
      const base64Data = await readFileAsBase64(file);
      const res = await fetch('/api/tenant/expenses/ocr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          fileBase64: base64Data,
          mimeType: file.type || 'image/jpeg',
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.ocr) {
          setOcrData(data.ocr);
          setFormAmount(data.ocr.amount ? String(data.ocr.amount) : '');
          setFormMerchant(data.ocr.merchant || '');
          if (data.ocr.expenseDate) {
            setFormDate(data.ocr.expenseDate);
          } else {
            setFormDate(new Date().toISOString().slice(0, 10));
          }
          if (data.ocr.expenseTime) {
            setFormTime(data.ocr.expenseTime);
          } else {
            setFormTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
          }
          if (data.ocr.category) {
            setFormCategory(data.ocr.category);
          } else {
            setFormCategory('');
          }
          if (data.ocr.description) {
            setFormDescription(data.ocr.description);
          }
          if (data.ocr.paymentMethod) {
            setFormPaymentMethod(data.ocr.paymentMethod);
          }
        }
      }
    } catch (err: any) {
      console.error('OCR Upload Error:', err);
      setOcrData({
        merchant: null,
        merchantSource: 'missing',
        amount: null,
        amountSource: 'missing',
        currency: 'INR',
        expenseDate: new Date().toISOString().slice(0, 10),
        dateSource: 'upload_fallback',
        expenseTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
        timeSource: 'upload_fallback',
        category: null,
        description: null,
        paymentMethod: null,
        rawText: '',
        derivedFromUploadTimestamp: true,
        ocrSuccess: false,
        confidence: 0,
        fallbackReason: 'Network error or server disconnected during OCR scan. Please verify details manually.',
        extractedValues: { merchant: null, amount: null, date: null, time: null, category: null, paymentMethod: null },
      });
      setFormDate(new Date().toISOString().slice(0, 10));
      setFormTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
    } finally {
      setOcrScanning(false);
      setSubmitStep('form');
    }
  };

  // Handle Create Expense Submission
  const handleSubmitExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      let receiptBase64: string | null = null;
      let receiptFileName: string | null = null;
      let receiptMimeType: string | null = null;

      if (uploadedFile) {
        receiptBase64 = await readFileAsBase64(uploadedFile);
        receiptFileName = uploadedFile.name;
        receiptMimeType = uploadedFile.type || 'image/jpeg';
      }

      const payload = {
        amount: formAmount,
        merchant: formMerchant,
        category: formCategory,
        expenseDate: formDate || new Date().toISOString().slice(0, 10),
        expenseTime: formTime || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
        description: formDescription,
        location: formLocation,
        paymentMethod: formPaymentMethod,
        receiptBase64,
        receiptFileName,
        receiptMimeType,
        originalOcrValues: ocrData ? { amount: ocrData.amount, merchant: ocrData.merchant, expenseDate: ocrData.expenseDate } : null,
      };

      const res = await fetch('/api/tenant/expenses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setShowSubmitModal(false);
        resetForm();
        fetchExpenses();
        fetchSummaryMetrics();
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || 'Failed to submit expense claim.');
      }
    } catch (err: any) {
      alert(err?.message || 'Error submitting expense claim.');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setSubmitStep('upload');
    setUploadedFile(null);
    setOcrData(null);
    setFormAmount('');
    setFormMerchant('');
    setFormDescription('');
    setFormLocation('');
    setFormCategory('');
  };

  // Actions: Approve, Reject, Reimburse, Withdraw
  const handleApprove = async (id: number) => {
    setActionProcessing(true);
    try {
      const res = await fetch(`/api/tenant/expenses/${id}/approve`, {
        method: 'POST',
        headers: authHeaders,
      });
      if (res.ok) {
        await fetchExpenseDetail(id);
        fetchExpenses();
        fetchSummaryMetrics();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to approve expense.');
      }
    } catch {
      alert('Error approving expense.');
    } finally {
      setActionProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!selectedExpense || !rejectionReasonInput.trim()) return;
    setActionProcessing(true);
    try {
      const res = await fetch(`/api/tenant/expenses/${selectedExpense.id}/reject`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectionReasonInput.trim() }),
      });
      if (res.ok) {
        await fetchExpenseDetail(selectedExpense.id);
        setShowRejectModal(false);
        setRejectionReasonInput('');
        fetchExpenses();
        fetchSummaryMetrics();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to reject expense.');
      }
    } catch {
      alert('Error rejecting expense.');
    } finally {
      setActionProcessing(false);
    }
  };

  const openReimburseModalForExpense = (exp: ExpenseItem) => {
    setSelectedExpense(exp);
    const rem = exp.remainingAmount !== undefined && exp.remainingAmount !== null
      ? exp.remainingAmount
      : (exp.approvedAmount !== undefined && exp.approvedAmount !== null ? exp.approvedAmount : exp.amount);

    setReimbursementAmountInput(String(rem));
    setReimbursementRefInput('');
    setPaymentMethodInput('Bank Transfer');
    setNotesInput('');
    setShowReimburseModal(true);
  };

  const handleReimburse = async () => {
    if (!selectedExpense) return;
    setActionProcessing(true);
    try {
      const res = await fetch(`/api/tenant/expenses/${selectedExpense.id}/reimburse`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: parseFloat(reimbursementAmountInput),
          reimbursementAmount: parseFloat(reimbursementAmountInput),
          reimbursementRef: reimbursementRefInput.trim() || 'Bank Transfer / Payroll',
          paymentMethod: paymentMethodInput,
          notes: notesInput,
        }),
      });

      if (res.ok) {
        await fetchExpenseDetail(selectedExpense.id);
        setShowReimburseModal(false);
        fetchExpenses();
        fetchSummaryMetrics();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to process reimbursement.');
      }
    } catch {
      alert('Error processing reimbursement.');
    } finally {
      setActionProcessing(false);
    }
  };

  const handleWithdraw = async (id: number) => {
    setActionProcessing(true);
    try {
      const res = await fetch(`/api/tenant/expenses/${id}/withdraw`, {
        method: 'POST',
        headers: authHeaders,
      });
      if (res.ok) {
        await fetchExpenseDetail(id);
        fetchExpenses();
        fetchSummaryMetrics();
      }
    } catch {
      // Handled
    } finally {
      setActionProcessing(false);
    }
  };

  // Report Generation Execution
  const handleGenerateReport = async () => {
    setGeneratingReport(true);
    try {
      const res = await fetch('/api/tenant/expenses/reports/generate', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format: reportFormat,
          columns: selectedReportColumns,
          filters: {
            status: activeStatusFilter,
            month: selectedMonth,
            category: selectedCategory,
            employee: selectedEmployee,
          },
          meta: {
            title: reportTitle,
            tenantName: 'SmartTeams EMS',
            generatedByName: user.name || user.email,
            generatedByEmail: user.email,
            generatedAt: new Date(),
            timezone: 'Asia/Kolkata',
            filtersDescription: `Status: ${activeStatusFilter} | Category: ${selectedCategory}`,
          },
        }),
      });

      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `expense_report_${new Date().toISOString().slice(0, 10)}.${reportFormat === 'excel' ? 'xlsx' : reportFormat}`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        setShowReportModal(false);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Failed to generate expense report.');
      }
    } catch {
      alert('Failed to generate expense report.');
    } finally {
      setGeneratingReport(false);
    }
  };

  const computedMetrics = useMemo(() => summaryMetrics, [summaryMetrics]);

  // Dynamic Trend Chart Data
  const chartData = useMemo(() => {
    const dataset = allScopeExpenses.length ? allScopeExpenses : expenses;
    if (!dataset.length) return [];
    const dateMap: Record<string, number> = {};
    for (const exp of dataset) {
      const d = exp.expenseDate ? new Date(exp.expenseDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) : 'Date';
      dateMap[d] = (dateMap[d] || 0) + Number(exp.amount || 0);
    }
    return Object.entries(dateMap).map(([date, amount]) => ({ date, amount }));
  }, [allScopeExpenses, expenses]);

  // Dynamic Pagination Pages Array
  const paginationPages = useMemo(() => {
    const pages: (number | string)[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push('...');
      const start = Math.max(2, page - 1);
      const end = Math.min(totalPages - 1, page + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (page < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }
    return pages;
  }, [page, totalPages]);

  // Native Content Layout
  const content = (
    <div className="space-y-6 text-slate-900 font-sans">
      {/* ----------------------------------------------------------------- */}
      {/* PAGE HEADER & TOP ACTIONS */}
      {/* ----------------------------------------------------------------- */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 font-sans tracking-tight">Expenses</h1>
          <p className="text-sm text-slate-500 font-medium mt-0.5">
            {canReadAll
              ? 'Track, review, approve, and reimburse company expenses.'
              : 'My Expenses: Track your submitted claims, approvals, and reimbursement history.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canViewReports && (
            <button
              onClick={() => setShowReportModal(true)}
              className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs border border-slate-200/80 shadow-2xs flex items-center gap-2 transition-all cursor-pointer"
            >
              <Download className="w-4 h-4 text-slate-600" />
              <span>Export Report</span>
            </button>
          )}
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`px-4 py-2.5 rounded-xl text-xs font-semibold border transition-all flex items-center gap-2 cursor-pointer ${
              showFilters ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
            }`}
          >
            <Filter className="w-4 h-4" />
            <span>Filters</span>
          </button>
          {canManageCategories && (
            <button
              onClick={() => { window.location.href = '/tenant/expense-categories'; }}
              className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs border border-slate-200/80 shadow-2xs flex items-center gap-2 transition-all cursor-pointer"
            >
              <Settings className="w-4 h-4 text-slate-600" />
              <span>Manage Categories</span>
            </button>
          )}
          {canSubmitExpense && (
            <button
              onClick={() => {
                resetForm();
                setShowSubmitModal(true);
              }}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-sm flex items-center gap-2 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Submit Expense</span>
            </button>
          )}
        </div>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* SUMMARY KPI CARDS */}
      {/* ----------------------------------------------------------------- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Expenses This Month */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-2xs hover:shadow-xs transition-all">
          <div className="flex items-center justify-between mb-3">
            <div className="w-11 h-11 rounded-2xl bg-purple-100/80 text-purple-600 flex items-center justify-center font-bold">
              <Wallet className="w-5 h-5" />
            </div>
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 bg-slate-50 px-2 py-0.5 rounded-full border border-slate-200">
              This Month
            </span>
          </div>
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            {canReadAll ? 'Total Expenses (This Month)' : 'My Claimed (This Month)'}
          </div>
          <div className="text-2xl font-black text-slate-900 font-sans tracking-tight mt-1">
            ₹{(computedMetrics?.thisMonthTotal || 0).toLocaleString('en-IN')}
          </div>
        </div>

        {/* Card 2: Pending Approval */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-2xs hover:shadow-xs transition-all">
          <div className="flex items-center justify-between mb-3">
            <div className="w-11 h-11 rounded-2xl bg-amber-100/80 text-amber-600 flex items-center justify-center font-bold">
              <Clock className="w-5 h-5" />
            </div>
            <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
              {computedMetrics?.pendingCount || 0} pending
            </span>
          </div>
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Pending Approval
          </div>
          <div className="text-2xl font-black text-slate-900 font-sans tracking-tight mt-1">
            ₹{(computedMetrics?.pendingAmount || 0).toLocaleString('en-IN')}
          </div>
        </div>

        {/* Card 3: Outstanding / Pending Reimbursement */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-2xs hover:shadow-xs transition-all">
          <div className="flex items-center justify-between mb-3">
            <div className="w-11 h-11 rounded-2xl bg-blue-100/80 text-blue-600 flex items-center justify-center font-bold">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
              {(computedMetrics?.approvedCount || 0) + (computedMetrics?.partiallyReimbursedCount || 0)} active
            </span>
          </div>
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            {canReadAll ? 'Outstanding Reimbursements' : 'Awaiting Reimbursement'}
          </div>
          <div className="text-2xl font-black text-slate-900 font-sans tracking-tight mt-1">
            ₹{(computedMetrics?.outstandingReimbursementAmount || 0).toLocaleString('en-IN')}
          </div>
        </div>

        {/* Card 4: Total Reimbursed */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-2xs hover:shadow-xs transition-all">
          <div className="flex items-center justify-between mb-3">
            <div className="w-11 h-11 rounded-2xl bg-emerald-100/80 text-emerald-600 flex items-center justify-center font-bold">
              <IndianRupee className="w-5 h-5" />
            </div>
            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
              {computedMetrics?.reimbursedCount || 0} paid
            </span>
          </div>
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Total Reimbursed
          </div>
          <div className="text-2xl font-black text-slate-900 font-sans tracking-tight mt-1">
            ₹{(computedMetrics?.reimbursedAmount || 0).toLocaleString('en-IN')}
          </div>
        </div>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* FILTER & QUICK STATUS SUMMARY BAR */}
      {/* ----------------------------------------------------------------- */}
      <div className="space-y-4">
        {/* Quick Status Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200/80 p-3 rounded-2xl shadow-2xs">
          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: 'ALL', label: 'All', count: computedMetrics.totalCount },
              { id: 'pending_approval', label: 'Pending', count: computedMetrics.pendingCount },
              { id: 'approved', label: 'Approved', count: computedMetrics.approvedCount },
              { id: 'partially_reimbursed', label: 'Partially Reimbursed', count: computedMetrics.partiallyReimbursedCount },
              { id: 'reimbursed', label: 'Reimbursed', count: computedMetrics.reimbursedCount },
              { id: 'rejected', label: 'Rejected', count: computedMetrics.rejectedCount },
            ].map((btn) => (
              <button
                key={btn.id}
                onClick={() => {
                  setActiveStatusFilter(btn.id);
                  setPage(1);
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  activeStatusFilter === btn.id
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200/60'
                }`}
              >
                {btn.label} <span className="ml-1 opacity-80">({btn.count})</span>
              </button>
            ))}
          </div>

          <div className="relative flex-1 sm:w-64 sm:flex-initial">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search ID, merchant, description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
            />
          </div>
        </div>

        {/* Collapsible Dropdown Filters */}
        {showFilters && (
          <div className="bg-white border border-slate-200/80 p-4 rounded-2xl shadow-2xs grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Month / Period</label>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Category</label>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-medium"
              >
                <option value="ALL">All Categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name} {c.status === 'inactive' ? '(Inactive)' : ''}
                  </option>
                ))}
              </select>
            </div>
            {canReadAll && (
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Employee</label>
                <select
                  value={selectedEmployee}
                  onChange={(e) => setSelectedEmployee(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-medium"
                >
                  <option value="ALL">All Employees</option>
                  {Array.from(new Set(allScopeExpenses.map((e) => e.employeeName).filter(Boolean) as string[])).map((empName: string) => (
                    <option key={empName} value={empName}>
                      {empName}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* MAIN EXPENSE TABLE */}
      {/* ----------------------------------------------------------------- */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50/80 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200/80 text-[11px]">
                <th className="py-3 px-4">Date & ID</th>
                {canReadAll && <th className="py-3 px-4">Employee</th>}
                <th className="py-3 px-4">Merchant & Category</th>
                <th className="py-3 px-4 text-right">Claimed</th>
                <th className="py-3 px-4 text-right">Reimbursed</th>
                <th className="py-3 px-4 text-right">Remaining</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-center">Receipt</th>
                <th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
              {expenses.length === 0 ? (
                <tr>
                  <td colSpan={canReadAll ? 9 : 8} className="py-12 text-center">
                    <div className="flex flex-col items-center justify-center max-w-sm mx-auto text-center">
                      <div className="w-12 h-12 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 mb-3">
                        <Receipt className="w-6 h-6" />
                      </div>
                      <h3 className="text-sm font-bold text-slate-800">No expense claims found</h3>
                      <p className="text-xs text-slate-500 mt-1 mb-4">There are no expense claims matching your selected filters or search query.</p>
                      <button
                        onClick={() => {
                          resetForm();
                          setShowSubmitModal(true);
                        }}
                        className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-2xs flex items-center gap-2 transition-all mx-auto cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Submit Expense</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                expenses.map((exp) => {
                  const catStyle = CATEGORY_COLORS[exp.category] || CATEGORY_COLORS.Others;
                  const approvedAmt = exp.approvedAmount ?? (['approved', 'partially_reimbursed', 'reimbursed'].includes(exp.status) ? exp.amount : null);
                  const reimbursedAmt = exp.reimbursedAmount ?? (exp.status === 'reimbursed' ? (approvedAmt ?? exp.amount) : 0);
                  const remainingAmt = exp.remainingAmount ?? (exp.status === 'reimbursed' ? 0 : ((approvedAmt ?? exp.amount) - reimbursedAmt));

                  return (
                    <tr key={exp.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="font-bold text-slate-900">{exp.expenseId}</div>
                        <div className="text-[11px] text-slate-500">{exp.expenseDate}</div>
                      </td>
                      {canReadAll && (
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-700 font-bold text-[11px] flex items-center justify-center">
                              {exp.employeeName ? exp.employeeName.slice(0, 2).toUpperCase() : 'EMP'}
                            </div>
                            <div>
                              <div className="font-bold text-slate-900">{exp.employeeName}</div>
                              <div className="text-[10px] text-slate-400 uppercase font-semibold">{exp.department || 'Staff'}</div>
                            </div>
                          </div>
                        </td>
                      )}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900">{exp.merchant || 'General Merchant'}</div>
                        <span className={`inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold border ${catStyle.bg} ${catStyle.text} ${catStyle.border}`}>
                          {exp.category}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right font-bold text-slate-900 whitespace-nowrap">
                        ₹{exp.amount.toLocaleString('en-IN')}
                      </td>
                      <td className="py-3.5 px-4 text-right font-bold text-emerald-700 whitespace-nowrap">
                        ₹{reimbursedAmt.toLocaleString('en-IN')}
                      </td>
                      <td className="py-3.5 px-4 text-right font-bold text-indigo-700 whitespace-nowrap">
                        ₹{remainingAmt.toLocaleString('en-IN')}
                      </td>
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <span
                          className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                            exp.status === 'approved'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200/60'
                              : exp.status === 'partially_reimbursed'
                              ? 'bg-amber-50 text-amber-800 border-amber-300'
                              : exp.status === 'reimbursed'
                              ? 'bg-blue-50 text-blue-700 border-blue-200/60'
                              : exp.status === 'rejected'
                              ? 'bg-rose-50 text-rose-700 border-rose-200/60'
                              : 'bg-slate-100 text-slate-700 border-slate-200'
                          }`}
                        >
                          {exp.status === 'pending_approval'
                            ? 'Pending'
                            : exp.status === 'partially_reimbursed'
                            ? 'Partially Reimbursed'
                            : exp.status.charAt(0).toUpperCase() + exp.status.slice(1)}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        {exp.receiptStoragePath ? (
                          <button
                            type="button"
                            title="View Receipt Attachment"
                            onClick={() => handleOpenFullReceipt(exp)}
                            className="w-8 h-8 mx-auto rounded-lg border border-indigo-200 bg-indigo-50/60 hover:bg-indigo-100 flex items-center justify-center cursor-pointer text-indigo-600 transition-all"
                          >
                            <FileText className="w-4 h-4" />
                          </button>
                        ) : (
                          <div className="w-8 h-8 mx-auto rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-300 opacity-60">
                            <FileText className="w-4 h-4" />
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <button
                          onClick={() => {
                            setSelectedExpense(exp);
                            fetchExpenseDetail(exp.id);
                            setShowDetailDrawer(true);
                          }}
                          className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center mx-auto transition-all cursor-pointer"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-slate-50/60 border-t border-slate-200/80 text-xs">
          <div className="text-slate-500 font-semibold">
            Showing {totalRecords === 0 ? 0 : (page - 1) * limit + 1} to {Math.min(page * limit, totalRecords)} of {totalRecords} entries
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <button
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="w-8 h-8 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 flex items-center justify-center text-slate-600 disabled:opacity-50 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {paginationPages.map((p, idx) => (
                <button
                  key={idx}
                  disabled={typeof p !== 'number'}
                  onClick={() => typeof p === 'number' && setPage(p)}
                  className={`w-8 h-8 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    page === p
                      ? 'bg-indigo-600 text-white shadow-2xs'
                      : typeof p === 'number'
                      ? 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
                      : 'bg-transparent text-slate-400 cursor-default'
                  }`}
                >
                  {p}
                </button>
              ))}
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="w-8 h-8 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 flex items-center justify-center text-slate-600 disabled:opacity-50 cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <select
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setPage(1);
              }}
              className="bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-700"
            >
              <option value={10}>10 / page</option>
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
            </select>
          </div>
        </div>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* EXPENSE DETAILS DRAWER */}
      {/* ----------------------------------------------------------------- */}
      <AnimatePresence>
        {showDetailDrawer && selectedExpense && (
          <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDetailDrawer(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
            />

            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="relative w-full max-w-lg bg-white h-full shadow-2xl flex flex-col z-10 text-slate-900"
            >
              {/* Drawer Header */}
              <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Expense Lifecycle Details</span>
                  <h3 className="text-lg font-black text-slate-900">{selectedExpense.expenseId}</h3>
                </div>
                <button
                  onClick={() => setShowDetailDrawer(false)}
                  className="w-8 h-8 rounded-xl bg-slate-200/80 hover:bg-slate-300 flex items-center justify-center text-slate-600 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Drawer Body */}
              <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
                {/* Segregation of Duties Notice */}
                {selectedExpense.userId === currentUserId && (selectedExpense.status === 'pending_approval' || selectedExpense.status === 'approved' || selectedExpense.status === 'partially_reimbursed') && (
                  <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2.5 font-medium">
                    <ShieldAlert className="w-4 h-4 shrink-0 text-amber-600" />
                    <span>Segregation of duties: You cannot approve, reject, or reimburse your own expense claim.</span>
                  </div>
                )}

                {/* Financial Breakdown Hero Card */}
                <div className="p-5 rounded-2xl bg-gradient-to-br from-indigo-900 via-slate-900 to-slate-950 text-white shadow-md space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-200">Financial Breakdown</span>
                      <div className="text-2xl font-black mt-0.5">₹{selectedExpense.amount.toLocaleString('en-IN')}</div>
                      <div className="text-[10px] text-slate-300">Claimed Amount</div>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold border ${
                        selectedExpense.status === 'approved'
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                          : selectedExpense.status === 'partially_reimbursed'
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                          : selectedExpense.status === 'reimbursed'
                          ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                          : selectedExpense.status === 'rejected'
                          ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                          : 'bg-slate-700/60 text-slate-300 border-slate-600'
                      }`}
                    >
                      {selectedExpense.status === 'pending_approval' ? 'Pending Approval' : selectedExpense.status.replace('_', ' ').toUpperCase()}
                    </span>
                  </div>

                  {/* Progress Bar */}
                  {['approved', 'partially_reimbursed', 'reimbursed'].includes(selectedExpense.status) && (
                    <div className="space-y-1.5 pt-2 border-t border-white/10">
                      <div className="flex justify-between text-[11px]">
                        <span>Reimbursed: ₹{(selectedExpense.reimbursedAmount || 0).toLocaleString('en-IN')}</span>
                        <span className="font-bold text-amber-300">Remaining: ₹{(selectedExpense.remainingAmount ?? selectedExpense.amount).toLocaleString('en-IN')}</span>
                      </div>
                      <div className="w-full h-2.5 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-indigo-400 to-emerald-400 transition-all duration-500"
                          style={{
                            width: `${Math.min(100, Math.max(0, (((selectedExpense.reimbursedAmount || 0) / (selectedExpense.approvedAmount || selectedExpense.amount)) * 100)))}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-2 pt-1 text-[11px] text-center bg-white/5 p-2.5 rounded-xl border border-white/10">
                    <div>
                      <div className="text-[10px] text-slate-400">Claimed</div>
                      <div className="font-bold text-white">₹{selectedExpense.amount.toLocaleString('en-IN')}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">Approved</div>
                      <div className="font-bold text-emerald-400">₹{(selectedExpense.approvedAmount ?? (['approved', 'partially_reimbursed', 'reimbursed'].includes(selectedExpense.status) ? selectedExpense.amount : 0)).toLocaleString('en-IN')}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">Remaining</div>
                      <div className="font-bold text-indigo-300">₹{(selectedExpense.remainingAmount ?? (selectedExpense.status === 'reimbursed' ? 0 : selectedExpense.amount)).toLocaleString('en-IN')}</div>
                    </div>
                  </div>
                </div>

                {/* Metadata Grid */}
                <div className="grid grid-cols-2 gap-4 text-xs bg-slate-50 p-4 rounded-2xl border border-slate-200">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Employee</span>
                    <div className="font-bold text-slate-900 mt-0.5">{selectedExpense.employeeName}</div>
                    <div className="text-[10px] text-slate-500">{selectedExpense.department || 'Department'}</div>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Merchant</span>
                    <div className="font-bold text-slate-900 mt-0.5">{selectedExpense.merchant || 'N/A'}</div>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Category</span>
                    <div className="font-bold text-slate-900 mt-0.5">{selectedExpense.category}</div>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Expense Date & Time</span>
                    <div className="font-bold text-slate-900 mt-0.5">
                      {selectedExpense.expenseDate} {selectedExpense.expenseTime}
                    </div>
                  </div>
                </div>

                {/* Reimbursement History Ledger */}
                {selectedExpense.reimbursementHistory && selectedExpense.reimbursementHistory.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 font-bold text-slate-800 text-xs">
                      <History className="w-4 h-4 text-indigo-600" />
                      <span>Reimbursement Transaction History</span>
                    </div>
                    <div className="space-y-2">
                      {selectedExpense.reimbursementHistory.map((tx) => (
                        <div key={tx.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs flex items-center justify-between">
                          <div>
                            <div className="font-bold text-slate-900">₹{tx.amount.toLocaleString('en-IN')} ({tx.isPartial ? 'Partial' : 'Full Payment'})</div>
                            <div className="text-[11px] text-slate-500">
                              Paid by {tx.reimbursedByName || 'Finance'} • {tx.paymentMethod || 'Bank Transfer'} ({tx.paymentRef || 'N/A'})
                            </div>
                            {tx.notes && <div className="text-[10px] text-slate-600 mt-0.5 italic">"{tx.notes}"</div>}
                          </div>
                          <div className="text-right">
                            <div className="text-[10px] font-bold text-slate-400">{new Date(tx.createdAt).toLocaleDateString()}</div>
                            <div className="text-[10px] text-indigo-600 font-semibold">Remaining: ₹{tx.newRemainingAmount.toLocaleString('en-IN')}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Description */}
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Description / Purpose</span>
                  <p className="text-xs text-slate-700 bg-slate-50 border border-slate-200 p-3 rounded-xl mt-1 font-medium">
                    {selectedExpense.description || 'No description provided.'}
                  </p>
                </div>

                {/* Receipt Preview Card */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Receipt Attachment</span>
                    {selectedExpense.receiptStoragePath && (
                      <button
                        type="button"
                        onClick={() => handleOpenFullReceipt(selectedExpense)}
                        className="text-xs font-bold text-indigo-600 hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <ArrowUpRight className="w-3.5 h-3.5" /> Open Full Size
                      </button>
                    )}
                  </div>
                  <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-indigo-600 font-bold">
                        <FileText className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-900">{selectedExpense.receiptOriginalName || 'receipt_document.pdf'}</div>
                        <div className="text-[10px] text-slate-400">{selectedExpense.receiptMimeType || 'PDF / Image Document'}</div>
                      </div>
                    </div>
                    {selectedExpense.receiptStoragePath && (
                      <button
                        type="button"
                        onClick={() => handleDownloadReceipt(selectedExpense)}
                        className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-700 font-bold text-xs hover:bg-slate-100 transition-all cursor-pointer"
                      >
                        Download
                      </button>
                    )}
                  </div>
                </div>

                {/* Rejection Reason if any */}
                {selectedExpense.rejectionReason && (
                  <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-xs">
                    <span className="font-bold text-rose-800 uppercase tracking-wider block text-[10px] mb-1">Rejection Reason</span>
                    <p className="text-rose-900 font-medium">{selectedExpense.rejectionReason}</p>
                  </div>
                )}
              </div>

              {/* Drawer Footer Actions */}
              <div className="p-5 border-t border-slate-200 bg-slate-50/80 flex flex-wrap gap-3">
                {selectedExpense.userId === currentUserId && (canApprove || canReimburse) && (
                  <div className="w-full text-center text-xs text-amber-700 font-semibold bg-amber-50 border border-amber-200/80 p-2.5 rounded-xl">
                    Segregation of duties: You cannot approve, reject, or reimburse your own expense claim.
                  </div>
                )}

                {canApprove && selectedExpense.status === 'pending_approval' && selectedExpense.userId !== currentUserId && (
                  <>
                    <button
                      disabled={actionProcessing}
                      onClick={() => handleApprove(selectedExpense.id)}
                      className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs cursor-pointer"
                    >
                      Approve Claim
                    </button>
                    <button
                      disabled={actionProcessing}
                      onClick={() => setShowRejectModal(true)}
                      className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs cursor-pointer"
                    >
                      Reject Claim
                    </button>
                  </>
                )}

                {canReimburse && ['approved', 'partially_reimbursed'].includes(selectedExpense.status) && selectedExpense.userId !== currentUserId && (
                  <button
                    disabled={actionProcessing}
                    onClick={() => openReimburseModalForExpense(selectedExpense)}
                    className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs cursor-pointer"
                  >
                    Disburse Reimbursement
                  </button>
                )}

                {selectedExpense.status === 'pending_approval' && selectedExpense.userId === currentUserId && (
                  <button
                    disabled={actionProcessing}
                    onClick={() => handleWithdraw(selectedExpense.id)}
                    className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs cursor-pointer"
                  >
                    Withdraw Expense to Draft
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ----------------------------------------------------------------- */}
      {/* REIMBURSEMENT MODAL (FULL / PARTIAL) */}
      {/* ----------------------------------------------------------------- */}
      <AnimatePresence>
        {showReimburseModal && selectedExpense && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-slate-200 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 text-slate-900"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-base font-black text-slate-900">Disburse Reimbursement</h3>
                  <p className="text-xs text-slate-500 font-medium">{selectedExpense.expenseId} • {selectedExpense.employeeName}</p>
                </div>
                <button onClick={() => setShowReimburseModal(false)} className="w-8 h-8 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-3.5 rounded-2xl bg-indigo-50 border border-indigo-100 text-xs space-y-1">
                <div className="flex justify-between text-slate-600 font-semibold">
                  <span>Approved Amount:</span>
                  <span>₹{(selectedExpense.approvedAmount || selectedExpense.amount).toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between text-slate-600 font-semibold">
                  <span>Reimbursed So Far:</span>
                  <span>₹{(selectedExpense.reimbursedAmount || 0).toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between text-indigo-950 font-black text-sm pt-1 border-t border-indigo-200">
                  <span>Remaining Reimbursable:</span>
                  <span>₹{(selectedExpense.remainingAmount ?? selectedExpense.amount).toLocaleString('en-IN')}</span>
                </div>
              </div>

              {!canAllowPartialReimburse && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[11px] flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
                  <span>Partial reimbursement capability is OFF for your role. Full reimbursement required.</span>
                </div>
              )}

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Reimbursement Amount (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    disabled={!canAllowPartialReimburse}
                    max={selectedExpense.remainingAmount ?? selectedExpense.amount}
                    value={reimbursementAmountInput}
                    onChange={(e) => setReimbursementAmountInput(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-bold focus:bg-white focus:border-indigo-500 disabled:opacity-80"
                  />
                  {canAllowPartialReimburse && (
                    <span className="text-[10px] text-slate-400 mt-0.5 block">
                      Enter partial amount or keep max amount (₹{(selectedExpense.remainingAmount ?? selectedExpense.amount).toLocaleString('en-IN')}) for full payout.
                    </span>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Payment Method</label>
                  <select
                    value={paymentMethodInput}
                    onChange={(e) => setPaymentMethodInput(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-medium"
                  >
                    <option value="Bank Transfer">Bank Transfer / NEFT / RTGS</option>
                    <option value="UPI / Direct Transfer">UPI / Direct Transfer</option>
                    <option value="Corporate Card Reimbursement">Corporate Card Reimbursement</option>
                    <option value="Cash Payout">Cash Payout</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Reference / UTR Number</label>
                  <input
                    type="text"
                    value={reimbursementRefInput}
                    onChange={(e) => setReimbursementRefInput(e.target.value)}
                    placeholder="e.g. UTR-9988776655"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-medium"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Notes / Disbursal Remarks</label>
                  <input
                    type="text"
                    value={notesInput}
                    onChange={(e) => setNotesInput(e.target.value)}
                    placeholder="e.g. First partial installment paid via ICICI Bank"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-medium"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowReimburseModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={actionProcessing}
                  onClick={handleReimburse}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs cursor-pointer"
                >
                  {actionProcessing ? 'Processing...' : 'Confirm Reimbursement'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ----------------------------------------------------------------- */}
      {/* REJECT EXPENSE MODAL */}
      {/* ----------------------------------------------------------------- */}
      <AnimatePresence>
        {showRejectModal && selectedExpense && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-slate-200 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 text-slate-900"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-base font-black text-rose-600">Reject Expense Claim</h3>
                  <p className="text-xs text-slate-500 font-medium">{selectedExpense.expenseId} • {selectedExpense.employeeName}</p>
                </div>
                <button onClick={() => setShowRejectModal(false)} className="w-8 h-8 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Mandatory Rejection Reason</label>
                  <textarea
                    rows={3}
                    required
                    value={rejectionReasonInput}
                    onChange={(e) => setRejectionReasonInput(e.target.value)}
                    placeholder="Provide detailed reason for rejecting this claim..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 font-medium"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowRejectModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={actionProcessing || !rejectionReasonInput.trim()}
                  onClick={handleReject}
                  className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {actionProcessing ? 'Rejecting...' : 'Confirm Rejection'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ----------------------------------------------------------------- */}
      {/* SUBMIT EXPENSE MODAL */}
      {/* ----------------------------------------------------------------- */}
      <AnimatePresence>
        {showSubmitModal && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-slate-200 rounded-3xl max-w-xl w-full p-6 shadow-2xl space-y-5"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-lg font-black text-slate-900">Submit New Expense</h3>
                  <p className="text-xs text-slate-500 font-medium">Upload receipt for automatic OCR scanning & submission</p>
                </div>
                <button onClick={() => setShowSubmitModal(false)} className="w-8 h-8 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {submitStep === 'upload' && (
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files?.[0]) handleFileUpload(e.dataTransfer.files[0]);
                  }}
                  className="border-2 border-dashed border-slate-300 hover:border-indigo-500 rounded-3xl p-8 text-center bg-slate-50/60 transition-colors cursor-pointer"
                >
                  <Upload className="w-10 h-10 text-indigo-600 mx-auto mb-3" />
                  <div className="text-sm font-bold text-slate-800">Drag and drop receipt here</div>
                  <div className="text-xs text-slate-400 mt-1">Supports PNG, JPG, JPEG, PDF up to 10MB</div>
                  <label className="mt-4 inline-block px-4 py-2 rounded-xl bg-indigo-600 text-white font-semibold text-xs cursor-pointer shadow-xs">
                    Browse Files
                    <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])} />
                  </label>
                </div>
              )}

              {submitStep === 'ocr_verify' && (
                <div className="p-8 text-center space-y-3">
                  <Sparkles className="w-10 h-10 text-indigo-600 animate-spin mx-auto" />
                  <div className="text-sm font-bold text-slate-900">Extracting receipt data with Gemini OCR...</div>
                  <div className="text-xs text-slate-500 font-medium">Auto-scanning date, time, merchant, and total amount</div>
                </div>
              )}

              {submitStep === 'form' && (
                <form onSubmit={handleSubmitExpense} className="space-y-4 text-xs">
                  {ocrData && (
                    <div className={`p-3 rounded-xl border text-xs space-y-1 ${ocrData.ocrSuccess ? 'bg-emerald-50 border-emerald-200 text-emerald-950' : 'bg-amber-50 border-amber-200 text-amber-950'}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 font-bold text-slate-800">
                          <Sparkles className={`w-4 h-4 shrink-0 ${ocrData.ocrSuccess ? 'text-emerald-600' : 'text-amber-600'}`} />
                          <span>{ocrData.ocrSuccess ? 'Receipt Auto-Extracted' : 'OCR Scan Complete — Needs Manual Input'}</span>
                        </div>
                        <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase ${ocrData.ocrSuccess ? 'bg-emerald-200/80 text-emerald-900' : 'bg-amber-200/80 text-amber-900'}`}>
                          {ocrData.ocrSuccess ? 'Auto-Parsed' : 'Needs Verification'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600">
                        {ocrData.amountSource === 'receipt' ? `Total Payable ₹${ocrData.amount?.toLocaleString('en-IN')} extracted from receipt.` : 'Could not confidently extract amount — please enter amount manually.'}
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-[11px] font-bold text-slate-600 uppercase">Amount (₹)</label>
                        {ocrData?.amountSource === 'receipt' ? (
                          <span className="text-[9px] font-bold text-emerald-600">✓ Extracted from receipt</span>
                        ) : ocrData ? (
                          <span className="text-[9px] font-bold text-amber-600">⚠ Please verify amount</span>
                        ) : null}
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        required
                        value={formAmount}
                        onChange={(e) => setFormAmount(e.target.value)}
                        placeholder="e.g. 8000"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-bold focus:bg-white focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-[11px] font-bold text-slate-600 uppercase">Merchant Name</label>
                        {ocrData?.merchantSource === 'receipt' ? (
                          <span className="text-[9px] font-bold text-emerald-600">✓ Extracted from receipt</span>
                        ) : ocrData ? (
                          <span className="text-[9px] font-bold text-amber-600">⚠ Could not confidently identify</span>
                        ) : null}
                      </div>
                      <input
                        type="text"
                        required
                        value={formMerchant}
                        onChange={(e) => setFormMerchant(e.target.value)}
                        placeholder="e.g. Reliance Smart"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-medium focus:bg-white focus:border-indigo-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-[11px] font-bold text-slate-600 uppercase">Category</label>
                        {ocrData?.category ? (
                          <span className="text-[9px] font-bold text-emerald-600">✓ Inferred</span>
                        ) : ocrData ? (
                          <span className="text-[9px] font-bold text-amber-600">Select category</span>
                        ) : null}
                      </div>
                      <select
                        value={formCategory}
                        onChange={(e) => setFormCategory(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 text-slate-900 font-medium focus:bg-white focus:border-indigo-500 text-xs"
                      >
                        {!formCategory && <option value="">[ Select category ]</option>}
                        {categories
                          .filter((c) => c.status === 'active')
                          .map((c) => (
                            <option key={c.id} value={c.name}>
                              {c.name}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-[11px] font-bold text-slate-600 uppercase">Expense Date</label>
                        {ocrData?.dateSource === 'receipt' ? (
                          <span className="text-[9px] font-bold text-emerald-600">✓ Receipt Date</span>
                        ) : ocrData ? (
                          <span className="text-[9px] font-bold text-slate-500">↳ Upload date</span>
                        ) : null}
                      </div>
                      <input
                        type="date"
                        required
                        value={formDate}
                        onChange={(e) => setFormDate(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 text-slate-900 font-medium focus:bg-white focus:border-indigo-500 text-xs"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-[11px] font-bold text-slate-600 uppercase">Expense Time</label>
                        {ocrData?.timeSource === 'receipt' ? (
                          <span className="text-[9px] font-bold text-emerald-600">✓ Receipt Time</span>
                        ) : ocrData ? (
                          <span className="text-[9px] font-bold text-slate-500">↳ Upload time</span>
                        ) : null}
                      </div>
                      <input
                        type="text"
                        placeholder="HH:MM"
                        required
                        value={formTime}
                        onChange={(e) => setFormTime(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 text-slate-900 font-medium focus:bg-white focus:border-indigo-500 text-xs"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Description / Purpose</label>
                    <textarea
                      rows={2}
                      value={formDescription}
                      onChange={(e) => setFormDescription(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 font-medium"
                      placeholder="Briefly state the business reason..."
                    />
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setShowSubmitModal(false)}
                      className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-xs cursor-pointer"
                    >
                      {submitting ? 'Submitting...' : 'Submit Claim'}
                    </button>
                  </div>
                </form>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ----------------------------------------------------------------- */}
      {/* IN-MODULE REPORT BUILDER MODAL */}
      {/* ----------------------------------------------------------------- */}
      <AnimatePresence>
        {showReportModal && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-slate-200 rounded-3xl max-w-2xl w-full p-6 shadow-2xl space-y-6 text-slate-900"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-lg font-black text-slate-900">Expense Report Builder</h3>
                  <p className="text-xs text-slate-500 font-medium">Customize columns, scope, and format directly inside Expenses</p>
                </div>
                <button onClick={() => setShowReportModal(false)} className="w-8 h-8 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Format Selection */}
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Export Format</label>
                <div className="grid grid-cols-4 gap-3 text-xs font-bold">
                  {[
                    { id: 'excel', label: 'Excel (.xlsx)', icon: FileSpreadsheet },
                    { id: 'pdf', label: 'PDF Report', icon: FileText },
                    { id: 'csv', label: 'CSV File', icon: FileText },
                    { id: 'json', label: 'JSON Data', icon: FileCode },
                  ].map((fmt) => (
                    <button
                      key={fmt.id}
                      onClick={() => setReportFormat(fmt.id as any)}
                      className={`p-3 rounded-2xl border flex flex-col items-center gap-1.5 transition-all cursor-pointer ${
                        reportFormat === fmt.id ? 'bg-indigo-50 border-indigo-500 text-indigo-700 shadow-2xs' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <fmt.icon className="w-5 h-5" />
                      <span>{fmt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Column Selection */}
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Select Columns to Include</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-slate-50 p-3.5 rounded-2xl border border-slate-200 max-h-48 overflow-y-auto text-xs">
                  {[
                    { key: 'expenseId', label: 'Expense ID' },
                    { key: 'employeeName', label: 'Employee Name' },
                    { key: 'department', label: 'Department' },
                    { key: 'expenseDate', label: 'Expense Date' },
                    { key: 'merchant', label: 'Merchant' },
                    { key: 'category', label: 'Category' },
                    { key: 'amount', label: 'Claimed Amount' },
                    { key: 'approvedAmount', label: 'Approved Amount' },
                    { key: 'reimbursedAmount', label: 'Reimbursed Amount' },
                    { key: 'remainingAmount', label: 'Remaining Amount' },
                    { key: 'status', label: 'Status' },
                    { key: 'reimbursementStatus', label: 'Reimbursement Status' },
                  ].map((col) => (
                    <label key={col.key} className="flex items-center gap-2 font-medium text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedReportColumns.includes(col.key)}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedReportColumns([...selectedReportColumns, col.key]);
                          else setSelectedReportColumns(selectedReportColumns.filter((c) => c !== col.key));
                        }}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>{col.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Footer Actions */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button onClick={() => setShowReportModal(false)} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs cursor-pointer">
                  Cancel
                </button>
                <button
                  onClick={handleGenerateReport}
                  disabled={generatingReport}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-xs flex items-center gap-2 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>{generatingReport ? 'Generating...' : 'Export Expenses Report'}</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );

  if (embedded) return content;

  const defaultNavItems = [
    { id: 'expenses', label: 'Expenses', icon: Receipt },
  ];

  return (
    <PortalShell
      user={user}
      roleLabel={user.role}
      navItems={defaultNavItems}
      activeTab="expenses"
      onTabChange={() => {}}
      title="Expenses"
      onLogout={onLogout || (() => {})}
    >
      {content}
    </PortalShell>
  );
}
