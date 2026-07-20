import { lazy, Suspense } from 'react';
import { BrowserRouter, HashRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useAuth, User } from './lib/auth';

// Capacitor's packaged webview has no server to rewrite deep links to
// index.html, so BrowserRouter 404s on a refresh of a nested route.
// HashRouter avoids that and needs no server support. Only active for the
// native build (VITE_CAPACITOR=true at build time, see CAPACITOR.md) —
// unset (the normal web build) keeps BrowserRouter exactly as before.
const Router = import.meta.env.VITE_CAPACITOR === 'true' ? HashRouter : BrowserRouter;

// Route-level code splitting: each page (and everything it alone imports —
// three.js/@react-three/fiber for the landing page, recharts for the
// Dashboard, etc.) ships as its own chunk, fetched only when that route is
// actually visited. Without this, every visitor downloaded all of it
// upfront in one ~2MB bundle regardless of which single page they landed
// on — the worst case for exactly the low-end-phone/slow-network KYC flow
// this app cares about.
const App = lazy(() => import('./App'));
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const EmployeeLogin = lazy(() => import('./pages/EmployeeLogin'));
const EmployeeKYC = lazy(() => import('./pages/EmployeeKYC'));
const EmployeeAttendance = lazy(() => import('./pages/EmployeeAttendance'));
const EmployeeDashboard = lazy(() => import('./pages/EmployeeDashboard'));
const EmployeeHome = lazy(() => import('./pages/EmployeeHome'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const QrScan = lazy(() => import('./pages/QrScan'));
const BranchSetupWizard = lazy(() => import('./pages/BranchSetupWizard'));
const Branches = lazy(() => import('./pages/Branches'));
const BranchDetail = lazy(() => import('./pages/BranchDetail'));
const RolePermissions = lazy(() => import('./pages/RolePermissions'));
const LeaveManagementPage = lazy(() => import('./pages/LeaveManagementPage'));
const PayrollPage = lazy(() => import('./pages/PayrollPage'));
const PayrollWizardPage = lazy(() => import('./pages/PayrollWizardPage'));
const PayrollHistoryPage = lazy(() => import('./pages/PayrollHistoryPage'));
const EmployeeDirectory = lazy(() => import('./pages/EmployeeDirectory'));
const TeamsPage = lazy(() => import('./pages/TeamsPage'));

// Everyone except the two org-level admin tiers can clock in, take breaks,
// and complete biometric KYC — Employee, Manager, HR, GM, Intern, or any
// custom role a tenant admin creates. Admins manage the workspace rather
// than clock in themselves, per the intended flow.
const canClockIn = (role?: string) => !!role && role !== 'super_admin' && role !== 'tenant_admin';

// Dashboard access: super_admin, tenant_admin, and any role with delegated
// admin privileges (HR/GM/Manager/etc., whatever the tenant admin has
// granted) can reach it — the backend enforces exactly what each of them can
// actually do once there. A plain 'employee' has no reason to be there.
const canSeeDashboard = (role?: string) => !!role && role !== 'employee';
const canManageLeaveDesk = (role?: string) => role === 'tenant_admin' || role === 'super_admin';
// Teams is a personal "my team" workspace for delegated roles — the tenant
// admin already administers the whole org via Administration, so they're
// excluded here even though they otherwise satisfy canSeeDashboard (the
// backend's own team.manage check mirrors this, see teams.routes.ts).
const canManageTeams = (role?: string) => canSeeDashboard(role) && role !== 'tenant_admin';

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
// honors that param once login (and KYC, if still pending) completes.
// KYC is a company-wide switch (tenant.kycEnabled) — when a tenant has
// turned it off, no employee there is ever routed to the KYC wizard.
// user.kycEnabled is undefined only for stale cached sessions predating this
// field, treated as enabled (the pre-existing behavior) until next login.
const kycRequired = (user: User) => user.kycEnabled !== false && !user.isKycCompleted;

function QrDeepLink({ user }: { user: User | null }) {
  const params = useParams<{ token: string }>();
  if (!user) return <Navigate to={`/employee/login?next=/qr/${params.token}`} />;
  if (!canClockIn(user.role)) return <Navigate to="/" />;
  if (kycRequired(user)) return <Navigate to="/employee/kyc" />;
  return <QrScan user={user} />;
}

export default function AdminApp() {
  const { user, loading, login, logout, updateSession } = useAuth();

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
          <Route path="/tenant/branches" element={user && canSeeDashboard(user.role) ? <Branches user={user} /> : <Navigate to="/login" />} />
          <Route path="/tenant/branches/:id" element={user && canSeeDashboard(user.role) ? <BranchDetail user={user} /> : <Navigate to="/login" />} />
          <Route path="/tenant/roles" element={user && canSeeDashboard(user.role) ? <RolePermissions user={user} /> : <Navigate to="/login" />} />
          <Route path="/tenant/leave" element={
            !user ? <Navigate to="/login" />
            : canManageLeaveDesk(user.role) ? <LeaveManagementPage user={user} onLogout={logout} />
            : <Navigate to={landingPathFor(user)} replace />
          } />
          <Route path="/tenant/payroll" element={user && canSeeDashboard(user.role) ? <PayrollPage user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/tenant/payroll/setup/employee/:userId/:step" element={user && canSeeDashboard(user.role) ? <PayrollWizardPage user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/tenant/payroll/setup/role/:roleName/:step" element={user && canSeeDashboard(user.role) ? <PayrollWizardPage user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/tenant/payroll/history/:userId" element={user && canSeeDashboard(user.role) ? <PayrollHistoryPage user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/tenant/directory" element={user && canSeeDashboard(user.role) ? <EmployeeDirectory user={user} onLogout={logout} /> : <Navigate to="/login" />} />
          <Route path="/tenant/teams" element={user && canManageTeams(user.role) ? <TeamsPage user={user} onLogout={logout} /> : <Navigate to="/login" />} />

          {/* Staff Routes — Employee, Manager, HR, GM, Intern, or any custom role */}
          <Route path="/employee" element={!user ? <EmployeeLogin onLogin={login} /> : <Navigate to={landingPathFor(user)} />} />
          <Route path="/employee/login" element={!user ? <EmployeeLogin onLogin={login} /> : <Navigate to={landingPathFor(user)} />} />
          <Route path="/employee/kyc" element={user && canClockIn(user.role) ? <EmployeeKYC user={user} updateSession={updateSession} /> : <Navigate to="/employee/login" />} />
          <Route path="/employee/dashboard" element={
            !user ? <Navigate to="/employee/login" />
            : !canClockIn(user.role) ? <Navigate to="/employee/login" />
            : kycRequired(user) ? <Navigate to="/employee/kyc" />
            : <EmployeeDashboard user={user} onLogout={logout} />
          } />
          <Route path="/employee/attendance" element={
            !user ? <Navigate to="/employee/login" />
            : !canClockIn(user.role) ? <Navigate to="/employee/login" />
            : kycRequired(user) ? <Navigate to="/employee/kyc" />
            : <EmployeeAttendance user={user} onLogout={logout} />
          } />
          {/* Old post-check-in page folded into the new dashboard's Breaks &
              Checkout section — keep the route as a redirect so any bookmark
              or in-app link still lands somewhere valid. */}
          <Route path="/employee/home" element={<Navigate to="/employee/dashboard" replace />} />
          <Route path="/employee/home-legacy" element={
            !user ? <Navigate to="/employee/login" />
            : !canClockIn(user.role) ? <Navigate to="/employee/login" />
            : kycRequired(user) ? <Navigate to="/employee/kyc" />
            : <EmployeeHome user={user} onLogout={logout} />
          } />

          {/* Dynamic QR Attendance */}
          <Route path="/employee/qr-scan" element={
            !user ? <Navigate to="/employee/login" />
            : !canClockIn(user.role) ? <Navigate to="/employee/login" />
            : kycRequired(user) ? <Navigate to="/employee/kyc" />
            : <QrScan user={user} />
          } />
          {/* Public deep link — opened by any QR scanner/camera app, not just this one's built-in scanner */}
          <Route path="/qr/:token" element={<QrDeepLink user={user} />} />
        </Routes>
      </Suspense>
    </Router>
  );
}
