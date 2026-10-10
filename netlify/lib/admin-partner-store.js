"use strict";

const { partners } = require("./partner-campaigns");

// Owner-only organizational metadata is separate from both campaign identity
// and payment records. This site-wide store survives production redeploys.
const STORE_NAME = "thorshall-admin-partners-v1";
const WORKFLOWS = Object.freeze(["active", "review", "paused"]);
const MAX_RECORD_BYTES = 16384;

class AdminDataError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

function cleanNotes(notes) {
  if (typeof notes !== "string" || notes.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(notes)) {
    throw new AdminDataError(400, "Notes must be plain text of at most 2,000 characters.");
  }
  return notes.trim();
}

function validateInput(body) {
  const fields = ["expectedRevision", "workflow", "notes"];
  if (!object(body) || Object.keys(body).some(key => !fields.includes(key))) {
    throw new AdminDataError(400, "Unsupported partner management fields.");
  }
  if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) {
    throw new AdminDataError(400, "A valid expected revision is required.");
  }
  if (typeof body.workflow !== "string" || !WORKFLOWS.includes(body.workflow)) {
    throw new AdminDataError(400, "Choose an active, review, or paused workflow status.");
  }
  return { expectedRevision: body.expectedRevision, workflow: body.workflow, notes: cleanNotes(body.notes) };
}

function recordKey(partnerCode) {
  if (typeof partnerCode !== "string" || !Object.hasOwn(partners, partnerCode)) throw new Error("Unknown admin partner");
  return `management/${partnerCode}`;
}

function publicManagement(record) {
  return { workflow: record.workflow, notes: record.notes, revision: record.revision, updatedAt: record.updatedAt };
}

function validateRecord(data, partnerCode) {
  if (!object(data) || data.schemaVersion !== 1 || data.partnerCode !== partnerCode
      || typeof data.workflow !== "string" || !WORKFLOWS.includes(data.workflow)
      || !Number.isSafeInteger(data.revision) || data.revision < 1
      || typeof data.updatedAt !== "string" || !Number.isFinite(Date.parse(data.updatedAt))) {
    throw new Error("Invalid stored admin metadata");
  }
  try { if (cleanNotes(data.notes) !== data.notes) throw new Error("Invalid notes"); }
  catch { throw new Error("Invalid stored admin metadata"); }
  return data;
}

async function openStore(getStore) {
  // Inject the statically imported SDK from the modern Function entry so the
  // deployed bundle contains it and receives native strong-read configuration.
  if (typeof getStore !== "function") throw new Error("Storage provider not configured");
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

async function readManagement(store, partnerCode) {
  const result = await store.getWithMetadata(recordKey(partnerCode), { type: "json", consistency: "strong" });
  if (result === null) return { record: { schemaVersion: 1, partnerCode, workflow: "active", notes: "", revision: 0, updatedAt: null }, etag: null };
  if (!result || typeof result.etag !== "string" || !result.etag) throw new Error("Missing admin metadata version");
  if (Buffer.byteLength(JSON.stringify(result.data) || "") > MAX_RECORD_BYTES) throw new Error("Admin metadata exceeds limit");
  return { record: validateRecord(result.data, partnerCode), etag: result.etag };
}

function matches(record, operation) {
  return record.workflow === operation.workflow && record.notes === operation.notes;
}

async function writeManagement(store, partnerCode, operation, now) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { record, etag } = await readManagement(store, partnerCode);
    // A lost response can be retried safely. Matching stale content is already
    // the desired result; no extra revision or duplicate update is necessary.
    if (operation.expectedRevision <= record.revision && matches(record, operation)) return publicManagement(record);
    if (operation.expectedRevision !== record.revision) {
      throw new AdminDataError(409, "This partner changed since you opened it. Refresh and review before saving.");
    }
    if (record.revision >= Number.MAX_SAFE_INTEGER) throw new AdminDataError(409, "This partner has reached its revision limit.");
    const next = { schemaVersion: 1, partnerCode, workflow: operation.workflow, notes: operation.notes, revision: record.revision + 1, updatedAt: now.toISOString() };
    const result = await store.setJSON(recordKey(partnerCode), next, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
    if (result?.modified === false) continue;
    // SDK 10.x can claim modified:true for a failed provider response. Require
    // an ETag and confirm the exact content with a strongly consistent read.
    if (result?.modified !== true || typeof result.etag !== "string" || !result.etag) throw new Error("Unconfirmed admin metadata write");
    const verified = await readManagement(store, partnerCode);
    if (verified.record.revision < next.revision || !matches(verified.record, operation)) throw new Error("Admin metadata write could not be confirmed");
    return publicManagement(verified.record);
  }
  throw new AdminDataError(409, "Another update is in progress. Refresh and review before saving.");
}

module.exports = { AdminDataError, STORE_NAME, openStore, publicManagement, readManagement, validateInput, writeManagement };
