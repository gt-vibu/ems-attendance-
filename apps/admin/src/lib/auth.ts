import { useState, useEffect } from 'react';

export interface User {
  id: number;
  uid: string;
  email: string;
  name: string;
  role: string;
  tenantId?: number;
  isKycCompleted?: boolean;
  // Company-wide switch: when false, this tenant's employees skip device
  // registration entirely and check in via GPS-within-radius alone. Defaults
  // true (undefined treated as enabled) for any cached session predating
  // this field.
  kycEnabled?: boolean;
  // Whether the tenant_admin has completed (or explicitly skipped) the
  // first-login branch-setup wizard. Irrelevant for non-tenant_admin roles.
  branchSetupCompleted?: boolean;
  // Whether this tenant has opted into camera-based face recognition as the
  // primary identity check. Only ever set at login/session refresh — not
  // returned by every endpoint that calls updateSession(), so call sites
  // that only update a narrower field (e.g. after enrollment) should merge
  // into the existing cached user rather than replace it wholesale.
  faceRecognitionEnabled?: boolean;
  // Which identity check this employee completed enrollment with — 'face'
  // or 'webauthn' — or undefined if neither yet.
  verificationMethod?: 'face' | 'webauthn';
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedUser = localStorage.getItem('auth_user');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
    setLoading(false);
  }, []);

  const login = (u: User) => {
    localStorage.setItem('auth_user', JSON.stringify(u));
    setUser(u);
  };

  const logout = async () => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      try {
        await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      } catch {
        // Best-effort — still clear local state below so the user isn't
        // stuck looking logged-in after a network hiccup. Worst case the
        // server-side session lingers until its own 24h expiry.
      }
    }
    localStorage.removeItem('auth_user');
    localStorage.removeItem('auth_token');
    setUser(null);
  };

  const updateSession = (u: User) => {
    localStorage.setItem('auth_user', JSON.stringify(u));
    setUser(u);
  };

  return { user, loading, login, logout, updateSession };
}

export function getAuthUser(): User | null {
  const storedUser = localStorage.getItem('auth_user');
  if (storedUser) return JSON.parse(storedUser);
  return null;
}
