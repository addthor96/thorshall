"use strict";

const test = require("node:test"), assert = require("node:assert/strict"), crypto = require("node:crypto");
const P = require("../netlify/lib/hunt-predictions");
const W = require("../netlify/lib/hunt-prediction-windows");
const Core = require("../hunt-shared");
const SECRET = "test-only-prediction-secret-over-32-characters";
const clone = value => structuredClone(value);
const BASE = new Date("2026-11-19T13:00:00.000Z");
function storage(initial = new Map()) {
  const records = new Map(initial), versions = new Map(); let writes = 0;
  return {
    records, get writes() { return writes; }, beforeWrite: null, afterWrite: null,
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
function fixture() {
  let clock = new Date(BASE), opens = 0;
  const hunt = { id: "hunt-a", title: "Test hunt", date: "2026-11-19", currency: "USD", start: 1000, balance: 0,
    status: "collecting", rows: [{ id: "row-a", slot: "Test slot", provider: "", bet: 10, payout: null }] };
  const record = { state: { schema: 2, activeId: hunt.id, hunts: [hunt], settings: { public: true } }, streamToken: "do-not-disclose-this-stream-token" };
  const huntStore = storage(new Map([["hunt-manager", record]])), predictions = storage();
  const options = { connectHunts: () => { opens++; return huntStore; }, connectPredictions: () => predictions,
    now: () => new Date(clock), secretFor: () => SECRET, logDiagnostic: () => {} };
  const handle = P.createHandler(options);
  const update = fn => { const next = clone(huntStore.records.get("hunt-manager")); fn(next); huntStore.records.set("hunt-manager", next); };
  return { handle, options, huntStore, predictions, update, get opens() { return opens; }, setClock: value => { clock = new Date(value); } };
}
function event(method = "GET", { cookie, body, hunt = "hunt-a", clientIp = "192.0.2.1", headers = {} } = {}) {
  return { httpMethod: method, rawUrl: "https://thorshall.gg/.netlify/functions/hunt-predictions" + (method === "GET" ? "?hunt=" + hunt : ""),
    deployContext: "production", published: true, clientIp,
    queryStringParameters: method === "GET" ? { hunt } : {},
    headers: { host: "thorshall.gg", origin: "https://thorshall.gg", "sec-fetch-site": "same-origin", "content-type": "application/json",
      "x-thorshall-request": "hunt-prediction", ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? "" : JSON.stringify(body) };
}
function payload(response) { return JSON.parse(response.body); }
async function browser(f, opts = {}) {
  const response = await f.handle(event("GET", opts));
  assert.equal(response.statusCode, 200);
  return response.headers["Set-Cookie"].split(";")[0];
}
function guess(username = "ViewerOne", amount = "123.45", huntId = "hunt-a") {
  return { huntId, username, amount, requestId: crypto.randomUUID(), website: "" };
}
async function submit(f, cookie, body = guess(), opts = {}) { return f.handle(event("POST", { cookie, body, ...opts })); }

test("guest browser cookies are signed, private, and production/previews use different ledgers", async () => {
  const f = fixture(), response = await f.handle(event());
  assert.match(response.headers["Set-Cookie"], /HttpOnly; SameSite=Lax; Max-Age=7776000; Secure$/);
  assert.match(response.headers["Cache-Control"], /no-store/);
  assert.doesNotMatch(response.body, /stream-token|identityHash|ipHash/);
  const production = P.storeName(event());
  assert.equal(production, "thorshall-hunt-predictions-v1");
  assert.notEqual(P.storeName({ ...event(), published: false }), production);
  assert.notEqual(P.storeName({ ...event(), deployContext: "deploy-preview", published: false }), production);
  assert.notEqual(P.storeName({ ...event(), rawUrl: "https://preview.example/predictions", headers: { host: "preview.example" } }), production);
  assert.throws(() => P.storeName({ ...event(), rawUrl: "https://other.example/predictions" }), /hunt page/);
  assert.equal(f.predictions.writes, 0, "GET creates no storage records");
});

test("money parsing uses exact cents and rejects ambiguous or excessive values", () => {
  for (const [value, expected] of [["0", 0], ["0.01", 1], ["12.3", 1230], ["123.45", 12345], ["1000000000", 100000000000]]) assert.equal(P.parseAmount(value), expected);
  for (const value of [1, "-1", "01", "1,000", "1e3", ".50", "1.", "1.234", "1000000000.01", "Infinity", "<script>"]) assert.throws(() => P.parseAmount(value), P.PredictionError);
  assert.equal(P.finalBalanceMinor({ balance: 0.1, rows: [{ payout: 0.2 }, { payout: null }] }), 30);
  assert.equal(P.finalBalanceMinor({ balance: 12.005, rows: [{ payout: 0.005 }] }), 1201);
  for (const [balance, payouts] of [[0.105, [0.01]], [0.005, []], [1.005, [0.1, 0.2]], [1000.005, [0.005, 0.005]], [0, [0.1, 0.2, 0.305]]]) {
    const hunt = { currency: "USD", balance, rows: payouts.map(payout => ({ payout })) };
    const displayed = Core.money(Core.calculate(hunt).endBalance, "USD");
    const expected = Number(displayed.replace(/[$,.]/g, ""));
    assert.equal(P.finalBalanceMinor(hunt), expected, "ranking must match displayed " + displayed);
  }
});

test("one prediction persists across handlers without touching the editor ETag or exposing other guesses", async () => {
  const f = fixture(), cookie = await browser(f), body = guess();
  const before = await f.huntStore.getWithMetadata("hunt-manager");
  const first = await submit(f, cookie, body), result = payload(first);
  assert.equal(first.statusCode, 201); assert.equal(result.count, 1); assert.equal(result.accepting, true);
  assert.deepEqual(result.mine, { username: "ViewerOne", amountMinor: 12345, createdAt: BASE.toISOString() });
  assert.deepEqual(result.podium, []);
  const later = P.createHandler(f.options), mine = await later(event("GET", { cookie })), stranger = await later(event());
  assert.equal(payload(mine).mine.username, "ViewerOne"); assert.equal(payload(stranger).mine, null);
  assert.equal(payload(stranger).count, 1); assert.deepEqual(payload(stranger).podium, []);
  assert.doesNotMatch(stranger.body, /ViewerOne|12345|identityHash|ipHash|stream-token/);
  assert.equal(f.huntStore.writes, 0); assert.deepEqual(await f.huntStore.getWithMetadata("hunt-manager"), before);
  const stored = JSON.stringify([...f.predictions.records.values()]);
  assert.doesNotMatch(stored, /192\.0\.2\.1|thorshall_prediction_id|test-only-prediction-secret/);
});

test("duplicate-safe retries work after closing and altered or second predictions are rejected", async () => {
  const f = fixture(), cookie = await browser(f), body = guess();
  assert.equal((await submit(f, cookie, body)).statusCode, 201);
  const exact = await submit(f, cookie, body); assert.equal(exact.statusCode, 200); assert.equal(payload(exact).duplicate, true);
  assert.equal((await submit(f, cookie, { ...body, amount: "555" })).statusCode, 409);
  assert.equal((await submit(f, cookie, guess("AnotherName"))).statusCode, 409);
  const stranger = await browser(f);
  assert.equal((await submit(f, stranger, guess("viewerone"))).statusCode, 409);
  f.update(record => { record.predictionClosedAt = { "hunt-a": "2026-11-19T13:01:00.000Z" }; record.state.hunts[0].status = "opening"; });
  const lateRetry = await submit(f, cookie, body); assert.equal(lateRetry.statusCode, 200); assert.equal(payload(lateRetry).count, 1);
  assert.equal((await submit(f, stranger, guess("OtherViewer"))).statusCode, 409);
  assert.equal(f.predictions.writes, 1);
});

test("concurrent saves serialize and enforce case-insensitive username uniqueness", async () => {
  const f = fixture(), a = await browser(f), b = await browser(f);
  const same = await Promise.all([submit(f, a, guess("ViewerOne")), submit(f, b, guess("viewerONE"))]);
  assert.deepEqual(same.map(result => result.statusCode).sort(), [201, 409]);
  const c = await browser(f), d = await browser(f);
  const distinct = await Promise.all([submit(f, c, guess("ViewerTwo")), submit(f, d, guess("ViewerThree"))]);
  assert.deepEqual(distinct.map(result => result.statusCode), [201, 201]);
  assert.equal(payload(await f.handle(event())).count, 3);
});

test("completed hunts reveal only closest three with stable earlier-received tie breaks", async () => {
  const f = fixture(), cookies = [];
  for (const [index, name, amount] of [[0, "EarlyTie", "122.45"], [1, "LateTie", "124.45"], [2, "ExactGuess", "123.45"], [3, "FarGuess", "1"]]) {
    f.setClock(new Date(+BASE + index * 1000)); const cookie = await browser(f); cookies.push(cookie);
    assert.equal((await submit(f, cookie, guess(name, amount))).statusCode, 201);
  }
  f.update(record => { record.predictionClosedAt = { "hunt-a": "2026-11-19T13:01:00.000Z" }; record.state.hunts[0].status = "opening"; record.state.hunts[0].rows[0].payout = 123.45; });
  assert.deepEqual(payload(await f.handle(event())).podium, [], "partial payouts never reveal rivals");
  f.update(record => { record.state.hunts[0].status = "complete"; });
  const response = await f.handle(event()), result = payload(response);
  assert.equal(result.accepting, false); assert.equal(result.count, 4);
  assert.deepEqual(result.podium.map(entry => [entry.place, entry.username, entry.amountMinor, entry.differenceMinor]), [[1, "ExactGuess", 12345, 0], [2, "EarlyTie", 12245, 100], [3, "LateTie", 12445, 100]]);
  assert.doesNotMatch(response.body, /FarGuess|identityHash|ipHash|requestId|createdAt|streamToken/);
  assert.equal(payload(await f.handle(event("GET", { cookie: cookies[3] }))).mine.username, "FarGuess");
});

test("predictions arriving at or after the immutable opening cutoff are excluded despite a raced write", async () => {
  const f = fixture(), cookie = await browser(f), body = guess();
  f.predictions.afterWrite = () => f.update(record => { record.predictionClosedAt = { "hunt-a": BASE.toISOString() }; record.state.hunts[0].status = "opening"; });
  const saved = await submit(f, cookie, body);
  assert.equal(saved.statusCode, 409); assert.equal(f.predictions.writes, 1);
  const result = payload(await f.handle(event("GET", { cookie })));
  assert.equal(result.count, 0); assert.equal(result.mine, null); assert.deepEqual(result.podium, []);
  assert.equal((await submit(f, cookie, body)).statusCode, 409, "retry cannot resurrect a late entry");
});

test("equal guesses received in the same millisecond follow acceptance order, not client-chosen request IDs", async () => {
  const f = fixture(), first = await browser(f), second = await browser(f);
  const a = { ...guess("FirstViewer", "123.45"), requestId: "ffffffff-ffff-4fff-bfff-ffffffffffff" };
  const b = { ...guess("SecondViewer", "123.45"), requestId: "00000000-0000-4000-8000-000000000000" };
  assert.equal((await submit(f, first, a)).statusCode, 201); assert.equal((await submit(f, second, b)).statusCode, 201);
  f.update(record => { record.predictionClosedAt = { "hunt-a": "2026-11-19T13:01:00.000Z" }; record.state.hunts[0].status = "complete"; record.state.hunts[0].rows[0].payout = 123.45; });
  assert.deepEqual(payload(await f.handle(event())).podium.map(entry => entry.username), ["FirstViewer", "SecondViewer"]);
});

test("a prediction received before opening can finish saving after opening without changing the cutoff", async () => {
  const f = fixture(), cookie = await browser(f);
  f.predictions.afterWrite = () => f.update(record => { record.predictionClosedAt = { "hunt-a": "2026-11-19T13:00:00.001Z" }; record.state.hunts[0].status = "opening"; });
  const result = await submit(f, cookie);
  assert.equal(result.statusCode, 201); assert.equal(payload(result).accepting, false); assert.equal(payload(result).count, 1);
  assert.equal(f.huntStore.records.get("hunt-manager").predictionClosedAt["hunt-a"], "2026-11-19T13:00:00.001Z");
});

test("private/inactive hunts are denied and a visibility change during saving does not return private results", async () => {
  const f = fixture(), cookie = await browser(f);
  f.update(record => { record.state.hunts.push({ ...clone(record.state.hunts[0]), id: "hidden-draft" }); });
  assert.equal((await f.handle(event("GET", { hunt: "hidden-draft" }))).statusCode, 404);
  assert.equal((await submit(f, cookie, guess("ViewerOne", "1", "hidden-draft"))).statusCode, 404);
  f.predictions.afterWrite = () => f.update(record => { record.state.settings.public = false; });
  const raced = await submit(f, cookie); assert.equal(raced.statusCode, 403); assert.doesNotMatch(raced.body, /ViewerOne|12345/);
  assert.equal((await f.handle(event())).statusCode, 403);
  assert.equal((await submit(f, cookie, guess())).statusCode, 403);
});

test("currency setup stays open before entries, while existing guesses are excluded on a mismatch", async () => {
  const setup = fixture();
  setup.update(record => { const next = clone(record.state); next.hunts[0].currency = "EUR"; record.predictionClosedAt = W.closePredictionWindows(record, next, new Date(+BASE + 1000)); record.state = next; });
  const fresh = payload(await setup.handle(event())); assert.equal(fresh.accepting, true); assert.equal(fresh.currency, "EUR");
  const f = fixture(), cookie = await browser(f); assert.equal((await submit(f, cookie)).statusCode, 201);
  f.update(record => { const next = clone(record.state); next.hunts[0].currency = "EUR"; record.predictionClosedAt = W.closePredictionWindows(record, next, new Date(+BASE + 1000)); record.state = next; });
  const result = payload(await f.handle(event("GET", { cookie })));
  assert.equal(result.count, 0); assert.equal(result.mine, null); assert.equal(result.accepting, false); assert.match(result.message, /currency changed/);
  assert.equal((await submit(f, await browser(f), guess("NewViewer"))).statusCode, 409);
});

test("cross-origin, forged cookies, invalid usernames, honeypots, large bodies and unsupported methods fail safely", async () => {
  const f = fixture(), cookie = await browser(f), start = f.opens;
  for (const headers of [{ origin: "https://attacker.example" }, { "sec-fetch-site": "cross-site" }, { "x-thorshall-request": "" }, { host: "attacker.example" }]) {
    assert.equal((await submit(f, cookie, guess(), { headers })).statusCode, 403);
  }
  assert.equal((await submit(f, cookie.replace(/.$/, "z"))).statusCode, 403);
  for (const name of ["ab", "x".repeat(26), "<script>", "some user", "@TwitchName"]) assert.equal((await submit(f, cookie, guess(name))).statusCode, 400);
  assert.equal((await submit(f, cookie, { ...guess(), website: "filled" })).statusCode, 400);
  assert.equal((await submit(f, cookie, { ...guess(), createdAt: BASE.toISOString() })).statusCode, 400);
  const oversized = event("POST", { cookie }); oversized.body = " ".repeat(P.MAX_BODY_BYTES + 1);
  assert.equal((await f.handle(oversized)).statusCode, 413);
  assert.equal((await f.handle(event("DELETE"))).statusCode, 405);
  assert.equal(f.opens, start, "all invalid operations are rejected before opening storage");
  assert.equal(f.predictions.writes, 0);
});

test("connection abuse cap permits normal shared connections but bounds accepted entries", async () => {
  const f = fixture();
  for (let index = 0; index < P.MAX_IP_ENTRIES; index++) assert.equal((await submit(f, await browser(f), guess("Viewer_" + index))).statusCode, 201);
  assert.equal((await submit(f, await browser(f), guess("Viewer_Last"))).statusCode, 429);
  assert.equal(payload(await f.handle(event())).count, P.MAX_IP_ENTRIES);
  assert.equal((await submit(f, await browser(f), guess("OtherConnection"), { clientIp: "198.51.100.1" })).statusCode, 201);
});

test("retry after an uncertain write recovers the original entry without adding a second one", async () => {
  const f = fixture(), cookie = await browser(f), body = guess(); let once = true;
  f.predictions.afterWrite = () => { if (once) { once = false; throw new Error("Connection lost after commit"); } };
  assert.equal((await submit(f, cookie, body)).statusCode, 503);
  const retry = await submit(f, cookie, body); assert.equal(retry.statusCode, 200); assert.equal(payload(retry).duplicate, true);
  assert.equal(payload(retry).count, 1); assert.equal(f.predictions.writes, 1);
});

test("server cutoff metadata handles prototype-like IDs and never reopens historical IDs", () => {
  const before = { state: { activeId: "__proto__", hunts: [{ id: "__proto__", status: "collecting", currency: "USD", rows: [] }] } };
  const next = clone(before.state); next.hunts[0].status = "opening";
  const windows = W.closePredictionWindows(before, next, BASE);
  assert.equal(Object.prototype.hasOwnProperty.call(windows, "__proto__"), true);
  assert.equal(windows.__proto__, BASE.toISOString());
  assert.equal(W.cutoffFor({ predictionClosedAt: windows }, "__proto__"), BASE.toISOString());
  const record = { state: next, predictionClosedAt: windows }, reopened = clone(before.state);
  assert.equal(W.closePredictionWindows(record, reopened, new Date(+BASE + 1000)).__proto__, BASE.toISOString());
  assert.equal(W.cutoffFor({ predictionClosedAt: {} }, "constructor"), null);
  assert.notEqual(P.ledgerKey("__proto__"), "__proto__");
});
