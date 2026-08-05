export interface CompanyIdentity {
  logo: string | null;
  companyName: string;
  legalName: string;
  tagline: string;
  description: string;
  website: string;
  supportEmail: string;
  supportPhone: string;
  address: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  taxId: string;
  regNumber: string;
  industry: string;
  orgSize: string;
  primaryColor: string;
  secondaryColor: string;
  theme: 'light' | 'dark' | 'system';
  timezone: string;
  dateFormat: string;
}

const DEFAULT_IDENTITY: CompanyIdentity = {
  logo: null,
  companyName: localStorage.getItem('company_name') || 'Smart Teams EMS',
  legalName: '',
  tagline: '',
  description: '',
  website: '',
  supportEmail: '',
  supportPhone: '',
  address: '',
  city: '',
  state: '',
  country: '',
  postalCode: '',
  taxId: '',
  regNumber: '',
  industry: '',
  orgSize: '',
  primaryColor: '#2563eb',
  secondaryColor: '#0f172a',
  theme: 'light',
  timezone: 'UTC-5 (Eastern Time)',
  dateFormat: 'YYYY-MM-DD',
};

const STORAGE_KEY = 'smartteams_company_identity';

export function getCompanyIdentity(): CompanyIdentity {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_IDENTITY, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.error('Failed to parse company identity:', e);
  }
  return DEFAULT_IDENTITY;
}

export function saveCompanyIdentity(partial: Partial<CompanyIdentity>): CompanyIdentity {
  const current = getCompanyIdentity();
  const updated = { ...current, ...partial };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  
  // Also sync legacy individual keys for backward compatibility
  if (updated.companyName) localStorage.setItem('company_name', updated.companyName);
  if (updated.tagline) localStorage.setItem('company_tagline', updated.tagline);
  if (updated.logo) localStorage.setItem('company_logo', updated.logo);
  if (updated.theme) localStorage.setItem('theme', updated.theme);

  // Apply theme dynamically
  if (partial.theme) {
    applyTheme(partial.theme);
  }

  // Dispatch custom event for real-time reactive UI re-renders
  window.dispatchEvent(new CustomEvent('company-identity-updated', { detail: updated }));
  return updated;
}

// ── Working Global Theme System ──
export function applyTheme(themeMode: 'light' | 'dark' | 'system') {
  const root = document.documentElement;
  
  let isDark = false;
  if (themeMode === 'dark') {
    isDark = true;
  } else if (themeMode === 'system') {
    isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } else {
    isDark = false;
  }

  if (isDark) {
    root.classList.add('dark');
    root.setAttribute('data-theme', 'dark');
  } else {
    root.classList.remove('dark');
    root.setAttribute('data-theme', 'light');
  }
}

export function initThemeSystem() {
  const identity = getCompanyIdentity();
  applyTheme(identity.theme);

  // Listen to OS theme changes if 'system' mode is active
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      const currentIdentity = getCompanyIdentity();
      if (currentIdentity.theme === 'system') {
        applyTheme('system');
      }
    });
  }
}
