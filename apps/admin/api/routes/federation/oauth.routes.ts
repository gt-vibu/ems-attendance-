import { Router } from 'express';
import { sendServerError } from '../../utils/errors';
import { authLimiter } from '../../middleware/rateLimit';
import { verifyClientCredentials, issueFederationAccessToken } from '../../auth/federationClients';

export const router = Router();

// OAuth 2.1 client-credentials grant — the one federation endpoint that
// does NOT require an existing bearer token (this IS how one is obtained).
// Reuses the same brute-force-resistant authLimiter every other
// credential-checking endpoint (login, etc.) already uses.
router.post('/v1/federation/oauth/token', authLimiter, async (req: any, res: any) => {
  try {
    const grantType = req.body?.grant_type;
    if (grantType !== 'client_credentials') {
      return res.status(400).json({ error: 'unsupported_grant_type', error_description: 'Only grant_type=client_credentials is supported.' });
    }

    // Accept either HTTP Basic auth (client_id:client_secret) or body
    // params — both are standard OAuth 2.1 client-credentials transports.
    let clientId = req.body?.client_id;
    let clientSecret = req.body?.client_secret;
    const authHeader = req.headers.authorization;
    if ((!clientId || !clientSecret) && authHeader?.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
      const sepIndex = decoded.indexOf(':');
      if (sepIndex > -1) {
        clientId = decoded.slice(0, sepIndex);
        clientSecret = decoded.slice(sepIndex + 1);
      }
    }

    const client = await verifyClientCredentials(clientId, clientSecret);
    if (!client) {
      return res.status(401).json({ error: 'invalid_client', error_description: 'Unknown client_id or incorrect client_secret.' });
    }

    const { accessToken, expiresIn } = issueFederationAccessToken(client);
    res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: expiresIn,
      scope: client.scopes.join(' '),
    });
  } catch (err: any) {
    sendServerError(res, err, 'federation/oauth.routes.ts');
  }
});
