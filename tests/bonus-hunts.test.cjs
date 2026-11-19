"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const site = path.resolve(__dirname, "..");
process.env.STATS_SESSION_SECRET = "test-only-signing-secret-at-least-32-characters";
process.env.DASHBOARD_PASSWORD = "test-only-master-password";
const { createSession, COOKIE_NAME } = require(path.join(site, "netlify/lib/stats-auth"));
const { createHandler, validateState, initialState, storeName } = require(path.join(site, "netlify/lib/bonus-hunts"));
const login = require(path.join(site, "netlify/functions/stats-session")).handler;
const adminPage = require(path.join(site, "netlify/functions/bonus-hunts-admin")).handler;

function storage() {
  let document = null, version = 0;
  return {
    async getWithMetadata() { return document ? { data: structuredClone(document), etag: `"v${version}"`, metadata: {} } : null; },
    async setJSON(key, value, options) {
      if ((options.onlyIfNew && document) || (options.onlyIfMatch && options.onlyIfMatch !== `"v${version}"`)) return { modified: false };
      document = structuredClone(value); version++;
      return { modified: true, etag: `"v${version}"` };
    }
  };
}

function event(method = "GET", mode = "admin", role = "admin", body) {
  return { httpMethod: method, queryStringParameters: { mode }, headers: { host: "thorshall.test", origin: "https://thorshall.test", "content-type": "application/json", "x-thorshall-request": "bonus-hunts", ...(role ? { cookie: `${COOKIE_NAME}=${encodeURIComponent(createSession(role))}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) };
}
function payload(response) { return JSON.parse(response.body); }

test("owner-only API denies anonymous and every creator without storage access", async () => {
  const handle = createHandler(() => { throw new Error("must not open storage"); });
  for (const role of [null, "manuel", "piyush", "radhika", "t1", "t2", "arshan"]) {
    assert.equal((await handle(event("GET", "admin", role))).statusCode, 401);
    assert.equal((await handle(event("PUT", "admin", role, { state: initialState() }))).statusCode, 401);
    assert.equal((await handle(event("POST", "admin", role, { action: "rotate-token" }))).statusCode, 401);
  }
});

test("preview and unpublished deploys never select the production hunt store", () => {
  const production = storeName({ deployContext: "production", published: true });
  assert.notEqual(storeName({ deployContext: "production", published: false }), production);
  assert.notEqual(storeName({ deployContext: "deploy-preview", published: false }), production);
  assert.notEqual(storeName({ deployContext: "branch-deploy", published: false }), production);
  assert.notEqual(storeName({ deployContext: "dev" }), production);
});

test("new hunts start public for launch and preserve private settings across saves", async () => {
  const store = storage();
  const first = createHandler(() => store);
  const initial = payload(await first(event()));
  assert.equal(initial.state.settings.public, true);
  assert.match(initial.streamToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await first(event("GET", "viewer", null))).statusCode, 200);
  const changed = structuredClone(initial.state);
  changed.settings.public = false;
  changed.hunts[0].start = 1000;
  changed.hunts[0].rows.push({ id: "bonus-1", slot: "Test slot", provider: "", bet: 2, payout: 200 });
  const saved = await first(event("PUT", "admin", "admin", { state: changed, revision: initial.revision }));
  assert.equal(saved.statusCode, 200);
  assert.notEqual(payload(saved).revision, initial.revision);
  const second = createHandler(() => store);
  const loaded = payload(await second(event()));
  assert.deepEqual(loaded.state, changed);
  assert.equal(loaded.streamToken, initial.streamToken);
  assert.equal((await first(event("GET", "viewer", null))).statusCode, 403);
  assert.equal((await first(event("PUT", "admin", "admin", { state: initial.state, revision: initial.revision }))).statusCode, 409);
});

test("conditional writes prevent two editors from replacing the same saved revision", async () => {
  const store = storage();
  const handle = createHandler(() => store);
  const initial = payload(await handle(event()));
  const a = structuredClone(initial.state), b = structuredClone(initial.state);
  a.hunts[0].title = "Editor A"; b.hunts[0].title = "Editor B";
  const results = await Promise.all([handle(event("PUT", "admin", "admin", { state: a, revision: initial.revision })), handle(event("PUT", "admin", "admin", { state: b, revision: initial.revision }))]);
  assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
});

test("starting payouts closes predictions once, preserves the cutoff on later saves and never exposes it", async () => {
  const store = storage();
  let clock = new Date("2026-11-19T12:00:00.000Z");
  const handle = createHandler(() => store, { now: () => clock });
  const initial = payload(await handle(event()));
  const huntId = initial.state.activeId;
  initial.state.hunts[0].status = "opening";
  let saved = payload(await handle(event("PUT", "admin", "admin", { state: initial.state, revision: initial.revision })));
  const cutoff = (await store.getWithMetadata()).data.predictionClosedAt[huntId];
  assert.equal(cutoff, clock.toISOString());
  assert.equal(saved.predictionClosedAt, undefined);
  clock = new Date("2026-11-19T12:30:00.000Z");
  saved.state.hunts[0].status = "collecting";
  saved = payload(await handle(event("PUT", "admin", "admin", { state: saved.state, revision: saved.revision })));
  assert.equal((await store.getWithMetadata()).data.predictionClosedAt[huntId], cutoff);
  const rotated = await handle(event("POST", "admin", "admin", { action: "rotate-token", revision: saved.revision }));
  assert.equal(rotated.statusCode, 200);
  assert.equal((await store.getWithMetadata()).data.predictionClosedAt[huntId], cutoff);
  assert.equal(payload(await handle(event("GET", "viewer", null))).predictionClosedAt, undefined);
});

test("OBS token is read-only and replacement revokes the previous token", async () => {
  const store = storage(), handle = createHandler(() => store);
  const initial = payload(await handle(event()));
  const overlay = event("GET", "overlay", null);
  overlay.headers.authorization = `Bearer ${initial.streamToken}`;
  const read = await handle(overlay);
  assert.equal(read.statusCode, 200);
  assert.equal(payload(read).streamToken, undefined);
  const illegalWrite = { ...overlay, httpMethod: "PUT", body: JSON.stringify({ state: initial.state, revision: initial.revision }) };
  assert.equal((await handle(illegalWrite)).statusCode, 401);
  const rotated = await handle(event("POST", "admin", "admin", { action: "rotate-token", revision: initial.revision }));
  assert.equal(rotated.statusCode, 200);
  assert.notEqual(payload(rotated).streamToken, initial.streamToken);
  assert.equal((await handle(overlay)).statusCode, 401);
  overlay.headers.authorization = `Bearer ${payload(rotated).streamToken}`;
  assert.equal((await handle(overlay)).statusCode, 200);
});

test("public display reveals only active and completed hunts and never the stream token", async () => {
  const store = storage(), handle = createHandler(() => store);
  const initial = payload(await handle(event()));
  initial.state.settings.public = true;
  const completed = structuredClone(initial.state.hunts[0]); completed.id = "completed-hunt"; completed.status = "complete";
  const privateDraft = structuredClone(initial.state.hunts[0]); privateDraft.id = "private-future-hunt"; privateDraft.title = "Private future draft";
  initial.state.hunts.push(completed, privateDraft);
  assert.equal((await handle(event("PUT", "admin", "admin", { state: initial.state, revision: initial.revision }))).statusCode, 200);
  const publicView = await handle(event("GET", "viewer", null));
  assert.equal(publicView.statusCode, 200);
  assert.equal(payload(publicView).streamToken, undefined);
  assert.deepEqual(payload(publicView).state.hunts.map(h => h.id), [initial.state.activeId, "completed-hunt"]);
  const overlay = event("GET", "overlay", null); overlay.headers.authorization = `Bearer ${initial.streamToken}`;
  const stream = await handle(overlay);
  assert.deepEqual(payload(stream).state.hunts.map(h => h.id), [initial.state.activeId]);
  assert.equal(payload(await handle(event())).state.hunts.length, 3);
  assert.match(publicView.headers["Cache-Control"], /no-store/);
});

test("writes reject cross-site requests, missing headers, unsafe payloads, and excess rows", async () => {
  const store = storage(), handle = createHandler(() => store);
  const initial = payload(await handle(event()));
  const write = () => event("PUT", "admin", "admin", { state: initial.state, revision: initial.revision });
  let request = write(); request.headers.origin = "https://unrelated.test";
  assert.equal((await handle(request)).statusCode, 403);
  request = write(); delete request.headers["x-thorshall-request"];
  assert.equal((await handle(request)).statusCode, 403);
  request = write(); request.headers["content-type"] = "text/plain";
  assert.equal((await handle(request)).statusCode, 403);
  request = write(); const body = JSON.parse(request.body); body.state.settings.streamToken = "overwrite"; request.body = JSON.stringify(body);
  assert.equal((await handle(request)).statusCode, 400);
  const invalid = structuredClone(initial.state); invalid.hunts[0].start = -1;
  assert.throws(() => validateState(invalid));
  invalid.hunts[0].start = 1; invalid.hunts[0].rows = Array.from({ length: 151 }, (_, i) => ({ id: `row-${i}`, slot: "", provider: "", bet: 1, payout: null }));
  assert.throws(() => validateState(invalid));
});

test("owner login returns to admin and anonymous admin-page requests redirect to sign-in", async () => {
  const redirected = await adminPage(event("GET", "admin", null));
  assert.equal(redirected.statusCode, 303);
  assert.match(redirected.headers.Location, /return=%2Fadmin%3Fview%3Dhunts$/);
  const loginResult = await login({ httpMethod: "POST", headers: {}, queryStringParameters: {}, body: new URLSearchParams({ password: process.env.DASHBOARD_PASSWORD, return: "/admin" }).toString() });
  assert.equal(loginResult.statusCode, 303);
  assert.equal(loginResult.headers.Location, "/admin");
  assert.match(loginResult.headers["Set-Cookie"], /HttpOnly; Secure; SameSite=Strict/);
  const unsafeReturn = await login({ httpMethod: "POST", headers: {}, queryStringParameters: {}, body: new URLSearchParams({ password: process.env.DASHBOARD_PASSWORD, return: "https://unrelated.test" }).toString() });
  assert.equal(unsafeReturn.headers.Location, "/");
});

test("malformed cookies are unauthorized instead of crashing", async () => {
  const handle = createHandler(() => { throw new Error("must not open storage"); });
  const request = event(); request.headers.cookie = `${COOKIE_NAME}=%broken`;
  assert.equal((await handle(request)).statusCode, 401);
});

test("storage outages are visible instead of claiming a successful save", async () => {
  const handle = createHandler(() => { throw new Error("storage unavailable"); });
  assert.equal((await handle(event())).statusCode, 503);
});

test("modern function and installed Blobs SDK use the strong-read endpoint", async () => {
  const { pathToFileURL } = require("node:url");
  const { setEnvironmentContext } = require(path.join(site, "node_modules/@netlify/blobs"));
  const originalFetch = global.fetch;
  const originalContext = process.env.NETLIFY_BLOBS_CONTEXT;
  const record = { state: initialState(), streamToken: "test-token-is-not-returned-to-public-viewers" };
  let endpoint;
  try {
    setEnvironmentContext({ siteID: "site-test", token: "test-only-storage-token", edgeURL: "https://cached.blobs.test", uncachedEdgeURL: "https://fresh.blobs.test" });
    global.fetch = async (url) => { endpoint = String(url); return new Response(JSON.stringify(record), { status: 200, headers: { etag: '"sdk-version"', "content-type": "application/json" } }); };
    const modern = await import(pathToFileURL(path.join(site, "netlify/functions/bonus-hunts-api.mjs")).href);
    const request = new Request("https://thorshall.test/.netlify/functions/bonus-hunts-api?mode=admin", { headers: event().headers });
    const response = await modern.default(request);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).revision, '"sdk-version"');
    assert.match(endpoint, /^https:\/\/fresh\.blobs\.test\//);
  } finally {
    global.fetch = originalFetch;
    if (originalContext === undefined) delete process.env.NETLIFY_BLOBS_CONTEXT; else process.env.NETLIFY_BLOBS_CONTEXT = originalContext;
  }
});


test("fresh public display does not require owner initialization or persist anonymous requests", async () => {
  let writes=0;
  const handle=createHandler(()=>({async getWithMetadata(){return null;},async setJSON(){writes++;throw new Error("not permitted");}}));
  const result=await handle(event("GET","viewer",null));
  assert.equal(result.statusCode,200);assert.equal(payload(result).state.settings.public,true);assert.equal(payload(result).revision,"empty");assert.equal(writes,0);
});

