const crypto = require('crypto');

const COOKIE_NAME = 'th_gsc_oauth_nonce';
const MAX_STATE_AGE_MS = 10 * 60 * 1000;

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf('=');
        if (separator === -1) return [part, ''];
        return [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
      }),
  );
}

function verifyState(state, stateSecret, cookieNonce) {
  try {
    const [payload, signature] = String(state || '').split('.');
    if (!payload || !signature) return false;

    const expected = crypto.createHmac('sha256', stateSecret).update(payload).digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return false;

    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const age = Date.now() - Number(decoded.issuedAt);
    if (!Number.isFinite(age) || age < 0 || age > MAX_STATE_AGE_MS) return false;
    if (!decoded.nonce || !cookieNonce) return false;

    const stateNonce = Buffer.from(String(decoded.nonce));
    const browserNonce = Buffer.from(String(cookieNonce));
    return stateNonce.length === browserNonce.length && crypto.timingSafeEqual(stateNonce, browserNonce);
  } catch {
    return false;
  }
}

function htmlPage(title, content, statusCode = 200) {
  return {
    statusCode,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'x-robots-tag': 'noindex, nofollow',
      'referrer-policy': 'no-referrer',
      'set-cookie': `${COOKIE_NAME}=; Path=/.netlify/functions/gsc-oauth-callback; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    },
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font-family:Arial,sans-serif;background:#0c0a08;color:#f5eee5;margin:0;padding:32px}.box{max-width:850px;margin:auto;background:#17110c;border:1px solid #6d4d24;border-radius:16px;padding:28px}h1{color:#f0cc79}pre,textarea{width:100%;box-sizing:border-box;background:#080604;color:#fff;border:1px solid #8c6936;border-radius:10px;padding:14px;word-break:break-all;white-space:pre-wrap}textarea{min-height:150px}.warn{color:#ffcc80}.ok{color:#82e0aa}button{background:#e1b85f;border:0;border-radius:9px;padding:12px 18px;font-weight:700;cursor:pointer}</style></head><body><main class="box">${content}</main></body></html>`,
  };
}

async function fetchWithTimeout(url, options, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const stateSecret = process.env.GSC_OAUTH_STATE_SECRET;
  const cookieNonce = parseCookies(event.headers?.cookie || event.headers?.Cookie || '')[COOKIE_NAME];

  if (params.error) {
    return htmlPage('Authorization cancelled', `<h1>Authorization cancelled</h1><p>${escapeHtml(params.error_description || params.error)}</p>`, 400);
  }

  const missing = [
    ['authorization code', params.code],
    ['OAuth state', params.state],
    ['GOOGLE_CLIENT_ID', clientId],
    ['GOOGLE_CLIENT_SECRET', clientSecret],
    ['GOOGLE_REDIRECT_URI', redirectUri],
    ['GSC_OAUTH_STATE_SECRET', stateSecret],
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length) {
    return htmlPage('OAuth setup error', `<h1>OAuth setup error</h1><p>Missing: ${escapeHtml(missing.join(', '))}</p>`, 400);
  }

  if (!verifyState(params.state, stateSecret, cookieNonce)) {
    return htmlPage('Security check failed', '<h1>Security check failed</h1><p>The authorization link expired, was opened in a different browser, or failed the state verification. Start again from the authorization URL.</p>', 400);
  }

  let tokenResponse;
  try {
    tokenResponse = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: params.code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
  } catch (error) {
    return htmlPage('Token exchange failed', `<h1>Google token exchange failed</h1><p>${escapeHtml(error.message)}</p>`, 502);
  }

  const rawBody = await tokenResponse.text();
  let tokenData;
  try {
    tokenData = JSON.parse(rawBody);
  } catch {
    tokenData = { raw: rawBody };
  }

  if (!tokenResponse.ok) {
    return htmlPage('Token exchange failed', `<h1>Google token exchange failed</h1><pre>${escapeHtml(JSON.stringify(tokenData, null, 2))}</pre>`, 502);
  }

  if (!tokenData.refresh_token) {
    return htmlPage('Refresh token missing', '<h1>No refresh token returned</h1><p>Remove the app from your Google Account permissions, then start authorization again. The bridge requires offline access.</p>', 400);
  }

  return htmlPage('GSC authorization complete', `
    <h1 class="ok">Google Search Console connected</h1>
    <p>Add the token below to Netlify as an environment variable named <strong>GSC_REFRESH_TOKEN</strong>.</p>
    <p class="warn"><strong>Keep it private.</strong> Do not place it in site files, screenshots, email, or chat.</p>
    <textarea id="token" readonly>${escapeHtml(tokenData.refresh_token)}</textarea>
    <p><button type="button" onclick="navigator.clipboard.writeText(document.getElementById('token').value)">Copy token</button></p>
    <p>After saving the variable in Netlify, trigger a new production deploy and close this page.</p>
  `);
};
