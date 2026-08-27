"use strict";

const { extractMetrics, jsonResponse, sleep } = require("../lib/rainbet-client");

const API_URL = "https://portal.rainbetpartners.com/api/customer/v1/partner/report";
const MANUEL_CAMPAIGN_ID = process.env.MANUEL_CAMPAIGN_ID || process.env.GEORGINA_CAMPAIGN_ID || "";
const DEFAULT_EXCHANGE_DATE = "2019-01-01";
const DEFAULT_COLUMNS = [
  "wager",
  "deposits_sum",
  "visits_count",
  "registrations_count",
  "first_deposits_count",
  "ggr",
  "ngr"
];

const CACHE_TTL_MS = 5 * 60 * 1000;
const memoryCache = new Map();

const cacheHeaders = {
  "Cache-Control": "public, max-age=30, s-maxage=300, stale-while-revalidate=3600",
  "Netlify-CDN-Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600"
};

function authCandidates(token) {
  const cleaned = String(token || "").trim();
  if (!cleaned) return [];
  if (/^(Bearer|Token)\s+/i.test(cleaned)) return [cleaned];
  return [cleaned, `Bearer ${cleaned}`];
}

function rangeDates(key) {
  const now = new Date();
  const from = new Date(now);

  switch (key) {
    case "today": {
      const start = new Date(now);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      return { key: "today", from: start.toISOString(), to: end.toISOString() };
    }
    case "7d":
      from.setUTCDate(from.getUTCDate() - 7);
      break;
    case "30d":
      from.setUTCDate(from.getUTCDate() - 30);
      break;
    case "6m":
      from.setUTCMonth(from.getUTCMonth() - 6);
      break;
    case "1y":
      from.setUTCFullYear(from.getUTCFullYear() - 1);
      break;
    case "all":
    default:
      return {
        key: "all",
        from: "2019-01-01T00:00:00.000Z",
        to: now.toISOString()
      };
  }

  return { key, from: from.toISOString(), to: now.toISOString() };
}

async function requestOnce(url, authorization, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: authorization
      },
      signal: controller.signal
    });

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_error) {
        throw new Error(`Rainbet returned an unreadable response (${response.status}).`);
      }
    }

    return { response, data };
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error("Rainbet API request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestWithRetry(url, authorization) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await requestOnce(url, authorization);
    if (result.response.status !== 429 || attempt === 2) return result;
    await sleep(1400 * (attempt + 1));
  }
  throw new Error("Rainbet API request failed.");
}

async function fetchManuelReport(token, range) {
  const params = new URLSearchParams({
    async: "false",
    from: range.from,
    to: range.to,
    exchange_rates_date: DEFAULT_EXCHANGE_DATE,
    conversion_currency: "USD"
  });

  DEFAULT_COLUMNS.forEach(column => params.append("columns[]", column));
  params.append("campaign_ids[]", String(MANUEL_CAMPAIGN_ID));

  const url = `${API_URL}?${params.toString()}`;
  const candidates = authCandidates(token);

  for (let index = 0; index < candidates.length; index += 1) {
    const { response, data } = await requestWithRetry(url, candidates[index]);

    if (response.ok) {
      try {
        return extractMetrics(data);
      } catch (error) {
        if (error instanceof Error && error.message.includes("expected totals were not found")) {
          return {
            wager: 0,
            deposits: 0,
            visits: 0,
            registrations: 0,
            ftd: 0,
            ggr: 0,
            ngr: 0
          };
        }
        throw error;
      }
    }

    if ([401, 403].includes(response.status) && index < candidates.length - 1) {
      continue;
    }

    const message =
      data?.message ||
      data?.error ||
      data?.errors?.[0]?.message ||
      `Rainbet API request failed with status ${response.status}.`;
    throw new Error(String(message));
  }

  throw new Error("Rainbet API authentication failed.");
}

exports.handler = async function (event) {
  const token = process.env.RAINBET_STATISTIC_TOKEN;
  if (!token) {
    return jsonResponse(500, { ok: false, error: "Missing RAINBET_STATISTIC_TOKEN" });
  }

  const requested = String(event.queryStringParameters?.range || "all").toLowerCase();
  const allowed = new Set(["today", "7d", "30d", "6m", "1y", "all"]);
  const range = rangeDates(allowed.has(requested) ? requested : "all");

  const cached = memoryCache.get(range.key);
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
    return jsonResponse(200, { ...cached.payload, cached: true }, cacheHeaders);
  }

  try {
    if (!MANUEL_CAMPAIGN_ID) {
      return jsonResponse(500, { ok: false, error: "Missing MANUEL_CAMPAIGN_ID or GEORGINA_CAMPAIGN_ID" });
    }

    const metrics = await fetchManuelReport(token, range);
    const payload = {
      ok: true,
      available: true,
      range: range.key,
      from: range.from,
      to: range.to,
      partners: {
        manuel: {
          name: "Manuel",
          connected: true,
          available: true,
          ...metrics
        }
      },
      updated: new Date().toISOString()
    };

    memoryCache.set(range.key, { time: Date.now(), payload });
    return jsonResponse(200, payload, cacheHeaders);
  } catch (error) {
    return jsonResponse(502, {
      ok: false,
      available: false,
      range: range.key,
      error: error instanceof Error ? error.message : "Statistics are temporarily unavailable."
    });
  }
};
