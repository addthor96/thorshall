"use strict";

const { fetchReport, jsonResponse } = require("../lib/rainbet-client");

exports.handler = async function () {
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

  const jobs = [
    ["overall", { name: "Overall", campaignId: null }],
    ...Object.entries(partnersConfig).filter(([, config]) => String(config.campaignId || "").trim())
  ];

  const results = await Promise.allSettled(
    jobs.map(([, config]) =>
      fetchReport({
        token,
        campaignId: config.campaignId
      })
    )
  );

  let overall = null;
  const partners = {};
  const errors = [];

  jobs.forEach(([key, config], index) => {
    const result = results[index];

    if (result.status === "fulfilled") {
      const payload = {
        name: config.name,
        connected: true,
        available: true,
        ...result.value
      };

      if (key === "overall") overall = payload;
      else partners[key] = payload;
      return;
    }

    const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
    errors.push(`${key}: ${message}`);

    const payload = {
      name: config.name,
      connected: true,
      available: false,
      error: "Statistics are temporarily unavailable."
    };

    if (key === "overall") overall = payload;
    else partners[key] = payload;
  });

  for (const [key, config] of Object.entries(partnersConfig)) {
    if (partners[key]) continue;

    partners[key] = {
      name: config.name,
      connected: false,
      available: false,
      error: "Campaign ID has not been configured."
    };
  }

  const anyAvailable = Boolean(overall?.available) || Object.values(partners).some((partner) => partner.available);

  return jsonResponse(anyAvailable ? 200 : 502, {
    ok: anyAvailable,
    available: anyAvailable,
    overall,
    partners,
    errors: errors.length ? errors : undefined,
    updated: new Date().toISOString()
  });
};
