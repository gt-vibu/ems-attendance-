/**
 * Application Base URL validator & resolver.
 * Ensures production builds require a valid public APP_BASE_URL and never fallback to localhost.
 */

export function getAppBaseUrl(): string {
  const envUrl = process.env.APP_BASE_URL || process.env.VITE_API_BASE_URL || process.env.BASE_URL;
  const isProd = process.env.NODE_ENV === 'production';

  if (envUrl) {
    try {
      const parsed = new URL(envUrl);
      if (isProd && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
        throw new Error(`Production APP_BASE_URL cannot point to localhost ('${envUrl}')`);
      }
      return envUrl.replace(/\/+$/, '');
    } catch (err: any) {
      if (isProd) {
        throw new Error(`Invalid APP_BASE_URL '${envUrl}' in production: ${err.message}`);
      }
    }
  }

  if (isProd) {
    throw new Error('APP_BASE_URL environment variable is required in production and cannot fall back to localhost');
  }

  return 'http://localhost:3000';
}

export function assertAppBaseUrlConfig(): void {
  // Validate at startup in production
  if (process.env.NODE_ENV === 'production') {
    getAppBaseUrl();
  }
}
