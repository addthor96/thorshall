"use strict";

const { extractMetrics, jsonResponse, sleep } = require("../lib/rainbet-client");
const { isAuthorized, unauthorized } = require("../lib/stats-auth");

const API_URL = "https://portal.rainbetpartners.com/api/customer/v1/partner/report";
const ARSHAN_CAMPAIGN_ID = "125599";
const DEFAULT_EXCHANGE_DATE = "2019-01-01";
const DEFAULT_COLUMNS = [
  "wager",
  "deposits_sum",
  "visits_count",
  "registrations_count",
  "first_deposits_count",
  "ggr",
  "ngr",
  "sb_ngr"
];

const CACHE_TTL_MS = 5 * 60 * 1000;
const memoryCache = new Map();

const cacheHeaders = {
  "Cache-Control": "private, no-store",
  "Netlify-CDN-Cache-Control": "no-store"
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
      // "Month" = current monthly billing period to date.
      from.setUTCDate(1);
      from.setUTCHours(0, 0, 0, 0);
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

function cleanNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "amount")) return cleanNumber(value.amount);
    if (Object.prototype.hasOwnProperty.call(value, "value")) return cleanNumber(value.value);
    return null;
  }
  const normalized = typeof value === "string" ? value.replace(/,/g, "").trim() : value;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function findMetric(value, wantedKey, depth = 0, seen = new Set()) {
  if (!value || typeof value !== "object" || depth > 8 || seen.has(value)) return null;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (entry && typeof entry === "object") {
        const name = entry.name || entry.key || entry.column;
        if (name === wantedKey) {
          const found = cleanNumber(
            Object.prototype.hasOwnProperty.call(entry, "value") ? entry.value : entry.amount
          );
          if (found !== null) return found;
        }
      }
    }
    for (const entry of value) {
      const found = findMetric(entry, wantedKey, depth + 1, seen);
      if (found !== null) return found;
    }
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(value, wantedKey)) {
    const found = cleanNumber(value[wantedKey]);
    if (found !== null) return found;
  }

  for (const child of Object.values(value)) {
    const found = findMetric(child, wantedKey, depth + 1, seen);
    if (found !== null) return found;
  }

  return null;
}

function extractExtraMetrics(data) {
  const preferred = [
    data?.totals?.data?.[0],
    data?.rows?.totals?.data?.[0],
    data?.data?.totals?.data?.[0],
    data?.result?.totals?.data?.[0],
    data?.totals,
    data?.summary,
    data?.data?.summary,
    data
  ].filter(Boolean);

  function pick(key) {
    for (const candidate of preferred) {
      const found = findMetric(candidate, key);
      if (found !== null) return found;
    }
    return null;
  }

  return {
    sbNgr: pick("sb_ngr")
  };
}

function tierRate(ngr) {
  const value = Math.max(0, Number(ngr) || 0);
  if (value >= 200000) return 0.50;
  if (value >= 100000) return 0.45;
  if (value >= 40000) return 0.40;
  if (value >= 10000) return 0.30;
  return 0.25;
}

function buildPayout(metrics) {
  const casinoNgr = Math.max(0, Number(metrics.ngr) || 0);
  const sbNgr = Math.max(0, Number(metrics.sbNgr) || 0);
  const casinoRate = tierRate(casinoNgr);
  const sbRate = tierRate(sbNgr);
  const tierEstimate = (casinoNgr * casinoRate) + (sbNgr * sbRate);

  return {
    casinoNgr,
    sbNgr,
    casinoRate,
    sbRate,
    estimatedRainbetCommission: tierEstimate,
    first3MonthsPayout: tierEstimate,
    after3MonthsPayout: tierEstimate * 0.5,
    basedOn: "tier_estimate"
  };
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

async function fetchArshanReport(token, range) {
  const params = new URLSearchParams({
    async: "false",
    from: range.from,
    to: range.to,
    exchange_rates_date: DEFAULT_EXCHANGE_DATE,
    conversion_currency: "USD"
  });

  DEFAULT_COLUMNS.forEach(column => params.append("columns[]", column));
  params.append("campaign_ids[]", ARSHAN_CAMPAIGN_ID);

  const url = `${API_URL}?${params.toString()}`;
  const candidates = authCandidates(token);

  for (let index = 0; index < candidates.length; index += 1) {
    const { response, data } = await requestWithRetry(url, candidates[index]);

    if (response.ok) {
      try {
        const core = extractMetrics(data);
        const extra = extractExtraMetrics(data);
        return { ...core, ...extra };
      } catch (error) {
        if (error instanceof Error && error.message.includes("expected totals were not found")) {
          return {
            wager: 0,
            deposits: 0,
            visits: 0,
            registrations: 0,
            ftd: 0,
            ggr: 0,
            ngr: 0,
            sbNgr: 0
          };
        }
        throw error;
      }
    }

    if ([401, 403].includes(response.status) && index < candidates.length - 1) continue;

    const validation = Array.isArray(data?.errors)
      ? data.errors.map(item => item?.message || item?.detail || item).filter(Boolean).join(" | ")
      : "";
    const message =
      data?.message ||
      data?.error ||
      validation ||
      `Rainbet API request failed with status ${response.status}.`;
    throw new Error(String(message));
  }

  throw new Error("Rainbet API authentication failed.");
}

exports.handler = async function (event) {
  if (!isAuthorized(event)) return unauthorized();
  const token = process.env.RAINBET_STATISTIC_TOKEN;
  if (!token) {
    return jsonResponse(500, { ok: false, error: "Missing RAINBET_STATISTIC_TOKEN" });
  }

  const requested = String(event.queryStringParameters?.range || "all").toLowerCase();
  const allowed = new Set(["today", "7d", "30d", "6m", "1y", "all"]);
  const range = rangeDates(allowed.has(requested) ? requested : "all");
  const billingRange = rangeDates("30d");

  const cached = memoryCache.get(range.key);
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
    return jsonResponse(200, { ...cached.payload, cached: true }, cacheHeaders);
  }

  try {
    const metrics = await fetchArshanReport(token, range);
    const billingMetrics = range.key === "30d"
      ? metrics
      : await fetchArshanReport(token, billingRange);

    const payout = buildPayout(billingMetrics);

    const payload = {
      ok: true,
      available: true,
      range: range.key,
      from: range.from,
      to: range.to,
      campaignId: ARSHAN_CAMPAIGN_ID,
      partners: {
        arshan: {
          name: "Arshan",
          connected: true,
          available: true,
          ...metrics,
          casinoNgr: metrics.ngr,
          sportsbookNgr: metrics.sbNgr
        }
      },
      billing: {
        range: "month",
        from: billingRange.from,
        to: billingRange.to,
        payout
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
      error: "Statistics are temporarily unavailable."
    });
  }
};
