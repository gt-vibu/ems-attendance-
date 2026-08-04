import { User } from '../lib/auth';
import AdminWorkspaceLayout from '../components/AdminWorkspaceLayout';
import TicketsPanel from '../components/TicketsPanel';

export default function TicketsPage({ user, onLogout }: { user: User; onLogout?: () => void }) {
  return (
    <AdminWorkspaceLayout
      user={user}
      onLogout={onLogout}
      title="Support & Inquiry Tickets"
      subtitle="Track and resolve employee support requests, disputes, and administrative tickets."
    >
      <TicketsPanel user={user} />
    </AdminWorkspaceLayout>
  );
}
