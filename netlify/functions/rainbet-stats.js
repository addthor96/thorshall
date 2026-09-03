"use strict";

const { fetchReport, jsonResponse } = require("../lib/rainbet-client");
const { isAuthorized, unauthorized } = require("../lib/stats-auth");

exports.handler = async function (event) {
  if (!isAuthorized(event, "admin")) return unauthorized();
  const token = process.env.RAINBET_STATISTIC_TOKEN;

  if (!token) {
    return jsonResponse(500, {
      ok: false,
      error: "Missing RAINBET_STATISTIC_TOKEN"
    });
  }

  try {
    const metrics = await fetchReport({ token });

    return jsonResponse(200, {
      ok: true,
      available: true,
      ...metrics,
      updated: new Date().toISOString()
    });
  } catch (error) {
    return jsonResponse(502, {
      ok: false,
      available: false,
      error: "Rainbet statistics are temporarily unavailable.",
      updated: new Date().toISOString()
    });
  }
};
