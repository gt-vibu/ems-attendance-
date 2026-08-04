import { User } from '../lib/auth';
import AdminWorkspaceLayout from '../components/AdminWorkspaceLayout';
import OrgChart from '../components/OrgChart';

export default function OrgChartPage({ user, onLogout }: { user: User; onLogout?: () => void }) {
  const canEdit = user.role === 'tenant_admin' || user.role === 'super_admin';

  return (
    <AdminWorkspaceLayout
      user={user}
      onLogout={onLogout}
      title="Organization Chart"
      subtitle="Visual reporting structure and hierarchy mapping."
    >
      <OrgChart canEdit={canEdit} />
    </AdminWorkspaceLayout>
  );
}
