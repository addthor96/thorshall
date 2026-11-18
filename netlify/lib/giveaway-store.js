"use strict";

const { createHash } = require("node:crypto");

const STORE_NAME = "thorshall-giveaways-v1";
const LEDGER_KEY = "completed-giveaways";
const MAX_ENTRY_MINOR = 10000000000;
const MAX_ENTRIES = 5000;
const MAX_LEDGER_BYTES = 4 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class GiveawayError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function keys(value, allowed) { return object(value) && Object.keys(value).every(key => allowed.includes(key)); }
function validId(value) { return typeof value === "string" && UUID.test(value); }
function validTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function parseAmount(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(value)) {
    throw new GiveawayError(400, "Enter a positive USD amount using at most two decimal places.");
  }
  const [whole, decimal = ""] = value.split(".");
  const minor = BigInt(whole) * 100n + BigInt(decimal.padEnd(2, "0"));
  if (minor <= 0n || minor > BigInt(MAX_ENTRY_MINOR)) throw new GiveawayError(400, "Enter an amount greater than $0 and no more than $100,000,000.");
  return Number(minor);
}

function validateInput(body, method) {
  const allowed = method === "POST" ? ["requestId", "amount"] : ["requestId", "entryId", "expectedRevision"];
  if (!keys(body, allowed)) throw new GiveawayError(400, "Unsupported giveaway fields.");
  if (!validId(body.requestId)) throw new GiveawayError(400, "A valid request ID is required.");
  const operation = { method, requestId: body.requestId.toLowerCase() };
  if (method === "POST") operation.amountMinor = parseAmount(body.amount);
  else {
    if (!validId(body.entryId) || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1) throw new GiveawayError(400, "A valid entry and current revision are required.");
    operation.entryId = body.entryId.toLowerCase();
    operation.expectedRevision = body.expectedRevision;
  }
  operation.digest = createHash("sha256").update(JSON.stringify(operation)).digest("hex");
  return operation;
}

function emptyLedger() { return { schema: 1, currency: "USD", revision: 0, totalMinor: 0, count: 0, entries: [], operations: [] }; }

function validateLedger(ledger) {
  if (!keys(ledger, ["schema", "currency", "revision", "totalMinor", "count", "entries", "operations"]) || ledger.schema !== 1 || ledger.currency !== "USD"
      || !Array.isArray(ledger.entries) || ledger.entries.length > MAX_ENTRIES || !Array.isArray(ledger.operations) || ledger.operations.length > MAX_ENTRIES * 2
      || !Number.isSafeInteger(ledger.revision) || ledger.revision !== ledger.operations.length || !Number.isSafeInteger(ledger.totalMinor) || ledger.totalMinor < 0
      || !Number.isSafeInteger(ledger.count) || ledger.count < 0 || ledger.count > ledger.entries.length) throw new Error("Invalid giveaway ledger");
  const entries = new Map(), requests = new Set();
  let total = 0n, count = 0;
  for (const entry of ledger.entries) {
    if (!keys(entry, ["id", "amountMinor", "createdAt", "status", "voidedAt"]) || !validId(entry.id) || entries.has(entry.id)
        || !Number.isSafeInteger(entry.amountMinor) || entry.amountMinor <= 0 || entry.amountMinor > MAX_ENTRY_MINOR || !validTimestamp(entry.createdAt)
        || !["recorded", "void"].includes(entry.status) || (entry.status === "void" ? !validTimestamp(entry.voidedAt) : entry.voidedAt !== undefined)) throw new Error("Invalid giveaway entry");
    entries.set(entry.id, entry);
    if (entry.status === "recorded") { total += BigInt(entry.amountMinor); count++; }
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || Number(total) !== ledger.totalMinor || count !== ledger.count) throw new Error("Invalid giveaway totals");
  const recorded = new Set(), voided = new Set();
  for (let index = 0; index < ledger.operations.length; index++) {
    const op = ledger.operations[index];
    if (!keys(op, ["requestId", "digest", "entryId", "method", "revision", "recordedAt"]) || !validId(op.requestId) || requests.has(op.requestId)
        || !validId(op.entryId) || !entries.has(op.entryId) || !["POST", "PATCH"].includes(op.method) || op.revision !== index + 1
        || typeof op.digest !== "string" || !/^[a-f0-9]{64}$/.test(op.digest) || !validTimestamp(op.recordedAt)) throw new Error("Invalid giveaway history");
    requests.add(op.requestId);
    const entry = entries.get(op.entryId);
    if (op.method === "POST") {
      if (recorded.has(entry.id) || op.requestId !== entry.id || entry.createdAt !== op.recordedAt) throw new Error("Invalid giveaway record history");
      recorded.add(entry.id);
    } else {
      if (!recorded.has(entry.id) || voided.has(entry.id) || entry.status !== "void" || entry.voidedAt !== op.recordedAt) throw new Error("Invalid giveaway void history");
      voided.add(entry.id);
    }
  }
  if (recorded.size !== entries.size || ledger.entries.some(entry => (entry.status === "void") !== voided.has(entry.id))) throw new Error("Incomplete giveaway history");
  return ledger;
}

function responseLedger(ledger) {
  return { currency: "USD", totalMinor: ledger.totalMinor, count: ledger.count, revision: ledger.revision,
    entries: ledger.entries.slice().reverse().slice(0, 20).map(entry => ({ ...entry })) };
}

function storeName(event = {}) {
  let url;
  try { url = new URL(event.rawUrl); } catch { throw new GiveawayError(503, "Giveaway storage could not verify this dashboard."); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new GiveawayError(503, "Giveaway storage could not verify this dashboard.");
  const hostHeader = Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === "host")?.[1];
  if (hostHeader && hostHeader.toLowerCase() !== url.host.toLowerCase()) throw new GiveawayError(503, "Giveaway storage could not verify this dashboard.");
  if (url.origin === "https://thorshall.gg" && event.deployContext === "production" && event.published === true) return STORE_NAME;
  const context = String(event.deployContext || "unverified").toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 20);
  const host = createHash("sha256").update(url.origin).digest("hex").slice(0, 8);
  return `${STORE_NAME}-preview-${context}-${host}`;
}

function openStore(getStore, event) {
  if (typeof getStore !== "function") throw new Error("Giveaway storage provider unavailable");
  return getStore({ name: storeName(event), consistency: "strong" });
}

async function readLedger(store) {
  const result = await store.getWithMetadata(LEDGER_KEY, { type: "json", consistency: "strong" });
  if (result === null) return { ledger: emptyLedger(), etag: null };
  if (!result || typeof result.etag !== "string" || !result.etag || result.data === null || Buffer.byteLength(JSON.stringify(result.data)) > MAX_LEDGER_BYTES) throw new Error("Invalid stored giveaway ledger");
  try { return { ledger: validateLedger(result.data), etag: result.etag }; }
  catch { throw new Error("Invalid stored giveaway ledger"); }
}

function findOperation(ledger, operation) {
  const existing = ledger.operations.find(item => item.requestId === operation.requestId);
  if (!existing) return null;
  if (existing.digest !== operation.digest) throw new GiveawayError(409, "This request ID was already used for another change. Reload before trying again.");
  return existing;
}

async function writeEntry(store, operation, now) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { ledger, etag } = await readLedger(store);
    if (findOperation(ledger, operation)) return { ledger, duplicate: true };
    const timestamp = now.toISOString();
    if (!validTimestamp(timestamp)) throw new Error("Giveaway clock unavailable");
    let entry;
    if (operation.method === "POST") {
      if (ledger.entries.length >= MAX_ENTRIES) throw new GiveawayError(409, "The giveaway ledger has reached its storage limit. Contact the site owner.");
      const nextTotal = BigInt(ledger.totalMinor) + BigInt(operation.amountMinor);
      if (nextTotal > BigInt(Number.MAX_SAFE_INTEGER)) throw new GiveawayError(409, "This amount would exceed the supported total.");
      entry = { id: operation.requestId, amountMinor: operation.amountMinor, createdAt: timestamp, status: "recorded" };
      ledger.entries.push(entry); ledger.totalMinor = Number(nextTotal); ledger.count++;
    } else {
      if (ledger.revision !== operation.expectedRevision) throw new GiveawayError(409, "The giveaway total changed. Reload and review the entry before undoing it.");
      entry = ledger.entries.find(item => item.id === operation.entryId);
      if (!entry) throw new GiveawayError(404, "Giveaway entry not found.");
      if (entry.status === "void") throw new GiveawayError(409, "This entry has already been undone.");
      entry.status = "void"; entry.voidedAt = timestamp;
      ledger.totalMinor -= entry.amountMinor; ledger.count--;
    }
    ledger.revision++;
    ledger.operations.push({ requestId: operation.requestId, digest: operation.digest, entryId: entry.id, method: operation.method, revision: ledger.revision, recordedAt: timestamp });
    if (Buffer.byteLength(JSON.stringify(ledger)) > MAX_LEDGER_BYTES) throw new GiveawayError(409, "The giveaway ledger has reached its storage limit. Contact the site owner.");
    const result = await store.setJSON(LEDGER_KEY, ledger, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
    if (result?.modified === false) continue;
    if (result?.modified !== true || typeof result.etag !== "string" || !result.etag) throw new Error("Unconfirmed giveaway write");
    const confirmed = await readLedger(store);
    if (!findOperation(confirmed.ledger, operation)) throw new Error("Giveaway write could not be confirmed");
    return { ledger: confirmed.ledger, duplicate: false };
  }
  throw new GiveawayError(409, "Another giveaway update is in progress. Retry the same save shortly.");
}

module.exports = { GiveawayError, STORE_NAME, LEDGER_KEY, MAX_ENTRY_MINOR, MAX_ENTRIES, parseAmount, validateInput, validateLedger, emptyLedger, responseLedger, storeName, openStore, readLedger, writeEntry };
