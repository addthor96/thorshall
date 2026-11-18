"use strict";

const { sessionAccess } = require("./stats-auth");
const { GiveawayError, readLedger, responseLedger, validateInput, writeEntry } = require("./giveaway-store");
const MAX_BODY_BYTES = 32 * 1024;
const HEADERS = {
  "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store, max-age=0",
  "CDN-Cache-Control": "no-store", "Netlify-CDN-Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer", Vary: "Cookie"
};
function json(statusCode, payload, extra = {}) { return { statusCode, headers: { ...HEADERS, ...extra }, body: JSON.stringify(payload) }; }
function header(event, name) { return Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === name)?.[1] || ""; }
function authorize(event, accessFor = sessionAccess) {
  let access = ""; try { access = accessFor(event); } catch { /* Invalid sessions fail closed. */ }
  if (!access) return json(401, { ok: false, error: "Sign in to the admin hub." }, { "WWW-Authenticate": "StatsSession" });
  if (access !== "admin") return json(403, { ok: false, error: "Only the site owner can access giveaway records." });
  return null;
}
function parseBody(event) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(header(event, "content-type"))) throw new GiveawayError(415, "Use JSON for giveaway updates.");
  if (typeof event.body !== "string" || event.body.length > MAX_BODY_BYTES * 2) throw new GiveawayError(413, "Giveaway update is too large.");
  const body = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new GiveawayError(413, "Giveaway update is too large.");
  try { return JSON.parse(body); } catch { throw new GiveawayError(400, "Invalid giveaway request."); }
}
function requireSameOrigin(event) {
  try {
    const url = new URL(event.rawUrl), origin = header(event, "origin"), host = header(event, "host"), fetchSite = header(event, "sec-fetch-site");
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || origin !== url.origin || (host && host.toLowerCase() !== url.host.toLowerCase())
        || (fetchSite && fetchSite !== "same-origin") || header(event, "x-thorshall-request") !== "giveaways") throw new Error();
  } catch { throw new GiveawayError(403, "Open the admin hub on this site before saving a giveaway."); }
}
function createHandler({ accessFor = sessionAccess, connectStore, now = () => new Date(), logDiagnostic = record => console.error(JSON.stringify(record)) } = {}) {
  return async function handler(event = {}) {
    const denial = authorize(event, accessFor); if (denial) return denial;
    const method = event.httpMethod;
    if (!["GET", "POST", "PATCH"].includes(method)) return json(405, { ok: false, error: "Method not allowed." }, { Allow: "GET, POST, PATCH" });
    if (Object.keys(event.queryStringParameters || {}).length) return json(400, { ok: false, error: "Unsupported giveaway parameter." });
    let stage = "validation";
    try {
      let operation;
      if (method !== "GET") { requireSameOrigin(event); operation = validateInput(parseBody(event), method); }
      stage = "connect";
      if (typeof connectStore !== "function") throw new Error("Giveaway storage provider unavailable");
      const store = await connectStore(event);
      if (method === "GET") { stage = "read"; const { ledger } = await readLedger(store); return json(200, { ok: true, ...responseLedger(ledger) }); }
      stage = "write";
      const result = await writeEntry(store, operation, now());
      return json(method === "POST" && !result.duplicate ? 201 : 200, { ok: true, ...responseLedger(result.ledger), duplicate: result.duplicate });
    } catch (error) {
      if (error instanceof GiveawayError) return json(error.status, { ok: false, error: error.message });
      try { logDiagnostic({ event: "giveaway_storage_failure", stage }); } catch { /* Logging cannot affect the response. */ }
      return json(503, { ok: false, error: "Giveaway records are temporarily unavailable. If a save failed, retry the same save before adding another giveaway." });
    }
  };
}
module.exports = { HEADERS, MAX_BODY_BYTES, authorize, createHandler };
