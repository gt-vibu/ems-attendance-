import { useState } from 'react';

// Device change requests — gated by settings.edit. Extracted verbatim from
// Dashboard.tsx. `onResolved` is called after a successful action so the
// parent can re-run its aggregate fetchTenantAdminData() (unchanged behavior).
export function useDeviceRequests(
  token: string | null,
  setLoading: (v: boolean) => void,
  setError: (v: string) => void,
  setSuccess: (v: string) => void,
  onResolved: () => void,
) {
  const [deviceRequests, setDeviceRequests] = useState<any[]>([]);
  const [hasDevicesAccess, setHasDevicesAccess] = useState(false);

  const handleDeviceAction = async (requestId: number, action: 'approve' | 'reject') => {
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/tenant/device-requests/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ requestId, action })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to process request');

      setSuccess(`Device request ${action}ed successfully.`);
      onResolved();

      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setError(err.message || 'Action failed');
    } finally {
      setLoading(false);
    }
  };

  return {
    deviceRequests, setDeviceRequests,
    hasDevicesAccess, setHasDevicesAccess,
    handleDeviceAction,
  };
}
