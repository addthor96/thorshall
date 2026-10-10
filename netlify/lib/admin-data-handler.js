"use strict";

const { sessionAccess, creatorPassword } = require("./stats-auth");
const { partners, getPartner } = require("./partner-campaigns");
const { isProductionRequest } = require("./partner-payment-handler");
const { AdminDataError, openStore, publicManagement, readManagement, validateInput, writeManagement } = require("./admin-partner-store");

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

function parseBody(event) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(header(event, "content-type"))) throw new AdminDataError(415, "Use JSON for partner updates.");
  if (typeof event.body !== "string" || event.body.length > MAX_BODY_BYTES * 2) throw new AdminDataError(413, "Partner update is too large.");
  const body = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new AdminDataError(413, "Partner update is too large.");
  try { return JSON.parse(body); } catch { throw new AdminDataError(400, "Invalid partner update."); }
}

function partnerView(partner, management, passwordFor) {
  // Fixed registry identity cannot be overridden by saved metadata. A boolean
  // is the only credential-related value ever exposed to the admin interface.
  return { ...partner, passwordConfigured: Boolean(passwordFor(partner.code)), management };
}

function createHandler({ accessFor = sessionAccess, passwordFor = creatorPassword, connectStore = openStore,
  productionRequest = isProductionRequest, now = () => new Date(), logDiagnostic = record => console.error(JSON.stringify(record)) } = {}) {
  return async function handler(event = {}) {
    const method = event.httpMethod;
    if (!["GET", "PATCH"].includes(method)) return json(405, { ok: false, error: "Method not allowed." }, { Allow: "GET, PATCH" });
    let access = "";
    try { access = accessFor(event); } catch { /* Malformed sessions fail closed. */ }
    if (!access) return json(401, { ok: false, error: "Sign in to the admin hub." }, { "WWW-Authenticate": "StatsSession" });
    if (access !== "admin") return json(403, { ok: false, error: "Only the site owner can access partner management." });
    const query = event.queryStringParameters || {};
    if (Object.keys(query).some(key => key !== "partner") || (method === "GET" && Object.keys(query).length)) {
      return json(400, { ok: false, error: "Unsupported management parameter." });
    }
    const partner = method === "PATCH" && typeof query.partner === "string" ? getPartner(query.partner) : null;
    if (method === "PATCH" && (!partner || partner.code !== query.partner)) return json(404, { ok: false, error: "Partner dashboard not found." });
    if (!productionRequest(event)) return json(503, { ok: false, error: "Partner management is available on the production admin hub only." });
    let stage = "validation";
    try {
      let operation;
      if (method === "PATCH") {
        const fetchSite = header(event, "sec-fetch-site");
        if (header(event, "origin") !== ORIGIN || (fetchSite && fetchSite !== "same-origin")) {
          throw new AdminDataError(403, "Open the admin hub on thorshall.gg before saving.");
        }
        operation = validateInput(parseBody(event));
      }
      stage = "connect";
      const store = await connectStore();
      if (method === "GET") {
        stage = "read";
        const views = await Promise.all(Object.values(partners).map(async item => {
          const { record } = await readManagement(store, item.code);
          return partnerView(item, publicManagement(record), passwordFor);
        }));
        return json(200, { ok: true, partners: views });
      }
      stage = "write";
      const management = await writeManagement(store, partner.code, operation, now());
      return json(200, { ok: true, partner: partnerView(partner, management, passwordFor) });
    } catch (error) {
      if (error instanceof AdminDataError) return json(error.status, { ok: false, error: error.message });
      // Never log raw SDK errors, private notes, environment variables or keys.
      try { logDiagnostic({ event: "admin_partner_storage_failure", stage }); } catch { /* Logging cannot change the response. */ }
      return json(503, { ok: false, error: "Partner management is temporarily unavailable. Retry the same save if an update failed." });
    }
  };
}

module.exports = { HEADERS, MAX_BODY_BYTES, createHandler };
