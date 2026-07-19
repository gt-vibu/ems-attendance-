import { useState } from 'react';

// Home tab (organization overview) extra widgets: pending leave, payroll
// this month, department breakdown/"Your Team" roster. Each is populated by
// the aggregate fetchTenantAdminData() fetch in Dashboard.tsx (unchanged);
// this hook just owns the state slice. Extracted verbatim from Dashboard.tsx.
export function useHomeWidgets() {
  const [homeLeaveRequests, setHomeLeaveRequests] = useState<any[]>([]);
  const [hasLeaveAccess, setHasLeaveAccess] = useState(false);
  const [homePayrollOverview, setHomePayrollOverview] = useState<any>(null);
  const [hasPayrollAccess, setHasPayrollAccess] = useState(false);
  // Full employee roster (department + managerId) — reports.view/employee.read
  // gated. Powers both the admin's Department Breakdown widget and a
  // manager's "Your Team" direct-report scoping (data-derived, not role-name).
  const [homeEmployees, setHomeEmployees] = useState<any[]>([]);
  const [hasEmployeesAccess, setHasEmployeesAccess] = useState(false);

  return {
    homeLeaveRequests, setHomeLeaveRequests,
    hasLeaveAccess, setHasLeaveAccess,
    homePayrollOverview, setHomePayrollOverview,
    hasPayrollAccess, setHasPayrollAccess,
    homeEmployees, setHomeEmployees,
    hasEmployeesAccess, setHasEmployeesAccess,
  };
}
