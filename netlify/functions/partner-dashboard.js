"use strict";

const { getPartner, partners } = require("../lib/partner-campaigns");
const { sessionAccess } = require("../lib/stats-auth");
const { renderDashboard } = require("../lib/partner-dashboard-page");

const headers = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store",
  "CDN-Cache-Control": "no-store",
  "Netlify-CDN-Cache-Control": "no-store",
  "Vary": "Cookie",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
};

exports.handler = async function (event) {
  if (String(event.httpMethod || "GET").toUpperCase() !== "GET") {
    return { statusCode: 405, headers: { ...headers, Allow: "GET" }, body: "Method not allowed." };
  }
  const routeCode = /^\/(t[1-9]\d*)-dashboard\/?$/.exec(event.path || "")?.[1];
  const partner = getPartner(routeCode || event.queryStringParameters?.partner);
  if (!partner) return { statusCode: 404, headers, body: "Dashboard not found." };
  const access = sessionAccess(event);
  if (access !== "admin" && access !== partner.code) {
    return {
      statusCode: 303,
      headers: { ...headers, Location: `/.netlify/functions/stats-session?return=${encodeURIComponent(partner.dashboardPath)}` },
      body: ""
    };
  }
  return { statusCode: 200, headers, body: renderDashboard(partner, { isAdmin: access === "admin", partners: Object.values(partners) }) };
};
