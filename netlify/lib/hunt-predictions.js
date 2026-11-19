"use strict";

const crypto = require("node:crypto");
const hunts = require("./bonus-hunts");
const Core = require("../../hunt-shared");
const { cutoffFor, collecting, timestamp } = require("./hunt-prediction-windows");
const COOKIE_NAME = "thorshall_prediction_id";
const MAX_BODY_BYTES = 4096;
const MAX_ENTRIES = 2000;
const MAX_LEDGER_BYTES = 1024 * 1024;
const MAX_IP_ENTRIES = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const HASH = /^[a-f0-9]{64}$/;
const HEADERS = {
  "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store, max-age=0",
  "CDN-Cache-Control": "no-store", "Netlify-CDN-Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive", "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer", Vary: "Cookie"
};
class PredictionError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function json(statusCode, value, headers = {}) { return { statusCode, headers: { ...HEADERS, ...headers }, body: JSON.stringify(value) }; }
function header(event, name) { return Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === name)?.[1] || ""; }
function hmac(secret, value) { return crypto.createHmac("sha256", secret).update(value).digest("hex"); }
function signingSecret() { return process.env.STATS_SESSION_SECRET || process.env.DASHBOARD_SESSION_SECRET || ""; }
function urlFor(event) {
  try {
    const url = new URL(event.rawUrl), host = header(event, "host");
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || (host && host.toLowerCase() !== url.host.toLowerCase())) throw new Error();
    return url;
  } catch { throw new PredictionError(403, "Open predictions on the Thor’s Hall hunt page."); }
}
function storeName(event) {
  const url = urlFor(event);
  if (url.origin === "https://thorshall.gg" && event.deployContext === "production" && event.published === true) return "thorshall-hunt-predictions-v1";
  const context = String(event.deployContext || "unverified").toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 20);
  return "thorshall-hunt-predictions-v1-preview-" + context + "-" + crypto.createHash("sha256").update(url.origin).digest("hex").slice(0, 10);
}
function ledgerKey(huntId) { return "hunt-" + huntId; }
function sameOrigin(event) {
  const url = urlFor(event), site = header(event, "sec-fetch-site");
  if (header(event, "origin") !== url.origin || (site && site !== "same-origin") || header(event, "x-thorshall-request") !== "hunt-prediction") {
    throw new PredictionError(403, "Submit your prediction from this hunt page.");
  }
}
function identity(event, secret) {
  const cookie = String(header(event, "cookie")).split(";").map(item => item.trim()).find(item => item.startsWith(COOKIE_NAME + "="));
  let value = cookie ? cookie.slice(COOKIE_NAME.length + 1) : "";
  const match = /^([A-Za-z0-9_-]{43})\.([a-f0-9]{64})$/.exec(value);
  let valid = false;
  if (match) {
    const expected = hmac(secret, "prediction-cookie-v1:" + match[1]);
    valid = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(match[2]));
  }
  const id = valid ? match[1] : crypto.randomBytes(32).toString("base64url");
  if (!valid) value = id + "." + hmac(secret, "prediction-cookie-v1:" + id);
  const secure = urlFor(event).protocol === "https:" ? "; Secure" : "";
  return { hash: hmac(secret, "prediction-browser-v1:" + id), valid,
    cookie: valid ? null : COOKIE_NAME + "=" + value + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=7776000" + secure };
}
function parseAmount(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value)) throw new PredictionError(400, "Enter an end balance using no more than two decimal places.");
  const [whole, decimal = ""] = value.split(".");
  const minor = BigInt(whole) * 100n + BigInt(decimal.padEnd(2, "0"));
  if (minor > 100000000000n) throw new PredictionError(400, "The prediction must be between 0 and 1,000,000,000.");
  return Number(minor);
}
function parseBody(event) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(header(event, "content-type"))) throw new PredictionError(415, "Submit predictions as JSON.");
  if (typeof event.body !== "string" || event.body.length > MAX_BODY_BYTES * 2) throw new PredictionError(413, "This prediction is too large.");
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new PredictionError(413, "This prediction is too large.");
  let body; try { body = JSON.parse(raw); } catch { throw new PredictionError(400, "Send a valid prediction."); }
  const allowed = ["huntId", "requestId", "username", "amount", "website"];
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) throw new PredictionError(400, "Unsupported prediction fields.");
  if (body.website !== "") throw new PredictionError(400, "This prediction could not be accepted.");
  if (typeof body.huntId !== "string" || !ID.test(body.huntId) || typeof body.requestId !== "string" || !UUID.test(body.requestId)) throw new PredictionError(400, "Refresh this hunt page before predicting.");
  if (typeof body.username !== "string" || !/^[A-Za-z0-9_]{3,25}$/.test(body.username)) throw new PredictionError(400, "Use your Twitch username: 3–25 letters, numbers or underscores.");
  return { huntId: body.huntId, requestId: body.requestId.toLowerCase(), username: body.username,
    nameKey: body.username.toLowerCase(), amountMinor: parseAmount(body.amount) };
}
function emptyLedger(hunt) { return { schema: 1, huntId: hunt.id, currency: hunt.currency, entries: [] }; }
function validateLedger(value, huntId) {
  if (!value || typeof value !== "object" || value.schema !== 1 || value.huntId !== huntId || !["USD", "EUR", "GBP", "CAD", "AUD"].includes(value.currency)
      || !Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES || Buffer.byteLength(JSON.stringify(value)) > MAX_LEDGER_BYTES) throw new Error("Invalid prediction ledger");
  const requestIds = new Set(), browsers = new Set(), names = new Set();
  for (const entry of value.entries) {
    if (!entry || typeof entry !== "object" || !UUID.test(entry.requestId) || !HASH.test(entry.identityHash) || !HASH.test(entry.ipHash)
        || typeof entry.username !== "string" || !/^[A-Za-z0-9_]{3,25}$/.test(entry.username) || entry.nameKey !== entry.username.toLowerCase()
        || !Number.isSafeInteger(entry.amountMinor) || entry.amountMinor < 0 || entry.amountMinor > 100000000000 || !timestamp(entry.createdAt)
        || requestIds.has(entry.requestId) || browsers.has(entry.identityHash) || names.has(entry.nameKey)) throw new Error("Invalid prediction record");
    requestIds.add(entry.requestId); browsers.add(entry.identityHash); names.add(entry.nameKey);
  }
  return value;
}
async function readLedger(store, hunt) {
  const entry = await store.getWithMetadata(ledgerKey(hunt.id), { type: "json", consistency: "strong" });
  if (entry === null) return { ledger: emptyLedger(hunt), etag: null };
  if (!entry || typeof entry.etag !== "string" || !entry.etag) throw new Error("Invalid prediction storage revision");
  return { ledger: validateLedger(entry.data, hunt.id), etag: entry.etag };
}
async function readHunt(store, huntId, event) {
  const entry = await store.getWithMetadata(hunts.KEY, { type: "json", consistency: "strong" });
  if (!entry?.data?.state || !Array.isArray(entry.data.state.hunts)) throw new PredictionError(404, "No hunt is available for predictions yet.");
  const record = entry.data, state = record.state;
  if (state.settings?.public !== true && !hunts.isOwner(event)) throw new PredictionError(403, "This hunt page is private.");
  const hunt = state.hunts.find(item => item.id === huntId && (item.id === state.activeId || item.status === "complete"));
  if (!hunt) throw new PredictionError(404, "This hunt is not available for predictions.");
  return { record, hunt };
}
function eligibleEntries(ledger, record, hunt) {
  if (ledger.currency !== hunt.currency) return [];
  const cutoff = cutoffFor(record, hunt.id);
  return ledger.entries.filter(entry => !cutoff || entry.createdAt < cutoff);
}
function finalBalanceMinor(hunt) {
  // Rank against the balance viewers actually see. The tracker already has an
  // established calculation/Intl rounding path; do not silently replace it.
  const balance = Core.calculate(hunt).endBalance;
  const parts = new Intl.NumberFormat("en-US", { style: "currency", currency: hunt.currency || "USD", maximumFractionDigits: 2 }).formatToParts(balance);
  const whole = parts.filter(part => part.type === "integer").map(part => part.value).join("");
  const fraction = (parts.find(part => part.type === "fraction")?.value || "").padEnd(2, "0");
  const minor = Number(BigInt(whole) * 100n + BigInt(fraction));
  if (!Number.isSafeInteger(minor)) throw new Error("Invalid final balance");
  return minor;
}
function accepting(record, hunt, ledger) {
  return record.state.settings?.public === true && record.state.activeId === hunt.id && collecting(hunt)
    && !cutoffFor(record, hunt.id) && ledger.currency === hunt.currency;
}
function summary(ledger, record, hunt, identityHash) {
  const entries = eligibleEntries(ledger, record, hunt), own = entries.find(entry => entry.identityHash === identityHash);
  let podium = [];
  if (hunt.status === "complete") {
    const end = finalBalanceMinor(hunt);
    podium = entries.map((entry, order) => ({ ...entry, order, differenceMinor: Math.abs(entry.amountMinor - end) }))
      .sort((a, b) => a.differenceMinor - b.differenceMinor || a.createdAt.localeCompare(b.createdAt) || a.order - b.order)
      .slice(0, 3).map((entry, index) => ({ place: index + 1, username: entry.username, amountMinor: entry.amountMinor, differenceMinor: entry.differenceMinor }));
  }
  return { ok: true, huntId: hunt.id, currency: hunt.currency, status: hunt.status,
    accepting: accepting(record, hunt, ledger), count: entries.length,
    mine: own ? { username: own.username, amountMinor: own.amountMinor, createdAt: own.createdAt } : null, podium,
    ...(ledger.currency !== hunt.currency ? { message: "The hunt currency changed. Earlier predictions cannot be ranked for this currency." } : {}) };
}
function matchingRetry(entry, operation, identityHash) {
  return entry.requestId === operation.requestId && entry.identityHash === identityHash && entry.username === operation.username && entry.amountMinor === operation.amountMinor;
}
function createHandler({ connectHunts, connectPredictions, now = () => new Date(), secretFor = signingSecret,
  logDiagnostic = value => console.error(JSON.stringify(value)) } = {}) {
  return async function handler(event = {}) {
    const method = String(event.httpMethod || "GET").toUpperCase();
    if (!["GET", "POST"].includes(method)) return json(405, { ok: false, error: "Method not allowed." }, { Allow: "GET, POST" });
    let extra = {}, stage = "validation";
    try {
      const at = now(); if (!timestamp(at.toISOString())) throw new Error("Invalid prediction clock");
      const secret = secretFor(); if (typeof secret !== "string" || secret.length < 32) throw new Error("Prediction signing is unavailable");
      const browser = identity(event, secret);
      if (browser.cookie) extra["Set-Cookie"] = browser.cookie;
      let operation, huntId;
      const query = event.queryStringParameters || {};
      if (method === "POST") {
        sameOrigin(event); if (Object.keys(query).length) throw new PredictionError(400, "Unsupported prediction parameter.");
        operation = parseBody(event); huntId = operation.huntId;
        if (!browser.valid) throw new PredictionError(403, "Refresh the hunt page before saving your prediction.");
      } else {
        if (Object.keys(query).length !== 1 || typeof query.hunt !== "string" || !ID.test(query.hunt)) throw new PredictionError(400, "Choose a valid hunt.");
        huntId = query.hunt;
      }
      stage = "connect";
      if (typeof connectHunts !== "function" || typeof connectPredictions !== "function") throw new Error("Prediction storage is unavailable");
      const huntStore = await connectHunts(event), predictionStore = await connectPredictions(event);
      stage = "read";
      const current = await readHunt(huntStore, huntId, event);
      let { ledger, etag } = await readLedger(predictionStore, current.hunt);
      if (method === "GET") return json(200, summary(ledger, current.record, current.hunt, browser.hash), extra);
      const priorRequest = ledger.entries.find(entry => entry.requestId === operation.requestId);
      if (priorRequest) {
        if (!matchingRetry(priorRequest, operation, browser.hash)) throw new PredictionError(409, "This request was already used. Refresh the hunt page.");
        if (!eligibleEntries(ledger, current.record, current.hunt).includes(priorRequest)) throw new PredictionError(409, "Predictions closed before this entry was accepted.");
        return json(200, { ...summary(ledger, current.record, current.hunt, browser.hash), duplicate: true }, extra);
      }
      if (!accepting(current.record, current.hunt, ledger)) throw new PredictionError(409, "Predictions are closed for this hunt.");
      const ip = typeof event.clientIp === "string" && event.clientIp.length < 100 ? event.clientIp : "unavailable";
      const ipHash = hmac(secret, "prediction-ip-v1:" + at.toISOString().slice(0, 10) + ":" + ip);
      const candidate = { ...operation, identityHash: browser.hash, ipHash, createdAt: at.toISOString() };
      delete candidate.huntId;
      let duplicate = false;
      stage = "write";
      for (let attempt = 0; attempt < 8; attempt++) {
        const prior = ledger.entries.find(entry => entry.requestId === operation.requestId);
        if (prior) {
          if (!matchingRetry(prior, operation, browser.hash)) throw new PredictionError(409, "This request was already used. Refresh the hunt page.");
          duplicate = true; break;
        }
        if (ledger.currency !== current.hunt.currency) throw new PredictionError(409, "The hunt currency changed. Refresh the hunt page.");
        if (ledger.entries.some(entry => entry.identityHash === browser.hash)) throw new PredictionError(409, "This browser already has a prediction for this hunt.");
        if (ledger.entries.some(entry => entry.nameKey === operation.nameKey)) throw new PredictionError(409, "That Twitch username already has a prediction for this hunt.");
        if (ledger.entries.filter(entry => entry.ipHash === ipHash).length >= MAX_IP_ENTRIES) throw new PredictionError(429, "Too many predictions from this connection. Try the next hunt.");
        if (ledger.entries.length >= MAX_ENTRIES) throw new PredictionError(429, "This hunt has reached its prediction limit.");
        const next = { ...ledger, entries: [...ledger.entries, candidate] };
        if (Buffer.byteLength(JSON.stringify(next)) > MAX_LEDGER_BYTES) throw new PredictionError(429, "This hunt has reached its prediction limit.");
        const result = await predictionStore.setJSON(ledgerKey(huntId), next, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
        if (result?.modified === true && typeof result.etag === "string" && result.etag) { ledger = next; break; }
        if (result?.modified !== false) throw new Error("Prediction save was not confirmed");
        if (attempt === 7) throw new PredictionError(409, "Other predictions are being saved. Retry the same prediction shortly.");
        ({ ledger, etag } = await readLedger(predictionStore, current.hunt));
      }
      stage = "confirm";
      const confirmed = await readLedger(predictionStore, current.hunt);
      const after = await readHunt(huntStore, huntId, event);
      const saved = confirmed.ledger.entries.find(entry => entry.requestId === operation.requestId);
      if (!saved || !matchingRetry(saved, operation, browser.hash)) throw new Error("Prediction save could not be confirmed");
      if (!eligibleEntries(confirmed.ledger, after.record, after.hunt).some(entry => entry.requestId === saved.requestId)) throw new PredictionError(409, "Predictions closed before this entry was accepted.");
      return json(duplicate ? 200 : 201, { ...summary(confirmed.ledger, after.record, after.hunt, browser.hash), duplicate }, extra);
    } catch (error) {
      if (error instanceof PredictionError) return json(error.status, { ok: false, error: error.message }, extra);
      try { logDiagnostic({ event: "hunt_prediction_failure", stage }); } catch { /* Logs never change a response. */ }
      return json(503, { ok: false, error: "Predictions are temporarily unavailable. Retry the same prediction shortly." }, extra);
    }
  };
}

module.exports = { createHandler, storeName, ledgerKey, HEADERS, MAX_BODY_BYTES, MAX_ENTRIES, MAX_IP_ENTRIES,
  COOKIE_NAME, PredictionError, parseAmount, validateLedger, eligibleEntries, finalBalanceMinor, summary };
