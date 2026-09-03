"use strict";

const crypto = require("crypto");

const COOKIE_NAME = "th_stats_session";
const SESSION_SECONDS = 60 * 60 * 8;
const CREATOR_ACCESS = new Set(["manuel", "piyush", "radhika", "aditya", "arshan"]);
const VALID_ACCESS = new Set(["admin", ...CREATOR_ACCESS]);

function adminPassword() {
  return process.env.STATS_ADMIN_PASSWORD || process.env.STATS_DASHBOARD_PASSWORD || process.env.DASHBOARD_PASSWORD || "";
}

function creatorPassword(creator) {
  const access = String(creator || "").toLowerCase();
  return CREATOR_ACCESS.has(access) ? process.env[`STATS_PASSWORD_${access.toUpperCase()}`] || "" : "";
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

function createSession(access = "admin") {
  const normalized = String(access).toLowerCase();
  if (!VALID_ACCESS.has(normalized)) throw new Error("Invalid statistics access scope");
  const payload = Buffer.from(JSON.stringify({
    access: normalized,
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

function isConfigured(access = "admin") {
  const normalized = String(access).toLowerCase();
  const signingSecret = secret();
  if (signingSecret.length < 32 || !VALID_ACCESS.has(normalized)) return false;
  return Boolean(adminPassword() || creatorPassword(normalized));
}

function authenticate(supplied, requestedAccess) {
  const normalized = String(requestedAccess || "admin").toLowerCase();
  if (!isConfigured(normalized)) return "";
  const master = adminPassword();
  if (master && safeEqual(supplied, master)) return "admin";
  const individual = creatorPassword(normalized);
  if (individual && safeEqual(supplied, individual)) return normalized;
  return "";
}

function sessionAccess(event) {
  if (secret().length < 32) return "";
  const token = readCookie(event?.headers?.cookie || event?.headers?.Cookie, COOKIE_NAME);
  const [payload, signature] = String(token).split(".");
  if (!payload || !signature || !safeEqual(sign(payload), signature)) return "";
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const access = String(decoded.access || "").toLowerCase();
    if (!VALID_ACCESS.has(access) || Number(decoded.exp) <= Math.floor(Date.now() / 1000)) return "";
    return access;
  } catch {
    return "";
  }
}

function isAuthorized(event, requiredAccess = "admin") {
  const required = String(requiredAccess).toLowerCase();
  if (!VALID_ACCESS.has(required)) return false;
  const access = sessionAccess(event);
  return access === "admin" || access === required;
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
  adminPassword,
  authenticate,
  createSession,
  creatorPassword,
  isAuthorized,
  isConfigured,
  safeEqual,
  sessionAccess,
  unauthorized
};
