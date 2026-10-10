"use strict";

const { sessionAccess } = require("../lib/stats-auth");
const { renderAdminPage } = require("../lib/admin-page");

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
  if (sessionAccess(event) !== "admin") {
    return { statusCode: 303, headers: { ...headers, Location: "/.netlify/functions/stats-session?return=%2Fadmin" }, body: "" };
  }
  return { statusCode: 200, headers, body: renderAdminPage() };
};
