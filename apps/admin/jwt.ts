import jsonwebtoken from 'jsonwebtoken';

// Handle CJS/ESM interop: some bundlers nest the default export
const jwt = (jsonwebtoken as any).default || jsonwebtoken;

// Never ship a hardcoded fallback secret. If JWT_SECRET isn't set in
// production, every issued token would be signed with a value that's public
// in the source tree — anyone could forge a valid super_admin session. Refuse
// to start instead. In non-production we allow an explicit, clearly-insecure
// dev default so `pnpm dev` still works without a .env, but we warn loudly.
function resolveJwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.trim()) return fromEnv;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'FATAL: JWT_SECRET is not set. Refusing to start in production with a ' +
      'hardcoded fallback secret (sessions would be forgeable). Set JWT_SECRET ' +
      'to a long random value in the environment.'
    );
  }

  console.warn(
    '[jwt] WARNING: JWT_SECRET is not set — using an insecure development-only ' +
    'default. Set JWT_SECRET in .env; production will refuse to start without it.'
  );
  return 'dev-only-insecure-secret-DO-NOT-USE-IN-PRODUCTION';
}

const JWT_SECRET = resolveJwtSecret();

export function signToken(payload: any): string {
  // Sign token with 24 hours expiry
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}

// Short-lived token for intermediate steps of a multi-step flow (e.g. the
// face-verification pass token handed from /verify-face to the final
// attendance submit) — deliberately expires in minutes, not hours, since it
// asserts "this specific check just happened", not "this session is logged in".
export function signShortLivedToken(payload: any, expiresIn: string): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

export function verifyToken(token: string): any {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}
