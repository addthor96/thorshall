const DEFAULT_SITE = 'sc-domain:thorshall.gg';
const API_ROOT = 'https://www.googleapis.com/webmasters/v3';

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex, nofollow',
    },
    body: JSON.stringify(body, null, 2),
  };
}

function isAuthorized(event) {
  const requiredKey = process.env.GSC_REPORT_KEY;
  if (!requiredKey) return true;
  const supplied = event.headers?.['x-gsc-key'] || event.headers?.['X-Gsc-Key'] || event.queryStringParameters?.key;
  return Boolean(supplied) && supplied === requiredKey;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function parseGoogleResponse(response) {
  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }
  if (!response.ok) {
    const message = data?.error?.message || data?.error_description || data?.error || `Google API error ${response.status}`;
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }
  return data;
}

async function accessToken() {
  const response = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GSC_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await parseGoogleResponse(response);
  if (!data.access_token) throw new Error('Google did not return an access token.');
  return data.access_token;
}

async function googleApi(path, token, options = {}) {
  const response = await fetchWithTimeout(`${API_ROOT}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  return parseGoogleResponse(response);
}

function dateInPacific(daysAgo = 0) {
  const date = new Date(Date.now() - daysAgo * 86400000);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function period(days, offset = 1) {
  return {
    startDate: dateInPacific(offset + days - 1),
    endDate: dateInPacific(offset),
  };
}

function totals(row) {
  return {
    clicks: Number(row?.clicks || 0),
    impressions: Number(row?.impressions || 0),
    ctr: Number(row?.ctr || 0),
    position: Number(row?.position || 0),
  };
}

function percentChange(current, previous) {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
}

function changes(current, previous) {
  return {
    clicks: percentChange(current.clicks, previous.clicks),
    impressions: percentChange(current.impressions, previous.impressions),
    ctr: percentChange(current.ctr, previous.ctr),
    position: previous.position === 0 ? null : current.position - previous.position,
  };
}

function queryBody(range, dimensions = [], rowLimit = 100) {
  return {
    ...range,
    type: 'web',
    dataState: 'all',
    dimensions,
    rowLimit,
  };
}

exports.handler = async (event) => {
  if (!isAuthorized(event)) return json(401, { ok: false, error: 'Unauthorized.' });

  const required = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GSC_REFRESH_TOKEN'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    return json(503, {
      ok: false,
      connected: false,
      error: `Missing environment variables: ${missing.join(', ')}`,
      nextStep: missing.includes('GSC_REFRESH_TOKEN') ? 'Complete Google authorization and add GSC_REFRESH_TOKEN in Netlify.' : 'Check the Google OAuth environment variables in Netlify.',
    });
  }

  const requestedDays = Number(event.queryStringParameters?.days || 28);
  const days = Number.isFinite(requestedDays) ? Math.min(Math.max(Math.round(requestedDays), 1), 90) : 28;
  const siteUrl = process.env.GSC_SITE_URL || DEFAULT_SITE;
  const currentPeriod = period(days, 1);
  const previousPeriod = period(days, days + 1);

  try {
    const token = await accessToken();
    const encodedSite = encodeURIComponent(siteUrl);
    const sites = await googleApi('/sites', token);
    const siteEntry = (sites.siteEntry || []).find((site) => site.siteUrl === siteUrl);

    if (!siteEntry) {
      return json(403, {
        ok: false,
        connected: true,
        error: `The authorized Google account does not have access to ${siteUrl}.`,
      });
    }

    const analyticsPath = `/sites/${encodedSite}/searchAnalytics/query`;
    const post = (body) => googleApi(analyticsPath, token, { method: 'POST', body: JSON.stringify(body) });

    const [currentSummary, previousSummary, daily, pages, queries, sitemaps] = await Promise.all([
      post(queryBody(currentPeriod, [], 1)),
      post(queryBody(previousPeriod, [], 1)),
      post(queryBody(currentPeriod, ['date'], Math.min(days, 90))),
      post(queryBody(currentPeriod, ['page'], 50)),
      post(queryBody(currentPeriod, ['query'], 50)),
      googleApi(`/sites/${encodedSite}/sitemaps`, token),
    ]);

    const currentTotals = totals(currentSummary.rows?.[0]);
    const previousTotals = totals(previousSummary.rows?.[0]);

    return json(200, {
      ok: true,
      connected: true,
      generatedAt: new Date().toISOString(),
      property: {
        siteUrl,
        permissionLevel: siteEntry.permissionLevel,
      },
      period: {
        days,
        current: currentPeriod,
        previous: previousPeriod,
        dataState: 'all',
        firstIncompleteDate: daily.metadata?.first_incomplete_date || null,
      },
      totals: currentTotals,
      previousTotals,
      change: changes(currentTotals, previousTotals),
      daily: (daily.rows || []).map((row) => ({
        date: row.keys?.[0] || null,
        ...totals(row),
      })),
      topPages: (pages.rows || []).map((row) => ({
        page: row.keys?.[0] || null,
        ...totals(row),
      })),
      topQueries: (queries.rows || []).map((row) => ({
        query: row.keys?.[0] || null,
        ...totals(row),
      })),
      sitemaps: (sitemaps.sitemap || []).map((sitemap) => ({
        path: sitemap.path,
        lastSubmitted: sitemap.lastSubmitted || null,
        lastDownloaded: sitemap.lastDownloaded || null,
        isPending: Boolean(sitemap.isPending),
        isSitemapsIndex: Boolean(sitemap.isSitemapsIndex),
        warnings: Number(sitemap.warnings || 0),
        errors: Number(sitemap.errors || 0),
        contents: sitemap.contents || [],
      })),
    });
  } catch (error) {
    const invalidGrant = String(error.message || '').includes('invalid_grant');
    return json(error.statusCode === 401 ? 401 : 502, {
      ok: false,
      connected: !invalidGrant,
      error: error.message,
      nextStep: invalidGrant ? 'The Google refresh token expired or was revoked. Run the authorization flow again.' : undefined,
    });
  }
};
