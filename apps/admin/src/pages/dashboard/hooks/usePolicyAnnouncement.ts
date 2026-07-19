import { useState } from 'react';

// Company Policy announcement banner — shown on both this dashboard and the
// employee dashboard; editing gated behind 'tenant.policy.manage'.
// Extracted verbatim from Dashboard.tsx.
export function usePolicyAnnouncement(token: string | null) {
  const [policyAnnouncement, setPolicyAnnouncement] = useState('');
  const [policyExpanded, setPolicyExpanded] = useState(false);
  const [policyDraft, setPolicyDraft] = useState('');
  const [policySaving, setPolicySaving] = useState(false);

  const fetchPolicyAnnouncement = async () => {
    try {
      const res = await fetch('/api/tenant/policy', { headers: { 'Authorization': `Bearer ${token}` } });
      const data = await res.json();
      setPolicyAnnouncement(data.policyAnnouncement || '');
      setPolicyDraft(data.policyAnnouncement || '');
    } catch { /* non-critical, banner just stays hidden */ }
  };

  const handleSavePolicy = async () => {
    setPolicySaving(true);
    try {
      const res = await fetch('/api/tenant/policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ policyAnnouncement: policyDraft }),
      });
      const data = await res.json();
      if (res.ok) setPolicyAnnouncement(data.policyAnnouncement || '');
    } finally {
      setPolicySaving(false);
    }
  };

  return {
    policyAnnouncement,
    policyExpanded, setPolicyExpanded,
    policyDraft, setPolicyDraft,
    policySaving,
    fetchPolicyAnnouncement,
    handleSavePolicy,
  };
}
