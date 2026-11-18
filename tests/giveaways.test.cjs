"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const { createSession } = require("../netlify/lib/stats-auth");
const { partners } = require("../netlify/lib/partner-campaigns");
const { createHandler, MAX_BODY_BYTES } = require("../netlify/lib/giveaway-handler");
const { LEDGER_KEY, STORE_NAME, parseAmount, validateInput, validateLedger, storeName, openStore, writeEntry, responseLedger } = require("../netlify/lib/giveaway-store");
const now = () => new Date("2026-11-18T12:34:56.000Z");
const body = (amount = "12.34", requestId = randomUUID()) => ({ requestId, amount });
const json = response => JSON.parse(response.body);
function event(method = "GET", data, overrides = {}) {
  return { httpMethod: method, rawUrl: "https://thorshall.gg/.netlify/functions/giveaways", deployContext: "production", published: true,
    headers: { host: "thorshall.gg", origin: "https://thorshall.gg", "content-type": "application/json", "sec-fetch-site": "same-origin", "x-thorshall-request": "giveaways" },
    queryStringParameters: {}, body: data === undefined ? "" : JSON.stringify(data), ...overrides };
}
function memoryStore() {
  const values = new Map(); let generation = 0, reads = 0, writes = 0;
  return { values, get reads() { return reads; }, get writes() { return writes; },
    async getWithMetadata(key, options) { reads++; assert.equal(options.type, "json"); assert.equal(options.consistency, "strong"); return structuredClone(values.get(key) || null); },
    async setJSON(key, data, options) {
      writes++; const current = values.get(key);
      assert.ok(options.onlyIfNew || options.onlyIfMatch, "write must be conditional");
      if ((options.onlyIfNew && current) || (options.onlyIfMatch && options.onlyIfMatch !== current?.etag)) return { modified: false };
      const etag = `v${++generation}`; values.set(key, { data: structuredClone(data), etag }); return { modified: true, etag };
    }
  };
}
function setup(access = "admin", store = memoryStore()) {
  let connections = 0;
  return { store, get connections() { return connections; }, handler: createHandler({ accessFor: () => access, connectStore: async () => { connections++; return store; }, now, logDiagnostic() {} }) };
}

test("anonymous and every partner cannot read or change the shared giveaway ledger", async () => {
  for (const access of ["", "manuel", "piyush", "radhika", "arshan", ...Object.keys(partners)]) {
    for (const method of ["GET", "POST", "PATCH"]) {
      const app = setup(access), response = await app.handler(event(method, body()));
      assert.equal(response.statusCode, access ? 403 : 401); assert.equal(app.connections, 0);
      assert.equal(json(response).entries, undefined); assert.equal(json(response).totalMinor, undefined);
    }
  }
});

test("real signed sessions and malformed cookies enforce owner access", async () => {
  const previous = process.env.STATS_SESSION_SECRET; process.env.STATS_SESSION_SECRET = "giveaway-test-secret-with-at-least-32-characters";
  try {
    const store = memoryStore(); let connects = 0;
    const handler = createHandler({ connectStore: async () => { connects++; return store; }, now });
    const request = event(); request.headers.cookie = `th_stats_session=${createSession("t2")}`;
    assert.equal((await handler(request)).statusCode, 403); assert.equal(connects, 0);
    request.headers.cookie = "th_stats_session=%bad";
    assert.equal((await handler(request)).statusCode, 401); assert.equal(connects, 0);
    request.headers.cookie = `th_stats_session=${createSession("admin")}`;
    assert.equal((await handler(request)).statusCode, 200); assert.equal(connects, 1);
  } finally { if (previous === undefined) delete process.env.STATS_SESSION_SECRET; else process.env.STATS_SESSION_SECRET = previous; }
});

test("confirmed missing store is empty and private responses forbid caching", async () => {
  const app = setup(), response = await app.handler(event());
  assert.deepEqual(json(response), { ok: true, currency: "USD", totalMinor: 0, count: 0, revision: 0, entries: [] });
  assert.equal(app.store.writes, 0);
  for (const key of ["Cache-Control", "CDN-Cache-Control", "Netlify-CDN-Cache-Control"]) assert.match(response.headers[key], /no-store/);
  assert.equal(response.headers.Vary, "Cookie"); assert.match(response.headers["X-Robots-Tag"], /noindex/);
});

test("USD amount parser uses exact cents and rejects coercion, exponents, zero and excessive precision", () => {
  for (const [input, expected] of [["0.01", 1], ["0.10", 10], ["12.3", 1230], ["12", 1200], ["100000000.00", 10000000000]]) assert.equal(parseAmount(input), expected);
  for (const input of [0.1, 1, null, {}, [], "", "0", "0.00", "-1", "+1", ".1", "01.00", " 1", "1 ", "1.", "1e3", "1E-2", "1.001", "100000000.01", "100000001", "NaN", "Infinity", "1,000.00"]) assert.throws(() => parseAmount(input));
});

test("cents add exactly, persist across handlers, and server timestamps cannot be supplied", async () => {
  const app = setup();
  assert.equal((await app.handler(event("POST", body("0.10")))).statusCode, 201);
  const second = await app.handler(event("POST", body("0.20")));
  assert.equal(json(second).totalMinor, 30); assert.equal(json(second).count, 2); assert.equal(json(second).revision, 2);
  assert.equal(json(second).entries[0].createdAt, now().toISOString());
  const loaded = json(await setup("admin", app.store).handler(event())); assert.equal(loaded.totalMinor, 30);
  const invalid = await app.handler(event("POST", { ...body(), createdAt: "2000-01-01" })); assert.equal(invalid.statusCode, 400);
});

test("idempotent POST retries share one record and changing a used request ID conflicts", async () => {
  const app = setup(), details = body();
  const first = json(await app.handler(event("POST", details)));
  const duplicateResponse = await app.handler(event("POST", { ...details, amount: "12.340" })); assert.equal(duplicateResponse.statusCode, 400);
  const retry = await app.handler(event("POST", details)); assert.equal(retry.statusCode, 200); assert.equal(json(retry).duplicate, true);
  assert.equal(json(retry).revision, 1); assert.equal(app.store.writes, 1); assert.equal(json(retry).entries[0].id, details.requestId);
  assert.equal((await app.handler(event("POST", { ...details, amount: "13" }))).statusCode, 409);
  assert.equal(first.totalMinor, 1234);
});

test("equivalent cent spellings have the same idempotency payload", async () => {
  const app = setup(), details = body("12"); await app.handler(event("POST", details));
  assert.equal(json(await app.handler(event("POST", { ...details, amount: "12.00" }))).duplicate, true);
  assert.equal(app.store.writes, 1);
});

test("lost write response retry does not add twice", async () => {
  const store = memoryStore(), write = store.setJSON.bind(store); let lost = true;
  store.setJSON = async (...args) => { const result = await write(...args); if (lost) { lost = false; throw new Error("provider token must stay private"); } return result; };
  const app = setup("admin", store), details = body("50");
  const failed = await app.handler(event("POST", details)); assert.equal(failed.statusCode, 503); assert.equal(json(failed).totalMinor, undefined);
  const retried = await app.handler(event("POST", details)); assert.equal(retried.statusCode, 200); assert.equal(json(retried).duplicate, true);
  assert.equal(json(retried).totalMinor, 5000); assert.equal(store.writes, 1);
});

test("concurrent different additions and duplicate retries preserve exact shared total", async () => {
  const store = memoryStore(), app = setup("admin", store), a = body("0.10"), b = body("0.20"), c = body("25.35");
  const results = await Promise.all([app.handler(event("POST", a)), app.handler(event("POST", b)), app.handler(event("POST", a)), app.handler(event("POST", c))]);
  assert.ok(results.every(result => [200, 201].includes(result.statusCode)));
  const saved = json(await app.handler(event())); assert.equal(saved.totalMinor, 2565); assert.equal(saved.count, 3); assert.equal(saved.revision, 3);
});

test("undo retains immutable amount/history, subtracts once, and lost-response retry is safe", async () => {
  const app = setup(), add = body("10"), first = json(await app.handler(event("POST", add)));
  const undo = { requestId: randomUUID(), entryId: add.requestId, expectedRevision: first.revision };
  const saved = await app.handler(event("PATCH", undo)); assert.equal(saved.statusCode, 200);
  assert.equal(json(saved).totalMinor, 0); assert.equal(json(saved).count, 0); assert.equal(json(saved).revision, 2);
  assert.deepEqual(json(saved).entries[0], { id: add.requestId, amountMinor: 1000, createdAt: now().toISOString(), status: "void", voidedAt: now().toISOString() });
  const retry = await app.handler(event("PATCH", undo)); assert.equal(retry.statusCode, 200); assert.equal(json(retry).duplicate, true); assert.equal(app.store.writes, 2);
  const addRetry = await app.handler(event("POST", add)); assert.equal(json(addRetry).totalMinor, 0); assert.equal(json(addRetry).entries[0].status, "void");
  const freshUndo = { ...undo, requestId: randomUUID(), expectedRevision: 2 };
  assert.equal((await app.handler(event("PATCH", freshUndo))).statusCode, 409);
  const ledger = app.store.values.get(LEDGER_KEY).data;
  assert.equal(ledger.entries.length, 1); assert.equal(ledger.operations.length, 2); assert.equal(ledger.entries[0].amountMinor, 1000);
});

test("stale undo revision never silently overrides another update", async () => {
  const app = setup(), first = body("10"), saved = json(await app.handler(event("POST", first)));
  await app.handler(event("POST", body("20")));
  assert.equal((await app.handler(event("PATCH", { requestId: randomUUID(), entryId: first.requestId, expectedRevision: saved.revision }))).statusCode, 409);
  assert.equal(json(await app.handler(event())).totalMinor, 3000);
});

test("racing voids only subtract once and concurrent new adds survive", async () => {
  const app = setup(), first = body("10"); await app.handler(event("POST", first));
  const undo = { requestId: randomUUID(), entryId: first.requestId, expectedRevision: 1 };
  const results = await Promise.all([app.handler(event("PATCH", undo)), app.handler(event("PATCH", undo)), app.handler(event("POST", body("5")))]);
  assert.ok(results.every(response => [200, 201].includes(response.statusCode)));
  assert.equal(json(await app.handler(event())).totalMinor, 500); assert.equal(json(await app.handler(event())).count, 1);
});

test("only latest 20 entries are returned while total/count include the full ledger", async () => {
  const app = setup(); let lastId;
  for (let i = 0; i < 25; i++) { const details = body("1"); lastId = details.requestId; await app.handler(event("POST", details)); }
  const result = json(await app.handler(event())); assert.equal(result.entries.length, 20); assert.equal(result.entries[0].id, lastId);
  assert.equal(result.totalMinor, 2500); assert.equal(result.count, 25); assert.equal(result.revision, 25);
  assert.doesNotMatch(JSON.stringify(result), /digest|requestId|operations|etag/);
});

test("same-origin JSON and CSRF checks reject forged or oversized writes before storage", async () => {
  const changes = [{ origin: "" }, { origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }, { "x-thorshall-request": "" }, { host: "preview.netlify.app" }];
  for (const change of changes) { const app = setup(), request = event("POST", body()); Object.assign(request.headers, change); assert.equal((await app.handler(request)).statusCode, 403); assert.equal(app.connections, 0); }
  const cases = [[{ body: "x".repeat(MAX_BODY_BYTES + 1) }, 413], [{ body: "{" }, 400]];
  for (const [overrides, code] of cases) { const app = setup(); assert.equal((await app.handler(event("POST", body(), overrides))).statusCode, code); assert.equal(app.connections, 0); }
  const app = setup(), request = event("POST", body()); request.headers["content-type"] = "text/plain"; assert.equal((await app.handler(request)).statusCode, 415); assert.equal(app.connections, 0);
});

test("strict field and method validation rejects unsupported edits", async () => {
  const app = setup();
  for (const input of [{ ...body(), totalMinor: 100 }, { ...body(), currency: "EUR" }, { requestId: "invalid", amount: "1" }, null, []]) assert.equal((await app.handler(event("POST", input))).statusCode, 400);
  assert.equal((await app.handler(event("PATCH", { requestId: randomUUID(), entryId: randomUUID(), expectedRevision: 0 }))).statusCode, 400);
  assert.equal((await app.handler(event("DELETE"))).statusCode, 405);
  assert.equal((await app.handler(event("GET", undefined, { queryStringParameters: { public: "1" } }))).statusCode, 400);
  assert.equal(app.connections, 0);
});

test("preview hosts and contexts always use stores separate from production", () => {
  const prod = event(); assert.equal(storeName(prod), STORE_NAME);
  const cases = [event("GET", undefined, { published: false }), event("GET", undefined, { deployContext: "deploy-preview" }), event("GET", undefined, { deployContext: undefined, published: undefined }),
    event("GET", undefined, { rawUrl: "https://test--thorshall.netlify.app/.netlify/functions/giveaways", headers: { host: "test--thorshall.netlify.app" } }),
    event("GET", undefined, { rawUrl: "http://localhost:8888/.netlify/functions/giveaways", deployContext: "dev", headers: { host: "localhost:8888" } })];
  for (const request of cases) { assert.notEqual(storeName(request), STORE_NAME); assert.match(storeName(request), /-preview-/); assert.ok(storeName(request).length < 64); }
  assert.throws(() => storeName(event("GET", undefined, { headers: { host: "evil.example" } })));
  const names = [];
  openStore(options => { names.push(options.name); assert.equal(options.consistency, "strong"); }, cases[0]);
  assert.notEqual(names[0], STORE_NAME);
});

test("read failures and corrupted totals fail closed without invented zero totals", async () => {
  const secret = "DO-NOT-EXPOSE-PRIVATE-PROVIDER-DATA";
  for (const store of [{ getWithMetadata: async () => { throw new Error(secret); } }, { getWithMetadata: async () => undefined }]) {
    const app = setup("admin", store), response = await app.handler(event()); assert.equal(response.statusCode, 503); assert.equal(json(response).totalMinor, undefined); assert.doesNotMatch(response.body, new RegExp(secret));
  }
  const app = setup(); await app.handler(event("POST", body("1")));
  app.store.values.get(LEDGER_KEY).data.totalMinor = 0;
  const response = await app.handler(event()); assert.equal(response.statusCode, 503); assert.equal(json(response).totalMinor, undefined);
  app.store.values.get(LEDGER_KEY).data.totalMinor = Number.MAX_SAFE_INTEGER + 1;
  assert.equal((await app.handler(event())).statusCode, 503);
});

test("silent write failures and failed confirmation cannot claim a successful save", async () => {
  for (const outcome of [undefined, { modified: true }, { modified: true, etag: "" }, { modified: true, etag: "pretend-version" }]) {
    const store = memoryStore(); store.setJSON = async () => outcome;
    const response = await setup("admin", store).handler(event("POST", body())); assert.equal(response.statusCode, 503); assert.equal(json(response).totalMinor, undefined);
  }
  const store = memoryStore(); store.setJSON = async () => ({ modified: false });
  assert.equal((await setup("admin", store).handler(event("POST", body()))).statusCode, 409);
});

test("history corruption is detected instead of dropping records", async () => {
  const app = setup(), details = body(); await app.handler(event("POST", details));
  const ledger = structuredClone(app.store.values.get(LEDGER_KEY).data);
  ledger.operations = []; ledger.revision = 0;
  assert.throws(() => validateLedger(ledger));
});

test("modern endpoint denies unauthorized requests before reading their body and bounds owner uploads", async () => {
  const previous = process.env.STATS_SESSION_SECRET; process.env.STATS_SESSION_SECRET = "giveaway-modern-test-secret-with-32-characters";
  try {
    const modern = await import(pathToFileURL(path.resolve(__dirname, "../netlify/functions/giveaways.mjs")).href);
    const unauthorized = new Request("https://thorshall.gg/.netlify/functions/giveaways", { method: "POST", body: "x".repeat(MAX_BODY_BYTES + 1) });
    assert.equal((await modern.default(unauthorized, { deploy: { context: "production", published: true } })).status, 401); assert.equal(unauthorized.bodyUsed, false);
    const headers = event().headers; headers.cookie = `th_stats_session=${createSession("admin")}`;
    const oversize = new Request("https://thorshall.gg/.netlify/functions/giveaways", { method: "POST", headers, body: "x".repeat(MAX_BODY_BYTES + 1) });
    assert.equal((await modern.default(oversize, { deploy: { context: "production", published: true } })).status, 413);
  } finally { if (previous === undefined) delete process.env.STATS_SESSION_SECRET; else process.env.STATS_SESSION_SECRET = previous; }
});
