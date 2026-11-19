"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), crypto = require("node:crypto");
const P = require("../netlify/lib/hunt-predictions"), W = require("../netlify/lib/hunt-prediction-windows"), Core = require("../hunt-shared");
const SECRET = "test-only-prediction-secret-over-32-characters", BASE = new Date("2026-11-19T13:00:00.000Z");
const clone = value => structuredClone(value);
function storage(initial = new Map()) {
  const records = new Map(initial), versions = new Map(); let writes = 0;
  return { records, get writes() { return writes; }, beforeWrite: null, afterWrite: null,
    async getWithMetadata(key) { const value = records.get(key); return value ? { data: clone(value), etag: '"v' + (versions.get(key) || 0) + '"' } : null; },
    async setJSON(key, data, options) {
      await this.beforeWrite?.(key, data);
      const etag = '"v' + (versions.get(key) || 0) + '"';
      if ((options.onlyIfNew && records.has(key)) || (options.onlyIfMatch && options.onlyIfMatch !== etag)) return { modified: false };
      records.set(key, clone(data)); versions.set(key, (versions.get(key) || 0) + 1); writes++;
      await this.afterWrite?.(key, data);
      return { modified: true, etag: '"v' + versions.get(key) + '"' };
    }
  };
}
function event(method = "GET", { cookie, body, hunt = "hunt-a", clientIp = "192.0.2.1", headers = {} } = {}) {
  return { httpMethod: method, rawUrl: "https://thorshall.gg/.netlify/functions/hunt-predictions" + (method === "GET" ? "?hunt=" + hunt : ""),
    deployContext: "production", published: true, clientIp, queryStringParameters: method === "GET" ? { hunt } : {},
    headers: { host: "thorshall.gg", origin: "https://thorshall.gg", "sec-fetch-site": "same-origin", "content-type": "application/json", "x-thorshall-request": "hunt-prediction", ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? "" : JSON.stringify(body) };
}
function fixture() {
  let clock = new Date(BASE), opens = 0, nextId = 100, configured = true;
  const hunt = { id: "hunt-a", title: "Test hunt", date: "2026-11-19", currency: "USD", start: 1000, balance: 0, status: "collecting", rows: [{ id: "row-a", slot: "Test slot", provider: "", bet: 10, payout: null }] };
  const record = { state: { schema: 2, activeId: hunt.id, hunts: [hunt], settings: { public: true } }, streamToken: "do-not-disclose-this-stream-token" };
  const huntStore = storage(new Map([["hunt-manager", record]])), predictions = storage(), identities = new Map();
  const options = { connectHunts: () => { opens++; return huntStore; }, connectPredictions: () => predictions, now: () => new Date(clock), secretFor: () => SECRET, logDiagnostic: () => {},
    authInfoFor: async request => ({ viewer: identities.get(request.headers.cookie) || null, authConfigured: configured,
      loginUrl: "/.netlify/functions/hunt-twitch?action=login&return=" + encodeURIComponent(request.queryStringParameters.return), logoutUrl: "/.netlify/functions/hunt-twitch?action=logout",
      authExpiresAt: "2026-11-19T21:00:00.000Z", authRevalidateAt: "2026-11-19T13:55:00.000Z" }) };
  const handle = P.createHandler(options);
  return { handle, options, huntStore, predictions, get opens() { return opens; }, setConfigured: value => { configured = value; }, setClock: value => { clock = new Date(value); },
    update(fn) { const next = clone(huntStore.records.get("hunt-manager")); fn(next); huntStore.records.set("hunt-manager", next); },
    user(login = "viewerone", id) { const user = { id: id || String(nextId++), login, displayName: login }, cookie = "test-session=" + crypto.randomUUID(); identities.set(cookie, user); return cookie; },
    sameUser(cookie, login) { const user = clone(identities.get(cookie)); if (login) { user.login = login; user.displayName = login; } const other = "test-session=" + crypto.randomUUID(); identities.set(other, user); return other; },
    revoke(cookie) { identities.delete(cookie); }, identity(cookie) { return identities.get(cookie); }
  };
}
function payload(response) { return JSON.parse(response.body); }
function guess(amount = "123.45", huntId = "hunt-a") { return { huntId, amount, requestId: crypto.randomUUID(), website: "" }; }
async function submit(f, cookie, body = guess(), opts = {}) { return f.handle(event("POST", { cookie, body, ...opts })); }

test("public summaries remain readable without login, never create browser cookies, and isolate preview storage", async () => {
  const f = fixture(), response = await f.handle(event()), data = payload(response);
  assert.equal(response.statusCode, 200); assert.equal(response.headers["Set-Cookie"], undefined); assert.match(response.headers["Cache-Control"], /no-store/);
  assert.equal(data.viewer, null); assert.equal(data.authConfigured, true); assert.match(data.loginUrl, /return=%2Fbonus-hunt%23hunt%3Dhunt-a$/);
  assert.equal(data.authExpiresAt, "2026-11-19T21:00:00.000Z"); assert.equal(data.authRevalidateAt, "2026-11-19T13:55:00.000Z");
  assert.doesNotMatch(response.body, /stream-token|identityHash|ipHash/); assert.equal(f.predictions.writes, 0);
  const production = P.storeName(event()); assert.equal(production, "thorshall-hunt-predictions-v1");
  for (const changed of [{ published: false }, { deployContext: "deploy-preview", published: false }, { rawUrl: "https://preview.example/predictions", headers: { host: "preview.example" } }]) assert.notEqual(P.storeName({ ...event(), ...changed }), production);
  assert.throws(() => P.storeName({ ...event(), rawUrl: "https://other.example/predictions" }), /hunt page/);
});

test("anonymous, unconfigured, invalid, or revoked Twitch sessions cannot write predictions", async () => {
  const f = fixture();
  for (const cookie of [undefined, "thorshall_prediction_id=old-anonymous-cookie", "test-session=forged"]) {
    const response = await submit(f, cookie); assert.equal(response.statusCode, 401); assert.match(payload(response).error, /Sign in with Twitch/);
  }
  const user = f.user(); f.revoke(user); assert.equal((await submit(f, user)).statusCode, 401);
  f.setConfigured(false); const unconfigured = await submit(f, f.user()); assert.equal(unconfigured.statusCode, 401); assert.equal(payload(unconfigured).authConfigured, false);
  assert.equal(f.opens, 0); assert.equal(f.predictions.writes, 0);
  const malformed = P.createHandler({ ...f.options, authInfoFor: async () => ({ authConfigured: true, viewer: { id: "forged", login: "owner", displayName: "Owner" } }) });
  assert.equal((await malformed(event("POST", { body: guess() }))).statusCode, 401);
});

test("guesses use exact cents and the same final balance rounding as the public tracker", () => {
  for (const [value, expected] of [["0", 0], ["0.01", 1], ["12.3", 1230], ["123.45", 12345], ["1000000000", 100000000000]]) assert.equal(P.parseAmount(value), expected);
  for (const value of [1, "-1", "01", "1,000", "1e3", ".50", "1.", "1.234", "1000000000.01", "Infinity", "<script>"]) assert.throws(() => P.parseAmount(value), P.PredictionError);
  for (const [balance, payouts] of [[0.105, [0.01]], [0.005, []], [1.005, [0.1, 0.2]], [1000.005, [0.005, 0.005]], [0, [0.1, 0.2, 0.305]]]) {
    const hunt = { currency: "USD", balance, rows: payouts.map(payout => ({ payout })) };
    assert.equal(P.finalBalanceMinor(hunt), Number(Core.money(Core.calculate(hunt).endBalance, "USD").replace(/[$,.]/g, "")));
  }
});

test("verified Twitch identity is server-derived, survives browsers and username changes, and leaves editor ETag alone", async () => {
  const f = fixture(), cookie = f.user("realviewer"), body = guess(), before = await f.huntStore.getWithMetadata("hunt-manager");
  const response = await submit(f, cookie, body), result = payload(response); assert.equal(response.statusCode, 201);
  assert.deepEqual(result.mine, { username: "realviewer", amountMinor: 12345, createdAt: BASE.toISOString() }); assert.equal(result.viewer.login, "realviewer");
  const secondBrowser = f.sameUser(cookie), renamed = f.sameUser(cookie, "newlogin");
  assert.equal(payload(await f.handle(event("GET", { cookie: secondBrowser }))).mine.username, "realviewer");
  assert.equal(payload(await f.handle(event("GET", { cookie: renamed }))).mine.username, "realviewer");
  assert.equal((await submit(f, secondBrowser, guess("500"))).statusCode, 409); assert.equal((await submit(f, renamed, guess("999.99"))).statusCode, 409);
  assert.equal((await submit(f, cookie, { ...guess(), username: "someoneelse" })).statusCode, 400);
  const stranger = await f.handle(event()); assert.equal(payload(stranger).mine, null); assert.doesNotMatch(stranger.body, /identityHash|ipHash|stream-token|userId|requestId/);
  assert.deepEqual(payload(stranger).entries, [{ username: "realviewer", amountMinor: 12345, createdAt: BASE.toISOString(), verified: true, isMine: false }]);
  assert.deepEqual(payload(await f.handle(event("GET", { cookie: renamed }))).entries, [{ username: "realviewer", amountMinor: 12345, createdAt: BASE.toISOString(), verified: true, isMine: true }]);
  assert.deepEqual(await f.huntStore.getWithMetadata("hunt-manager"), before); assert.equal(f.huntStore.writes, 0);
  const stored = f.predictions.records.get(P.ledgerKey("hunt-a")).entries[0]; assert.equal(stored.userId, f.identity(cookie).id); assert.equal(stored.authKind, "twitch"); assert.equal(stored.username, "realviewer");
  assert.doesNotMatch(JSON.stringify(stored), /192\.0\.2\.1|test-session|test-only-prediction-secret/);
});

test("a client account assertion prevents accidental submissions after an account changes in another tab", async () => {
  const f = fixture(), a = f.user("accounta"), b = f.user("accountb");
  const wrong = await submit(f, b, { ...guess(), viewerId: f.identity(a).id }); assert.equal(wrong.statusCode, 409); assert.match(payload(wrong).error, /account changed/); assert.equal(f.opens, 0);
  const good = await submit(f, b, { ...guess(), viewerId: f.identity(b).id }); assert.equal(good.statusCode, 201); assert.equal(payload(good).mine.username, "accountb");
  const saved = f.predictions.records.get(P.ledgerKey("hunt-a")).entries[0]; assert.equal(saved.viewerId, undefined);
});

test("the public roster includes every eligible locked prediction in chronological acceptance order without private identifiers", async () => {
  const f = fixture(), cookies = [];
  for (let i = 0; i < 12; i++) {
    // Insertion order differs from timestamps so chronological ordering is
    // explicit; the first two share a timestamp and retain acceptance order.
    f.setClock(new Date(+BASE + (i < 2 ? 2 : 12 - i) * 1000));
    const cookie = f.user("viewer_" + i); cookies.push(cookie);
    assert.equal((await submit(f, cookie, guess(String(i)), { clientIp: "192.0.2." + (i + 1) })).statusCode, 201);
  }
  const publicData = payload(await f.handle(event()));
  assert.equal(publicData.count, 12); assert.equal(publicData.entries.length, 12);
  const stored = f.predictions.records.get(P.ledgerKey("hunt-a")).entries;
  const expected = stored.map((entry, order) => ({ entry, order })).sort((a, b) => a.entry.createdAt.localeCompare(b.entry.createdAt) || a.order - b.order).map(value => value.entry.username);
  assert.deepEqual(publicData.entries.map(entry => entry.username), expected);
  for (const entry of publicData.entries) {
    assert.deepEqual(Object.keys(entry).sort(), ["amountMinor", "createdAt", "isMine", "username", "verified"]);
    assert.equal(entry.verified, true); assert.equal(entry.isMine, false);
  }
  const ownData = payload(await f.handle(event("GET", { cookie: cookies[4] })));
  assert.deepEqual(ownData.entries.filter(entry => entry.isMine).map(entry => entry.username), ["viewer_4"]);
  assert.equal(ownData.entries.find(entry => entry.isMine).amountMinor, 400);
  assert.doesNotMatch(JSON.stringify(publicData.entries), /userId|identityHash|ipHash|requestId|test-session|192\.0\.2\./);
});

test("legacy anonymous records stay readable without being assigned to a real account or blocking its name", async () => {
  const f = fixture();
  const old = { requestId: crypto.randomUUID(), username: "realviewer", nameKey: "realviewer", amountMinor: 10000, identityHash: "a".repeat(64), ipHash: "b".repeat(64), createdAt: new Date(+BASE - 1000).toISOString() };
  f.predictions.records.set(P.ledgerKey("hunt-a"), { schema: 1, huntId: "hunt-a", currency: "USD", entries: [old] });
  const cookie = f.user("realviewer"); const before = payload(await f.handle(event("GET", { cookie }))); assert.equal(before.mine, null); assert.equal(before.count, 1);
  assert.deepEqual(before.entries, [{ username: "realviewer", amountMinor: 10000, createdAt: old.createdAt, verified: false, isMine: false }]);
  assert.equal((await submit(f, cookie)).statusCode, 201); assert.equal(payload(await f.handle(event("GET", { cookie }))).mine.amountMinor, 12345);
  assert.deepEqual(f.predictions.records.get(P.ledgerKey("hunt-a")).entries[0], old);
  assert.throws(() => P.validateLedger({ schema: 1, huntId: "hunt-a", currency: "USD", entries: [{ ...old, userId: f.identity(cookie).id }] }, "hunt-a"));
});

test("exact retries work after closing while changed requests and different identities cannot reuse the request", async () => {
  const f = fixture(), cookie = f.user(), body = guess(); assert.equal((await submit(f, cookie, body)).statusCode, 201);
  assert.equal(payload(await submit(f, f.sameUser(cookie), body)).duplicate, true);
  assert.equal((await submit(f, cookie, { ...body, amount: "555" })).statusCode, 409);
  const stranger = f.user("otheruser"); assert.equal((await submit(f, stranger, body)).statusCode, 409);
  f.update(record => { record.predictionClosedAt = { "hunt-a": "2026-11-19T13:01:00.000Z" }; record.state.hunts[0].status = "opening"; });
  assert.equal((await submit(f, cookie, body)).statusCode, 200); assert.equal((await submit(f, stranger)).statusCode, 409); assert.equal(f.predictions.writes, 1);
});

test("concurrent saves serialize and enforce one entry for each immutable Twitch account", async () => {
  const f = fixture(), a = f.user(), b = f.sameUser(a);
  const same = await Promise.all([submit(f, a), submit(f, b)]); assert.deepEqual(same.map(r => r.statusCode).sort(), [201, 409]);
  const distinct = await Promise.all([submit(f, f.user("viewertwo")), submit(f, f.user("viewerthree"))]); assert.deepEqual(distinct.map(r => r.statusCode), [201, 201]);
  assert.equal(payload(await f.handle(event())).count, 3);
});

test("final podium ranks the closest three while the public roster retains every eligible entry", async () => {
  const f = fixture(), cookies = [];
  for (const [index, name, amount] of [[0, "earlytie", "122.45"], [1, "latetie", "124.45"], [2, "exactguess", "123.45"], [3, "farguess", "1"]]) {
    f.setClock(new Date(+BASE + index * 1000)); const cookie = f.user(name); cookies.push(cookie); assert.equal((await submit(f, cookie, guess(amount))).statusCode, 201);
  }
  f.update(record => { record.predictionClosedAt = { "hunt-a": "2026-11-19T13:01:00.000Z" }; record.state.hunts[0].status = "opening"; record.state.hunts[0].rows[0].payout = 123.45; });
  assert.deepEqual(payload(await f.handle(event())).podium, []);
  f.update(record => { record.state.hunts[0].status = "complete"; }); const response = await f.handle(event()), data = payload(response);
  assert.deepEqual(data.podium.map(e => [e.place, e.username, e.amountMinor, e.differenceMinor]), [[1, "exactguess", 12345, 0], [2, "earlytie", 12245, 100], [3, "latetie", 12445, 100]]);
  assert.deepEqual(data.entries.map(entry => entry.username), ["earlytie", "latetie", "exactguess", "farguess"]);
  assert.doesNotMatch(response.body, /identityHash|ipHash|requestId|streamToken|userId/);
  assert.equal(payload(await f.handle(event("GET", { cookie: cookies[3] }))).mine.username, "farguess");
});

test("equal guesses in the same millisecond follow acceptance order rather than client request IDs", async () => {
  const f = fixture(), first = f.user("firstviewer"), second = f.user("secondviewer");
  assert.equal((await submit(f, first, { ...guess(), requestId: "ffffffff-ffff-4fff-bfff-ffffffffffff" })).statusCode, 201);
  assert.equal((await submit(f, second, { ...guess(), requestId: "00000000-0000-4000-8000-000000000000" })).statusCode, 201);
  f.update(record => { record.state.hunts[0].status = "complete"; record.state.hunts[0].rows[0].payout = 123.45; });
  assert.deepEqual(payload(await f.handle(event())).podium.map(e => e.username), ["firstviewer", "secondviewer"]);
});

test("a concurrent opening cutoff excludes late writes and cannot be reversed by a retry", async () => {
  const f = fixture(), cookie = f.user(), body = guess();
  f.predictions.afterWrite = () => f.update(record => { record.predictionClosedAt = { "hunt-a": BASE.toISOString() }; record.state.hunts[0].status = "opening"; });
  assert.equal((await submit(f, cookie, body)).statusCode, 409); assert.equal(f.predictions.writes, 1);
  const summary = payload(await f.handle(event("GET", { cookie }))); assert.equal(summary.count, 0); assert.equal(summary.mine, null); assert.deepEqual(summary.podium, []); assert.deepEqual(summary.entries, []);
  assert.equal((await submit(f, cookie, body)).statusCode, 409);
});

test("pre-cutoff submissions can complete after opening without changing the deadline", async () => {
  const f = fixture(), cookie = f.user();
  f.predictions.afterWrite = () => f.update(record => { record.predictionClosedAt = { "hunt-a": "2026-11-19T13:00:00.001Z" }; record.state.hunts[0].status = "opening"; });
  const response = await submit(f, cookie); assert.equal(response.statusCode, 201); assert.equal(payload(response).accepting, false); assert.equal(payload(response).count, 1);
});

test("private/inactive hunts are denied, including a visibility change while a prediction saves", async () => {
  const f = fixture(), cookie = f.user(); f.update(record => record.state.hunts.push({ ...clone(record.state.hunts[0]), id: "hidden-draft" }));
  assert.equal((await f.handle(event("GET", { hunt: "hidden-draft" }))).statusCode, 404); assert.equal((await submit(f, cookie, guess("1", "hidden-draft"))).statusCode, 404);
  f.predictions.afterWrite = () => f.update(record => { record.state.settings.public = false; });
  const raced = await submit(f, cookie); assert.equal(raced.statusCode, 403); assert.doesNotMatch(raced.body, /viewerone|12345/); assert.equal((await f.handle(event())).statusCode, 403);
});

test("a new currency can be set before predictions, while old guesses are excluded if currencies differ", async () => {
  const fresh = fixture(); fresh.update(record => { const next = clone(record.state); next.hunts[0].currency = "EUR"; record.predictionClosedAt = W.closePredictionWindows(record, next, new Date(+BASE + 1000)); record.state = next; });
  assert.equal(payload(await fresh.handle(event())).accepting, true);
  const f = fixture(), cookie = f.user(); assert.equal((await submit(f, cookie)).statusCode, 201);
  f.update(record => { record.state.hunts[0].currency = "EUR"; }); const data = payload(await f.handle(event("GET", { cookie })));
  assert.equal(data.count, 0); assert.equal(data.mine, null); assert.deepEqual(data.entries, []); assert.equal(data.accepting, false); assert.match(data.message, /currency changed/); assert.equal((await submit(f, f.user("otheruser"))).statusCode, 409);
});

test("cross-site writes, forged identity fields, honeypots, excessive bodies and methods fail before storage", async () => {
  const f = fixture(), cookie = f.user(), start = f.opens;
  for (const headers of [{ origin: "https://attacker.example" }, { "sec-fetch-site": "cross-site" }, { "x-thorshall-request": "" }, { host: "attacker.example" }]) assert.equal((await submit(f, cookie, guess(), { headers })).statusCode, 403);
  for (const body of [{ ...guess(), username: "forgeduser" }, { ...guess(), userId: "123" }, { ...guess(), viewerId: "forged" }, { ...guess(), createdAt: BASE.toISOString() }, { ...guess(), website: "filled" }]) assert.equal((await submit(f, cookie, body)).statusCode, 400);
  const oversized = event("POST", { cookie }); oversized.body = " ".repeat(P.MAX_BODY_BYTES + 1); assert.equal((await f.handle(oversized)).statusCode, 413);
  assert.equal((await f.handle(event("DELETE"))).statusCode, 405); assert.equal(f.opens, start); assert.equal(f.predictions.writes, 0);
});

test("connection limits and duplicate-safe uncertain-write recovery still protect authenticated submissions", async () => {
  const f = fixture(); for (let i = 0; i < P.MAX_IP_ENTRIES; i++) assert.equal((await submit(f, f.user("viewer_" + i))).statusCode, 201);
  assert.equal((await submit(f, f.user("lastviewer"))).statusCode, 429); assert.equal((await submit(f, f.user("otherconnection"), guess(), { clientIp: "198.51.100.1" })).statusCode, 201);
  const retry = fixture(), cookie = retry.user(), body = guess(); let once = true;
  retry.predictions.afterWrite = () => { if (once) { once = false; throw new Error("Lost after commit"); } };
  assert.equal((await submit(retry, cookie, body)).statusCode, 503); const recovered = await submit(retry, cookie, body);
  assert.equal(recovered.statusCode, 200); assert.equal(payload(recovered).duplicate, true); assert.equal(retry.predictions.writes, 1);
});

test("server cutoffs preserve prototype-like IDs and immutable historical deadlines", () => {
  const before = { state: { activeId: "__proto__", hunts: [{ id: "__proto__", status: "collecting", currency: "USD", rows: [] }] } }, next = clone(before.state); next.hunts[0].status = "opening";
  const windows = W.closePredictionWindows(before, next, BASE); assert.equal(Object.prototype.hasOwnProperty.call(windows, "__proto__"), true); assert.equal(windows.__proto__, BASE.toISOString());
  assert.equal(W.closePredictionWindows({ state: next, predictionClosedAt: windows }, clone(before.state), new Date(+BASE + 1000)).__proto__, BASE.toISOString());
  assert.equal(W.cutoffFor({ predictionClosedAt: {} }, "constructor"), null); assert.notEqual(P.ledgerKey("__proto__"), "__proto__");
});

test("the real OAuth session helper supplies prediction identity and storage failures never become anonymous access", async () => {
  const Auth = require("../netlify/lib/hunt-twitch-auth"), authStore = storage();
  const env = { TWITCH_CLIENT_ID: "testClient123", TWITCH_CLIENT_SECRET: "test-only-client-secret", STATS_SESSION_SECRET: SECRET };
  const fetcher = async url => {
    const value = url.includes("/token") ? { access_token: "test-access-token" }
      : url.includes("/validate") ? { client_id: env.TWITCH_CLIENT_ID, user_id: "98765", login: "verifiedviewer", expires_in: 14400 }
      : { data: [{ id: "98765", login: "verifiedviewer", display_name: "VerifiedViewer" }] };
    return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const options = { env, connectStore: () => authStore, fetcher, now: () => new Date(BASE) }, auth = Auth.createHandler(options);
  const authEvent = query => ({ ...event(), rawUrl: "https://thorshall.gg/.netlify/functions/hunt-twitch?" + new URLSearchParams(query), queryStringParameters: query });
  const started = await auth(authEvent({ action: "login", return: "/bonus-hunt#hunt=hunt-a" }));
  assert.equal(started.statusCode, 303);
  const state = new URL(started.headers.Location).searchParams.get("state"), stateCookie = started.cookies[0].split(";")[0];
  const callback = authEvent({ action: "callback", state, code: "test-auth-code" }); callback.headers.cookie = stateCookie;
  const completed = await auth(callback); assert.equal(completed.headers.Location, "/bonus-hunt?twitch=connected#hunt=hunt-a");
  const sessionCookie = completed.cookies.find(cookie => cookie.startsWith(Auth.SESSION_COOKIE + "=")).split(";")[0];
  const f = fixture(), handle = P.createHandler({ ...f.options, authInfoFor: request => Auth.predictionAuthInfo(request, options) });
  const guest = payload(await handle(event())); assert.equal(guest.viewer, null); assert.equal(guest.authConfigured, true);
  const signedIn = payload(await handle(event("GET", { cookie: sessionCookie }))); assert.equal(signedIn.viewer.id, "98765");
  const saved = await handle(event("POST", { cookie: sessionCookie, body: guess() })); assert.equal(saved.statusCode, 201); assert.equal(payload(saved).mine.username, "verifiedviewer");
  const unavailable = P.createHandler({ ...f.options, authInfoFor: request => Auth.predictionAuthInfo(request, { ...options, connectStore: () => { throw new Error("auth store unavailable"); } }) });
  assert.equal((await unavailable(event("POST", { cookie: sessionCookie, body: guess() }))).statusCode, 503);
  assert.equal(f.predictions.writes, 1);
});
