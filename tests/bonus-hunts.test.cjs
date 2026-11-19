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
    assert.equal((await handle(event("POST", "admin", role, { action: "close-predictions", huntId: "hunt-a" }))).statusCode, 401);
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

test("saving opening status closes predictions and ordinary imports cannot reopen them", async () => {
  const store = storage();
  let clock = new Date("2026-11-19T12:00:00.000Z");
  const handle = createHandler(() => store, { now: () => clock });
  const initial = payload(await handle(event()));
  const huntId = initial.state.activeId;
  assert.equal(initial.predictionWindows[huntId].accepting, true);
  initial.state.hunts[0].status = "opening";
  initial.state.hunts[0].rows.push({ id: "paid-bonus", slot: "Test bonus", provider: "", bet: 10, payout: 100 });
  let saved = payload(await handle(event("PUT", "admin", "admin", { state: initial.state, revision: initial.revision })));
  assert.equal(saved.predictionWindows[huntId].accepting, false);
  assert.equal(saved.predictionWindows[huntId].closedAt, clock.toISOString());
  assert.equal((await handle(event("POST", "admin", "admin", { action: "close-predictions", huntId, revision: initial.revision }))).statusCode, 409);
  saved = payload(await handle(event("POST", "admin", "admin", { action: "close-predictions", huntId, revision: saved.revision })));
  const cutoff = (await store.getWithMetadata()).data.predictionClosedAt[huntId];
  assert.equal(cutoff, clock.toISOString());
  assert.equal(saved.predictionClosedAt, undefined);
  assert.equal(saved.predictionWindows[huntId].closedAt, cutoff);
  assert.equal(saved.predictionWindows[huntId].accepting, false);
  assert.equal(saved.streamToken, undefined);
  clock = new Date("2026-11-19T12:30:00.000Z");
  saved.state.hunts[0].status = "collecting";
  saved = payload(await handle(event("PUT", "admin", "admin", { state: saved.state, revision: saved.revision })));
  assert.equal((await store.getWithMetadata()).data.predictionClosedAt[huntId], cutoff);
  const rotated = await handle(event("POST", "admin", "admin", { action: "rotate-token", revision: saved.revision }));
  assert.equal(rotated.statusCode, 200);
  assert.equal((await store.getWithMetadata()).data.predictionClosedAt[huntId], cutoff);
  assert.equal(payload(await handle(event("GET", "viewer", null))).predictionClosedAt, undefined);
  assert.equal(payload(await handle(event("GET", "viewer", null))).predictionWindows[huntId].closedAt, cutoff);
});

test("finishing a hunt closes predictions and owner closure rejects unsafe, unknown or unsaved hunts", async () => {
  const store = storage(), at = new Date("2026-11-19T12:15:00.000Z"), handle = createHandler(() => store, { now: () => at });
  const initial = payload(await handle(event())), huntId = initial.state.activeId;
  const unsafe = event("POST", "admin", "admin", { action: "close-predictions", huntId, revision: initial.revision });
  unsafe.headers.origin = "https://evil.test";
  assert.equal((await handle(unsafe)).statusCode, 403);
  for (const bad of [undefined, "missing-hunt", "../../hunt"]) assert.equal((await handle(event("POST", "admin", "admin", { action: "close-predictions", huntId: bad, revision: initial.revision }))).statusCode, 400);
  assert.equal((await store.getWithMetadata()).etag, initial.revision);
  initial.state.hunts[0].status = "complete";
  const finished = payload(await handle(event("PUT", "admin", "admin", { state: initial.state, revision: initial.revision })));
  assert.deepEqual(finished.predictionWindows[huntId], { closedAt: at.toISOString(), accepting: false, windowId: "0", reopenable: false });
  finished.state.hunts[0].status = "opening";
  const reopened = payload(await handle(event("PUT", "admin", "admin", { state: finished.state, revision: finished.revision })));
  assert.deepEqual(reopened.predictionWindows[huntId], finished.predictionWindows[huntId]);
});

test("concurrent hunt editing and prediction closure cannot overwrite the winning saved revision", async () => {
  const store = storage(), at = new Date("2026-11-19T12:20:00.000Z"), handle = createHandler(() => store, { now: () => at });
  const initial = payload(await handle(event())), huntId = initial.state.activeId, changed = structuredClone(initial.state);
  changed.hunts[0].title = "New live name";
  const results = await Promise.all([
    handle(event("POST", "admin", "admin", { action: "close-predictions", huntId, revision: initial.revision })),
    handle(event("PUT", "admin", "admin", { state: changed, revision: initial.revision }))
  ]);
  assert.deepEqual(results.map(result => result.statusCode).sort(), [200, 409]);
  let saved = payload(await handle(event()));
  if (results[0].statusCode === 409) saved = payload(await handle(event("POST", "admin", "admin", { action: "close-predictions", huntId, revision: saved.revision })));
  assert.equal(saved.predictionWindows[huntId].closedAt, at.toISOString());
  assert.equal(saved.predictionWindows[huntId].accepting, false);
  assert.equal((await handle(event("PUT", "admin", "admin", { state: initial.state, revision: initial.revision }))).statusCode, 409);
  assert.equal(payload(await handle(event())).predictionWindows[huntId].closedAt, at.toISOString());
});

test("owner phase commands close and reopen atomically while preserving every bonus and payout", async () => {
  const store = storage(); let at = new Date("2026-11-19T12:00:00.000Z");
  const handle = createHandler(() => store, { now: () => at });
  let saved = payload(await handle(event())), huntId = saved.state.activeId;
  saved.state.hunts[0].rows.push({ id: "collected", slot: "Preserved slot", provider: "", bet: 5, payout: null });
  saved.state.hunts[0].balance = 42;
  saved = payload(await handle(event("PUT", "admin", "admin", { state: saved.state, revision: saved.revision })));
  at = new Date("2026-11-19T12:01:00.000Z");
  const staleRevision = saved.revision;
  saved = payload(await handle(event("POST", "admin", "admin", { action: "start-opening", huntId, revision: saved.revision })));
  assert.equal(saved.state.hunts[0].status, "opening");
  assert.deepEqual(saved.predictionWindows[huntId], { windowId: "0", accepting: false, closedAt: at.toISOString(), reopenable: true });
  assert.equal((await handle(event("POST", "admin", "admin", { action: "back-to-hunting", huntId, revision: staleRevision }))).statusCode, 409);
  saved.state.hunts[0].rows[0].payout = 125;
  saved = payload(await handle(event("PUT", "admin", "admin", { state: saved.state, revision: saved.revision })));
  const preserved = structuredClone(saved.state.hunts[0]);
  at = new Date("2026-11-19T12:02:00.000Z");
  saved = payload(await handle(event("POST", "admin", "admin", { action: "back-to-hunting", huntId, revision: saved.revision })));
  assert.deepEqual(saved.state.hunts[0], { ...preserved, status: "collecting" });
  assert.equal(saved.predictionWindows[huntId].accepting, true);
  assert.equal(saved.predictionWindows[huntId].closedAt, null);
  const newId = saved.predictionWindows[huntId].windowId;
  assert.match(newId, /^[0-9a-f-]{36}$/); assert.notEqual(newId, "0");
  assert.equal((await handle(event("POST", "admin", "admin", { action: "back-to-hunting", huntId, revision: saved.revision }))).statusCode, 400);
  assert.equal(payload(await handle(event())).predictionWindows[huntId].windowId, newId);
  at = new Date("2026-11-19T12:03:00.000Z");
  saved = payload(await handle(event("POST", "admin", "admin", { action: "start-opening", huntId, revision: saved.revision })));
  const stored = (await store.getWithMetadata()).data;
  assert.deepEqual(stored.predictionWindowHistory[huntId], [{ id: "0", openedAt: null, closedAt: "2026-11-19T12:01:00.000Z" },
    { id: newId, openedAt: "2026-11-19T12:02:00.000Z", closedAt: "2026-11-19T12:03:00.000Z" }]);
  assert.equal(saved.predictionWindows[huntId].accepting, false);
});

test("finished, deactivated and removed hunt IDs retain permanent prediction tombstones across imports", async () => {
  for (const retirement of ["complete", "deactivate", "remove"]) {
    const store = storage(), handle = createHandler(() => store);
    let saved = payload(await handle(event())), huntId = saved.state.activeId;
    const original = structuredClone(saved.state.hunts[0]), other = { ...original, id: "another-hunt" };
    if (retirement === "complete") saved.state.hunts[0].status = "complete";
    else { saved.state.hunts.push(other); saved.state.activeId = other.id; if (retirement === "remove") saved.state.hunts.shift(); }
    saved = payload(await handle(event("PUT", "admin", "admin", { state: saved.state, revision: saved.revision })));
    saved.state.hunts = [{ ...original, status: "opening" }]; saved.state.activeId = huntId;
    saved = payload(await handle(event("PUT", "admin", "admin", { state: saved.state, revision: saved.revision })));
    assert.equal(saved.predictionWindows[huntId].reopenable, false, retirement);
    assert.equal(saved.predictionWindows[huntId].accepting, false, retirement);
    assert.equal((await handle(event("POST", "admin", "admin", { action: "back-to-hunting", huntId, revision: saved.revision }))).statusCode, 400, retirement);
    assert.equal(Object.hasOwn((await store.getWithMetadata()).data.predictionPermanentlyClosed, huntId), true);
  }
});

test("phase commands reject inactive hunts, creator sessions and unsafe requests without changing revision", async () => {
  const store = storage(), handle = createHandler(() => store); let saved = payload(await handle(event()));
  const huntId = saved.state.activeId;
  saved.state.hunts.push({ ...structuredClone(saved.state.hunts[0]), id: "inactive-hunt" });
  saved = payload(await handle(event("PUT", "admin", "admin", { state: saved.state, revision: saved.revision })));
  for (const action of ["start-opening", "back-to-hunting"]) {
    assert.equal((await handle(event("POST", "admin", "manuel", { action, huntId, revision: saved.revision }))).statusCode, 401);
    assert.equal((await handle(event("POST", "admin", "admin", { action, huntId: "inactive-hunt", revision: saved.revision }))).statusCode, 400);
    const unsafe = event("POST", "admin", "admin", { action, huntId, revision: saved.revision }); unsafe.headers.origin = "https://evil.test";
    assert.equal((await handle(unsafe)).statusCode, 403);
  }
  assert.equal((await store.getWithMetadata()).etag, saved.revision);
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
  assert.deepEqual(Object.keys(payload(publicView).predictionWindows), [initial.state.activeId, "completed-hunt"]);
  assert.equal(payload(publicView).predictionWindows["private-future-hunt"], undefined);
  const overlay = event("GET", "overlay", null); overlay.headers.authorization = `Bearer ${initial.streamToken}`;
  const stream = await handle(overlay);
  assert.deepEqual(payload(stream).state.hunts.map(h => h.id), [initial.state.activeId]);
  assert.equal(payload(stream).predictionWindows, undefined);
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

