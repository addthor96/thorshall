const crypto = require("crypto");

const COOKIE_NAME = "th_gsc_session";
const SITE_URL = process.env.GSC_SITE_URL || "sc-domain:thorshall.gg";

function envSecret() {
  return process.env.DASHBOARD_SESSION_SECRET ||
    process.env.GSC_OAUTH_STATE_SECRET ||
    "";
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function sign(value) {
  return crypto.createHmac("sha256", envSecret()).update(value).digest("base64url");
}

function readCookie(header, name) {
  const cookies = String(header || "").split(";");
  for (const cookie of cookies) {
    const index = cookie.indexOf("=");
    if (index < 0) continue;
    if (cookie.slice(0, index).trim() === name) {
      return decodeURIComponent(cookie.slice(index + 1).trim());
    }
  }
  return "";
}

function validSession(event) {
  const token = readCookie(event.headers?.cookie || event.headers?.Cookie, COOKIE_NAME);
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !envSecret()) return false;
  if (!safeEqual(sign(payload), signature)) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(decoded.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, private",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "X-Content-Type-Options": "nosniff"
    },
    body: JSON.stringify(body, null, 2)
  };
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function utcDateDaysAgo(days) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days));
}

function change(current, previous) {
  if (!previous) return current ? null : 0;
  return (current - previous) / previous;
}

async function googleFetch(url, options, accessToken) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options?.headers || {})
    }
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const message = data?.error?.message || data?.error_description || `Google API error ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data;
}

async function getAccessToken() {
  const required = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GSC_REFRESH_TOKEN"];
  const missing = required.filter(name => !process.env[name]);
  if (missing.length) throw new Error(`Missing environment variable(s): ${missing.join(", ")}`);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GSC_REFRESH_TOKEN,
      grant_type: "refresh_token"
    })
  });

  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Google token refresh failed.");
  }
  return data.access_token;
}

async function query(accessToken, startDate, endDate, dimensions = []) {
  const site = encodeURIComponent(SITE_URL);
  return googleFetch(
    `https://www.googleapis.com/webmasters/v3/sites/${site}/searchAnalytics/query`,
    {
      method: "POST",
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions,
        rowLimit: dimensions.length ? 25000 : 1,
        dataState: "all"
      })
    },
    accessToken
  );
}

function totalsFrom(result) {
  const row = result?.rows?.[0] || {};
  return {
    clicks: Number(row.clicks || 0),
    impressions: Number(row.impressions || 0),
    ctr: Number(row.ctr || 0),
    position: Number(row.position || 0)
  };
}

function keyedRows(result, key) {
  return (result?.rows || []).map(row => ({
    [key]: row.keys?.[0] || "",
    clicks: Number(row.clicks || 0),
    impressions: Number(row.impressions || 0),
    ctr: Number(row.ctr || 0),
    position: Number(row.position || 0)
  }));
}

function dailyRows(result, startDate, days) {
  const byDate = new Map(
    keyedRows(result, "date").map(row => [row.date, row])
  );
  const rows = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  for (let i = 0; i < days; i++) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i);
    const key = isoDate(date);
    rows.push(byDate.get(key) || {
      date: key, clicks: 0, impressions: 0, ctr: 0, position: 0
    });
  }
  return rows;
}

async function getProperty(accessToken) {
  const site = encodeURIComponent(SITE_URL);
  try {
    const result = await googleFetch(
      `https://www.googleapis.com/webmasters/v3/sites/${site}`,
      { method: "GET" },
      accessToken
    );
    return {
      siteUrl: result.siteUrl || SITE_URL,
      permissionLevel: result.permissionLevel || "unknown"
    };
  } catch {
    return { siteUrl: SITE_URL, permissionLevel: "unknown" };
  }
}

async function getSitemaps(accessToken) {
  const site = encodeURIComponent(SITE_URL);
  const result = await googleFetch(
    `https://www.googleapis.com/webmasters/v3/sites/${site}/sitemaps`,
    { method: "GET" },
    accessToken
  );
  return (result.sitemap || []).map(item => ({
    path: item.path,
    lastSubmitted: item.lastSubmitted || null,
    lastDownloaded: item.lastDownloaded || null,
    isPending: Boolean(item.isPending),
    isSitemapsIndex: Boolean(item.isSitemapsIndex),
    warnings: Number(item.warnings || 0),
    errors: Number(item.errors || 0),
    contents: (item.contents || []).map(content => ({
      type: content.type,
      submitted: String(content.submitted ?? "0"),
      indexed: String(content.indexed ?? "0")
    }))
  }));
}

exports.handler = async function (event) {
  if (!process.env.DASHBOARD_PASSWORD || !envSecret()) {
    return json(503, { ok: false, error: "Dashboard security is not configured." });
  }
  if (!validSession(event)) {
    return json(401, { ok: false, error: "Unauthorized" });
  }

  try {
    const accessToken = await getAccessToken();
    const days = 28;
    const currentEnd = utcDateDaysAgo(1);
    const currentStart = utcDateDaysAgo(days);
    const previousEnd = utcDateDaysAgo(days + 1);
    const previousStart = utcDateDaysAgo(days * 2);

    const current = { startDate: isoDate(currentStart), endDate: isoDate(currentEnd) };
    const previous = { startDate: isoDate(previousStart), endDate: isoDate(previousEnd) };

    const [
      property,
      currentTotalsResult,
      previousTotalsResult,
      dailyResult,
      pagesResult,
      queriesResult,
      sitemaps
    ] = await Promise.all([
      getProperty(accessToken),
      query(accessToken, current.startDate, current.endDate),
      query(accessToken, previous.startDate, previous.endDate),
      query(accessToken, current.startDate, current.endDate, ["date"]),
      query(accessToken, current.startDate, current.endDate, ["page"]),
      query(accessToken, current.startDate, current.endDate, ["query"]),
      getSitemaps(accessToken)
    ]);

    const totals = totalsFrom(currentTotalsResult);
    const previousTotals = totalsFrom(previousTotalsResult);

    return json(200, {
      ok: true,
      connected: true,
      generatedAt: new Date().toISOString(),
      property,
      period: {
        days,
        current,
        previous,
        dataState: "all",
        firstIncompleteDate: null
      },
      totals,
      previousTotals,
      change: {
        clicks: change(totals.clicks, previousTotals.clicks),
        impressions: change(totals.impressions, previousTotals.impressions),
        ctr: change(totals.ctr, previousTotals.ctr),
        position: totals.position - previousTotals.position
      },
      daily: dailyRows(dailyResult, current.startDate, days),
      topPages: keyedRows(pagesResult, "page")
        .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions),
      topQueries: keyedRows(queriesResult, "query")
        .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions),
      sitemaps
    });
  } catch (error) {
    console.error("gsc-report error", error);
    return json(error.status || 500, {
      ok: false,
      connected: false,
      error: error.message || "Search Console report failed."
    });
  }
};
