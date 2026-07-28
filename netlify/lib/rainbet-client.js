"use strict";

const API_URL = "https://portal.rainbetpartners.com/api/customer/v1/partner/report";
const DEFAULT_FROM = "2019-01-01T00:00:00.000Z";
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

const FIELD_MAP = {
  wager: "wager",
  deposits_sum: "deposits",
  visits_count: "visits",
  registrations_count: "registrations",
  first_deposits_count: "ftd",
  ggr: "ggr",
  ngr: "ngr",

  // Backward-compatible aliases in case Rainbet returns legacy names.
  ftd_count: "ftd",
  casino_ggr: "ggr",
  casino_ngr: "ngr"
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tomorrowUtcDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function jsonResponse(statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
    },
    body: JSON.stringify(payload)
  };
}

function cleanNumber(value) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "amount")) {
      return cleanNumber(value.amount);
    }
    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      return cleanNumber(value.value);
    }
    return null;
  }

  const normalized = typeof value === "string" ? value.replace(/,/g, "").trim() : value;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function parseNamedEntries(entries) {
  if (!Array.isArray(entries)) return null;

  const map = {};
  let matched = 0;

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const name = entry.name || entry.key || entry.column;
    if (!name || !Object.prototype.hasOwnProperty.call(FIELD_MAP, name)) continue;

    map[name] = cleanNumber(
      Object.prototype.hasOwnProperty.call(entry, "value") ? entry.value : entry.amount
    );
    matched += 1;
  }

  return matched ? map : null;
}

function parseMetricObject(object) {
  if (!object || typeof object !== "object" || Array.isArray(object)) return null;

  const map = {};
  let matched = 0;

  for (const field of Object.keys(FIELD_MAP)) {
    if (!Object.prototype.hasOwnProperty.call(object, field)) continue;
    map[field] = cleanNumber(object[field]);
    matched += 1;
  }

  return matched ? map : null;
}

function parseCandidate(candidate) {
  if (!candidate) return null;

  if (Array.isArray(candidate)) {
    const named = parseNamedEntries(candidate);
    if (named) return named;

    if (candidate.length === 1) return parseCandidate(candidate[0]);

    for (const item of candidate) {
      const direct = parseMetricObject(item);
      if (direct && Object.keys(direct).length >= 4) return direct;
    }

    return null;
  }

  return parseMetricObject(candidate);
}

function findMetricsRecursively(value, depth = 0, seen = new Set()) {
  if (!value || typeof value !== "object" || depth > 7 || seen.has(value)) return null;
  seen.add(value);

  const direct = parseCandidate(value);
  if (direct && Object.keys(direct).length >= 4) return direct;

  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) {
    const result = findMetricsRecursively(child, depth + 1, seen);
    if (result) return result;
  }

  return null;
}

function extractMetrics(data) {
  const candidates = [
    data?.totals?.data?.[0],
    data?.rows?.totals?.data?.[0],
    data?.data?.totals?.data?.[0],
    data?.result?.totals?.data?.[0],
    data?.totals?.data,
    data?.rows?.totals?.data,
    data?.data?.totals?.data,
    data?.result?.totals?.data,
    data?.totals,
    data?.summary,
    data?.data?.summary
  ];

  let raw = null;
  for (const candidate of candidates) {
    raw = parseCandidate(candidate);
    if (raw && Object.keys(raw).length >= 4) break;
    raw = null;
  }

  if (!raw) raw = findMetricsRecursively(data);

  const coreFields = ["wager", "deposits_sum", "visits_count", "registrations_count"];
  if (!raw || !coreFields.every((field) => Object.prototype.hasOwnProperty.call(raw, field))) {
    throw new Error("Rainbet returned a response, but the expected totals were not found.");
  }

  const metrics = {
    wager: null,
    deposits: null,
    visits: null,
    registrations: null,
    ftd: null,
    ggr: null,
    ngr: null
  };

  for (const [source, destination] of Object.entries(FIELD_MAP)) {
    if (!Object.prototype.hasOwnProperty.call(raw, source)) continue;
    // Prefer the documented field names; aliases only fill an empty value.
    if (metrics[destination] === null || ["wager", "deposits_sum", "visits_count", "registrations_count", "first_deposits_count", "ggr", "ngr"].includes(source)) {
      metrics[destination] = raw[source];
    }
  }

  return metrics;
}

function authCandidates(token) {
  const cleaned = String(token || "").trim();
  if (!cleaned) return [];
  if (/^(Bearer|Token)\s+/i.test(cleaned)) return [cleaned];
  return [cleaned, `Bearer ${cleaned}`];
}

async function requestOnce(url, authorization, timeoutMs) {
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
        const error = new Error(`Rainbet returned an unreadable response (${response.status}).`);
        error.status = response.status;
        throw error;
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

function retryDelay(response, attempt) {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 10000);

    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.min(Math.max(date - Date.now(), 0), 10000);
  }

  return 1400 * (attempt + 1);
}

async function requestWithRateLimitRetry(url, authorization, timeoutMs) {
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const result = await requestOnce(url, authorization, timeoutMs);

    if (result.response.status !== 429 || attempt === maxRetries) {
      return result;
    }

    await sleep(retryDelay(result.response, attempt));
  }

  throw new Error("Rainbet API request failed.");
}

async function fetchReport({ token, campaignId = null, timeoutMs = 15000 }) {
  const candidates = authCandidates(token);
  if (!candidates.length) throw new Error("Missing RAINBET_STATISTIC_TOKEN");

  const params = new URLSearchParams({
    async: "false",
    from: DEFAULT_FROM,
    to: tomorrowUtcDate(),
    exchange_rates_date: DEFAULT_EXCHANGE_DATE,
    conversion_currency: "USD"
  });

  DEFAULT_COLUMNS.forEach((column) => params.append("columns[]", column));
  if (campaignId !== null && campaignId !== undefined && String(campaignId).trim()) {
    params.append("campaign_ids[]", String(campaignId).trim());
  }

  const url = `${API_URL}?${params.toString()}`;

  for (let index = 0; index < candidates.length; index += 1) {
    const authorization = candidates[index];
    const { response, data } = await requestWithRateLimitRetry(url, authorization, timeoutMs);

    if (response.ok) {
      return extractMetrics(data);
    }

    const message =
      data?.message ||
      data?.error ||
      data?.errors?.[0]?.message ||
      `Rainbet API request failed with status ${response.status}.`;

    const error = new Error(String(message));
    error.status = response.status;

    // Only try the alternate Authorization format for an actual auth failure.
    if ([401, 403].includes(response.status) && index < candidates.length - 1) {
      continue;
    }

    throw error;
  }

  throw new Error("Rainbet API authentication failed.");
}

module.exports = {
  extractMetrics,
  fetchReport,
  jsonResponse,
  sleep
};
