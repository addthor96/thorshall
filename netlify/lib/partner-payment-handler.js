"use strict";

const { sessionAccess } = require("./stats-auth");
const { getPartner } = require("./partner-campaigns");
const { PaymentError, openStore, publicPayment, readLedger, validateInput, writePayment } = require("./partner-payment-store");

const MAX_BODY_BYTES = 8192;
const ORIGIN = "https://thorshall.gg";
const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Netlify-CDN-Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  Vary: "Cookie"
};

function json(statusCode, payload, extra = {}) {
  return { statusCode, headers: { ...HEADERS, ...extra }, body: JSON.stringify(payload) };
}

function header(event, name) {
  const entry = Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === name);
  return entry ? entry[1] : "";
}

function productionRejection(event, context = event.deployContext || process.env.CONTEXT) {
  if (context && context !== "production") return "deploy_context";
  try {
    const url = new URL(event.rawUrl);
    if (url.origin !== ORIGIN || url.username || url.password) return "url_origin";
    if (header(event, "host") && header(event, "host").toLowerCase() !== url.host) return "host_mismatch";
    return null;
  } catch { return "malformed_url"; }
}

function isProductionRequest(event, context = event.deployContext || process.env.CONTEXT) {
  return productionRejection(event, context) === null;
}

function storageErrorCategory(error) {
  // Return constants only. Never log SDK error messages: they can contain
  // provider response bodies, store keys or environment configuration details.
  const names = [error?.name, error?.constructor?.name];
  if (names.includes("MissingBlobsEnvironmentError")) return "missing_environment";
  if (names.includes("BlobsConsistencyError")) return "strong_consistency_unavailable";
  if (names.includes("BlobsInternalError")) return "provider_failure";
  if (["MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND"].includes(error?.code)) return "dependency_unavailable";
  if (["Invalid stored payment ledger", "Missing ledger version", "Ledger exceeds limit"].includes(error?.message)) return "invalid_stored_data";
  if (["Unconfirmed ledger write", "Payment write could not be confirmed"].includes(error?.message)) return "unconfirmed_write";
  if (names.includes("SyntaxError")) return "invalid_json";
  if (names.includes("TypeError")) return "type_error";
  if (names.includes("ReferenceError")) return "reference_error";
  return "other";
}

function diagnostic(log, record) {
  try { log(record); } catch { /* Logging must never affect request behavior. */ }
}

function parseBody(event) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(header(event, "content-type"))) throw new PaymentError(415, "Use JSON for payment updates.");
  if (typeof event.body !== "string" || event.body.length > MAX_BODY_BYTES * 2) throw new PaymentError(413, "Payment request is too large.");
  const body = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new PaymentError(413, "Payment request is too large.");
  try { return JSON.parse(body); } catch { throw new PaymentError(400, "Invalid payment request."); }
}

function createHandler({ accessFor = sessionAccess, connectStore = openStore, productionRequest = isProductionRequest, now = () => new Date(), logDiagnostic = record => console.error(JSON.stringify(record)) } = {}) {
  return async function handler(event = {}) {
    const method = event.httpMethod;
    if (!["GET", "POST", "PATCH"].includes(method)) return json(405, { ok: false, error: "Method not allowed." }, { Allow: "GET, POST, PATCH" });
    const query = event.queryStringParameters || {};
    if (Object.keys(query).some(key => key !== "partner")) return json(400, { ok: false, error: "Unsupported payment parameter." });
    const partner = getPartner(query.partner);
    if (!partner) return json(404, { ok: false, error: "Partner dashboard not found." });
    let access = "";
    try { access = accessFor(event); } catch { /* Fail closed for malformed sessions. */ }
    if (!access) return json(401, { ok: false, error: "Sign in to view this dashboard." }, { "WWW-Authenticate": "StatsSession" });
    const admin = access === "admin";
    if (!admin && access !== partner.code) return json(403, { ok: false, error: "You do not have access to this payment history." });
    if (method !== "GET" && !admin) return json(403, { ok: false, error: "Only the site owner can record or correct payments." });
    // All authorization precedes connecting to storage. Production site-wide
    // records cannot be accessed through deploy-preview or branch hostnames.
    if (!productionRequest(event)) {
      diagnostic(logDiagnostic, { event: "partner_payment_production_rejected", reason: productionRejection(event) || "deploy_context" });
      return json(503, { ok: false, error: "Payment history is available on the production dashboard only." });
    }
    let stage = "validation";
    try {
      let operation;
      const current = now();
      if (method !== "GET") {
        const fetchSite = header(event, "sec-fetch-site");
        if (header(event, "origin") !== ORIGIN || (fetchSite && fetchSite !== "same-origin")) {
          throw new PaymentError(403, "Open the dashboard on thorshall.gg before saving a payment.");
        }
        operation = validateInput(parseBody(event), method, current);
      }
      stage = "connect";
      const store = await connectStore();
      if (method === "GET") {
        stage = "read";
        const { ledger } = await readLedger(store, partner.code);
        const payments = ledger.payments.map(payment => publicPayment(payment, admin))
          .sort((a, b) => b.paidAt.localeCompare(a.paidAt) || b.createdAt.localeCompare(a.createdAt));
        return json(200, { ok: true, partner: { code: partner.code, name: partner.name }, canManage: admin, payments, updatedAt: ledger.updatedAt });
      }
      stage = "write";
      const result = await writePayment(store, partner.code, operation, current);
      return json(method === "POST" && !result.duplicate ? 201 : 200, { ok: true, payment: publicPayment(result.payment, true), duplicate: result.duplicate });
    } catch (error) {
      if (error instanceof PaymentError) return json(error.status, { ok: false, error: error.message });
      diagnostic(logDiagnostic, { event: "partner_payment_storage_failure", stage, category: storageErrorCategory(error) });
      // Do not expose raw Netlify errors, request tokens, store keys, or records.
      return json(503, { ok: false, error: "Payment history is temporarily unavailable. If a save failed, retry the same save before adding another payment." });
    }
  };
}

module.exports = { MAX_BODY_BYTES, createHandler, isProductionRequest };
