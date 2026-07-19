import { useState, useEffect } from 'react';

// Recruitment — hiring form, branch/shift options, and the "new role needs
// payroll setup" reminder. Extracted verbatim from Dashboard.tsx.
// `onHired` is called after a successful hire so the parent can re-run its
// aggregate `fetchTenantAdminData()` (unchanged behavior).
export function useRecruitment(
  token: string | null,
  setLoading: (v: boolean) => void,
  setError: (v: string) => void,
  setSuccess: (v: string) => void,
  onHired: () => void,
) {
  // Recruitment Form fields
  const [recruitedUsers, setRecruitedUsers] = useState<any[]>([]);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  // Empty by default (not e.g. 'Employee') so the <datalist> below shows every
  // suggestion — browsers filter datalist options to ones that substring-match
  // whatever's already typed, so a pre-filled value used to hide every option
  // that didn't literally contain that text.
  const [newUserRole, setNewUserRole] = useState('');
  const [newUserPrivileges, setNewUserPrivileges] = useState<string[]>([]);
  const [hasRecruitmentAccess, setHasRecruitmentAccess] = useState(false);

  // POST /api/tenant/users/create requires branchId/shiftId (every employee
  // must belong to a real branch and a real shift from day one) — these
  // fields drive that, sourced from the caller's own manageable branches
  // (GET /api/tenant/my-branches, already branch-scoped server-side) rather
  // than the unscoped /api/branches.
  const [hireBranches, setHireBranches] = useState<any[]>([]);
  const [hireShifts, setHireShifts] = useState<any[]>([]);
  const [newUserBranchId, setNewUserBranchId] = useState('');
  const [newUserShiftId, setNewUserShiftId] = useState('');

  // Branch options for the Recruit Team Member form above — fetched once;
  // not gated behind any tab check since it's cheap and the form needs it
  // ready the moment Administration > Recruitment is opened.
  useEffect(() => {
    fetch('/api/tenant/my-branches', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        const list = Array.isArray(d.branches) ? d.branches : [];
        setHireBranches(list);
        if (list.length > 0) setNewUserBranchId((current) => current || String(list[0].id));
      })
      .catch(() => { /* Recruitment form just shows "no branches yet" below */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Shift options depend on which branch is selected above.
  useEffect(() => {
    if (!newUserBranchId) { setHireShifts([]); return; }
    fetch(`/api/branches/${newUserBranchId}/shifts`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        const list = Array.isArray(d.shifts) ? d.shifts : [];
        setHireShifts(list);
        setNewUserShiftId((current) => (list.some((s: any) => String(s.id) === current) ? current : (list[0] ? String(list[0].id) : '')));
      })
      .catch(() => setHireShifts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newUserBranchId]);

  // "Set up this new role" prompt — a banner shown right after hiring the
  // first person into a brand-new role (POST /api/tenant/users/create's
  // isNewRole flag), plus a persistent list (derived fresh from real data
  // every time this loads, not stored anywhere) of any role that has
  // privilege defaults but no payroll role-default yet — so the reminder
  // survives a dismiss/navigate-away instead of being a one-time toast.
  const [newRolePrompt, setNewRolePrompt] = useState<string | null>(null);
  const [allRoleNames, setAllRoleNames] = useState<string[]>([]);
  const [payrollConfiguredRoleNames, setPayrollConfiguredRoleNames] = useState<string[]>([]);
  const refreshRoleSetupStatus = () => {
    fetch('/api/tenant/roles', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setAllRoleNames(Array.isArray(d.roles) ? d.roles.map((r: any) => r.roleName) : []))
      .catch(() => {});
    fetch('/api/tenant/payroll/role-defaults', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setPayrollConfiguredRoleNames(Array.isArray(d.roleDefaults) ? d.roleDefaults.map((r: any) => r.roleName) : []))
      .catch(() => {});
  };
  useEffect(() => { refreshRoleSetupStatus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const rolesNeedingPayrollSetup = allRoleNames.filter((r) => !payrollConfiguredRoleNames.includes(r));

  const handleHireUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/tenant/users/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          email: newUserEmail,
          name: newUserName,
          role: newUserRole,
          privileges: newUserPrivileges,
          branchId: newUserBranchId ? Number(newUserBranchId) : undefined,
          shiftId: newUserShiftId ? Number(newUserShiftId) : undefined,
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to register employee');

      setSuccess(
        data.emailDelivered
          ? `Employee "${newUserName}" hired successfully. Temporary credentials sent.`
          : `Employee "${newUserName}" hired successfully — but the credential email could NOT be delivered (no mail provider is configured or it failed). Share their temporary password with them manually, or check the SMTP/Resend setup.`
      );
      if (data.isNewRole && data.role) {
        setNewRolePrompt(data.role);
        refreshRoleSetupStatus();
      }
      setNewUserEmail('');
      setNewUserName('');
      setNewUserRole('');
      setNewUserPrivileges([]);

      onHired();

      setTimeout(() => setSuccess(''), data.emailDelivered ? 4000 : 10000);
    } catch (err: any) {
      setError(err.message || 'Failed to register employee');
    } finally {
      setLoading(false);
    }
  };

  // Functional update — required because "Manage Employees" calls this twice
  // in one handler (toggling both 'employee.create' and 'employee.read'
  // together); reading the `newUserPrivileges` closure variable directly (as
  // this used to) meant the second call saw the same stale pre-update array
  // as the first, so it silently overwrote the first toggle instead of
  // building on it. The functional form always sees the latest queued state.
  const togglePrivilege = (priv: string) => {
    setNewUserPrivileges(prev => prev.includes(priv) ? prev.filter(p => p !== priv) : [...prev, priv]);
  };

  return {
    recruitedUsers, setRecruitedUsers,
    newUserEmail, setNewUserEmail,
    newUserName, setNewUserName,
    newUserRole, setNewUserRole,
    newUserPrivileges, setNewUserPrivileges,
    hasRecruitmentAccess, setHasRecruitmentAccess,
    hireBranches,
    hireShifts,
    newUserBranchId, setNewUserBranchId,
    newUserShiftId, setNewUserShiftId,
    newRolePrompt, setNewRolePrompt,
    allRoleNames,
    rolesNeedingPayrollSetup,
    refreshRoleSetupStatus,
    handleHireUser,
    togglePrivilege,
  };
}
