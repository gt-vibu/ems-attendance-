import { useState } from 'react';

// ==========================================
// SUPER ADMIN STATE & FUNCTIONS
// ==========================================
// Extracted verbatim from Dashboard.tsx. `setLoading`/`setError`/`setSuccess`
// and `setNotifications` remain owned by Dashboard (shared across sections)
// and are passed in so behavior is unchanged.
export function useSuperAdminData(
  token: string | null,
  setLoading: (v: boolean) => void,
  setError: (v: string) => void,
  setSuccess: (v: string) => void,
  setNotifications: (v: any[]) => void,
) {
  const [tenancyRequests, setTenancyRequests] = useState<any[]>([]);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>(['device_identity', 'gps_geofence']);
  const [selectedPlanOverride, setSelectedPlanOverride] = useState<string>('');
  const [allTenants, setAllTenants] = useState<any[]>([]);
  const [superAnalytics, setSuperAnalytics] = useState<any>(null);
  const [platformFeatures, setPlatformFeatures] = useState<{ key: string; label: string; description: string }[]>([]);
  // Set only when an approval's confirmation email did NOT actually get
  // delivered (unconfigured/misconfigured/blocked mail provider) — the
  // activation link (which embeds the temp password) is the new tenant
  // admin's ONLY way to log in, and email was previously the ONLY channel
  // it ever went out through. Shown as a persistent, manually-dismissed
  // banner (not the auto-clearing `success` toast) so the super admin has
  // time to actually copy and forward it through another channel.
  const [undeliveredActivation, setUndeliveredActivation] = useState<{ companyName: string; activationLink: string } | null>(null);

  const fetchSuperAdminData = async () => {
    try {
      const reqsRes = await fetch('/api/super/requests', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const reqsData = await reqsRes.json();
      if (reqsData.requests) setTenancyRequests(reqsData.requests);

      const notifyRes = await fetch('/api/super/notifications', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const notifyData = await notifyRes.json();
      if (notifyData.notifications) setNotifications(notifyData.notifications);

      const tenantsRes = await fetch('/api/super/tenants', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const tenantsData = await tenantsRes.json();
      if (tenantsData.tenants) setAllTenants(tenantsData.tenants);

      const analyticsRes = await fetch('/api/super/analytics', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const analyticsData = await analyticsRes.json();
      setSuperAnalytics(analyticsData);

      const featuresRes = await fetch('/api/super/platform-features', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const featuresData = await featuresRes.json();
      if (Array.isArray(featuresData.features)) setPlatformFeatures(featuresData.features);
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleTenantStatus = async (tenantId: number, currentStatus: string) => {
    const nextStatus = currentStatus === 'suspended' ? 'active' : 'suspended';
    if (!window.confirm(`${nextStatus === 'suspended' ? 'Suspend' : 'Reactivate'} this tenant? ${nextStatus === 'suspended' ? 'Their users will be immediately blocked from logging in or checking in.' : ''}`)) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/super/tenants/status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ tenantId, status: nextStatus })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update tenant status');
      setSuccess(`Tenant ${nextStatus === 'suspended' ? 'suspended' : 'reactivated'} successfully.`);
      fetchSuperAdminData();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setError(err.message || 'Failed to update tenant status');
    } finally {
      setLoading(false);
    }
  };

  // Permanently deletes a tenant AND every one of its employees/data
  // (attendance, leave, payroll, documents, etc.) — irreversible, unlike
  // suspend above which just blocks logins. Backed by the existing
  // POST /api/super/tenants/delete cascade.
  const handleDeleteTenant = async (tenantId: number, tenantName: string) => {
    if (!window.confirm(`Permanently delete "${tenantName}" and ALL of its data — every employee, attendance record, leave request, and document? This cannot be undone.`)) return;
    if (!window.confirm(`Are you absolutely sure? Type-confirm: this will erase "${tenantName}" completely.`)) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/super/tenants/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ tenantId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete tenant');
      setSuccess(`"${tenantName}" and all of its data have been permanently deleted.`);
      fetchSuperAdminData();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setError(err.message || 'Failed to delete tenant');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenApproveModal = (req: any) => {
    setSelectedRequest(req);
    setSelectedPlanOverride(req.plan || 'Standard');
    setShowApprovalModal(true);
  };

  const handleApproveRequest = async () => {
    if (!selectedRequest) return;
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/super/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          requestId: selectedRequest.id,
          featuresAllowed: selectedFeatures,
          plan: selectedPlanOverride || selectedRequest.plan
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to approve onboarding');

      if (data.emailDelivered) {
        setSuccess(`Tenant "${selectedRequest.companyName}" approved successfully! Temporary credentials mailed.`);
        setTimeout(() => setSuccess(''), 4000);
      } else {
        // Email genuinely failed to send (or no provider is configured) —
        // the new tenant admin has no other way to get their temp password,
        // so surface the activation link here instead of only in a toast
        // that disappears in 4 seconds.
        setUndeliveredActivation({ companyName: selectedRequest.companyName, activationLink: data.activationLink });
      }
      setShowApprovalModal(false);
      fetchSuperAdminData();
    } catch (err: any) {
      setError(err.message || 'Approval failed');
    } finally {
      setLoading(false);
    }
  };

  const toggleFeature = (feat: string) => {
    if (selectedFeatures.includes(feat)) {
      setSelectedFeatures(selectedFeatures.filter(f => f !== feat));
    } else {
      setSelectedFeatures([...selectedFeatures, feat]);
    }
  };

  // --- Manage-admins modal (delete a tenant_admin account) ---
  const [manageAdminsTenant, setManageAdminsTenant] = useState<any>(null);
  const [tenantAdmins, setTenantAdmins] = useState<any[]>([]);
  const [tenantAdminsLoading, setTenantAdminsLoading] = useState(false);

  const openManageAdmins = async (tenant: any) => {
    setManageAdminsTenant(tenant);
    setTenantAdmins([]);
    setTenantAdminsLoading(true);
    try {
      const res = await fetch(`/api/super/tenants/${tenant.id}/admins`, { headers: { 'Authorization': `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok && data.admins) setTenantAdmins(data.admins);
    } catch (err) {
      console.error(err);
    } finally {
      setTenantAdminsLoading(false);
    }
  };

  const handleDeleteTenantAdmin = async (adminUserId: number, adminName: string) => {
    if (!window.confirm(`Permanently delete the admin account "${adminName}"? This revokes their access immediately and cannot be undone. The rest of the tenant (employees, data) is unaffected.`)) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/super/tenant-admins/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ userId: adminUserId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete admin account');
      setSuccess(`Admin account "${adminName}" deleted.`);
      setTenantAdmins((prev) => prev.filter((a) => a.id !== adminUserId));
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setError(err.message || 'Failed to delete admin account');
    } finally {
      setLoading(false);
    }
  };

  // --- Edit an existing tenant's platform feature whitelist — the ongoing
  // counterpart to the one-time selection made at approval time. This is
  // the top of the cascade: whatever the tenant admin can turn on/delegate
  // is bounded by what's selected here (see isPlatformFeatureAllowed() in
  // apps/admin/api/auth/rbac.ts). ---
  const [editFeaturesTenant, setEditFeaturesTenant] = useState<any>(null);
  const [editFeaturesSelected, setEditFeaturesSelected] = useState<string[]>([]);
  const [editFeaturesSaving, setEditFeaturesSaving] = useState(false);

  const openEditFeatures = (tenant: any) => {
    setEditFeaturesTenant(tenant);
    setEditFeaturesSelected(Array.isArray(tenant.featuresAllowed) ? tenant.featuresAllowed : []);
  };

  const toggleEditFeature = (key: string) => {
    setEditFeaturesSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleSaveEditFeatures = async () => {
    if (!editFeaturesTenant) return;
    setEditFeaturesSaving(true);
    setError('');
    try {
      const res = await fetch('/api/super/tenants/features', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ tenantId: editFeaturesTenant.id, featuresAllowed: editFeaturesSelected }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update plan features');
      setSuccess(`Plan features updated for "${editFeaturesTenant.name}".`);
      setEditFeaturesTenant(null);
      fetchSuperAdminData();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setError(err.message || 'Failed to update plan features');
    } finally {
      setEditFeaturesSaving(false);
    }
  };

  return {
    tenancyRequests,
    showApprovalModal, setShowApprovalModal,
    selectedRequest,
    selectedFeatures,
    selectedPlanOverride, setSelectedPlanOverride,
    allTenants,
    superAnalytics,
    platformFeatures,
    undeliveredActivation, setUndeliveredActivation,
    fetchSuperAdminData,
    handleToggleTenantStatus,
    handleDeleteTenant,
    handleOpenApproveModal,
    handleApproveRequest,
    toggleFeature,
    manageAdminsTenant, tenantAdmins, tenantAdminsLoading,
    openManageAdmins, setManageAdminsTenant,
    handleDeleteTenantAdmin,
    editFeaturesTenant, setEditFeaturesTenant, editFeaturesSelected, editFeaturesSaving,
    openEditFeatures, toggleEditFeature, handleSaveEditFeatures,
  };
}
