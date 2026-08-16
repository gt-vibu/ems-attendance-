import { Router } from 'express';
import { eq, and, desc, inArray, ne } from 'drizzle-orm';
import { db, schema } from '../../db';
import { sendServerError } from '../utils/errors';
import { getByIdForTenant } from '../utils/tenantScoped';
import { authenticate } from '../middleware/authenticate';
import { hasPrivilege, hasAnyPrivilege, getScopedBranchIds, getEffectivePrivileges, getDefaultPrivilegesForRole, isPlatformFeatureAllowedForTenant } from '../auth/rbac';
import { logToAuditLedger } from '../services/audit';
import { notifyUser } from '../services/notifications';
import { notify } from '../services/notificationService';
import { resolveDayStatus } from '../services/attendanceDayStatus';
import { tenantDateKey } from '../services/tenantTime';

export const router = Router();

// GET all employees
router.get('/api/tenant/employees', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'employee.read') && !await hasPrivilege(req.user, 'reports.view')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }

    const tenantId = req.user.tenantId;
    const scopedBranchIds = await getScopedBranchIds(req.user);

    // Fetch users
    const userFilter = scopedBranchIds !== null
      ? and(eq(schema.users.tenantId, tenantId), inArray(schema.users.branchId, scopedBranchIds))
      : eq(schema.users.tenantId, tenantId);

    const [usersList, branchesList, shiftsList] = await Promise.all([
      db.select().from(schema.users).where(userFilter).orderBy(desc(schema.users.createdAt)),
      db.select().from(schema.branches).where(eq(schema.branches.tenantId, tenantId)),
      db.select().from(schema.shifts).where(eq(schema.shifts.tenantId, tenantId)),
    ]);

    const branchMap = new Map<number, any>(branchesList.map(b => [b.id, b]));
    const shiftMap = new Map<number, any>(shiftsList.map(s => [s.id, s]));
    const userMap = new Map<number, any>(usersList.map(u => [u.id, u]));

    const employees = usersList.map(u => {
      const branch = u.branchId ? branchMap.get(u.branchId) : null;
      const shift = u.shiftId ? shiftMap.get(u.shiftId) : null;
      const manager = u.managerId ? userMap.get(u.managerId) : null;

      return {
        id: u.id,
        uid: u.uid,
        name: u.name,
        email: u.email,
        phone: u.phone || '',
        department: u.department || '',
        designation: u.designation || '',
        employmentType: u.employmentType || 'full_time',
        managerId: u.managerId || null,
        managerName: manager ? manager.name : '',
        branchId: u.branchId || null,
        branchName: branch ? branch.name : '',
        shiftId: u.shiftId || null,
        shiftName: shift ? shift.name : '',
        shiftCheckIn: shift ? shift.checkInTime : '',
        shiftCheckOut: shift ? shift.checkOutTime : '',
        dateOfJoining: u.dateOfJoining || '',
        employeeStatus: u.employeeStatus || 'active',
        role: u.role,
        isKycCompleted: !!u.isKycCompleted,
        createdAt: u.createdAt,
      };
    });

    res.json({ employees });
  } catch (err: any) {
    sendServerError(res, err, "employees.routes.ts");
  }
});

// Lightweight node list for the org chart — the frontend builds the actual
// tree from managerId (see OrgChartPage.tsx), this just supplies scoped,
// active-employee nodes. Deliberately separate from GET /api/tenant/employees
// (which returns the full profile shape needed for the directory table) so
// the org-chart page's payload stays small even for a large tenant.
router.get('/api/tenant/org-chart', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasAnyPrivilege(req.user, ['employee.read', 'reports.view'])) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }

    const tenantId = req.user.tenantId;
    const scopedBranchIds = await getScopedBranchIds(req.user);
    const userFilter = scopedBranchIds !== null
      ? and(eq(schema.users.tenantId, tenantId), inArray(schema.users.branchId, scopedBranchIds), ne(schema.users.employeeStatus, 'terminated'))
      : and(eq(schema.users.tenantId, tenantId), ne(schema.users.employeeStatus, 'terminated'));

    const usersList = await db.select().from(schema.users).where(userFilter);
    const validIds = new Set(usersList.map((u) => u.id));

    const nodes = usersList.map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      designation: u.designation || '',
      department: u.department || '',
      // A managerId pointing outside this scoped set (e.g. branch-scoped
      // viewer whose employees report to someone outside their branches) or
      // at a terminated/missing user renders as a root node instead of a
      // dangling reference.
      managerId: u.managerId && validIds.has(u.managerId) ? u.managerId : null,
    }));

    res.json({ nodes });
  } catch (err: any) {
    sendServerError(res, err, "employees.routes.ts");
  }
});

// GET single employee profile
router.get('/api/tenant/employees/:id', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'employee.read') && !await hasPrivilege(req.user, 'reports.view')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }

    const employeeId = parseInt(req.params.id, 10);
    const tenantId = req.user.tenantId;

    const employee = await getByIdForTenant(schema.users, employeeId, tenantId);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    const scopedBranchIds = await getScopedBranchIds(req.user);
    if (scopedBranchIds !== null && employee.branchId && !scopedBranchIds.includes(employee.branchId)) {
      return res.status(403).json({ error: 'Access denied: You are not scoped to this employee\'s branch.' });
    }

    // Fetch references for enrichments
    const [branchRows, shiftRows, managerRows] = await Promise.all([
      employee.branchId ? db.select().from(schema.branches).where(eq(schema.branches.id, employee.branchId)).limit(1) : Promise.resolve([]),
      employee.shiftId ? db.select().from(schema.shifts).where(eq(schema.shifts.id, employee.shiftId)).limit(1) : Promise.resolve([]),
      employee.managerId ? db.select().from(schema.users).where(eq(schema.users.id, employee.managerId)).limit(1) : Promise.resolve([]),
    ]);

    res.json({
      employee: {
        id: employee.id,
        uid: employee.uid,
        name: employee.name,
        email: employee.email,
        phone: employee.phone || '',
        department: employee.department || '',
        designation: employee.designation || '',
        employmentType: employee.employmentType || 'full_time',
        managerId: employee.managerId || null,
        managerName: managerRows[0] ? managerRows[0].name : '',
        branchId: employee.branchId || null,
        branchName: branchRows[0] ? branchRows[0].name : '',
        shiftId: employee.shiftId || null,
        shiftName: shiftRows[0] ? shiftRows[0].name : '',
        dateOfJoining: employee.dateOfJoining || '',
        employeeStatus: employee.employeeStatus || 'active',
        role: employee.role,
        isKycCompleted: !!employee.isKycCompleted,
        createdAt: employee.createdAt,
        privileges: Array.isArray(employee.privileges) ? employee.privileges : [],
      }
    });
  } catch (err: any) {
    sendServerError(res, err, "employees.routes.ts");
  }
});

// UPDATE employee profile
router.put('/api/tenant/employees/:id', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasAnyPrivilege(req.user, ['employee.edit', 'employee.create'])) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }

    const employeeId = parseInt(req.params.id, 10);
    const tenantId = req.user.tenantId;

    const employee = await getByIdForTenant(schema.users, employeeId, tenantId);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    const scopedBranchIds = await getScopedBranchIds(req.user);
    if (scopedBranchIds !== null && employee.branchId && !scopedBranchIds.includes(employee.branchId)) {
      return res.status(403).json({ error: 'Access denied: You are not scoped to this employee\'s branch.' });
    }

    const {
      name,
      phone,
      department,
      designation,
      employmentType,
      managerId,
      branchId,
      shiftId,
      dateOfJoining,
      employeeStatus,
      email,
      role,
      privileges,
    } = req.body;

    // Validate mobile phone format if provided
    if (phone !== undefined && phone !== null && String(phone).trim() !== '') {
      const cleanPhone = String(phone).trim();
      if (!/^\+?[0-9\s\-]{7,15}$/.test(cleanPhone) || /[a-zA-Z]/.test(cleanPhone)) {
        return res.status(400).json({ error: 'Invalid mobile phone number. Must contain 7-15 digits with optional dashes/spaces/leading + and no letters.' });
      }
    }

    // Validate email uniqueness if changing
    if (email && email !== employee.email) {
      const existing = await db.select().from(schema.users).where(and(eq(schema.users.email, email), ne(schema.users.id, employeeId)));
      if (existing.length > 0) {
        return res.status(400).json({ error: 'Email already registered' });
      }
    }

    // Validate role if changing
    if (role && role !== employee.role) {
      const normalizedRole = String(role).trim().toLowerCase();
      if (normalizedRole === 'super_admin' || normalizedRole === 'tenant_admin' || normalizedRole === 'superadmin') {
        return res.status(403).json({ error: 'This role cannot be assigned here.' });
      }
    }

    // Precedence of Power checks for privileges
    let finalPrivilegesDelta = employee.privileges;
    if (privileges !== undefined || (role && role !== employee.role)) {
      const requesterPrivileges = await getEffectivePrivileges(req.user);
      const targetRole = role || employee.role;
      const roleDefaults = await getDefaultPrivilegesForRole(tenantId, targetRole);
      
      const requestedExtra = Array.isArray(privileges) 
        ? privileges 
        : (Array.isArray(employee.privileges) ? employee.privileges : []);

      const grantablePrivileges = requesterPrivileges === 'ALL'
        ? requestedExtra
        : requestedExtra.filter((p: string) => requesterPrivileges.includes(p));

      // Calculate the delta (extras not in defaults)
      const individualExtras = grantablePrivileges.filter((p: string) => !roleDefaults.includes(p));
      finalPrivilegesDelta = individualExtras;
    }

    // Validate branch if changing
    if (branchId && branchId !== employee.branchId) {
      const branchRow = await getByIdForTenant(schema.branches, branchId, tenantId);
      if (!branchRow) {
        return res.status(400).json({ error: 'Invalid branch ID.' });
      }
      if (scopedBranchIds !== null && !scopedBranchIds.includes(branchId)) {
        return res.status(403).json({ error: 'Access denied: You are not scoped to the target branch.' });
      }
    }

    // Validate shift if changing
    let newShiftName: string | null = null;
    if (shiftId && shiftId !== employee.shiftId) {
      const shiftRow = await getByIdForTenant(schema.shifts, shiftId, tenantId);
      if (!shiftRow) {
        return res.status(400).json({ error: 'Invalid shift ID.' });
      }
      newShiftName = shiftRow.name;
    }

    // Validate manager if changing
    if (managerId && managerId !== employee.managerId) {
      const managerRow = await getByIdForTenant(schema.users, managerId, tenantId);
      if (!managerRow) {
        return res.status(400).json({ error: 'Invalid manager ID.' });
      }
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (department !== undefined) updateData.department = department;
    if (designation !== undefined) updateData.designation = designation;
    if (employmentType !== undefined) updateData.employmentType = employmentType;
    if (managerId !== undefined) updateData.managerId = managerId;
    if (branchId !== undefined) updateData.branchId = branchId;
    if (shiftId !== undefined) updateData.shiftId = shiftId;
    if (dateOfJoining !== undefined) updateData.dateOfJoining = dateOfJoining;
    if (employeeStatus !== undefined) updateData.employeeStatus = employeeStatus;
    if (email !== undefined) updateData.email = email;
    if (role !== undefined) updateData.role = role;
    if (finalPrivilegesDelta !== undefined) updateData.privileges = finalPrivilegesDelta;

    const [updated] = await db.update(schema.users)
      .set(updateData)
      .where(eq(schema.users.id, employeeId))
      .returning();

    await logToAuditLedger({
      tenantId,
      actorId: req.user.userId,
      actorName: req.user.name,
      action: 'EMPLOYEE_UPDATED',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      deviceInfo: req.headers['user-agent'] || '',
      details: { employeeId, updates: updateData }
    });

    if (newShiftName) {
      // Previously in-app only (notifyUser), completely bypassing notify()/
      // email even though 'shift_changed' is defined with email enabled in
      // DEFAULT_POLICIES — an employee's shift could change with no email
      // ever sent. Toggle-gated fallback keeps the old in-app-only behavior
      // for tenants that haven't opted into unified_notifications.
      if (await isPlatformFeatureAllowedForTenant(tenantId, 'unified_notifications')) {
        await notify(tenantId, 'shift_changed', {
          subjectUserId: employeeId,
          subjectName: updated?.name || employee.name,
          actorId: req.user.userId,
          data: { newShiftName },
        }).catch(() => undefined);
      } else {
        await notifyUser(employeeId, 'Your shift has changed', `Your shift has been changed to ${newShiftName}, effective immediately.`);
      }
    }

    res.json({ success: true, employee: updated });
  } catch (err: any) {
    sendServerError(res, err, "employees.routes.ts");
  }
});

// Clears an employee's registered passkey and KYC-complete flag so they can
// go through /employee/register-device again — needed when a passkey stops
// working because the device was lost/reset, or the app's own domain changed
// (e.g. moving between ngrok tunnel URLs or hostnames during testing), since
// WebAuthn credentials are strictly scoped to the domain they were created on.
router.post('/api/tenant/employees/:id/reset-device', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'employee.resetDevice')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    if (!await isPlatformFeatureAllowedForTenant(req.user.tenantId, 'device_change')) {
      return res.status(403).json({ error: 'Device change requests are not enabled for your organization.' });
    }

    const employeeId = parseInt(req.params.id, 10);
    const tenantId = req.user.tenantId;

    const employee = await getByIdForTenant(schema.users, employeeId, tenantId);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    const scopedBranchIds = await getScopedBranchIds(req.user);
    if (scopedBranchIds !== null && employee.branchId && !scopedBranchIds.includes(employee.branchId)) {
      return res.status(403).json({ error: 'Access denied: You are not scoped to this employee\'s branch.' });
    }

    await db.delete(schema.webauthnCredentials).where(eq(schema.webauthnCredentials.userId, employeeId));
    await db.update(schema.users)
      .set({ isKycCompleted: false, registeredDeviceId: null, deviceApprovalPending: false })
      .where(eq(schema.users.id, employeeId));

    await logToAuditLedger({
      tenantId,
      actorId: req.user.userId,
      actorName: req.user.name,
      action: 'EMPLOYEE_DEVICE_RESET',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      deviceInfo: req.headers['user-agent'] || '',
      details: { employeeId }
    });

    res.json({ success: true });
  } catch (err: any) {
    sendServerError(res, err, "employees.routes.ts");
  }
});

// GET all departments
router.get('/api/tenant/departments', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'employee.read') && !await hasPrivilege(req.user, 'reports.view')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }

    const tenantId = req.user.tenantId;
    const depts = await db.select().from(schema.departments).where(eq(schema.departments.tenantId, tenantId));

    // Fetch all users to map head names
    const users = await db.select().from(schema.users).where(eq(schema.users.tenantId, tenantId));
    const userMap = new Map<number, any>(users.map(u => [u.id, u]));

    const departments = depts.map(d => {
      const head = d.headUserId ? userMap.get(d.headUserId) : null;
      return {
        id: d.id,
        name: d.name,
        description: d.description || '',
        headUserId: d.headUserId || null,
        headName: head ? head.name : '',
        createdAt: d.createdAt,
      };
    });

    res.json({ departments });
  } catch (err: any) {
    sendServerError(res, err, "employees.routes.ts");
  }
});

// GET the current user's own manager + immediate colleagues — deliberately
// self-scoped (no employee.read/reports.view privilege required, same
// reasoning as /api/leave/mine and /api/payroll/mine) so a plain employee
// can see who they work with without being granted the full directory.
// "Colleagues" = other users sharing the same manager, or (if the caller has
// no manager) the same department. Read-only: name + designation only, no
// contact/salary/status fields.
router.get('/api/employees/my-team', authenticate, async (req: any, res: any) => {
  try {
    const tenantId = req.user.tenantId;
    const selfRows = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId)).limit(1);
    if (selfRows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const self = selfRows[0];

    const manager = self.managerId
      ? (await db.select().from(schema.users).where(eq(schema.users.id, self.managerId)).limit(1))[0]
      : null;

    let colleagueRows: any[] = [];
    if (self.managerId) {
      colleagueRows = await db.select().from(schema.users).where(
        and(eq(schema.users.tenantId, tenantId), eq(schema.users.managerId, self.managerId), ne(schema.users.id, self.id))
      );
    } else if (self.department) {
      colleagueRows = await db.select().from(schema.users).where(
        and(eq(schema.users.tenantId, tenantId), eq(schema.users.department, self.department), ne(schema.users.id, self.id))
      );
    }

    res.json({
      manager: manager && manager.tenantId === tenantId ? { id: manager.id, name: manager.name, designation: manager.designation || '', department: manager.department || '' } : null,
      colleagues: colleagueRows.slice(0, 25).map((u) => ({ id: u.id, name: u.name, designation: u.designation || '', department: u.department || '' })),
    });
  } catch (err: any) {
    sendServerError(res, err, "employees.routes.ts");
  }
});

// Self-service — every authenticated user can read/update their OWN
// per-channel notification opt-out (no employee.edit privilege required,
// unlike the general employee-profile PUT above, since this only ever
// touches the caller's own row and can't affect anyone else's data).
router.get('/api/employees/me/notification-preferences', authenticate, async (req: any, res: any) => {
  try {
    const rows = await db.select({ notificationChannelPrefs: (schema.users as any).notificationChannelPrefs }).from(schema.users).where(eq(schema.users.id, req.user.userId)).limit(1);
    const prefs = (rows[0] as any)?.notificationChannelPrefs || { email: true, in_app: true };
    res.json({ preferences: prefs });
  } catch (err: any) {
    sendServerError(res, err, "employees.routes.ts");
  }
});

router.put('/api/employees/me/notification-preferences', authenticate, async (req: any, res: any) => {
  try {
    const { email, in_app } = req.body || {};
    const preferences = { email: email !== false, in_app: in_app !== false };
    await db.update(schema.users).set({ notificationChannelPrefs: preferences } as any).where(eq(schema.users.id, req.user.userId));
    res.json({ preferences });
  } catch (err: any) {
    sendServerError(res, err, "employees.routes.ts");
  }
});

router.put('/api/employees/me', authenticate, async (req: any, res: any) => {
  try {
    const { name, phone } = req.body || {};
    const updates: any = {};
    if (name && String(name).trim()) updates.name = String(name).trim();
    if (phone !== undefined && phone !== null && String(phone).trim() !== '') {
      const cleanPhone = String(phone).trim();
      if (!/^\+?[0-9\s\-]{7,15}$/.test(cleanPhone) || /[a-zA-Z]/.test(cleanPhone)) {
        return res.status(400).json({ error: 'Invalid mobile phone number format. Must contain 7-15 digits.' });
      }
      updates.phone = cleanPhone;
    }
    if (Object.keys(updates).length > 0) {
      await db.update(schema.users).set(updates).where(eq(schema.users.id, req.user.userId));
    }
    res.json({ success: true, updates });
  } catch (err: any) {
    sendServerError(res, err, "employees.routes.ts");
  }
});

// "Today's Team" card (EmployeeDashboard.tsx, Your Team tab) — Present/
// Absent/Late/Pending Leave/Pending Correction counts for a manager's own
// direct reports, computed via the same resolveDayStatus() classification
// already used everywhere else in this app (calendar views, payroll's
// attendance-driven mode), instead of a bespoke count query that could
// drift out of sync with what "present"/"absent" actually means elsewhere.
// Deliberately scoped to req.user's own direct reports only (managerId =
// req.user.userId) — NOT the whole department — matching how every other
// manager-facing notification/escalation in this app resolves "my team."
router.get('/api/employees/my-team/today-summary', authenticate, async (req: any, res: any) => {
  try {
    const tenantId = req.user.tenantId;
    const reports = await db.select().from(schema.users).where(
      and(eq(schema.users.tenantId, tenantId), eq(schema.users.managerId, req.user.userId), ne(schema.users.employeeStatus, 'terminated'))
    );
    if (reports.length === 0) {
      return res.json({ hasReports: false, present: 0, absent: 0, late: 0, pendingLeave: 0, pendingCorrections: 0, total: 0 });
    }
    const reportIds = reports.map((r) => r.id);
    const tenantRow = (await db.select({ timezone: schema.tenants.timezone }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1))[0] || null;
    const todayKey = tenantDateKey(tenantRow);

    let present = 0, absent = 0, late = 0;
    for (const r of reports) {
      const entry = await resolveDayStatus(tenantId, r.id, todayKey);
      if (entry.status === 'present' || entry.status === 'half_day' || entry.status === 'regularized') present++;
      else if (entry.status === 'late') { present++; late++; }
      else if (entry.status === 'absent_pending_review' || entry.status === 'lop') absent++;
    }

    const pendingLeaveRows = await db.select().from(schema.leaveRequests).where(
      and(inArray(schema.leaveRequests.userId, reportIds), eq(schema.leaveRequests.status, 'pending'))
    );
    const pendingCorrectionRows = await db.select().from(schema.attendanceCorrections).where(
      and(inArray(schema.attendanceCorrections.userId, reportIds), eq(schema.attendanceCorrections.status, 'pending'))
    );

    res.json({
      hasReports: true,
      total: reports.length,
      present, absent, late,
      pendingLeave: pendingLeaveRows.length,
      pendingCorrections: pendingCorrectionRows.length,
    });
  } catch (err: any) {
    sendServerError(res, err, "employees.routes.ts");
  }
});

// CREATE department
router.post('/api/tenant/departments', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'employee.create')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }

    const { name, description, headUserId } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Department name is required.' });
    }

    const tenantId = req.user.tenantId;

    if (headUserId) {
      const headUserRow = await getByIdForTenant(schema.users, headUserId, tenantId);
      if (!headUserRow) {
        return res.status(400).json({ error: 'Invalid department head user ID.' });
      }
    }

    const [inserted] = await db.insert(schema.departments).values({
      tenantId,
      name,
      description: description || null,
      headUserId: headUserId || null,
    }).returning();

    await logToAuditLedger({
      tenantId,
      actorId: req.user.userId,
      actorName: req.user.name,
      action: 'DEPARTMENT_CREATED',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      deviceInfo: req.headers['user-agent'] || '',
      details: { departmentId: inserted.id, name }
    });

    res.json({ success: true, department: inserted });
  } catch (err: any) {
    sendServerError(res, err, "employees.routes.ts");
  }
});
