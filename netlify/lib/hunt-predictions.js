"use strict";

const crypto = require("node:crypto");
const hunts = require("./bonus-hunts");
const Core = require("../../hunt-shared");
const { cutoffFor, running, timestamp, validWindowId, windowFor, versionEligible } = require("./hunt-prediction-windows");
const TWITCH_ID = /^[1-9]\d{0,19}$/;
const TWITCH_LOGIN = /^[a-z0-9_]{1,25}$/;
const MAX_BODY_BYTES = 4096;
const MAX_ENTRIES = 2000;
const MAX_LEDGER_BYTES = 1024 * 1024;
const MAX_IP_ENTRIES = 10;
const MAX_REVISIONS = 100;
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
function verifiedUser(value) {
  if (!value || typeof value !== "object" || !TWITCH_ID.test(value.id) || !TWITCH_LOGIN.test(value.login)
      || typeof value.displayName !== "string" || !value.displayName || value.displayName.length > 50 || /[\u0000-\u001f\u007f]/.test(value.displayName)) return null;
  return { id: value.id, login: value.login, displayName: value.displayName };
}
async function defaultAuthInfo(event) {
  return require("./hunt-twitch-auth").predictionAuthInfo(event);
}
function publicAuth(value) {
  return { viewer: verifiedUser(value?.viewer), authConfigured: value?.authConfigured === true,
    loginUrl: typeof value?.loginUrl === "string" ? value.loginUrl : "/.netlify/functions/hunt-twitch?action=login",
    logoutUrl: typeof value?.logoutUrl === "string" ? value.logoutUrl : "/.netlify/functions/hunt-twitch?action=logout",
    authExpiresAt: timestamp(value?.authExpiresAt) ? value.authExpiresAt : null,
    authRevalidateAt: timestamp(value?.authRevalidateAt) ? value.authRevalidateAt : null };
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
  const allowed = ["huntId", "requestId", "amount", "website", "viewerId", "expectedRevision", "windowId"];
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) throw new PredictionError(400, "Unsupported prediction fields.");
  if (body.website !== "") throw new PredictionError(400, "This prediction could not be accepted.");
  if (typeof body.huntId !== "string" || !ID.test(body.huntId) || typeof body.requestId !== "string" || !UUID.test(body.requestId)) throw new PredictionError(400, "Refresh this hunt page before predicting.");
  if (body.viewerId !== undefined && (typeof body.viewerId !== "string" || !TWITCH_ID.test(body.viewerId))) throw new PredictionError(400, "Refresh your Twitch sign-in before predicting.");
  if (body.expectedRevision !== undefined && body.expectedRevision !== null && (typeof body.expectedRevision !== "string" || !UUID.test(body.expectedRevision))) throw new PredictionError(400, "Refresh your saved prediction before changing it.");
  if (body.windowId !== undefined && !validWindowId(body.windowId)) throw new PredictionError(400, "Refresh this hunt's prediction window before saving.");
  return { huntId: body.huntId, requestId: body.requestId.toLowerCase(), amountMinor: parseAmount(body.amount), expectedRevision: body.expectedRevision?.toLowerCase() || null,
    windowId: body.windowId?.toLowerCase() || "0",
    ...(body.viewerId !== undefined ? { viewerId: body.viewerId } : {}) };
}
function emptyLedger(hunt) { return { schema: 1, huntId: hunt.id, currency: hunt.currency, entries: [] }; }
function validAdmission(version) {
  return (version.windowId === undefined || validWindowId(version.windowId))
    && (version.expectedRevision === undefined || version.expectedRevision === null || typeof version.expectedRevision === "string" && UUID.test(version.expectedRevision))
    && (version.admittedAt === undefined ? version.windowId === undefined : version.admittedAt === null || timestamp(version.admittedAt) && version.admittedAt >= version.createdAt);
}
function validateLedger(value, huntId) {
  if (!value || typeof value !== "object" || value.schema !== 1 || value.huntId !== huntId || !["USD", "EUR", "GBP", "CAD", "AUD"].includes(value.currency)
      || !Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES || Buffer.byteLength(JSON.stringify(value)) > MAX_LEDGER_BYTES) throw new Error("Invalid prediction ledger");
  const requestIds = new Set(), legacyBrowsers = new Set(), legacyNames = new Set(), users = new Set(), sequences = new Set();
  for (const [index, entry] of value.entries.entries()) {
    const twitch = entry?.authKind === "twitch";
    if (!entry || typeof entry !== "object" || !UUID.test(entry.requestId) || !HASH.test(entry.identityHash) || !HASH.test(entry.ipHash)
        || typeof entry.username !== "string" || !(twitch ? TWITCH_LOGIN : /^[A-Za-z0-9_]{3,25}$/).test(entry.username) || entry.nameKey !== entry.username.toLowerCase()
        || !Number.isSafeInteger(entry.amountMinor) || entry.amountMinor < 0 || entry.amountMinor > 100000000000 || !timestamp(entry.createdAt)
        || requestIds.has(entry.requestId) || !validAdmission(entry)) throw new Error("Invalid prediction record");
    if (twitch) {
      if (!TWITCH_ID.test(entry.userId) || users.has(entry.userId)) throw new Error("Invalid Twitch prediction record");
      users.add(entry.userId);
    } else {
      if (entry.authKind !== undefined || entry.userId !== undefined || legacyBrowsers.has(entry.identityHash) || legacyNames.has(entry.nameKey)) throw new Error("Invalid legacy prediction record");
      legacyBrowsers.add(entry.identityHash); legacyNames.add(entry.nameKey);
    }
    requestIds.add(entry.requestId);
    const sequence = entry.sequence === undefined ? index + 1 : entry.sequence;
    if (!Number.isSafeInteger(sequence) || sequence < 1 || sequences.has(sequence)) throw new Error("Invalid prediction acceptance order");
    sequences.add(sequence);
    if (entry.revisions !== undefined) {
      if (!twitch || !Array.isArray(entry.revisions) || entry.revisions.length > MAX_REVISIONS) throw new Error("Invalid prediction revisions");
      let previous = entry;
      for (const revision of entry.revisions) {
        if (!revision || typeof revision !== "object" || !UUID.test(revision.requestId) || requestIds.has(revision.requestId)
            || revision.parentRevision !== previous.requestId || typeof revision.username !== "string" || !TWITCH_LOGIN.test(revision.username) || revision.nameKey !== revision.username
            || !Number.isSafeInteger(revision.amountMinor) || revision.amountMinor < 0 || revision.amountMinor > 100000000000
            || !HASH.test(revision.ipHash) || !timestamp(revision.createdAt) || revision.createdAt < previous.createdAt || !validAdmission(revision)
            || !Number.isSafeInteger(revision.sequence) || revision.sequence <= (previous.sequence || index + 1) || sequences.has(revision.sequence)) throw new Error("Invalid prediction revision");
        requestIds.add(revision.requestId); sequences.add(revision.sequence); previous = revision;
      }
    }
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
  return ledger.entries.flatMap((entry, order) => {
    const versions = [entry, ...(entry.revisions || [])].filter(version => versionEligible(record, hunt.id, version));
    if (!versions.length) return [];
    const latest = versions[versions.length - 1];
    return [{ ...entry, username: latest.username, amountMinor: latest.amountMinor, requestId: latest.requestId,
      updatedAt: latest.admittedAt || latest.createdAt, acceptedOrder: latest.sequence || order + 1, edited: latest !== entry }];
  });
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
  return record.state.settings?.public === true && record.state.activeId === hunt.id && hunt.status === "collecting"
    && !cutoffFor(record, hunt.id) && ledger.currency === hunt.currency;
}
function summary(ledger, record, hunt, viewer) {
  const entries = eligibleEntries(ledger, record, hunt), own = viewer ? entries.find(entry => entry.authKind === "twitch" && entry.userId === viewer.id) : null;
  // The public roster deliberately projects only display fields. Authentication,
  // request, and abuse-prevention identifiers remain in the server ledger.
  const publicEntries = entries.map((entry, order) => ({ entry, order }))
    .sort((a, b) => a.entry.createdAt.localeCompare(b.entry.createdAt) || a.order - b.order)
    .map(({ entry }) => ({ username: entry.username, amountMinor: entry.amountMinor, createdAt: entry.createdAt, ...(entry.edited ? { updatedAt: entry.updatedAt } : {}),
      verified: entry.authKind === "twitch", isMine: !!viewer && entry.authKind === "twitch" && entry.userId === viewer.id }));
  let podium = [];
  if (hunt.status === "complete") {
    const end = finalBalanceMinor(hunt);
    podium = entries.map((entry, order) => ({ ...entry, order, differenceMinor: Math.abs(entry.amountMinor - end) }))
      .sort((a, b) => a.differenceMinor - b.differenceMinor || a.updatedAt.localeCompare(b.updatedAt) || a.acceptedOrder - b.acceptedOrder || a.order - b.order)
      .slice(0, 3).map((entry, index) => ({ place: index + 1, username: entry.username, amountMinor: entry.amountMinor, differenceMinor: entry.differenceMinor }));
  }
  return { ok: true, huntId: hunt.id, currency: hunt.currency, status: hunt.status, windowId: windowFor(record, hunt.id).id,
    accepting: accepting(record, hunt, ledger), count: entries.length, entries: publicEntries,
    mine: own ? { username: own.username, amountMinor: own.amountMinor, createdAt: own.createdAt, updatedAt: own.updatedAt, revision: own.requestId } : null, podium,
    ...(ledger.currency !== hunt.currency ? { message: "The hunt currency changed. Earlier predictions cannot be ranked for this currency." } : {}) };
}
function operationFor(ledger, requestId) {
  for (const entry of ledger.entries) {
    if (entry.requestId === requestId) return { entry, version: entry };
    const version = entry.revisions?.find(revision => revision.requestId === requestId);
    if (version) return { entry, version };
  }
  return null;
}
function matchingRetry(saved, operation, viewer) {
  return saved.version.requestId === operation.requestId && saved.entry.authKind === "twitch" && saved.entry.userId === viewer.id
    && saved.version.amountMinor === operation.amountMinor && (Object.prototype.hasOwnProperty.call(saved.version, "expectedRevision") ? saved.version.expectedRevision : saved.version.parentRevision || null) === operation.expectedRevision
    && (saved.version.windowId || "0") === operation.windowId;
}
function acceptedOperation(saved, ledger, record, hunt) {
  return ledger.currency === hunt.currency && versionEligible(record, hunt.id, saved.version);
}
function nextSequence(ledger) {
  return ledger.entries.reduce((largest, entry, index) => Math.max(largest, entry.sequence || index + 1, ...(entry.revisions || []).map(revision => revision.sequence)), 0) + 1;
}
function reservedLedgerBytes(ledger) {
  // Reserve the full ISO timestamp for every pending admission so confirming a
  // near-limit ledger never makes the stored document unreadable.
  const pending = ledger.entries.reduce((count, entry) => count + [entry, ...(entry.revisions || [])].filter(version => version.admittedAt === null).length, 0);
  return Buffer.byteLength(JSON.stringify(ledger)) + pending * 22;
}
function createHandler({ connectHunts, connectPredictions, now = () => new Date(), secretFor = signingSecret, authInfoFor = defaultAuthInfo,
  logDiagnostic = value => console.error(JSON.stringify(value)) } = {}) {
  return async function handler(event = {}) {
    const method = String(event.httpMethod || "GET").toUpperCase();
    if (!["GET", "POST"].includes(method)) return json(405, { ok: false, error: "Method not allowed." }, { Allow: "GET, POST" });
    let extra = {}, stage = "validation", auth = null;
    try {
      const at = now(); if (!timestamp(at.toISOString())) throw new Error("Invalid prediction clock");
      const secret = secretFor(); if (typeof secret !== "string" || secret.length < 32) throw new Error("Prediction signing is unavailable");
      urlFor(event);
      let operation, huntId;
      const query = event.queryStringParameters || {};
      if (method === "POST") {
        sameOrigin(event); if (Object.keys(query).length) throw new PredictionError(400, "Unsupported prediction parameter.");
        operation = parseBody(event); huntId = operation.huntId;
      } else {
        if (Object.keys(query).length !== 1 || typeof query.hunt !== "string" || !ID.test(query.hunt)) throw new PredictionError(400, "Choose a valid hunt.");
        huntId = query.hunt;
      }
      stage = "auth";
      const authEvent = { ...event, queryStringParameters: { ...(event.queryStringParameters || {}), return: "/bonus-hunt#hunt=" + huntId } };
      auth = publicAuth(await authInfoFor(authEvent));
      if (method === "POST" && (!auth.authConfigured || !auth.viewer)) {
        return json(401, { ok: false, error: auth.authConfigured ? "Sign in with Twitch before submitting a prediction." : "Twitch sign-in is being connected. Predictions require a verified Twitch account.", ...auth });
      }
      if (operation?.viewerId !== undefined && operation.viewerId !== auth.viewer.id) throw new PredictionError(409, "Your Twitch account changed. Refresh predictions and review your entry.");
      stage = "connect";
      if (typeof connectHunts !== "function" || typeof connectPredictions !== "function") throw new Error("Prediction storage is unavailable");
      const huntStore = await connectHunts(event), predictionStore = await connectPredictions(event);
      stage = "read";
      let current = await readHunt(huntStore, huntId, event);
      let { ledger, etag } = await readLedger(predictionStore, current.hunt);
      if (method === "GET") return json(200, { ...summary(ledger, current.record, current.hunt, auth.viewer), ...auth }, extra);
      const priorRequest = operationFor(ledger, operation.requestId);
      if (priorRequest) {
        if (!matchingRetry(priorRequest, operation, auth.viewer)) throw new PredictionError(409, "This request was already used. Refresh the hunt page.");
        if (priorRequest.version.admittedAt !== null) {
          if (!acceptedOperation(priorRequest, ledger, current.record, current.hunt)) throw new PredictionError(409, "Predictions closed before this change was accepted.");
          return json(200, { ...summary(ledger, current.record, current.hunt, auth.viewer), ...auth, duplicate: true }, extra);
        }
      }
      if (!priorRequest && (!accepting(current.record, current.hunt, ledger) || windowFor(current.record, huntId).id !== operation.windowId)) throw new PredictionError(409, "Predictions changed or closed for this hunt. Refresh before saving.");
      const ip = typeof event.clientIp === "string" && event.clientIp.length < 100 ? event.clientIp : "unavailable";
      const ipHash = hmac(secret, "prediction-ip-v1:" + at.toISOString().slice(0, 10) + ":" + ip);
      let duplicate = false, editing = false;
      stage = "write";
      for (let attempt = 0; attempt < 8; attempt++) {
        const prior = operationFor(ledger, operation.requestId);
        if (prior) {
          if (!matchingRetry(prior, operation, auth.viewer)) throw new PredictionError(409, "This request was already used. Refresh the hunt page.");
          duplicate = true; break;
        }
        if (attempt) current = await readHunt(huntStore, huntId, event);
        if (!accepting(current.record, current.hunt, ledger) || windowFor(current.record, huntId).id !== operation.windowId) throw new PredictionError(409, "Predictions changed or closed for this hunt. Refresh before saving.");
        const ownIndex = ledger.entries.findIndex(entry => entry.authKind === "twitch" && entry.userId === auth.viewer.id), own = ledger.entries[ownIndex];
        const previous = eligibleEntries(ledger, current.record, current.hunt).find(entry => entry.authKind === "twitch" && entry.userId === auth.viewer.id);
        const lastStored = own && (own.revisions?.at(-1) || own);
        if ((previous?.requestId || null) !== operation.expectedRevision) throw new PredictionError(409, "Your prediction changed in another tab. Refresh predictions before saving again.");
        editing = !!own;
        if (own && (own.revisions?.length || 0) >= MAX_REVISIONS) throw new PredictionError(429, "This prediction has reached its change limit for this hunt.");
        if (!own && ledger.entries.filter(entry => entry.ipHash === ipHash).length >= MAX_IP_ENTRIES) throw new PredictionError(429, "Too many predictions from this connection. Try the next hunt.");
        if (!own && ledger.entries.length >= MAX_ENTRIES) throw new PredictionError(429, "This hunt has reached its prediction limit.");
        const savedAt = now().toISOString();
        if (!timestamp(savedAt) || lastStored && savedAt < lastStored.createdAt) throw new Error("Invalid prediction clock");
        const version = { requestId: operation.requestId, username: auth.viewer.login, nameKey: auth.viewer.login, amountMinor: operation.amountMinor,
          ipHash, createdAt: savedAt, sequence: nextSequence(ledger), windowId: operation.windowId, admittedAt: null, expectedRevision: operation.expectedRevision };
        const next = { ...ledger, entries: [...ledger.entries] };
        if (own) next.entries[ownIndex] = { ...own, revisions: [...(own.revisions || []), { ...version, parentRevision: lastStored.requestId }] };
        else next.entries.push({ ...version, authKind: "twitch", userId: auth.viewer.id, identityHash: hmac(secret, "prediction-twitch-v1:" + auth.viewer.id) });
        if (reservedLedgerBytes(next) > MAX_LEDGER_BYTES) throw new PredictionError(429, "This hunt has reached its prediction limit.");
        const result = await predictionStore.setJSON(ledgerKey(huntId), next, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
        if (result?.modified === true && typeof result.etag === "string" && result.etag) { ledger = next; break; }
        if (result?.modified !== false) throw new Error("Prediction save was not confirmed");
        if (attempt === 7) throw new PredictionError(409, "Other predictions are being saved. Retry the same prediction shortly.");
        ({ ledger, etag } = await readLedger(predictionStore, current.hunt));
      }
      stage = "confirm";
      // Pending versions are invisible, including to subsequent public reads.
      // Admission occurs only after a strong read confirms the SAME cycle;
      // closed-gap writes therefore cannot become eligible when a new cycle opens.
      for (let attempt = 0; attempt < 8; attempt++) {
        const pending = await readLedger(predictionStore, current.hunt), saved = operationFor(pending.ledger, operation.requestId);
        if (!saved || !matchingRetry(saved, operation, auth.viewer)) throw new Error("Prediction save could not be confirmed");
        if (saved.version.admittedAt !== null) break;
        current = await readHunt(huntStore, huntId, event);
        if (windowFor(current.record, huntId).id !== operation.windowId || current.record.state.settings?.public !== true || current.record.state.activeId !== huntId
            || !running(current.hunt) || pending.ledger.currency !== current.hunt.currency) throw new PredictionError(409, "Predictions changed or closed before this change was accepted.");
        const previous = eligibleEntries(pending.ledger, current.record, current.hunt).find(entry => entry.authKind === "twitch" && entry.userId === auth.viewer.id);
        if ((previous?.requestId || null) !== operation.expectedRevision) throw new PredictionError(409, "Your prediction changed in another tab. Refresh predictions before saving again.");
        const admittedAt = now().toISOString(), admitted = { ...saved.version, admittedAt };
        if (!timestamp(admittedAt) || admittedAt < admitted.createdAt) throw new Error("Invalid prediction admission clock");
        if (!versionEligible(current.record, huntId, admitted)) throw new PredictionError(409, "Predictions closed before this change was accepted.");
        const next = { ...pending.ledger, entries: pending.ledger.entries.map(entry => entry.requestId === saved.entry.requestId
          ? entry.requestId === operation.requestId ? { ...entry, admittedAt }
            : { ...entry, revisions: entry.revisions.map(revision => revision.requestId === operation.requestId ? { ...revision, admittedAt } : revision) } : entry) };
        if (Buffer.byteLength(JSON.stringify(next)) > MAX_LEDGER_BYTES) throw new PredictionError(429, "This hunt has reached its prediction limit.");
        const result = await predictionStore.setJSON(ledgerKey(huntId), next, { onlyIfMatch: pending.etag });
        if (result?.modified === true && typeof result.etag === "string" && result.etag) break;
        if (result?.modified !== false) throw new Error("Prediction admission was not confirmed");
        if (attempt === 7) throw new PredictionError(409, "Other predictions are being saved. Retry the same prediction shortly.");
      }
      const confirmed = await readLedger(predictionStore, current.hunt);
      const after = await readHunt(huntStore, huntId, event);
      const saved = operationFor(confirmed.ledger, operation.requestId);
      if (!saved || !matchingRetry(saved, operation, auth.viewer)) throw new Error("Prediction save could not be confirmed");
      if (!acceptedOperation(saved, confirmed.ledger, after.record, after.hunt)) throw new PredictionError(409, "Predictions closed before this change was accepted.");
      return json(duplicate || editing ? 200 : 201, { ...summary(confirmed.ledger, after.record, after.hunt, auth.viewer), ...auth, duplicate }, extra);
    } catch (error) {
      if (error instanceof PredictionError) return json(error.status, { ok: false, error: error.message }, extra);
      try { logDiagnostic({ event: "hunt_prediction_failure", stage }); } catch { /* Logs never change a response. */ }
      return json(503, { ok: false, error: "Predictions are temporarily unavailable. Retry the same prediction shortly." }, extra);
    }
  };
}

module.exports = { createHandler, storeName, ledgerKey, HEADERS, MAX_BODY_BYTES, MAX_ENTRIES, MAX_IP_ENTRIES, MAX_REVISIONS,
  PredictionError, parseAmount, validateLedger, eligibleEntries, finalBalanceMinor, summary, verifiedUser };
