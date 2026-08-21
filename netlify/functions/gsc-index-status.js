const crypto = require("crypto");

const COOKIE_NAME = "th_gsc_session";
const SITE_URL = process.env.GSC_SITE_URL || "sc-domain:thorshall.gg";
const DEFAULT_SITEMAP = "https://thorshall.gg/sitemap.xml";

function envSecret() {
  return process.env.DASHBOARD_SESSION_SECRET || process.env.GSC_OAUTH_STATE_SECRET || "";
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
  for (const cookie of String(header || "").split(";")) {
    const i = cookie.indexOf("=");
    if (i < 0) continue;
    if (cookie.slice(0, i).trim() === name) {
      return decodeURIComponent(cookie.slice(i + 1).trim());
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

function validAiKey(event) {
  const configured = process.env.GSC_AI_ACCESS_KEY || "";
  const supplied = event.queryStringParameters?.key || "";
  return Boolean(configured && supplied && safeEqual(supplied, configured));
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

async function getAccessToken() {
  const required = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GSC_REFRESH_TOKEN"];
  const missing = required.filter(name => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing environment variable(s): ${missing.join(", ")}`);
  }

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

async function inspectUrl(accessToken, url) {
  const response = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      inspectionUrl: url,
      siteUrl: SITE_URL,
      languageCode: "en-US"
    })
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(data?.error?.message || `Google URL Inspection API error ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const x = data?.inspectionResult?.indexStatusResult || {};
  return {
    url,
    verdict: x.verdict || null,
    coverageState: x.coverageState || null,
    robotsTxtState: x.robotsTxtState || null,
    indexingState: x.indexingState || null,
    pageFetchState: x.pageFetchState || null,
    lastCrawlTime: x.lastCrawlTime || null,
    crawledAs: x.crawledAs || null,
    googleCanonical: x.googleCanonical || null,
    userCanonical: x.userCanonical || null,
    referringUrls: x.referringUrls || [],
    sitemap: x.sitemap || []
  };
}

async function sitemapUrls() {
  const response = await fetch(DEFAULT_SITEMAP, {
    headers: { "User-Agent": "ThorHall-GSC-Monitor/1.0" }
  });
  if (!response.ok) {
    throw new Error(`Could not load sitemap (${response.status})`);
  }
  const xml = await response.text();
  return [...xml.matchAll(/<(?:[A-Za-z0-9_-]+:)?loc>\s*([^<]+?)\s*<\/(?:[A-Za-z0-9_-]+:)?loc>/gi)]
    .map(match => match[1].trim())
    .filter(url => url.startsWith("https://thorshall.gg/"))
    .slice(0, 100);
}

async function pool(items, limit, worker) {
  const output = new Array(items.length);
  let next = 0;

  async function run() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try {
        output[index] = await worker(items[index]);
      } catch (error) {
        output[index] = {
          url: items[index],
          error: error.message,
          status: error.status || 500
        };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => run())
  );
  return output;
}

exports.handler = async function (event) {
  if (!process.env.DASHBOARD_PASSWORD || !envSecret()) {
    return json(503, { ok: false, error: "Dashboard security is not configured." });
  }

  if (!validSession(event) && !validAiKey(event)) {
    return json(401, { ok: false, error: "Unauthorized" });
  }

  try {
    const accessToken = await getAccessToken();
    const single = String(event.queryStringParameters?.url || "").trim();
    const urls = single ? [single] : await sitemapUrls();

    for (const url of urls) {
      if (!url.startsWith("https://thorshall.gg/")) {
        return json(400, { ok: false, error: "Only thorshall.gg URLs are allowed." });
      }
    }

    const results = await pool(urls, 5, url => inspectUrl(accessToken, url));
    const summary = results.reduce((acc, row) => {
      const key = row.coverageState || row.verdict || row.error || "Unknown";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    return json(200, {
      ok: true,
      generatedAt: new Date().toISOString(),
      siteUrl: SITE_URL,
      count: results.length,
      summary,
      results
    });
  } catch (error) {
    console.error("gsc-index-status error", error);
    return json(error.status || 500, {
      ok: false,
      error: error.message || "URL inspection failed."
    });
  }
};
