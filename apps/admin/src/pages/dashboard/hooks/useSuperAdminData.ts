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
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>(['kyc', 'gps_geofence']);
  const [selectedPlanOverride, setSelectedPlanOverride] = useState<string>('');
  const [allTenants, setAllTenants] = useState<any[]>([]);
  const [superAnalytics, setSuperAnalytics] = useState<any>(null);

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

      setSuccess(`Tenant "${selectedRequest.companyName}" approved successfully! Temporary credentials mailed.`);
      setShowApprovalModal(false);
      fetchSuperAdminData();

      setTimeout(() => setSuccess(''), 4000);
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

  return {
    tenancyRequests,
    showApprovalModal, setShowApprovalModal,
    selectedRequest,
    selectedFeatures,
    selectedPlanOverride, setSelectedPlanOverride,
    allTenants,
    superAnalytics,
    fetchSuperAdminData,
    handleToggleTenantStatus,
    handleOpenApproveModal,
    handleApproveRequest,
    toggleFeature,
  };
}
