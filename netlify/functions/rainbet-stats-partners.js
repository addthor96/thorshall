"use strict";

const { fetchReport, jsonResponse, sleep } = require("../lib/rainbet-client");

const CACHE_TTL_MS = 5 * 60 * 1000;
let memoryCache = null;
let memoryCacheTime = 0;

const cacheHeaders = {
  "Cache-Control": "public, max-age=30, s-maxage=300, stale-while-revalidate=3600",
  "Netlify-CDN-Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600"
};

function cachedResponse() {
  if (!memoryCache || Date.now() - memoryCacheTime >= CACHE_TTL_MS) return null;
  return jsonResponse(200, { ...memoryCache, cached: true }, cacheHeaders);
}

exports.handler = async function () {
  const cached = cachedResponse();
  if (cached) return cached;

  const token = process.env.RAINBET_STATISTIC_TOKEN;

  if (!token) {
    return jsonResponse(500, {
      ok: false,
      error: "Missing RAINBET_STATISTIC_TOKEN"
    });
  }

  const partnersConfig = {
    mithra: {
      name: "Mithra",
      campaignId: process.env.MITHRA_CAMPAIGN_ID || "89073"
    },
    georgina: {
      name: "Georgina",
      campaignId: process.env.GEORGINA_CAMPAIGN_ID || ""
    }
  };

  let overall = null;
  const partners = {};
  const errors = [];

  // Rainbet rate-limits simultaneous report requests. Fetch them one at a time.
  try {
    overall = {
      name: "Overall",
      connected: true,
      available: true,
      ...(await fetchReport({ token }))
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`overall: ${message}`);
    overall = {
      name: "Overall",
      connected: true,
      available: false,
      error: "Statistics are temporarily unavailable."
    };
  }

  for (const [key, config] of Object.entries(partnersConfig)) {
    const campaignId = String(config.campaignId || "").trim();

    if (!campaignId) {
      partners[key] = {
        name: config.name,
        connected: false,
        available: false,
        error: "Campaign ID has not been configured."
      };
      continue;
    }

    // Keep enough space between requests to avoid Rainbet's 429 response.
    await sleep(1600);

    try {
      partners[key] = {
        name: config.name,
        connected: true,
        available: true,
        ...(await fetchReport({ token, campaignId }))
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${key}: ${message}`);
      partners[key] = {
        name: config.name,
        connected: true,
        available: false,
        error: "Statistics are temporarily unavailable."
      };
    }
  }

  const anyAvailable = Boolean(overall?.available) || Object.values(partners).some((partner) => partner.available);
  const payload = {
    ok: anyAvailable,
    available: anyAvailable,
    overall,
    partners,
    errors: errors.length ? errors : undefined,
    updated: new Date().toISOString()
  };

  if (anyAvailable) {
    memoryCache = payload;
    memoryCacheTime = Date.now();
  }

  return jsonResponse(anyAvailable ? 200 : 502, payload, anyAvailable ? cacheHeaders : {});
};
