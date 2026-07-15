const crypto = require('crypto');

const OAUTH_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const COOKIE_NAME = 'th_gsc_oauth_nonce';

function response(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'x-robots-tag': 'noindex, nofollow',
      ...headers,
    },
    body,
  };
}

exports.handler = async () => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const stateSecret = process.env.GSC_OAUTH_STATE_SECRET;

  const missing = [
    ['GOOGLE_CLIENT_ID', clientId],
    ['GOOGLE_REDIRECT_URI', redirectUri],
    ['GSC_OAUTH_STATE_SECRET', stateSecret],
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length) {
    return response(500, `Missing environment variables: ${missing.join(', ')}`);
  }

  const issuedAt = Date.now();
  const nonce = crypto.randomBytes(32).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ issuedAt, nonce })).toString('base64url');
  const signature = crypto.createHmac('sha256', stateSecret).update(payload).digest('base64url');
  const state = `${payload}.${signature}`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: OAUTH_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });

  return response(302, '', {
    location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    'set-cookie': `${COOKIE_NAME}=${nonce}; Path=/.netlify/functions/gsc-oauth-callback; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  });
};
