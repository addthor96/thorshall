"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHandler } = require("../netlify/lib/admin-data-handler");
const { openStore, readManagement, validateInput, writeManagement } = require("../netlify/lib/admin-partner-store");
const { createSession } = require("../netlify/lib/stats-auth");

const now = () => new Date("2026-10-10T13:00:00.000Z");
function input(overrides = {}) { return { expectedRevision: 0, workflow: "review", notes: "Follow up next week.", ...overrides }; }
function event(method = "GET", body, partner = "t2", overrides = {}) {
  return {
    httpMethod: method, rawUrl: "https://thorshall.gg/.netlify/functions/admin-data", deployContext: "production",
    headers: { host: "thorshall.gg", origin: "https://thorshall.gg", "content-type": "application/json", "sec-fetch-site": "same-origin" },
    queryStringParameters: method === "GET" ? {} : { partner }, body: body === undefined ? "" : JSON.stringify(body), ...overrides
  };
}
function memoryStore() {
  const values = new Map();
  let reads = 0, writes = 0, generation = 0;
  return {
    values, get reads() { return reads; }, get writes() { return writes; },
    async getWithMetadata(key, options) {
      reads += 1;
      assert.equal(options.consistency, "strong"); assert.equal(options.type, "json");
      return structuredClone(values.get(key) || null);
    },
    async setJSON(key, data, options) {
      writes += 1;
      const previous = values.get(key);
      assert.ok(options.onlyIfNew || options.onlyIfMatch, "every write must be conditional");
      if ((options.onlyIfNew && previous) || (options.onlyIfMatch && previous?.etag !== options.onlyIfMatch)) return { modified: false };
      const etag = `v${++generation}`;
      values.set(key, { data: structuredClone(data), etag });
      return { modified: true, etag };
    }
  };
}
function setup(access = "admin", store = memoryStore()) {
  let connections = 0;
  const diagnostics = [];
  return { store, diagnostics, get connections() { return connections; }, handler: createHandler({
    accessFor: () => access, connectStore: async () => { connections += 1; return store; }, now,
    passwordFor: code => code === "t2" ? "DO-NOT-EXPOSE-PRIVATE-PASSWORD" : "", logDiagnostic: record => diagnostics.push(record)
  }) };
}
function json(response) { return JSON.parse(response.body); }

test("admin metadata rejects anonymous and every partner role before touching storage", async () => {
  for (const access of ["", "t1", "t2", "aditya", "unknown"]) {
    for (const method of ["GET", "PATCH"]) {
      const app = setup(access);
      assert.equal((await app.handler(event(method, input()))).statusCode, access ? 403 : 401);
      assert.equal(app.connections, 0);
    }
  }
  const handler = createHandler({ accessFor: () => { throw new Error("bad cookie"); }, connectStore: () => assert.fail("storage unauthorized") });
  assert.equal((await handler(event())).statusCode, 401);
});

test("real signed admin and partner sessions enforce the role boundary", async () => {
  const previous = process.env.STATS_SESSION_SECRET;
  process.env.STATS_SESSION_SECRET = "admin-test-session-secret-at-least-32-characters";
  try {
    const handler = createHandler({ connectStore: async () => memoryStore(), now });
    for (const scope of ["t1", "t2", "admin"]) {
      const request = event(); request.headers.cookie = `th_stats_session=${createSession(scope)}`;
      assert.equal((await handler(request)).statusCode, scope === "admin" ? 200 : 403);
    }
    const tampered = event(); tampered.headers.cookie = `th_stats_session=${createSession("admin")}x`;
    assert.equal((await handler(tampered)).statusCode, 401);
  } finally {
    if (previous === undefined) delete process.env.STATS_SESSION_SECRET; else process.env.STATS_SESSION_SECRET = previous;
  }
});

test("empty metadata reads retain fixed registry and reveal only password configuration booleans", async () => {
  const app = setup();
  const response = await app.handler(event());
  assert.equal(response.statusCode, 200);
  const result = json(response);
  assert.equal(result.partners.length, 2);
  assert.deepEqual(result.partners.map(partner => [partner.code, partner.campaignId, partner.passwordConfigured]), [["t1", "130933", false], ["t2", "150649", true]]);
  assert.equal(result.partners[1].name, "Swagat Nayak");
  assert.equal(result.partners[1].dashboardPath, "/t2-dashboard");
  assert.deepEqual(result.partners[1].management, { workflow: "active", notes: "", revision: 0, updatedAt: null });
  assert.doesNotMatch(response.body, /DO-NOT-EXPOSE|STATS_PASSWORD|schemaVersion|partnerCode/);
  for (const name of ["Cache-Control", "CDN-Cache-Control", "Netlify-CDN-Cache-Control"]) assert.match(response.headers[name], /no-store/);
  assert.equal(response.headers.Vary, "Cookie");
  assert.equal(app.store.writes, 0);
});

test("unknown queries, methods and partner identifiers fail without storage", async () => {
  const app = setup();
  for (const code of ["t3", "../t2", "constructor", "__proto__", ["t2"], "T2"]) {
    assert.equal((await app.handler(event("PATCH", input(), code))).statusCode, 404);
  }
  for (const queryStringParameters of [{ partner: "t2" }, { campaignId: "150649" }]) {
    assert.equal((await app.handler(event("GET", undefined, "t2", { queryStringParameters }))).statusCode, 400);
  }
  assert.equal((await app.handler(event("PATCH", input(), "t2", { queryStringParameters: { partner: "t2", admin: true } }))).statusCode, 400);
  assert.equal((await app.handler(event("POST", input()))).statusCode, 405);
  assert.equal((await app.handler(event("DELETE"))).statusCode, 405);
  assert.equal(app.connections, 0);
});

test("exact same origin and JSON are required before updates reach storage", async () => {
  for (const [headers, status] of [[{ origin: "" }, 403], [{ origin: "null" }, 403], [{ origin: "https://other.example" }, 403],
    [{ "sec-fetch-site": "cross-site" }, 403], [{ "sec-fetch-site": "same-site" }, 403], [{ "content-type": "text/plain" }, 415]]) {
    const app = setup(); const request = event("PATCH", input()); Object.assign(request.headers, headers);
    assert.equal((await app.handler(request)).statusCode, status); assert.equal(app.connections, 0);
  }
  const app = setup();
  assert.equal((await app.handler(event("PATCH", input(), "t2", { body: "x".repeat(8193) }))).statusCode, 413);
  assert.equal((await app.handler(event("PATCH", input(), "t2", { body: "{" }))).statusCode, 400);
  assert.equal(app.connections, 0);
});

test("production host and deploy context gates protect shared production records", async () => {
  const app = setup();
  for (const overrides of [{ rawUrl: "https://preview.netlify.app/.netlify/functions/admin-data" }, { deployContext: "deploy-preview" },
    { rawUrl: "http://thorshall.gg/" }, { headers: { host: "branch.netlify.app" } }]) {
    assert.equal((await app.handler(event("GET", undefined, "t2", overrides))).statusCode, 503);
  }
  assert.equal(app.connections, 0);
});

test("input validation rejects identity changes and invalid workflow, revision and notes", async () => {
  const invalid = [{ campaignId: "130933" }, { name: "Other" }, { passwordConfigured: true }, { isAdmin: true },
    { expectedRevision: -1 }, { expectedRevision: "0" }, { expectedRevision: 0.1 }, { workflow: "deleted" }, { workflow: ["active"] },
    { notes: null }, { notes: "a".repeat(2001) }, { notes: "private\u0000data" }, { notes: "private\u007fdata" }];
  for (const override of invalid) {
    const app = setup();
    assert.equal((await app.handler(event("PATCH", input(override)))).statusCode, 400);
    assert.equal(app.connections, 0);
  }
  for (const body of [null, [], 4, {}, { workflow: "active", notes: "" }]) assert.throws(() => validateInput(body));
});

test("create and update private metadata preserves identity and partner isolation", async () => {
  const app = setup();
  const first = await app.handler(event("PATCH", input({ notes: "  Line one\nLine two  " })));
  assert.equal(first.statusCode, 200);
  assert.deepEqual(json(first).partner.management, { workflow: "review", notes: "Line one\nLine two", revision: 1, updatedAt: now().toISOString() });
  assert.equal(json(first).partner.campaignId, "150649");
  const second = await app.handler(event("PATCH", input({ expectedRevision: 1, workflow: "paused", notes: "Awaiting response." })));
  assert.equal(second.statusCode, 200); assert.equal(json(second).partner.management.revision, 2);
  const all = json(await app.handler(event())).partners;
  assert.deepEqual(all[0].management, { workflow: "active", notes: "", revision: 0, updatedAt: null });
  assert.equal(all[1].management.workflow, "paused");
  assert.equal(all[1].landingPath, "/t2");
  assert.equal(all[1].campaignUrl, "https://playrainbet.com/tggbn1yfr");
});

test("same metadata retry is idempotent and stale changes do not overwrite", async () => {
  const app = setup(); const details = input();
  assert.equal((await app.handler(event("PATCH", details))).statusCode, 200);
  const retry = await app.handler(event("PATCH", details));
  assert.equal(retry.statusCode, 200); assert.equal(json(retry).partner.management.revision, 1); assert.equal(app.store.writes, 1);
  assert.equal((await app.handler(event("PATCH", { ...details, notes: "Different stale content" }))).statusCode, 409);
  assert.equal((await app.handler(event("PATCH", { ...details, expectedRevision: 99 }))).statusCode, 409);
  assert.equal(app.store.writes, 1);
  assert.equal((await app.handler(event("PATCH", { ...details, expectedRevision: 1, notes: "" }))).statusCode, 200);
  assert.equal(json(await app.handler(event())).partners[1].management.notes, "");
});

test("concurrent metadata changes cannot silently overwrite the same revision", async () => {
  const store = memoryStore();
  const result = await Promise.allSettled([
    writeManagement(store, "t2", validateInput(input({ notes: "First edit" })), now()),
    writeManagement(store, "t2", validateInput(input({ notes: "Other edit" })), now())
  ]);
  assert.equal(result.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(result.find(item => item.status === "rejected").reason.status, 409);
  assert.equal(store.values.get("management/t2").data.revision, 1);
});

test("concurrent identical metadata retries persist only one revision", async () => {
  const store = memoryStore(); const operation = validateInput(input());
  const result = await Promise.all([writeManagement(store, "t2", operation, now()), writeManagement(store, "t2", operation, now())]);
  assert.equal(result[0].revision, 1); assert.equal(result[1].revision, 1);
  assert.equal(store.values.get("management/t2").data.revision, 1);
});

test("lost save response retries against persisted desired content", async () => {
  const store = memoryStore(); const save = store.setJSON.bind(store); let first = true;
  store.setJSON = async (...args) => { const result = await save(...args); if (first) { first = false; throw new Error("Lost response"); } return result; };
  const app = setup("admin", store);
  assert.equal((await app.handler(event("PATCH", input()))).statusCode, 503);
  const retry = await app.handler(event("PATCH", input()));
  assert.equal(retry.statusCode, 200); assert.equal(json(retry).partner.management.revision, 1); assert.equal(store.writes, 1);
});

test("storage outage is explicit and sanitized rather than empty active metadata", async () => {
  const secret = "PRIVATE-NOTES-AND-PROVIDER-TOKEN";
  const diagnostics = [];
  const handler = createHandler({ accessFor: () => "admin", connectStore: () => { throw new Error(secret); }, logDiagnostic: record => diagnostics.push(record) });
  const response = await handler(event());
  assert.equal(response.statusCode, 503);
  assert.deepEqual(Object.keys(json(response)).sort(), ["error", "ok"]);
  assert.doesNotMatch(response.body + JSON.stringify(diagnostics), new RegExp(secret));
  assert.deepEqual(diagnostics, [{ event: "admin_partner_storage_failure", stage: "connect" }]);
  const store = memoryStore(); const read = store.getWithMetadata.bind(store);
  store.getWithMetadata = async (...args) => args[0] === "management/t1" ? read(...args) : Promise.reject(new Error(secret));
  const partlyUnavailable = await setup("admin", store).handler(event());
  assert.equal(partlyUnavailable.statusCode, 503); assert.equal(json(partlyUnavailable).partners, undefined);
});

test("failed conditional writes and false SDK success never report a save", async () => {
  for (const result of [{ modified: true, etag: "" }, { modified: true, etag: "fake" }, undefined]) {
    const store = memoryStore(); store.setJSON = async () => result;
    assert.equal((await setup("admin", store).handler(event("PATCH", input()))).statusCode, 503);
  }
  const store = memoryStore(); let attempts = 0; store.setJSON = async () => { attempts += 1; return { modified: false }; };
  assert.equal((await setup("admin", store).handler(event("PATCH", input()))).statusCode, 409);
  assert.equal(attempts, 4);
});

test("malformed or oversized persisted data fails closed and is never returned as notes", async () => {
  const valid = { schemaVersion: 1, partnerCode: "t2", workflow: "review", notes: "ok", revision: 1, updatedAt: now().toISOString() };
  for (const data of [{}, { ...valid, partnerCode: "t1" }, { ...valid, notes: "a".repeat(2001) }, { ...valid, workflow: "unknown" },
    { ...valid, revision: 0 }, { ...valid, updatedAt: null }, { ...valid, extra: "x".repeat(20000) }]) {
    const store = memoryStore(); store.values.set("management/t2", { etag: "v1", data });
    assert.equal((await setup("admin", store).handler(event())).statusCode, 503);
  }
  const store = memoryStore(); store.values.set("management/t2", { data: valid });
  assert.equal((await setup("admin", store).handler(event())).statusCode, 503);
  await assert.rejects(readManagement(memoryStore(), "__proto__"));
});

test("modern adapter bounds bodies, passes deploy context and fails anonymous access", async () => {
  const { default: adapter } = await import("../netlify/functions/admin-data.mjs");
  const url = "https://thorshall.gg/.netlify/functions/admin-data";
  assert.equal((await adapter(new Request(url))).status, 401);
  const large = new Request(`${url}?partner=t2`, { method: "PATCH", body: "x".repeat(8193) });
  const response = await adapter(large);
  assert.equal(response.status, 413); assert.match(response.headers.get("Cache-Control"), /no-store/);
  const previous = process.env.STATS_SESSION_SECRET;
  process.env.STATS_SESSION_SECRET = "admin-adapter-session-secret-at-least-32-characters";
  try {
    const signed = new Request(url, { headers: { cookie: `th_stats_session=${createSession("admin")}` } });
    assert.equal((await adapter(signed, { deploy: { context: "branch-deploy" } })).status, 503);
  } finally {
    if (previous === undefined) delete process.env.STATS_SESSION_SECRET; else process.env.STATS_SESSION_SECRET = previous;
  }
});

test("injected SDK opens a site-wide strong store without fallback credentials or disk", async () => {
  const store = memoryStore(); const calls = [];
  assert.equal(await openStore(options => { calls.push(options); return store; }), store);
  assert.deepEqual(calls, [{ name: "thorshall-admin-partners-v1", consistency: "strong" }]);
  await assert.rejects(openStore());
});
