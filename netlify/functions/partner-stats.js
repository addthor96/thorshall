"use strict";

const { isAuthorized } = require("../lib/stats-auth");
const { getPartner } = require("../lib/partner-campaigns");

const API_URL = "https://portal.rainbetpartners.com/api/customer/v1/partner/report";
const CACHE_TTL_MS = 5 * 60 * 1000;
const COLUMNS = ["wager", "deposits_sum", "visits_count", "registrations_count", "first_deposits_count", "ggr", "ngr", "sb_ngr"];
const FIELD_MAP = {
  wager: "wager", deposits_sum: "deposits", visits_count: "visits",
  registrations_count: "registrations", first_deposits_count: "ftd",
  ggr: "ggr", ngr: "ngr", sb_ngr: "sbNgr"
};
const ALIASES = { ftd_count: "first_deposits_count", casino_ggr: "ggr", casino_ngr: "ngr" };
const CORE = ["wager", "deposits_sum", "visits_count", "registrations_count"];
const RANGES = new Set(["today", "7d", "month", "all"]);
const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Netlify-CDN-Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  Vary: "Cookie"
};

function json(statusCode, payload, extra = {}) {
  return { statusCode, headers: { ...HEADERS, ...extra }, body: JSON.stringify(payload) };
}

// UTC calendar ranges: "7d" includes today and the preceding six UTC dates.
// Every range ends now, not at a future midnight or in the browser's timezone.
function rangeDates(key, now = new Date()) {
  if (!RANGES.has(key) || !Number.isFinite(now.getTime())) throw new Error("Invalid report range");
  const from = new Date(now);
  from.setUTCHours(0, 0, 0, 0);
  if (key === "7d") from.setUTCDate(from.getUTCDate() - 6);
  if (key === "month") from.setUTCDate(1);
  if (key === "all") from.setTime(Date.parse("2019-01-01T00:00:00.000Z"));
  return { key, from: from.toISOString(), to: now.toISOString() };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanNumber(value, depth = 0) {
  if (depth > 3) return null;
  if (isObject(value)) {
    if (Object.hasOwn(value, "amount")) return cleanNumber(value.amount, depth + 1);
    if (Object.hasOwn(value, "value")) return cleanNumber(value.value, depth + 1);
    return null;
  }
  if (typeof value !== "number" && typeof value !== "string") return null;
  const normalized = typeof value === "string" ? value.replace(/,/g, "").trim() : value;
  if (normalized === "") return null;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}

function parseMetricValue(value, depth = 0) {
  if (depth > 3) throw new Error("Invalid report metric");
  // An explicit null means unavailable. Missing or nonnumeric values must not
  // be confused with that state, especially when all core totals are valid.
  if (value === null) return null;
  if (isObject(value)) {
    if (Object.hasOwn(value, "amount")) return parseMetricValue(value.amount, depth + 1);
    if (Object.hasOwn(value, "value")) return parseMetricValue(value.value, depth + 1);
  }
  const result = cleanNumber(value);
  if (result === null) throw new Error("Invalid report metric");
  return result;
}

function parseCandidate(candidate) {
  if (Array.isArray(candidate)) {
    if (!candidate.length) return null;
    const named = {};
    for (const entry of candidate) {
      if (!isObject(entry)) continue;
      const name = entry.name || entry.key || entry.column;
      const field = ALIASES[name] || name;
      if (!Object.hasOwn(FIELD_MAP, field)) continue;
      if (Object.hasOwn(named, field)) throw new Error("Duplicate report metric");
      named[field] = parseMetricValue(Object.hasOwn(entry, "value") ? entry.value : entry.amount);
    }
    if (Object.keys(named).length) return named;
    return candidate.length === 1 ? parseCandidate(candidate[0]) : null;
  }
  if (!isObject(candidate)) return null;
  const result = {};
  for (const field of COLUMNS) {
    if (Object.hasOwn(candidate, field)) result[field] = parseMetricValue(candidate[field]);
  }
  for (const [alias, field] of Object.entries(ALIASES)) {
    if (!Object.hasOwn(result, field) && Object.hasOwn(candidate, alias)) {
      result[field] = parseMetricValue(candidate[alias]);
    }
  }
  return Object.keys(result).length ? result : null;
}

function hasErrors(object) {
  if (object.ok === false || object.success === false) return true;
  return [object.error, object.errors].some(value => {
    if (Array.isArray(value)) return value.length > 0;
    if (isObject(value)) return Object.keys(value).length > 0;
    return Boolean(value);
  });
}

function reportEnvelopes(data) {
  if (!isObject(data)) throw new Error("Invalid report response");
  const queue = [data];
  const result = [];
  while (queue.length && result.length < 12) {
    const current = queue.shift();
    if (hasErrors(current)) throw new Error("Report returned an error");
    result.push(current);
    // Only documented report containers; never search arbitrary user rows for
    // a first matching metric and mistake it for the campaign's total.
    for (const key of ["data", "result", "rows"]) {
      if (isObject(current[key])) queue.push(current[key]);
    }
  }
  return result;
}

function explicitlyEmpty(envelopes) {
  // Contradictory counts, nonempty rows, or malformed totals cannot establish
  // an empty report even if another container happens to contain [].
  for (const envelope of envelopes) {
    for (const rows of [envelope.rows, envelope.rows?.data, envelope.data]) {
      if (Array.isArray(rows) && rows.length > 0) return false;
    }
    for (const field of ["total", "total_count", "count"]) {
      if (Object.hasOwn(envelope, field) && cleanNumber(envelope[field]) !== 0) return false;
    }
    if (isObject(envelope.pagination) && Object.hasOwn(envelope.pagination, "total") && cleanNumber(envelope.pagination.total) !== 0) return false;
    for (const field of ["totals", "summary"]) {
      if (!Object.hasOwn(envelope, field)) continue;
      const value = envelope[field];
      const empty = Array.isArray(value) && value.length === 0;
      const emptyData = isObject(value) && Array.isArray(value.data) && value.data.length === 0;
      if (!empty && !emptyData) return false;
    }
  }
  return envelopes.some(envelope => {
    const rows = Array.isArray(envelope.rows) ? envelope.rows
      : Array.isArray(envelope.rows?.data) ? envelope.rows.data
      : Array.isArray(envelope.data) ? envelope.data : null;
    if (!rows || rows.length !== 0) return false;
    const emptyTotals = Array.isArray(envelope.totals?.data) && envelope.totals.data.length === 0;
    const counts = [envelope.total, envelope.total_count, envelope.count, envelope.pagination?.total];
    const countIsZero = counts.some(value => cleanNumber(value) === 0);
    return emptyTotals || countIsZero;
  });
}

function extractReportMetrics(data) {
  const envelopes = reportEnvelopes(data);
  for (const envelope of envelopes) {
    for (const candidate of [envelope.totals?.data, envelope.totals, envelope.summary]) {
      const raw = parseCandidate(candidate);
      if (!raw) continue;
      if (!CORE.every(field => Object.hasOwn(raw, field) && raw[field] !== null)) {
        throw new Error("Incomplete report totals");
      }
      // Missing or explicitly null optional columns remain unavailable;
      // parseMetricValue has already rejected malformed numeric values.
      const metrics = Object.fromEntries(Object.values(FIELD_MAP).map(field => [field, null]));
      for (const [source, value] of Object.entries(raw)) metrics[FIELD_MAP[source]] = value;
      return metrics;
    }
  }
  if (explicitlyEmpty(envelopes)) {
    return Object.fromEntries(Object.values(FIELD_MAP).map(field => [field, 0]));
  }
  throw new Error("Report totals not found");
}

function authCandidates(token) {
  const cleaned = String(token || "").trim();
  if (!cleaned) return [];
  return /^(Bearer|Token)\s+/i.test(cleaned) ? [cleaned] : [cleaned, `Bearer ${cleaned}`];
}

async function fetchPartnerReport(partner, range, token, fetchImpl, wait) {
  const params = new URLSearchParams({
    async: "false", from: range.from, to: range.to,
    exchange_rates_date: "2019-01-01", conversion_currency: "USD"
  });
  COLUMNS.forEach(column => params.append("columns[]", column));
  params.append("campaign_ids[]", partner.campaignId);
  const candidates = authCandidates(token);
  let retriedRateLimit = false;
  for (let index = 0; index < candidates.length; index += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7500);
    try {
      const response = await fetchImpl(`${API_URL}?${params}`, {
        method: "GET", headers: { Accept: "application/json", Authorization: candidates[index] },
        signal: controller.signal
      });
      if (response.status === 429 && !retriedRateLimit) {
        retriedRateLimit = true;
        await wait(1200);
        index -= 1; // Retry the same auth format, at most once per report.
        continue;
      }
      if ([401, 403].includes(response.status) && index + 1 < candidates.length) continue;
      if (!response.ok) throw new Error("Report request failed");
      const data = JSON.parse(await response.text());
      return extractReportMetrics(data);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("Report authorization failed");
}

// Dependency injection keeps the access boundary and upstream behavior testable
// without real API credentials or live submissions.
function createHandler({ authorize = isAuthorized, fetchImpl = (...args) => fetch(...args), now = () => new Date(), getToken = () => process.env.RAINBET_STATISTIC_TOKEN, cache = new Map(), wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  return async function handler(event = {}) {
    if (event.httpMethod !== "GET") return json(405, { ok: false, error: "Method not allowed." }, { Allow: "GET" });
    const query = event.queryStringParameters || {};
    if (Object.keys(query).some(key => !["partner", "range"].includes(key))) {
      return json(400, { ok: false, error: "Unsupported report parameter." });
    }
    const partner = getPartner(query.partner);
    if (!partner) return json(404, { ok: false, error: "Partner dashboard not found." });

    // Authorization MUST precede token use, any cached result, and every API call.
    let allowed = false;
    try { allowed = authorize(event, partner.code); } catch { /* malformed session */ }
    if (!allowed) return json(401, { ok: false, error: "Sign in to view this dashboard." }, { "WWW-Authenticate": "StatsSession" });

    const key = String(query.range || "month").toLowerCase();
    if (!RANGES.has(key)) return json(400, { ok: false, error: "Invalid report range." });
    const token = getToken();
    if (!String(token || "").trim()) return json(503, { ok: false, error: "Campaign reporting is not configured yet." });
    const current = now();
    const range = rangeDates(key, current);
    const cacheKey = `${partner.code}:${partner.campaignId}:${key}:${range.from}:${range.to.slice(0, 10)}`;
    const cached = cache.get(cacheKey);
    if (cached && current.getTime() >= cached.time && current.getTime() - cached.time < CACHE_TTL_MS) {
      return json(200, { ...cached.payload, cached: true });
    }

    try {
      const metrics = await fetchPartnerReport(partner, range, token, fetchImpl, wait);
      const payload = {
        ok: true,
        partner: { code: partner.code, name: partner.name, campaignId: partner.campaignId, landingPath: partner.landingPath, campaignUrl: partner.campaignUrl },
        range, metrics, updated: now().toISOString(), cached: false
      };
      // Bound warm-instance memory and discard expired entries. No shared CDN
      // caching is used; the local cache remains behind the same access check.
      for (const [entryKey, entry] of cache) {
        if (current.getTime() - entry.time >= CACHE_TTL_MS) cache.delete(entryKey);
      }
      cache.set(cacheKey, { time: current.getTime(), payload });
      return json(200, payload);
    } catch {
      // Never send upstream bodies, account tokens, or raw exceptions to clients.
      return json(502, { ok: false, error: "Campaign statistics are temporarily unavailable. Please try again shortly." });
    }
  };
}

exports.handler = createHandler();
exports.createHandler = createHandler;
exports.rangeDates = rangeDates;
exports.extractReportMetrics = extractReportMetrics;
