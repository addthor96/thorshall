"use strict";

const crypto = require("crypto");

const COOKIE_NAME = "th_stats_session";
const SESSION_SECONDS = 60 * 60 * 8;

function password() {
  return process.env.STATS_DASHBOARD_PASSWORD || process.env.DASHBOARD_PASSWORD || "";
}

function secret() {
  return process.env.STATS_SESSION_SECRET || process.env.DASHBOARD_SESSION_SECRET || "";
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function sign(value) {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}

function createSession() {
  const payload = Buffer.from(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readCookie(header, name) {
  for (const item of String(header || "").split(";")) {
    const index = item.indexOf("=");
    if (index < 0) continue;
    if (item.slice(0, index).trim() === name) {
      return decodeURIComponent(item.slice(index + 1).trim());
    }
  }
  return "";
}

function isConfigured() {
  return Boolean(password() && secret());
}

function isAuthorized(event) {
  if (!isConfigured()) return false;
  const token = readCookie(event?.headers?.cookie || event?.headers?.Cookie, COOKIE_NAME);
  const [payload, signature] = String(token).split(".");
  if (!payload || !signature || !safeEqual(sign(payload), signature)) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(decoded.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function unauthorized() {
  return {
    statusCode: 401,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "WWW-Authenticate": "StatsSession"
    },
    body: JSON.stringify({
      ok: false,
      error: "Authentication required.",
      login: "/.netlify/functions/stats-session"
    })
  };
}

module.exports = {
  COOKIE_NAME,
  SESSION_SECONDS,
  createSession,
  isAuthorized,
  isConfigured,
  password,
  safeEqual,
  unauthorized
};
