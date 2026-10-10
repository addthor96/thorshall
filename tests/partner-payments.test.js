"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createHandler, isProductionRequest } = require("../netlify/lib/partner-payment-handler");
const { canonicalAmount, validateInput, writePayment, openStore } = require("../netlify/lib/partner-payment-store");
const { createSession } = require("../netlify/lib/stats-auth");

const now = () => new Date("2026-10-10T12:00:00.000Z");
function payload(overrides = {}) {
  return { requestId: randomUUID(), reportingMonth: "2026-09", amountPaid: "500", currency: "USD", paidAt: "2026-10-10", reference: "tx123", ...overrides };
}
function event(method = "GET", body, partner = "t2", overrides = {}) {
  return { httpMethod: method, rawUrl: `https://thorshall.gg/.netlify/functions/partner-payments?partner=${partner}`, deployContext: "production",
    headers: { host: "thorshall.gg", origin: "https://thorshall.gg", "content-type": "application/json", "sec-fetch-site": "same-origin" },
    queryStringParameters: { partner }, body: body === undefined ? "" : JSON.stringify(body), ...overrides };
}
function memoryStore() {
  const values = new Map();
  let reads = 0, writes = 0, generation = 0;
  return {
    values,
    get reads() { return reads; }, get writes() { return writes; },
    async getWithMetadata(key, options) { reads += 1; assert.equal(options.consistency, "strong"); assert.equal(options.type, "json"); return structuredClone(values.get(key) || null); },
    async setJSON(key, data, options) {
      writes += 1;
      const previous = values.get(key);
      if ((options.onlyIfNew && previous) || (options.onlyIfMatch && previous?.etag !== options.onlyIfMatch)) return { modified: false };
      assert.ok(options.onlyIfNew || options.onlyIfMatch, "every write must be conditional");
      const etag = `v${++generation}`;
      values.set(key, { data: structuredClone(data), etag });
      return { modified: true, etag };
    }
  };
}
function setup(access = "admin", store = memoryStore()) {
  let connections = 0;
  return { store, get connections() { return connections; }, handler: createHandler({ accessFor: () => access, connectStore: async () => { connections += 1; return store; }, now }) };
}
function json(result) { return JSON.parse(result.body); }

test("anonymous, wrong partner and partner mutations fail before storage", async () => {
  for (const [access, method, expected] of [["", "GET", 401], ["t1", "GET", 403], ["t2", "POST", 403], ["t2", "PATCH", 403]]) {
    const app = setup(access);
    assert.equal((await app.handler(event(method, payload()))).statusCode, expected);
    assert.equal(app.connections, 0);
  }
});

test("real signed sessions enforce both partner isolation and admin writes", async () => {
  const oldSecret = process.env.STATS_SESSION_SECRET;
  process.env.STATS_SESSION_SECRET = "payment-test-secret-that-is-at-least-32-characters";
  try {
    const store = memoryStore();
    const handler = createHandler({ connectStore: async () => store, now });
    const own = event(); own.headers.cookie = `th_stats_session=${createSession("t2")}`;
    assert.equal((await handler(own)).statusCode, 200);
    const other = event("GET", undefined, "t1"); other.headers.cookie = own.headers.cookie;
    assert.equal((await handler(other)).statusCode, 403);
    const save = event("POST", payload()); save.headers.cookie = own.headers.cookie;
    assert.equal((await handler(save)).statusCode, 403);
    save.headers.cookie = `th_stats_session=${createSession("admin")}`;
    assert.equal((await handler(save)).statusCode, 201);
  } finally {
    if (oldSecret === undefined) delete process.env.STATS_SESSION_SECRET; else process.env.STATS_SESSION_SECRET = oldSecret;
  }
});

test("GET on an empty store shows honest empty list and private no-store headers", async () => {
  const app = setup("t2");
  const response = await app.handler(event());
  assert.equal(response.statusCode, 200);
  assert.deepEqual(json(response), { ok: true, partner: { code: "t2", name: "Swagat Nayak" }, canManage: false, payments: [], updatedAt: null });
  for (const key of ["Cache-Control", "CDN-Cache-Control", "Netlify-CDN-Cache-Control"]) assert.match(response.headers[key], /no-store/);
  assert.equal(response.headers.Vary, "Cookie");
});

test("reject unknown partners, unsupported query fields and methods", async () => {
  const app = setup();
  assert.equal((await app.handler(event("GET", undefined, "../t2"))).statusCode, 404);
  assert.equal((await app.handler(event("GET", undefined, "t2", { queryStringParameters: { partner: "t2", campaign: "130933" } }))).statusCode, 400);
  assert.equal((await app.handler(event("DELETE"))).statusCode, 405);
  assert.equal(app.connections, 0);
});

test("reject absent/cross-site origins and non-JSON or oversized requests before storage", async () => {
  const cases = [
    [{ origin: "" }, 403], [{ origin: "https://evil.example" }, 403], [{ "sec-fetch-site": "cross-site" }, 403],
    [{ "content-type": "text/plain" }, 415]
  ];
  for (const [headers, expected] of cases) {
    const app = setup(); const request = event("POST", payload()); Object.assign(request.headers, headers);
    assert.equal((await app.handler(request)).statusCode, expected); assert.equal(app.connections, 0);
  }
  const app = setup();
  assert.equal((await app.handler(event("POST", payload(), "t2", { body: "x".repeat(9000) }))).statusCode, 413);
  assert.equal((await app.handler(event("POST", payload(), "t2", { body: "{" }))).statusCode, 400);
  assert.equal(app.connections, 0);
});

test("only canonical production requests may reach shared production storage", async () => {
  assert.equal(isProductionRequest(event(), "production"), true);
  for (const url of ["https://preview.netlify.app/", "http://thorshall.gg/", "https://thorshall.gg:8443/", "https://user@thorshall.gg/", "https://thorshall.gg.evil.example/"]) {
    assert.equal(isProductionRequest(event("GET", undefined, "t2", { rawUrl: url }), "production"), false);
  }
  assert.equal(isProductionRequest(event(), "deploy-preview"), false);
  const forged = event(); forged.headers.host = "preview.netlify.app";
  assert.equal(isProductionRequest(forged, "production"), false);
  const app = setup();
  assert.equal((await app.handler(event("GET", undefined, "t2", { deployContext: "branch-deploy" }))).statusCode, 503);
  assert.equal(app.connections, 0);
});

test("exact amounts reject floats, exponent notation, unsupported precision and currencies", () => {
  assert.equal(canonicalAmount("0.01", "USD"), "0.01");
  assert.equal(canonicalAmount("123", "USD"), "123.00");
  assert.equal(canonicalAmount("1.000001", "USDT"), "1.000001");
  assert.equal(canonicalAmount("123", "ISK"), "123");
  for (const [value, currency] of [[0.1, "USD"], ["1e3", "USD"], ["0", "USD"], ["-1", "USD"], ["01", "USD"], [".1", "USD"], ["1.001", "USD"], ["1.0", "ISK"], ["1.0000001", "USDT"], ["1000000000.01", "USD"], ["1", "BTC"], ["1", "constructor"], ["1", "__proto__"], ["1", ["USD"]]]) {
    assert.throws(() => canonicalAmount(value, currency));
  }
});

test("invalid dates, future fields, unknown fields and control characters fail validation", async () => {
  for (const overrides of [{ paidAt: "2026-02-30" }, { paidAt: "2026-10-11" }, { reportingMonth: "2026-11" }, { reportingMonth: "2026-13" }, { reportingMonth: "1999-01" }, { reference: "secret\nrow" }, { reference: "a".repeat(201) }, { isAdmin: true }, { requestId: "invalid" }]) {
    const app = setup();
    assert.equal((await app.handler(event("POST", payload(overrides)))).statusCode, 400);
    assert.equal(app.connections, 0);
  }
});

test("POST idempotency prevents duplicates; conflicting request reuse is rejected", async () => {
  const app = setup(); const details = payload();
  const first = await app.handler(event("POST", details));
  assert.equal(first.statusCode, 201); assert.equal(json(first).payment.amountPaid, "500.00");
  const duplicate = await app.handler(event("POST", details));
  assert.equal(duplicate.statusCode, 200); assert.equal(json(duplicate).duplicate, true); assert.equal(app.store.writes, 1);
  assert.equal((await app.handler(event("POST", { ...details, amountPaid: "600" }))).statusCode, 409);
  assert.equal(json(await app.handler(event())).payments.length, 1);
});

test("partner records remain separate and history is visible only to admin", async () => {
  const admin = setup();
  await admin.handler(event("POST", payload(), "t2"));
  assert.equal(json(await admin.handler(event("GET", undefined, "t1"))).payments.length, 0);
  assert.equal(json(await admin.handler(event())).payments[0].history.length, 1);
  const partner = setup("t2", admin.store);
  const record = json(await partner.handler(event())).payments[0];
  assert.equal(record.history, undefined); assert.equal(record.status, "paid");
  assert.doesNotMatch(JSON.stringify(record), /requestId|digest/);
});

test("correction requires revision, appends history, and duplicate correction is safe", async () => {
  const app = setup(); const first = json(await app.handler(event("POST", payload()))).payment;
  const correction = payload({ id: first.id, expectedRevision: 1, amountPaid: "600", correctionReason: "Corrected receipt amount" });
  const saved = await app.handler(event("PATCH", correction));
  assert.equal(saved.statusCode, 200);
  assert.equal(json(saved).payment.revision, 2); assert.equal(json(saved).payment.history[0].amountPaid, "500.00");
  assert.equal(json(saved).payment.history[1].amountPaid, "600.00");
  assert.equal(json(await app.handler(event("PATCH", correction))).duplicate, true);
  const stale = await app.handler(event("PATCH", { ...correction, requestId: randomUUID(), amountPaid: "700" }));
  assert.equal(stale.statusCode, 409);
  assert.equal(json(await app.handler(event())).payments[0].amountPaid, "600.00");
  assert.equal((await app.handler(event("PATCH", { ...correction, requestId: randomUUID(), expectedRevision: 2, correctionReason: "" }))).statusCode, 400);
});

test("concurrent creates and retries preserve distinct records with no duplicates", async () => {
  const store = memoryStore();
  const first = validateInput(payload(), "POST", now());
  const second = validateInput(payload(), "POST", now());
  await Promise.all([writePayment(store, "t2", first, now()), writePayment(store, "t2", second, now()), writePayment(store, "t2", first, now())]);
  assert.equal(store.values.get("ledger/t2").data.payments.length, 2);
});

test("concurrent corrections cannot silently overwrite each other", async () => {
  const store = memoryStore();
  const base = await writePayment(store, "t2", validateInput(payload(), "POST", now()), now());
  const a = validateInput(payload({ id: base.payment.id, expectedRevision: 1, amountPaid: "601", correctionReason: "First correction" }), "PATCH", now());
  const b = validateInput(payload({ id: base.payment.id, expectedRevision: 1, amountPaid: "602", correctionReason: "Second correction" }), "PATCH", now());
  const result = await Promise.allSettled([writePayment(store, "t2", a, now()), writePayment(store, "t2", b, now())]);
  assert.equal(result.filter(value => value.status === "fulfilled").length, 1);
  assert.equal(result.find(value => value.status === "rejected").reason.status, 409);
  assert.equal(store.values.get("ledger/t2").data.payments[0].history.length, 2);
});

test("storage errors and silent SDK write failures are sanitized, never reported as saved", async () => {
  const secret = "DO-NOT-EXPOSE-TOKEN";
  const app = createHandler({ accessFor: () => "admin", connectStore: async () => { throw new Error(secret); }, now });
  const unavailable = await app(event());
  assert.equal(unavailable.statusCode, 503); assert.doesNotMatch(unavailable.body, new RegExp(secret));
  for (const result of [{ modified: true, etag: "" }, { modified: true, etag: "fake" }, undefined]) {
    const store = memoryStore(); store.setJSON = async () => result;
    const broken = setup("admin", store);
    assert.equal((await broken.handler(event("POST", payload()))).statusCode, 503);
  }
});

test("ambiguous response after successful write can safely retry same request", async () => {
  const store = memoryStore(); const set = store.setJSON.bind(store); let first = true;
  store.setJSON = async (...args) => { const result = await set(...args); if (first) { first = false; throw new Error("network lost response"); } return result; };
  const app = setup("admin", store); const details = payload();
  assert.equal((await app.handler(event("POST", details))).statusCode, 503);
  const retry = await app.handler(event("POST", details));
  assert.equal(retry.statusCode, 200); assert.equal(json(retry).duplicate, true); assert.equal(store.values.get("ledger/t2").data.payments.length, 1);
});

test("malformed or mismatched stored ledger fails closed instead of showing empty history", async () => {
  for (const data of [{}, { schemaVersion: 1, partnerCode: "t1", payments: [], updatedAt: now().toISOString() }]) {
    const store = memoryStore(); store.values.set("ledger/t2", { data, etag: "v1" });
    assert.equal((await setup("admin", store).handler(event())).statusCode, 503);
  }
});

test("modern adapter bounds streamed bodies and propagates production context", async () => {
  const { default: adapter } = await import("../netlify/functions/partner-payments.mjs");
  const oversized = new Request("https://thorshall.gg/.netlify/functions/partner-payments?partner=t2", { method: "POST", body: "x".repeat(8193) });
  assert.equal((await adapter(oversized, { deploy: { context: "production" } })).status, 413);
  const anonymous = new Request("https://thorshall.gg/.netlify/functions/partner-payments?partner=t2");
  assert.equal((await adapter(anonymous, { deploy: { context: "production" } })).status, 401);
  const oldSecret = process.env.STATS_SESSION_SECRET;
  process.env.STATS_SESSION_SECRET = "payment-adapter-secret-that-is-at-least-32-characters";
  try {
    const signed = new Request("https://thorshall.gg/.netlify/functions/partner-payments?partner=t2", { headers: { cookie: `th_stats_session=${createSession("admin")}` } });
    const preview = await adapter(signed, { deploy: { context: "deploy-preview" } });
    assert.equal(preview.status, 503);
    assert.match((await preview.json()).error, /production dashboard only/);
  } finally {
    if (oldSecret === undefined) delete process.env.STATS_SESSION_SECRET; else process.env.STATS_SESSION_SECRET = oldSecret;
  }
});

test("missing native Blobs configuration fails closed with no filesystem fallback", async () => {
  const old = process.env.NETLIFY_BLOBS_CONTEXT;
  const global = globalThis.netlifyBlobsContext;
  delete process.env.NETLIFY_BLOBS_CONTEXT; delete globalThis.netlifyBlobsContext;
  try { await assert.rejects(openStore()); }
  finally {
    if (old !== undefined) process.env.NETLIFY_BLOBS_CONTEXT = old;
    if (global !== undefined) globalThis.netlifyBlobsContext = global;
  }
});
