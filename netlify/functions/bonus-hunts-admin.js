"use strict";

const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { isOwner } = require("../lib/bonus-hunts");

const headers = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
};

exports.handler = async function(event) {
  if (String(event.httpMethod || "GET").toUpperCase() !== "GET") return { statusCode: 405, headers, body: "Method not allowed" };
  if (!isOwner(event)) return { statusCode: 303, headers: { ...headers, Location: "/.netlify/functions/stats-session?return=%2Fadmin%3Fview%3Dhunts" }, body: "" };
  const candidates = [path.join(process.cwd(), "netlify/views/hunts-admin.html"), path.join(__dirname, "../views/hunts-admin.html")];
  for (const candidate of candidates) {
    try { return { statusCode: 200, headers, body: await readFile(candidate, "utf8") }; } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return { statusCode: 503, headers, body: "The hunt manager could not be loaded. Check the function bundle includes netlify/views/hunts-admin.html." };
};

