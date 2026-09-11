"use strict";

const { fetchReport, jsonResponse } = require("../lib/rainbet-client");
const CAMPAIGN_ID = "84509";
const TTL = 5 * 60 * 1000;
let cached = null;
let cachedAt = 0;
let pending = null;
const headers = { "Cache-Control": "public, max-age=30, s-maxage=300" };

exports.handler = async function () {
  if (cached && Date.now() - cachedAt < TTL) return jsonResponse(200, cached, headers);
  const token = process.env.RAINBET_STATISTIC_TOKEN;
  if (!token) return jsonResponse(503, { ok: false, error: "Statistics temporarily unavailable." });
  try {
    if (!pending) {
      pending = fetchReport({ token, campaignId: CAMPAIGN_ID }).then(report => {
        const metrics = {};
        for (const key of ["visits", "registrations", "ftd", "deposits", "wager", "ngr"]) {
          metrics[key] = typeof report[key] === "number" && Number.isFinite(report[key]) ? report[key] : null;
        }
        cached = { ok: true, campaignId: CAMPAIGN_ID, metrics, updated: new Date().toISOString() };
        cachedAt = Date.now();
        return cached;
      }).finally(() => { pending = null; });
    }
    return jsonResponse(200, await pending, headers);
  } catch (_) {
    return jsonResponse(502, { ok: false, error: "Statistics temporarily unavailable." });
  }
};
