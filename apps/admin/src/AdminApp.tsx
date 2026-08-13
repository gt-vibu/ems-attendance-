import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, HashRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useAuth, User } from './lib/auth';

// Capacitor's packaged webview has no server to rewrite deep links to
// index.html, so BrowserRouter 404s on a refresh of a nested route.
// HashRouter avoids that and needs no server support. Only active for the
// native build (VITE_CAPACITOR=true at build time, see CAPACITOR.md) —
// unset (the normal web build) keeps BrowserRouter exactly as before.
const Router = import.meta.env.VITE_CAPACITOR === 'true' ? HashRouter : BrowserRouter;

// Resilient dynamic import wrapper: if a browser has a stale index.html or if Vercel
// deploys a new commit while a session is active (changing bundle asset hashes),
// catching the chunk fetch failure and reloading fetches the fresh build manifest cleanly.
function safeLazy<T extends React.ComponentType<any>>(importFn: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      return await importFn();
    } catch (error: any) {
      console.warn('Dynamic import failed, attempting auto-reload to sync with latest build manifest:', error);
      const key = 'chunk_reload_retry_' + window.location.pathname;
      const reloaded = sessionStorage.getItem(key);
      if (!reloaded) {
        sessionStorage.setItem(key, 'true');
        window.location.reload();
        return new Promise<{ default: T }>(() => {});
      }
      sessionStorage.removeItem(key);
      throw error;
    }
  });
}

// Route-level code splitting: each page ships as its own chunk.
const App = safeLazy(() => import('./App'));
const Login = safeLazy(() => import('./pages/Login'));
const Dashboard = safeLazy(() => import('./pages/Dashboard'));
const EmployeeLogin = safeLazy(() => import('./pages/EmployeeLogin'));
const RegisterDevice = safeLazy(() => import('./pages/RegisterDevice'));
const EmployeeAttendance = safeLazy(() => import('./pages/EmployeeAttendance'));
const EmployeeDashboard = safeLazy(() => import('./pages/EmployeeDashboard'));
const EmployeeHome = safeLazy(() => import('./pages/EmployeeHome'));
const ForgotPassword = safeLazy(() => import('./pages/ForgotPassword'));
const ResetPassword = safeLazy(() => import('./pages/ResetPassword'));
const QrScan = safeLazy(() => import('./pages/QrScan'));
const BranchSetupWizard = safeLazy(() => import('./pages/BranchSetupWizard'));
const Branches = safeLazy(() => import('./pages/Branches'));
const BranchDetail = safeLazy(() => import('./pages/BranchDetail'));
const RolePermissions = safeLazy(() => import('./pages/RolePermissions'));
const ReportsPage = safeLazy(() => import('./pages/ReportsPage'));
const AdminOverviewPage = safeLazy(() => import('./pages/AdminOverviewPage'));
const ApprovalRoutingPage = safeLazy(() => import('./pages/ApprovalRoutingPage'));
const LeaveManagementPage = safeLazy(() => import('./pages/LeaveManagementPage'));
const PayrollPage = safeLazy(() => import('./pages/PayrollPage'));
const PayrollWizardPage = safeLazy(() => import('./pages/PayrollWizardPage'));
const PayrollHistoryPage = safeLazy(() => import('./pages/PayrollHistoryPage'));
const PayrollBatchPage = safeLazy(() => import('./pages/PayrollBatchPage'));
const NotificationPoliciesPage = safeLazy(() => import('./pages/NotificationPoliciesPage'));
const DelegationPage = safeLazy(() => import('./pages/DelegationPage'));
const FederationClientsPage = safeLazy(() => import('./pages/FederationClientsPage'));
const PlatformFederationClientsPage = safeLazy(() => import('./pages/PlatformFederationClientsPage'));
const IntegrationHubPage = safeLazy(() => import('./pages/IntegrationHubPage'));
const PlanFeaturesPage = safeLazy(() => import('./pages/PlanFeaturesPage'));
const BusinessCalendarPage = safeLazy(() => import('./pages/BusinessCalendarPage'));
const EmployeeDirectory = safeLazy(() => import('./pages/EmployeeDirectory'));
const TeamsPage = safeLazy(() => import('./pages/TeamsPage'));
const WorkspaceBoundariesPage = safeLazy(() => import('./pages/WorkspaceBoundariesPage'));
const AttendancePreferencesPage = safeLazy(() => import('./pages/AttendancePreferencesPage'));
const AuditLedgerPage = safeLazy(() => import('./pages/AuditLedgerPage'));
const TerminationsPage = safeLazy(() => import('./pages/TerminationsPage'));
const ShiftSwapsPage = safeLazy(() => import('./pages/ShiftSwapsPage'));
const TicketsPage = safeLazy(() => import('./pages/TicketsPage'));
const OrgChartPage = safeLazy(() => import('./pages/OrgChartPage'));
const UserProfilePage = safeLazy(() => import('./pages/UserProfilePage'));
const CompanyProfilePage = safeLazy(() => import('./pages/CompanyProfilePage'));
const ExpensesPage = safeLazy(() => import('./pages/ExpensesPage'));
const ExpenseCategoriesPage = safeLazy(() => import('./pages/ExpenseCategoriesPage'));

// Everyone except the two org-level admin tiers can clock in, take breaks,
// and register a device — Employee, Manager, HR, GM, Intern, or any
// custom role a tenant admin creates. Admins manage the workspace rather
// than clock in themselves, per the intended flow.
const canClockIn = (role?: string) => !!role && role !== 'super_admin' && role !== 'tenant_admin';

// Dashboard access: super_admin, tenant_admin, and any role with delegated
// admin privileges (HR/GM/Manager/etc., whatever the tenant admin has
// granted) can reach it — the backend enforces exactly what each of them can
// actually do once there. A plain 'employee' has no reason to be there.
const canSeeDashboard = (role?: string) => !!role && role !== 'employee';
const canManageLeaveDesk = (role?: string) => role === 'tenant_admin' || role === 'super_admin';
const canManageTeams = (role?: string) => canSeeDashboard(role);

function landingPathFor(user: User) {
  // Attendance is mandatory for every non-admin operating role. Managers,
  // HR, GM, and custom staff roles may also have dashboard access, but they
  // should land in the employee workspace first so "mark attendance" and
  // break controls are never hidden behind the management UI.
  if (canClockIn(user.role)) return '/employee/dashboard';
  if (canSeeDashboard(user.role)) return '/dashboard';
  return '/login';
}

const RouteFallback = () => (
  <div className="min-h-screen flex items-center justify-center font-mono text-xs uppercase tracking-widest text-slate-400">
    Loading...
  </div>
);

// The QR deep link (https://.../qr/{token}) is meant to be opened by ANY
// camera app, not just this one's in-app scanner — so unlike every other
// route above, it has to work for a visitor who isn't logged in yet at
// all. "Do not lose QR session during login": bounce through
// /employee/login?next=/qr/:token and EmployeeLogin.tsx's routeAfterLogin
// honors that param once login (and device registration, if still pending)
// completes. Device registration is a company-wide switch (tenant.kycEnabled)
// — when a tenant has turned it off, no employee there is ever routed to the
// registration page. user.kycEnabled is undefined only for stale cached
// sessions predating this field, treated as enabled (the pre-existing
// behavior) until next login.
const deviceRegistrationRequired = (user: User) => user.kycEnabled !== false && !user.isKycCompleted;

function QrDeepLink({ user }: { user: User | null }) {
  const params = useParams<{ token: string }>();
  if (!user) return <Navigate to={`/employee/login?next=/qr/${params.token}`} />;
  if (!canClockIn(user.role)) return <Navigate to="/" />;
  if (deviceRegistrationRequired(user)) return <Navigate to="/employee/register-device" />;
  return <QrScan user={user} />;
}

export default function AdminApp() {
  const { user, loading, login, logout, updateSession } = useAuth();

  // Route guards below (deviceRegistrationRequired, landingPathFor) decide
  // where to send a clock-in-role user using whatever was cached in
  // localStorage at their last login — isKycCompleted/faceRecognitionEnabled
  // included. If a tenant admin changes the identity-check method (or a
  // super admin changes the platform plan) while this person is already
  // signed in, that cached snapshot goes stale and the route guards keep
  // making the OLD decision until a fresh login. Refresh once per app load
  // so a change reaches them within this session instead of requiring one.
  useEffect(() => {
    if (!user || !canClockIn(user.role)) return;
    const token = localStorage.getItem('auth_token');
    fetch('/api/auth/session', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.user) updateSession({ ...user, ...d.user }); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (loading) return <div className="min-h-screen flex items-center justify-center font-mono text-xs uppercase tracking-widest text-slate-500">Loading Secure Environment...</div>;

  return (
    <Router>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<App />} />

          {/* Admin/Management Routes */}
          <Route path="/login" element={!user ? <Login onLogin={login} /> : <Navigate to={landingPathFor(user)} />} />
          <Route path="/forgot-password" element={!user ? <ForgotPassword /> : <Navigate to={landingPathFor(user)} />} />
          <Route path="/reset-password" element={!user ? <ResetPassword /> : <Navigate to={landingPathFor(user)} />} />
          <Route path="/dashboard" element={user && canSeeDashboard(user.role) ? <Dashboard user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/tenant/branch-setup" element={
            !user ? <Navigate to="/login" />
            : user.role !== 'tenant_admin' ? <Navigate to={landingPathFor(user)} />
            : <BranchSetupWizard user={user} updateSession={updateSession} />
          } />
          <Route path="/tenant/branches" element={user && canSeeDashboard(user.role) ? <Branches user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/tenant/branches/:id" element={user && canSeeDashboard(user.role) ? <BranchDetail user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/tenant/roles" element={user && canSeeDashboard(user.role) ? <RolePermissions user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/tenant/reports" element={user && canSeeDashboard(user.role) ? <ReportsPage user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/tenant/approval-routing" element={user && canSeeDashboard(user.role) ? <ApprovalRoutingPage user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/tenant/leave" element={
            !user ? <Navigate to="/login" />
            : canManageLeaveDesk(user.role) ? <LeaveManagementPage user={user} onLogout={logout} />
            : <Navigate to={landingPathFor(user)} replace />
          } />
          <Route path="/tenant/payroll" element={user && canSeeDashboard(user.role) ? <PayrollPage user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/tenant/payroll/setup/employee/:userId/:step" element={user && canSeeDashboard(user.role) ? <PayrollWizardPage user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/tenant/payroll/setup/role/:roleName/:step" element={user && canSeeDashboard(user.role) ? <PayrollWizardPage user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/tenant/payroll/history/:userId" element={user && canSeeDashboard(user.role) ? <PayrollHistoryPage user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/tenant/payroll/batches" element={user && canSeeDashboard(user.role) ? <PayrollBatchPage user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/tenant/notification-center" element={user && canSeeDashboard(user.role) ? <NotificationPoliciesPage user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/tenant/notification-policies" element={<Navigate to="/tenant/notification-center" replace />} />
          <Route path="/tenant/delegation" element={user && canSeeDashboard(user.role) ? <DelegationPage user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/super/federation-clients/:tenantId" element={user && user.role === 'super_admin' ? <FederationClientsPage /> : <Navigate to="/login" />} />
          <Route path="/super/platform-federation-clients" element={user && user.role === 'super_admin' ? <PlatformFederationClientsPage /> : <Navigate to="/login" />} />
          <Route path="/super/integration-hub" element={user && user.role === 'super_admin' ? <IntegrationHubPage user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/super/plan-features/:tenantId" element={user && user.role === 'super_admin' ? <PlanFeaturesPage user={user} /> : <Navigate to="/login" />} />
          <Route path="/tenant/business-calendar" element={user && canSeeDashboard(user.role) ? <BusinessCalendarPage user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/tenant/admin" element={user && canSeeDashboard(user.role) ? <AdminOverviewPage user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/tenant/directory" element={<Navigate to="/dashboard?tab=directory" replace />} />
          <Route path="/tenant/teams" element={<Navigate to="/dashboard?tab=teams" replace />} />
          <Route path="/tenant/workspace-boundaries" element={user && canSeeDashboard(user.role) ? <WorkspaceBoundariesPage user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/tenant/settings" element={<Navigate to="/tenant/workspace-boundaries" replace />} />
          <Route path="/tenant/attendance-preferences" element={user && canSeeDashboard(user.role) ? <AttendancePreferencesPage user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/tenant/audit-ledger" element={user && canSeeDashboard(user.role) ? <AuditLedgerPage user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/tenant/terminations" element={user && canSeeDashboard(user.role) ? <TerminationsPage user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/tenant/shift-swaps" element={user && canSeeDashboard(user.role) ? <ShiftSwapsPage user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/tenant/tickets" element={user && canSeeDashboard(user.role) ? <TicketsPage user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/tenant/org-chart" element={user && canSeeDashboard(user.role) ? <OrgChartPage user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/tenant/profile" element={user ? <UserProfilePage user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/tenant/company-profile" element={user && canSeeDashboard(user.role) ? <CompanyProfilePage user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/tenant/expense-categories" element={user && canSeeDashboard(user.role) ? <ExpenseCategoriesPage user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/tenant/expenses" element={user && canSeeDashboard(user.role) ? <Dashboard user={user} onLogout={logout} defaultTab="expenses" /> : <Navigate to="/login" />} />

          {/* Staff Routes — Employee, Manager, HR, GM, Intern, or any custom role */}
          <Route path="/employee/expenses" element={user ? <EmployeeDashboard user={user} onLogout={logout} defaultTab="expenses" /> : <Navigate to="/login" />} />
          <Route path="/employee" element={!user ? <EmployeeLogin onLogin={login} /> : <Navigate to={landingPathFor(user)} />} />
          <Route path="/employee/login" element={!user ? <EmployeeLogin onLogin={login} /> : <Navigate to={landingPathFor(user)} />} />
          <Route path="/employee/register-device" element={
            !user ? <Navigate to="/employee/login" />
            : !canClockIn(user.role) ? <Navigate to="/employee/login" />
            // Already registered with FACE specifically — most commonly hit
            // via the browser's back button after finishing face
            // enrollment, which re-visits this URL from history rather than
            // actually re-mounting a fresh app state. Without this guard it
            // just re-renders the enrollment flow from scratch every time.
            //
            // Deliberately checks verificationMethod === 'face' as well as
            // isKycCompleted, not isKycCompleted alone — a WebAuthn-
            // registered employee (isKycCompleted is already true from
            // THAT registration) legitimately visits this same URL via the
            // attendance page's "Switch to Face Recognition" link, and
            // must NOT be bounced straight back to the dashboard before
            // ever seeing the face enrollment flow they just asked for.
            : (user.isKycCompleted === true && user.verificationMethod === 'face') ? <Navigate to="/employee/dashboard" />
            : <RegisterDevice user={user} updateSession={updateSession} />
          } />
          <Route path="/employee/dashboard" element={
            !user ? <Navigate to="/employee/login" />
            : !canClockIn(user.role) ? <Navigate to="/employee/login" />
            : deviceRegistrationRequired(user) ? <Navigate to="/employee/register-device" />
            : <EmployeeDashboard user={user} onLogout={logout} />
          } />
          <Route path="/employee/attendance" element={
            !user ? <Navigate to="/employee/login" />
            : !canClockIn(user.role) ? <Navigate to="/employee/login" />
            : deviceRegistrationRequired(user) ? <Navigate to="/employee/register-device" />
            : <EmployeeAttendance user={user} onLogout={logout} updateSession={updateSession} />
          } />
          {/* Old post-check-in page folded into the new dashboard's Breaks &
              Checkout section — keep the route as a redirect so any bookmark
              or in-app link still lands somewhere valid. */}
          <Route path="/employee/home" element={<Navigate to="/employee/dashboard" replace />} />
          <Route path="/employee/home-legacy" element={
            !user ? <Navigate to="/employee/login" />
            : !canClockIn(user.role) ? <Navigate to="/employee/login" />
            : deviceRegistrationRequired(user) ? <Navigate to="/employee/register-device" />
            : <EmployeeHome user={user} onLogout={logout} />
          } />

          {/* Dynamic QR Attendance */}
          <Route path="/employee/qr-scan" element={
            !user ? <Navigate to="/employee/login" />
            : !canClockIn(user.role) ? <Navigate to="/employee/login" />
            : deviceRegistrationRequired(user) ? <Navigate to="/employee/register-device" />
            : <QrScan user={user} />
          } />
          {/* Public deep link — opened by any QR scanner/camera app, not just this one's built-in scanner */}
          <Route path="/qr/:token" element={<QrDeepLink user={user} />} />
          {/* Catch-all fallback */}
          <Route path="*" element={<Navigate to={user ? landingPathFor(user) : "/login"} replace />} />
        </Routes>
      </Suspense>
    </Router>
  );
}
