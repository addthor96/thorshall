"use strict";

const { createHash } = require("node:crypto");

// A site-wide store survives deploys. Each partner's records and revision log
// share one atomic object: no partial payment/index/history writes are possible.
const STORE_NAME = "thorshall-partner-payments-v1";
const MAX_PAYMENTS = 5000;
const MAX_REVISIONS = 100;
const MAX_LEDGER_BYTES = 8 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CURRENCY_DECIMALS = Object.freeze({ USD: 2, EUR: 2, GBP: 2, ISK: 0, USDT: 6, USDC: 6 });

class PaymentError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalAmount(value, currency) {
  if (typeof currency !== "string" || !Object.hasOwn(CURRENCY_DECIMALS, currency)) {
    throw new PaymentError(400, "Choose a supported payment currency.");
  }
  const decimals = CURRENCY_DECIMALS[currency];
  if (decimals === undefined || typeof value !== "string" || !/^(0|[1-9]\d{0,9})(\.\d+)?$/.test(value)) {
    throw new PaymentError(400, "Enter a valid payment amount and supported currency.");
  }
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new PaymentError(400, `Use at most ${decimals} decimal places for ${currency}.`);
  const minor = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (minor <= 0n || minor > 1000000000n * 10n ** BigInt(decimals)) {
    throw new PaymentError(400, "Payment amount must be greater than zero and no more than 1 billion.");
  }
  return decimals ? `${whole}.${fraction.padEnd(decimals, "0")}` : whole;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value >= "2000-01-01";
}

function cleanText(value, name, required = false) {
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new PaymentError(400, `${name} must be plain text of at most 200 characters.`);
  }
  const result = value.trim();
  if (required && !result) throw new PaymentError(400, `${name} is required.`);
  return result;
}

function validateInput(body, method, now) {
  const allowed = ["requestId", "reportingMonth", "amountPaid", "currency", "paidAt", "reference"];
  if (method === "PATCH") allowed.push("id", "expectedRevision", "correctionReason");
  if (!isObject(body) || Object.keys(body).some(key => !allowed.includes(key))) {
    throw new PaymentError(400, "Unsupported payment fields.");
  }
  if (typeof body.requestId !== "string" || !UUID.test(body.requestId)) throw new PaymentError(400, "A valid payment request ID is required.");
  const today = now.toISOString().slice(0, 10);
  if (typeof body.reportingMonth !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.reportingMonth) || body.reportingMonth < "2000-01" || body.reportingMonth > today.slice(0, 7)) {
    throw new PaymentError(400, "Choose a valid reporting month that is not in the future.");
  }
  if (!validDate(body.paidAt) || body.paidAt > today) throw new PaymentError(400, "Choose a valid payment date that is not in the future.");
  const fields = {
    reportingMonth: body.reportingMonth,
    amountPaid: canonicalAmount(body.amountPaid, body.currency),
    currency: body.currency,
    paidAt: body.paidAt,
    reference: cleanText(body.reference, "Transaction reference")
  };
  const operation = { method, requestId: body.requestId, fields };
  if (method === "PATCH") {
    if (typeof body.id !== "string" || !UUID.test(body.id) || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1) {
      throw new PaymentError(400, "A valid payment ID and expected revision are required.");
    }
    operation.id = body.id;
    operation.expectedRevision = body.expectedRevision;
    operation.correctionReason = cleanText(body.correctionReason, "Correction reason", true);
  }
  operation.digest = createHash("sha256").update(JSON.stringify(operation)).digest("hex");
  return operation;
}

function validStoredFields(record) {
  try {
    return isObject(record) && typeof record.reportingMonth === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(record.reportingMonth)
      && canonicalAmount(record.amountPaid, record.currency) === record.amountPaid && validDate(record.paidAt)
      && cleanText(record.reference, "Reference") === record.reference;
  } catch { return false; }
}

function validateLedger(data, partnerCode) {
  if (!isObject(data) || data.schemaVersion !== 1 || data.partnerCode !== partnerCode || !Array.isArray(data.payments)
      || data.payments.length > MAX_PAYMENTS || typeof data.updatedAt !== "string" || !Number.isFinite(Date.parse(data.updatedAt))) {
    throw new Error("Invalid payment ledger");
  }
  const ids = new Set();
  const requests = new Set();
  for (const payment of data.payments) {
    if (!validStoredFields(payment) || !UUID.test(payment.id) || ids.has(payment.id) || !Array.isArray(payment.history)
        || !payment.history.length || payment.history.length > MAX_REVISIONS || payment.revision !== payment.history.length
        || !Number.isFinite(Date.parse(payment.createdAt)) || !Number.isFinite(Date.parse(payment.updatedAt))) throw new Error("Invalid payment entry");
    ids.add(payment.id);
    for (let index = 0; index < payment.history.length; index += 1) {
      const revision = payment.history[index];
      if (!validStoredFields(revision) || revision.revision !== index + 1 || !UUID.test(revision.requestId)
          || requests.has(revision.requestId) || !/^[a-f0-9]{64}$/.test(revision.digest)
          || !Number.isFinite(Date.parse(revision.recordedAt)) || revision.action !== (index === 0 ? "recorded" : "corrected")
          || cleanText(revision.correctionReason, "Correction reason", index > 0) !== revision.correctionReason) throw new Error("Invalid payment history");
      requests.add(revision.requestId);
    }
    const latest = payment.history.at(-1);
    for (const key of ["reportingMonth", "amountPaid", "currency", "paidAt", "reference"]) {
      if (payment[key] !== latest[key]) throw new Error("Payment revision mismatch");
    }
  }
  return data;
}

function publicPayment(payment, admin) {
  const { id, reportingMonth, amountPaid, currency, paidAt, reference, revision, createdAt, updatedAt } = payment;
  const result = { id, reportingMonth, amountPaid, currency, paidAt, reference, revision, createdAt, updatedAt, status: "paid" };
  if (admin) result.history = payment.history.map(({ requestId, digest, ...record }) => record);
  return result;
}

function findOperation(ledger, operation) {
  for (const payment of ledger.payments) {
    const revision = payment.history.find(item => item.requestId === operation.requestId);
    if (!revision) continue;
    if (revision.digest !== operation.digest) throw new PaymentError(409, "This request ID was already used for different payment details. Reload before saving.");
    return payment;
  }
  return null;
}

async function openStore() {
  // The modern Netlify Function entry supplies its Blobs context automatically.
  // No fallback to local disk, browser storage, public git, or deploy stores.
  const { getStore } = require("@netlify/blobs");
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

async function readLedger(store, partnerCode) {
  const result = await store.getWithMetadata(`ledger/${partnerCode}`, { type: "json", consistency: "strong" });
  if (result === null) return { ledger: { schemaVersion: 1, partnerCode, payments: [], updatedAt: null }, etag: null };
  if (!result || typeof result.etag !== "string" || !result.etag) throw new Error("Missing ledger version");
  if (Buffer.byteLength(JSON.stringify(result.data)) > MAX_LEDGER_BYTES) throw new Error("Ledger exceeds limit");
  try { return { ledger: validateLedger(result.data, partnerCode), etag: result.etag }; }
  catch { throw new Error("Invalid stored payment ledger"); }
}

async function writePayment(store, partnerCode, operation, now) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { ledger, etag } = await readLedger(store, partnerCode);
    const duplicate = findOperation(ledger, operation);
    if (duplicate) return { payment: duplicate, duplicate: true };
    const timestamp = now.toISOString();
    let payment;
    if (operation.method === "POST") {
      if (ledger.payments.length >= MAX_PAYMENTS) throw new PaymentError(409, "The payment ledger is full. Contact the site owner.");
      payment = { id: operation.requestId, ...operation.fields, revision: 1, createdAt: timestamp, updatedAt: timestamp, history: [] };
      ledger.payments.push(payment);
    } else {
      payment = ledger.payments.find(item => item.id === operation.id);
      if (!payment) throw new PaymentError(404, "Payment record not found.");
      if (payment.revision !== operation.expectedRevision) throw new PaymentError(409, "This payment changed since you opened it. Reload and review before correcting it.");
      if (payment.history.length >= MAX_REVISIONS) throw new PaymentError(409, "This record has reached its correction limit. Contact the site owner.");
      Object.assign(payment, operation.fields, { revision: payment.revision + 1, updatedAt: timestamp });
    }
    payment.history.push({
      revision: payment.revision, recordedAt: timestamp, action: operation.method === "POST" ? "recorded" : "corrected",
      ...operation.fields, correctionReason: operation.correctionReason || "", requestId: operation.requestId, digest: operation.digest
    });
    ledger.updatedAt = timestamp;
    if (Buffer.byteLength(JSON.stringify(ledger)) > MAX_LEDGER_BYTES) throw new PaymentError(409, "The payment ledger is full. Contact the site owner.");
    const result = await store.setJSON(`ledger/${partnerCode}`, ledger, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
    if (result?.modified === false) continue; // Another writer won; safely re-read.
    // SDK 10.x issue #741 may claim success after a non-412 failure. A real
    // provider write has an ETag; confirm the exact operation with a strong read.
    if (result?.modified !== true || typeof result.etag !== "string" || !result.etag) throw new Error("Unconfirmed ledger write");
    const verified = await readLedger(store, partnerCode);
    const saved = findOperation(verified.ledger, operation);
    if (!saved) throw new Error("Payment write could not be confirmed");
    return { payment: saved, duplicate: false };
  }
  throw new PaymentError(409, "Another payment update is in progress. Retry this save shortly.");
}

module.exports = { CURRENCY_DECIMALS, PaymentError, STORE_NAME, canonicalAmount, openStore, publicPayment, readLedger, validateInput, writePayment };
