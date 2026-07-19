import { Router } from 'express';
import { eq, and, desc, inArray, ne } from 'drizzle-orm';
import { db, schema } from '../../db';
import { authenticate } from '../middleware/authenticate';
import { hasPrivilege, getScopedBranchIds, getEffectivePrivileges, getDefaultPrivilegesForRole } from '../auth/rbac';
import { logToAuditLedger } from '../services/audit';
import { notifyUser } from '../services/notifications';

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
    res.status(500).json({ error: err.message });
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

    const userRows = await db.select().from(schema.users).where(eq(schema.users.id, employeeId)).limit(1);
    if (userRows.length === 0) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    const employee = userRows[0];
    if (employee.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Access denied: This employee belongs to another organization.' });
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
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE employee profile
router.put('/api/tenant/employees/:id', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'employee.create')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }

    const employeeId = parseInt(req.params.id, 10);
    const tenantId = req.user.tenantId;

    const userRows = await db.select().from(schema.users).where(eq(schema.users.id, employeeId)).limit(1);
    if (userRows.length === 0) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    const employee = userRows[0];
    if (employee.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Access denied: This employee belongs to another organization.' });
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
      const branchRows = await db.select().from(schema.branches).where(eq(schema.branches.id, branchId)).limit(1);
      if (branchRows.length === 0 || branchRows[0].tenantId !== tenantId) {
        return res.status(400).json({ error: 'Invalid branch ID.' });
      }
      if (scopedBranchIds !== null && !scopedBranchIds.includes(branchId)) {
        return res.status(403).json({ error: 'Access denied: You are not scoped to the target branch.' });
      }
    }

    // Validate shift if changing
    let newShiftName: string | null = null;
    if (shiftId && shiftId !== employee.shiftId) {
      const shiftRows = await db.select().from(schema.shifts).where(eq(schema.shifts.id, shiftId)).limit(1);
      if (shiftRows.length === 0 || shiftRows[0].tenantId !== tenantId) {
        return res.status(400).json({ error: 'Invalid shift ID.' });
      }
      newShiftName = shiftRows[0].name;
    }

    // Validate manager if changing
    if (managerId && managerId !== employee.managerId) {
      const managerRows = await db.select().from(schema.users).where(eq(schema.users.id, managerId)).limit(1);
      if (managerRows.length === 0 || managerRows[0].tenantId !== tenantId) {
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
      await notifyUser(employeeId, 'Your shift has changed', `Your shift has been changed to ${newShiftName}, effective immediately.`);
    }

    res.json({ success: true, employee: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
      const userRows = await db.select().from(schema.users).where(eq(schema.users.id, headUserId)).limit(1);
      if (userRows.length === 0 || userRows[0].tenantId !== tenantId) {
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
    res.status(500).json({ error: err.message });
  }
});
