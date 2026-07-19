// Starter leave-type catalog offered to a tenant with zero configured leave
// policies — mirrors the standard set most HR systems (Zoho People, etc.)
// ship by default, so a fresh tenant's Leave Management isn't a single empty
// card. Fully editable/deletable afterward like any other policy; this is
// just a one-time convenience seed, not a hardcoded requirement.
export const STARTER_LEAVE_POLICIES: Array<{
  name: string;
  code: string;
  maxDaysPerYear: number;
  allowHalfDay: boolean;
  requiresApproval: boolean;
  defaultDeductionPercent: number;
}> = [
  { name: 'Casual Leave', code: 'CL', maxDaysPerYear: 12, allowHalfDay: true, requiresApproval: true, defaultDeductionPercent: 100 },
  { name: 'Sick Leave', code: 'SL', maxDaysPerYear: 12, allowHalfDay: true, requiresApproval: true, defaultDeductionPercent: 100 },
  { name: 'Earned Leave', code: 'EL', maxDaysPerYear: 15, allowHalfDay: false, requiresApproval: true, defaultDeductionPercent: 100 },
  { name: 'Leave Without Pay', code: 'LWP', maxDaysPerYear: 0, allowHalfDay: false, requiresApproval: true, defaultDeductionPercent: 100 },
  { name: 'Paternity Leave', code: 'PL', maxDaysPerYear: 7, allowHalfDay: false, requiresApproval: true, defaultDeductionPercent: 0 },
  { name: 'Sabbatical Leave', code: 'SB', maxDaysPerYear: 0, allowHalfDay: false, requiresApproval: true, defaultDeductionPercent: 100 },
];
