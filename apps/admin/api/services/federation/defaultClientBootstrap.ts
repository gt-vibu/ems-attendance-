import { hashPassword } from '../../../password';

export interface BootstrapFederationClientSeed {
  name: string;
  company: string;
  description: string;
  clientId: string;
  clientSecretHash: string;
  apiKey: string | null;
  webhookSecret: string | null;
  appUuid: string | null;
  publicIdentifier: string | null;
  environment: 'sandbox' | 'staging' | 'production';
  scopes: string[];
  webhookUrl: string | null;
  rateLimitPerMin: number;
  isMarketplaceApp: boolean;
  rating: string | null;
  category: string | null;
  installCount: number;
  status: 'active';
}

function parseScopes(raw: string | undefined): string[] {
  if (!raw) return ['attendance.read', 'leave.read', 'payroll.read', 'employee.read'];
  return raw.split(',').map((scope) => scope.trim()).filter(Boolean);
}

function parseEnvironment(raw: string | undefined): 'sandbox' | 'staging' | 'production' {
  if (raw === 'production' || raw === 'staging' || raw === 'sandbox') return raw;
  return 'sandbox';
}

// Optional local/dev bootstrap for one real federation client. We only seed
// when the operator explicitly provides a raw secret via env so OAuth can
// actually succeed; otherwise we leave the table empty instead of inserting
// unusable fake hashes that guarantee invalid_client failures.
export async function buildDefaultFederationClientSeed(
  env: NodeJS.ProcessEnv,
): Promise<BootstrapFederationClientSeed[]> {
  const clientId = env.FEDERATION_BOOTSTRAP_CLIENT_ID?.trim();
  const clientSecret = env.FEDERATION_BOOTSTRAP_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return [];

  return [
    {
      name: env.FEDERATION_BOOTSTRAP_CLIENT_NAME?.trim() || 'BlizBooks Local Bridge',
      company: env.FEDERATION_BOOTSTRAP_CLIENT_COMPANY?.trim() || 'BlizBooks',
      description: env.FEDERATION_BOOTSTRAP_CLIENT_DESCRIPTION?.trim()
        || 'Local bootstrap federation client for SmartTeams workforce integration testing.',
      clientId,
      clientSecretHash: await hashPassword(clientSecret),
      apiKey: env.FEDERATION_BOOTSTRAP_API_KEY?.trim() || null,
      webhookSecret: env.FEDERATION_BOOTSTRAP_WEBHOOK_SECRET?.trim() || null,
      appUuid: env.FEDERATION_BOOTSTRAP_APP_UUID?.trim() || null,
      publicIdentifier: env.FEDERATION_BOOTSTRAP_PUBLIC_IDENTIFIER?.trim() || null,
      environment: parseEnvironment(env.FEDERATION_BOOTSTRAP_ENVIRONMENT),
      scopes: parseScopes(env.FEDERATION_BOOTSTRAP_SCOPES),
      webhookUrl: env.FEDERATION_BOOTSTRAP_WEBHOOK_URL?.trim() || null,
      rateLimitPerMin: Number(env.FEDERATION_BOOTSTRAP_RATE_LIMIT_PER_MIN) || 5000,
      isMarketplaceApp: false,
      rating: null,
      category: 'Payroll & Accounting',
      installCount: 0,
      status: 'active',
    },
  ];
}
