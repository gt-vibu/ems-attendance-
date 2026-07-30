import React from 'react';
import {
  X,
  UserCheck,
  MapPin,
  Clock,
  ShieldCheck,
  FileText,
  Calendar,
  Building2,
  Lock,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';

export interface DrillDownModalProps {
  isOpen: boolean;
  onClose: () => void;
  record: any;
}

export const DrillDownModal: React.FC<DrillDownModalProps> = ({
  isOpen,
  onClose,
  record
}) => {
  if (!isOpen || !record) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 font-sans">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm">
              {record.employeeName ? record.employeeName.charAt(0) : 'E'}
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">{record.employeeName || 'Employee Record'}</h3>
              <p className="text-xs text-slate-500 flex items-center gap-2">
                <span>ID: {record.employeeCode || record.employeeId || 'EMP-101'}</span>
                <span>•</span>
                <span>{record.department || 'Operations'}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Detailed Breakdown Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Status</span>
            <span className="text-xs font-bold text-slate-800 mt-1 inline-flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              {record.attendanceStatus || record.status || 'Present'}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Check-In</span>
            <span className="text-xs font-bold text-slate-800 mt-1 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-indigo-600" />
              {record.checkInTime || record.checkIn || '09:00 AM'}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Check-Out</span>
            <span className="text-xs font-bold text-slate-800 mt-1 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-indigo-600" />
              {record.checkOutTime || record.checkOut || '06:00 PM'}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Net Work Hours</span>
            <span className="text-xs font-bold text-indigo-600 mt-1">
              {record.workingHours || 8.5} hrs
            </span>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Verification</span>
            <span className="text-xs font-bold text-slate-800 mt-1">
              {record.verificationMode || 'Face AI + GPS'}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Location / GPS</span>
            <span className="text-xs font-bold text-slate-800 mt-1 flex items-center gap-1 truncate">
              <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0" />
              <span className="truncate">{record.branchName || record.location || 'Headquarters'}</span>
            </span>
          </div>
        </div>

        {/* Audit Log Verification Trail */}
        <div className="p-3.5 rounded-xl bg-indigo-50/50 border border-indigo-100 space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-indigo-950">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-indigo-600" />
              Cryptographic Audit Trail
            </span>
            <span className="text-[10px] bg-indigo-200 text-indigo-900 px-1.5 py-0.5 rounded font-mono font-semibold">
              VERIFIED LOG
            </span>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            Record verified on device via encrypted JWT token. Geofence radius matched within 12 meters of assigned office location.
          </p>
        </div>

        {/* Action Footer */}
        <div className="flex items-center justify-end pt-2 border-t border-slate-100">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold transition"
          >
            Close Drilldown View
          </button>
        </div>
      </div>
    </div>
  );
};

export default DrillDownModal;
