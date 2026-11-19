"use strict";

const crypto = require("node:crypto");
const { sessionAccess, safeEqual } = require("./stats-auth");
const { updatePredictionWindows, cutoffFor, windowFor, MAX_CYCLES } = require("./hunt-prediction-windows");
const KEY = "hunt-manager";
const MAX_BODY_BYTES = 1500000;
const CURRENCIES = new Set(["USD", "EUR", "GBP", "CAD", "AUD"]);
const STATUSES = new Set(["collecting", "opening", "complete"]);

class InputError extends Error {}

function isOwner(event) {
  try { return sessionAccess(event) === "admin"; } catch { return false; }
}

function json(statusCode, value) {
  return { statusCode, headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store, max-age=0",
    "CDN-Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Cookie, Authorization"
  }, body: JSON.stringify(value) };
}

function object(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputError(`${label} must be an object.`);
  if (Object.keys(value).some(key => !keys.includes(key))) throw new InputError(`${label} has an unsupported field.`);
}

function text(value, max, label, allowEmpty = false) {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new InputError(`${label} is invalid.`);
  }
  return value.trim();
}

function id(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) throw new InputError(`${label} is invalid.`);
  return value;
}

function amount(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1000000000) throw new InputError(`${label} must be between 0 and 1,000,000,000.`);
  return Math.round(value * 1000000) / 1000000;
}

function validateState(value) {
  object(value, ["schema", "activeId", "hunts", "settings"], "Hunt manager");
  if (value.schema !== 2) throw new InputError("Unsupported hunt format.");
  object(value.settings, ["public"], "Settings");
  if (typeof value.settings.public !== "boolean") throw new InputError("Visibility must be true or false.");
  if (!Array.isArray(value.hunts) || value.hunts.length < 1 || value.hunts.length > 50) throw new InputError("Keep between 1 and 50 hunts.");
  const huntIds = new Set();
  const hunts = value.hunts.map(hunt => {
    object(hunt, ["id", "title", "date", "currency", "start", "balance", "status", "rows"], "Hunt");
    const huntId = id(hunt.id, "Hunt ID");
    if (huntIds.has(huntId)) throw new InputError("Hunt IDs must be unique.");
    huntIds.add(huntId);
    if (!CURRENCIES.has(hunt.currency)) throw new InputError("Choose a supported currency.");
    if (!STATUSES.has(hunt.status)) throw new InputError("Choose a supported hunt status.");
    if (typeof hunt.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(hunt.date) || Number.isNaN(Date.parse(hunt.date + "T00:00:00Z"))) throw new InputError("Choose a valid date.");
    if (!Array.isArray(hunt.rows) || hunt.rows.length > 150) throw new InputError("A hunt supports up to 150 bonuses.");
    const rowIds = new Set();
    return {
      id: huntId,
      title: text(hunt.title, 80, "Hunt title"),
      date: hunt.date,
      currency: hunt.currency,
      start: amount(hunt.start, "Starting balance"),
      balance: amount(hunt.balance, "Remaining cash balance"),
      status: hunt.status,
      rows: hunt.rows.map(row => {
        object(row, ["id", "slot", "provider", "bet", "payout"], "Bonus");
        const rowId = id(row.id, "Bonus ID");
        if (rowIds.has(rowId)) throw new InputError("Bonus IDs must be unique within a hunt.");
        rowIds.add(rowId);
        return { id: rowId, slot: text(row.slot, 100, "Slot name", true), provider: text(row.provider, 80, "Provider", true), bet: amount(row.bet, "Bet"), payout: row.payout === null ? null : amount(row.payout, "Payout") };
      })
    };
  });
  const activeId = id(value.activeId, "Active hunt ID");
  if (!huntIds.has(activeId)) throw new InputError("Choose an active hunt that exists.");
  return { schema: 2, activeId, hunts, settings: { public: value.settings.public } };
}

function initialState() {
  const activeId = crypto.randomUUID();
  return { schema: 2, activeId, hunts: [{ id: activeId, title: "Hunt #1", date: new Date().toISOString().slice(0, 10), currency: "USD", start: 0, balance: 0, status: "collecting", rows: [] }], settings: { public: true } };
}

function header(event, name) {
  const key = Object.keys(event.headers || {}).find(key => key.toLowerCase() === name.toLowerCase());
  return key ? event.headers[key] : "";
}

function validWrite(event) {
  if (header(event, "x-thorshall-request") !== "bonus-hunts") return false;
  if (!/^application\/json(?:\s*;|$)/i.test(header(event, "content-type"))) return false;
  if (header(event, "sec-fetch-site") === "cross-site") return false;
  const origin = header(event, "origin");
  if (!origin) return true;
  try {
    const host = header(event, "x-forwarded-host") || header(event, "host");
    const parsed = new URL(origin);
    return /^(https?:)$/.test(parsed.protocol) && parsed.host === host && parsed.origin === origin;
  } catch { return false; }
}

function parseBody(event) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : String(event.body || "");
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) throw new InputError("This hunt collection is too large.");
  try { return JSON.parse(raw); } catch { throw new InputError("Send valid JSON."); }
}

function validStreamToken(event, record) {
  const auth = String(header(event, "authorization"));
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(auth);
  return Boolean(match && record && safeEqual(match[1], record.streamToken));
}

function displayState(state, mode) {
  return {
    schema: state.schema,
    activeId: state.activeId,
    hunts: state.hunts.filter(hunt => hunt.id === state.activeId || (mode === "viewer" && hunt.status === "complete")),
    settings: { public: state.settings.public }
  };
}

function predictionWindows(record, state = record.state) {
  return Object.fromEntries(state.hunts.map(hunt => {
    const closedAt = cutoffFor(record, hunt.id);
    const active = state.activeId === hunt.id, retired = Object.prototype.hasOwnProperty.call(record.predictionPermanentlyClosed || {}, hunt.id);
    return [hunt.id, { closedAt, windowId: windowFor(record, hunt.id).id, accepting: state.settings.public === true && active && hunt.status === "collecting" && !closedAt,
      reopenable: active && hunt.status === "opening" && !retired && (record.predictionWindowHistory?.[hunt.id]?.length || 1) < MAX_CYCLES }];
  }));
}

function storeName(event) {
  let context = event?.deployContext || process.env.CONTEXT || "production";
  if (context === "production" && event?.published === false) context = "production-preview";
  const suffix = context === "production" ? "" : `-${context.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0,30)}`;
  return `thorshall-bonus-hunts-v2${suffix}`;
}

async function openStore(event) {
  const { getStore } = require("@netlify/blobs");
  return getStore({ name: storeName(event), consistency: "strong" });
}

function createHandler(storeFactory = openStore, { now = () => new Date() } = {}) {
  return async function handler(event) {
    const method = String(event.httpMethod || "GET").toUpperCase();
    const mode = event.queryStringParameters?.mode || "viewer";
    const owner = isOwner(event);
    const mutation = method === "PUT" || method === "POST";
    if (!["GET", "PUT", "POST"].includes(method)) return json(405, { ok: false, error: "Method not allowed." });
    if ((mutation || mode === "admin") && !owner) return json(401, { ok: false, error: "Owner sign-in required.", login: "/.netlify/functions/stats-session?return=/admin" });
    if (mutation && !validWrite(event)) return json(403, { ok: false, error: "This request must come from the hunt manager." });
    if (!mutation && !["admin", "viewer", "overlay"].includes(mode)) return json(400, { ok: false, error: "Unknown view." });
    try {
      const store = await storeFactory(event);
      let entry = await store.getWithMetadata(KEY, { type: "json", consistency: "strong" });
      if (!entry && owner && method === "GET" && mode === "admin") {
        const created = { state: initialState(), streamToken: crypto.randomBytes(32).toString("base64url") };
        const result = await store.setJSON(KEY, created, { onlyIfNew: true });
        if (result.modified && !result.etag) throw new Error("Storage did not confirm initialization");
        entry = await store.getWithMetadata(KEY, { type: "json", consistency: "strong" });
      }
      if (!entry && method === "GET" && mode === "viewer") {
        // A newly published page has a useful empty display before its first
        // owner visit. Anonymous viewers never create or modify stored hunts.
        const state = initialState();
        return json(200, { ok: true, state, revision: "empty", predictionWindows: predictionWindows({ state }) });
      }
      if (!entry) return json(404, { ok: false, error: "No hunt has been saved yet." });
      const record = entry.data;
      if (!record || !record.state || typeof record.streamToken !== "string") throw new Error("Stored hunt document is invalid");
      if (!mutation) {
        if (mode === "overlay" && !validStreamToken(event, record)) return json(401, { ok: false, error: "Stream link is missing or has been replaced." });
        if (mode === "viewer" && !owner && record.state.settings.public !== true) return json(403, { ok: false, error: "This hunt page is private." });
        const state = mode === "admin" ? record.state : displayState(record.state, mode);
        return json(200, { ok: true, state, revision: entry.etag, ...(mode !== "overlay" ? { predictionWindows: predictionWindows(record, state) } : {}), ...(mode === "admin" ? { streamToken: record.streamToken } : {}) });
      }
      const body = parseBody(event);
      object(body, method === "PUT" ? ["state", "revision"] : ["action", "revision", "huntId"], "Request");
      if (typeof body.revision !== "string" || body.revision !== entry.etag) return json(409, { ok: false, error: "The saved hunt changed. Reload before saving again.", revision: entry.etag });
      let next;
      if (method === "PUT") next = { state: validateState(body.state), streamToken: record.streamToken };
      else {
        if (body.action === "close-predictions") {
          const huntId = id(body.huntId, "Hunt ID");
          if (!record.state.hunts.some(hunt => hunt.id === huntId)) throw new InputError("Choose a saved hunt before closing predictions.");
          next = { state: record.state, streamToken: record.streamToken };
        } else if (["start-opening", "back-to-hunting"].includes(body.action)) {
          const huntId = id(body.huntId, "Hunt ID"), hunt = record.state.hunts.find(item => item.id === huntId);
          if (!hunt || record.state.activeId !== huntId) throw new InputError("Choose the active saved hunt before changing its phase.");
          if (body.action === "start-opening" && hunt.status !== "collecting") throw new InputError("This hunt is already opening or finished.");
          if (body.action === "back-to-hunting" && (hunt.status !== "opening" || Object.prototype.hasOwnProperty.call(record.predictionPermanentlyClosed || {}, huntId)
              || (record.predictionWindowHistory?.[huntId]?.length || 1) >= MAX_CYCLES)) throw new InputError("Only the current unfinished hunt can return to hunting.");
          const state = { ...record.state, hunts: record.state.hunts.map(item => item.id === huntId ? { ...item, status: body.action === "start-opening" ? "opening" : "collecting" } : item) };
          next = { state, streamToken: record.streamToken };
        } else if (body.action === "rotate-token" && body.huntId === undefined) {
          next = { state: record.state, streamToken: crypto.randomBytes(32).toString("base64url") };
        } else throw new InputError("Unknown action.");
      }
      const clock = now();
      // A legacy opening hunt can return to collection too, but its initial
      // window must first be recorded as closed before a fresh cycle opens.
      const windowsRecord = body.action === "back-to-hunting" && !cutoffFor(record, body.huntId)
        ? { ...record, ...updatePredictionWindows(record, record.state, clock, { closeHuntId: body.huntId }) } : record;
      Object.assign(next, updatePredictionWindows(windowsRecord, next.state, clock, {
        closeHuntId: ["close-predictions", "start-opening"].includes(body.action) ? body.huntId : null,
        reopenHuntId: body.action === "back-to-hunting" ? body.huntId : null,
        newWindowId: body.action === "back-to-hunting" ? crypto.randomUUID() : null
      }));
      const result = await store.setJSON(KEY, next, { onlyIfMatch: entry.etag });
      if (!result.modified) return json(409, { ok: false, error: "Another save finished first. Reload the saved hunt before trying again." });
      if (!result.etag) throw new Error("Storage did not confirm the save");
      return json(200, { ok: true, state: next.state, revision: result.etag, predictionWindows: predictionWindows(next), ...(method === "POST" && body.action === "rotate-token" ? { streamToken: next.streamToken } : {}) });
    } catch (error) {
      if (error instanceof InputError) return json(400, { ok: false, error: error.message });
      console.error("Bonus hunt storage request failed:", error.name || "Error");
      return json(503, { ok: false, error: "Hunt storage is unavailable. Your unsaved changes are still in the editor; try saving again shortly." });
    }
  };
}

module.exports = { createHandler, isOwner, initialState, validateState, InputError, KEY, storeName };

