"use strict";

const test = require("node:test"), assert = require("node:assert/strict"), path = require("node:path");
const auth = require("../netlify/lib/hunt-twitch-auth");
const ENV = { TWITCH_CLIENT_ID: "testclient12345", TWITCH_CLIENT_SECRET: "test-only-client-secret", STATS_SESSION_SECRET: "test-only-session-signing-secret-at-least-32-characters" };
const ACCESS_TOKEN = "testOnlyAccessTokenDoNotDisplay";
const clone = value => structuredClone(value);
function memory() {
  const records = new Map(); let version = 0;
  return {
    records,
    async getWithMetadata(key) { const entry = records.get(key); return entry ? clone(entry) : null; },
    async setJSON(key, data, options = {}) {
      const old = records.get(key);
      if ((options.onlyIfNew && old) || (options.onlyIfMatch && options.onlyIfMatch !== old?.etag)) return { modified: false };
      const etag = "test-v" + ++version; records.set(key, { data: clone(data), etag }); return { modified: true, etag };
    },
    async delete(key) { records.delete(key); }
  };
}
function event(action = "session", { cookie, method = "GET", query = {}, origin = "https://thorshall.gg", headers = {} } = {}) {
  const params = { action, ...query };
  return { httpMethod: method, rawUrl: origin + auth.ENDPOINT + "?" + new URLSearchParams(params), queryStringParameters: params,
    deployContext: "production", published: true, headers: { host: new URL(origin).host, ...(cookie ? { cookie } : {}), ...headers } };
}
function cookiePair(response, name) { return response.cookies.find(value => value.startsWith(name + "=")).split(";")[0]; }
function payload(response) { return JSON.parse(response.body); }
function setup({ overrideFetch, env = ENV } = {}) {
  const store = memory(), calls = []; let time = Date.parse("2026-11-19T10:00:00.000Z"), revoked = false;
  const fetcher = async (url, options = {}) => {
    calls.push({ url, options });
    if (overrideFetch) return overrideFetch(url, options);
    if (url.endsWith("/token")) return Response.json({ access_token: ACCESS_TOKEN, refresh_token: "discarded-refresh-token" });
    if (url.endsWith("/validate")) return revoked ? Response.json({ message: "invalid access token" }, { status: 401 })
      : Response.json({ client_id: env.TWITCH_CLIENT_ID, user_id: "123456789", login: "testviewer", expires_in: 24 * 3600, scopes: [] });
    if (url.endsWith("/users")) return Response.json({ data: [{ id: "123456789", login: "testviewer", display_name: "TestViewer" }] });
    throw new Error("Unexpected Twitch request");
  };
  const options = { env, connectStore: () => store, fetcher, now: () => new Date(time) };
  const handler = auth.createHandler(options);
  async function login(returnPath = "/bonus-hunt#hunt=hunt-a") {
    const start = await handler(event("login", { query: { return: returnPath } }));
    const state = new URL(start.headers.Location).searchParams.get("state"), stateCookie = cookiePair(start, auth.STATE_COOKIE);
    const callbackEvent = event("callback", { cookie: stateCookie, query: { state, code: "test-code" } });
    const response = await handler(callbackEvent);
    return { start, response, callbackEvent, state, stateCookie, sessionCookie: response.cookies?.some(c => c.startsWith(auth.SESSION_COOKIE + "=")) ? cookiePair(response, auth.SESSION_COOKIE) : null };
  }
  return { store, options, handler, login, calls, advance: ms => { time += ms; }, revoke: () => { revoked = true; } };
}

test("unconfigured Twitch login fails closed without touching storage", async () => {
  const options = { env: {}, connectStore: () => { throw new Error("must not connect"); } };
  assert.equal(auth.configFor(event(), {}), null);
  const info = await auth.predictionAuthInfo(event(), options);
  assert.equal(info.authConfigured, false); assert.equal(info.viewer, null);
  const handler = auth.createHandler(options);
  assert.equal(payload(await handler(event())).configured, false);
  assert.equal((await handler(event("login"))).statusCode, 503);
});

test("OAuth requests only basic identity and returns to the selected hunt", async () => {
  const app = setup(), login = await app.login();
  const authorize = new URL(login.start.headers.Location);
  assert.equal(authorize.origin, "https://id.twitch.tv");
  assert.equal(authorize.searchParams.get("response_type"), "code");
  assert.equal(authorize.searchParams.get("scope"), "");
  assert.equal(authorize.searchParams.get("redirect_uri"), auth.DEFAULT_REDIRECT);
  assert.match(login.start.cookies[0], /HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
  assert.equal(login.response.statusCode, 303); assert.equal(login.response.headers.Location, "/bonus-hunt?twitch=connected#hunt=hunt-a");
  assert.equal(app.calls.length, 3);
  assert.equal(app.calls[1].options.headers.Authorization, "OAuth " + ACCESS_TOKEN);
  assert.equal(app.calls[2].options.headers["Client-Id"], ENV.TWITCH_CLIENT_ID);
  assert.equal(new URLSearchParams(app.calls[0].options.body).get("client_secret"), ENV.TWITCH_CLIENT_SECRET);
  assert.ok(app.calls.every(call => call.options.signal instanceof AbortSignal && call.options.redirect === "error"));
});

test("successful callbacks replace provider query parameters with a safe marker and keep session cookies", async () => {
  const app = setup(), selected = "/bonus-hunt#hunt=selected-hunt_2";
  const start = await app.handler(event("login", { query: { return: selected } }));
  const state = new URL(start.headers.Location).searchParams.get("state");
  const callback = await app.handler(event("callback", { cookie: cookiePair(start, auth.STATE_COOKIE),
    query: { state, code: "discard-oauth-code-sentinel", scope: "" } }));
  const destination = new URL(callback.headers.Location, "https://thorshall.gg");
  assert.equal(callback.statusCode, 303);
  assert.equal(destination.pathname, "/bonus-hunt");
  assert.equal(destination.search, "?twitch=connected");
  assert.equal(destination.hash, "#hunt=selected-hunt_2");
  assert.deepEqual([...destination.searchParams.keys()], ["twitch"]);
  assert.doesNotMatch(callback.headers.Location, /action=|code=|scope=|state=|discard-oauth-code-sentinel/);
  assert.equal(callback.cookies.length, 2);
  assert.match(callback.cookies[0], new RegExp("^" + auth.STATE_COOKIE + "=;.*Max-Age=0; Secure$"));
  assert.match(callback.cookies[1], new RegExp("^" + auth.SESSION_COOKIE + "=.*HttpOnly; SameSite=Lax; Max-Age=28800; Secure$"));
  const session = payload(await app.handler(event("session", { cookie: cookiePair(callback, auth.SESSION_COOKIE) })));
  assert.equal(session.user.login, "testviewer");
});

test("sessions store encrypted access tokens and expose only verified Twitch identity", async () => {
  const app = setup(), login = await app.login();
  assert.match(login.sessionCookie, new RegExp("^" + auth.SESSION_COOKIE + "=[A-Za-z0-9_.-]+$"));
  const serialized = JSON.stringify([...app.store.records.values()]);
  assert.doesNotMatch(serialized, new RegExp(ACCESS_TOKEN + "|discarded-refresh-token|" + ENV.TWITCH_CLIENT_SECRET));
  const info = await auth.predictionAuthInfo(event("session", { cookie: login.sessionCookie }), app.options);
  assert.deepEqual(info.viewer, { id: "123456789", login: "testviewer", displayName: "TestViewer" });
  assert.equal(info.authExpiresAt, "2026-11-19T18:00:00.000Z"); assert.equal(info.authRevalidateAt, "2026-11-19T10:55:00.000Z");
  const publicInfo = payload(await app.handler(event("session", { cookie: login.sessionCookie })));
  assert.equal(publicInfo.revalidateAfter, 55 * 60); assert.equal(publicInfo.configured, true);
  assert.doesNotMatch(JSON.stringify(publicInfo), /access_token|refresh_token|client_secret/);
});

test("active visitor sessions revalidate after55 minutes and revoked grants end the session", async () => {
  const app = setup(), login = await app.login();
  app.advance(auth.VALIDATE_MS - 1);
  assert.ok(await auth.getPredictionUser(event("session", { cookie: login.sessionCookie }), app.options));
  assert.equal(app.calls.length, 3);
  app.advance(1);
  assert.ok(await auth.getPredictionUser(event("session", { cookie: login.sessionCookie }), app.options));
  assert.equal(app.calls.length, 5);
  app.revoke(); app.advance(auth.VALIDATE_MS);
  assert.equal(await auth.getPredictionUser(event("session", { cookie: login.sessionCookie }), app.options), null);
  assert.equal([...app.store.records.keys()].filter(key => key.startsWith("session-")).length, 0);
});

test("expired, modified, duplicate and foreign-origin session cookies never authenticate", async () => {
  const app = setup(), login = await app.login();
  assert.equal(await auth.getPredictionUser(event("session", { cookie: login.sessionCookie + "x" }), app.options), null);
  assert.equal(await auth.getPredictionUser(event("session", { cookie: login.sessionCookie + "; " + login.sessionCookie }), app.options), null);
  const previewOptions = { ...app.options, env: { ...ENV, TWITCH_REDIRECT_URI: "https://preview.test" + auth.ENDPOINT + "?action=callback" } };
  assert.equal(await auth.getPredictionUser(event("session", { cookie: login.sessionCookie, origin: "https://preview.test" }), previewOptions), null);
  app.advance(auth.SESSION_MS);
  assert.equal(await auth.getPredictionUser(event("session", { cookie: login.sessionCookie }), app.options), null);
});

test("login state is tied to its browser and consumed before token exchange", async () => {
  const app = setup();
  const start = await app.handler(event("login")), state = new URL(start.headers.Location).searchParams.get("state");
  const wrong = await app.handler(event("callback", { query: { state, code: "test-code" }, cookie: auth.STATE_COOKIE + "=different" }));
  assert.match(wrong.headers.Location, /twitch=expired/); assert.equal(app.calls.length, 0);
  const callback = event("callback", { query: { state, code: "test-code" }, cookie: cookiePair(start, auth.STATE_COOKIE) });
  const responses = await Promise.all([app.handler(callback), app.handler(callback)]);
  assert.equal(responses.filter(r => r.cookies?.some(c => c.startsWith(auth.SESSION_COOKIE + "="))).length, 1);
  assert.equal(app.calls.length, 3);
  const replay = await app.handler(callback); assert.match(replay.headers.Location, /twitch=expired/); assert.equal(app.calls.length, 3);
});

test("expired OAuth state is rejected and access denial never exchanges a code", async () => {
  const app = setup();
  let start = await app.handler(event("login")), state = new URL(start.headers.Location).searchParams.get("state");
  app.advance(auth.STATE_MS);
  assert.match((await app.handler(event("callback", { query: { state, code: "test-code" }, cookie: cookiePair(start, auth.STATE_COOKIE) }))).headers.Location, /twitch=expired/);
  start = await app.handler(event("login")); state = new URL(start.headers.Location).searchParams.get("state");
  const denied = await app.handler(event("callback", { query: { state, error: "access_denied", error_description: "sensitive unexpected provider text" }, cookie: cookiePair(start, auth.STATE_COOKIE) }));
  assert.match(denied.headers.Location, /twitch=cancelled/); assert.doesNotMatch(JSON.stringify(denied), /sensitive unexpected/); assert.equal(app.calls.length, 0);
});

test("new OAuth flows are rate limited per pseudonymous connection and pending flows are reused", async () => {
  const app = setup(), firstEvent = event("login", { query: { return: "/bonus-hunt#hunt=hunt-a" } }); firstEvent.clientIp = "192.0.2.10";
  const first = await app.handler(firstEvent), cookie = cookiePair(first, auth.STATE_COOKIE);
  const reused = await app.handler({ ...firstEvent, headers: { ...firstEvent.headers, cookie } });
  assert.equal(reused.headers.Location, first.headers.Location);
  assert.equal([...app.store.records.keys()].filter(key => key.startsWith("pending-")).length, 1);
  for (let i = 1; i < auth.LOGIN_LIMIT; i++) assert.equal((await app.handler(firstEvent)).statusCode, 303);
  const limited = await app.handler(firstEvent); assert.equal(limited.statusCode, 429); assert.ok(Number(limited.headers["Retry-After"]) > 0);
  assert.doesNotMatch(JSON.stringify([...app.store.records.values()]), /192\.0\.2\.10/);
  assert.equal((await app.handler({ ...firstEvent, clientIp: "192.0.2.11" })).statusCode, 303);
  app.advance(auth.STATE_MS);
  assert.equal((await app.handler(firstEvent)).statusCode, 303);
});

test("expired and consumed OAuth state records are cleaned without allowing replay", async () => {
  const app = setup(), login = await app.login();
  assert.equal([...app.store.records.keys()].filter(key => key.startsWith("pending-")).length, 0);
  const start = await app.handler(event("login"));
  const state = new URL(start.headers.Location).searchParams.get("state");
  app.advance(auth.STATE_MS);
  await app.handler(event("callback", { cookie: cookiePair(start, auth.STATE_COOKIE), query: { state, code: "test-code" } }));
  assert.equal([...app.store.records.keys()].filter(key => key.startsWith("pending-")).length, 0);
  assert.match((await app.handler(login.callbackEvent)).headers.Location, /twitch=expired/);
});

test("only allowlisted hunt paths and registered callback origins are used", async () => {
  for (const value of ["https://evil.test", "//evil.test", "/bonus-hunt?next=https://evil.test", "/bonus-hunt#token=secret", "/bonus-hunt\\evil", "/bonus-hunt%0d%0a", "/admin"]) assert.equal(auth.safeReturn(value), "/bonus-hunt");
  assert.equal(auth.safeReturn("/bonus-hunt#hunt=valid-id_1"), "/bonus-hunt#hunt=valid-id_1");
  for (const redirect of ["https://evil.test" + auth.ENDPOINT + "?action=callback", "http://thorshall.gg" + auth.ENDPOINT + "?action=callback", "https://thorshall.gg/other?action=callback", auth.DEFAULT_REDIRECT + "&next=bad"]) assert.equal(auth.configFor(event(), { ...ENV, TWITCH_REDIRECT_URI: redirect }), null);
  const app = setup(), login = await app.login("//evil.test"); assert.equal(login.response.headers.Location, "/bonus-hunt?twitch=connected");
  assert.equal(auth.storeName(event()), "thorshall-hunt-twitch-v1");
  assert.notEqual(auth.storeName({ ...event(), published: false }), auth.storeName(event()));
  assert.notEqual(auth.storeName(event("session", { origin: "https://preview.test" })), auth.storeName(event()));
});

test("client-ID mismatch or mismatched profile cannot mint a session", async () => {
  for (const mismatched of ["client", "user"]) {
    const app = setup({ overrideFetch: async url => {
      if (url.endsWith("/token")) return Response.json({ access_token: ACCESS_TOKEN });
      if (url.endsWith("/validate")) return Response.json({ client_id: mismatched === "client" ? "anotherApp" : ENV.TWITCH_CLIENT_ID, user_id: "123456789", login: "testviewer", expires_in: 3600 });
      return Response.json({ data: [{ id: "999999", login: "testviewer", display_name: "Spoof" }] });
    } });
    const login = await app.login(); assert.equal(login.sessionCookie, null); assert.match(login.response.headers.Location, /twitch=failed/);
  }
});

test("provider and storage failures return sanitized errors without losing the replay guard", async () => {
  const app = setup({ overrideFetch: async () => { throw new Error("secret-provider-text-" + ENV.TWITCH_CLIENT_SECRET); } });
  const login = await app.login(); assert.equal(login.sessionCookie, null); assert.match(login.response.headers.Location, /twitch=failed/);
  assert.doesNotMatch(JSON.stringify(login.response), /secret-provider|test-only-client-secret/);
  assert.match((await app.handler(login.callbackEvent)).headers.Location, /twitch=expired/);
  const unavailable = auth.createHandler({ env: ENV, connectStore: () => { throw new Error("storage secret"); } });
  assert.doesNotMatch(JSON.stringify(await unavailable(event("login"))), /storage secret/);
});

test("logout requires the same origin and removes the server session", async () => {
  const app = setup(), login = await app.login();
  assert.equal((await app.handler(event("logout", { method: "GET", cookie: login.sessionCookie }))).statusCode, 405);
  const foreign = event("logout", { method: "POST", cookie: login.sessionCookie, headers: { origin: "https://evil.test", "x-thorshall-request": "twitch-session" } });
  assert.equal((await app.handler(foreign)).statusCode, 403);
  assert.ok(await auth.getPredictionUser(event("session", { cookie: login.sessionCookie }), app.options));
  const out = await app.handler(event("logout", { method: "POST", cookie: login.sessionCookie, headers: { origin: "https://thorshall.gg", "sec-fetch-site": "same-origin", "x-thorshall-request": "twitch-session" } }));
  assert.equal(out.statusCode, 200); assert.ok(out.cookies.some(c => c.startsWith(auth.SESSION_COOKIE + "=;") && c.includes("Max-Age=0")));
  assert.equal(await auth.getPredictionUser(event("session", { cookie: login.sessionCookie }), app.options), null);
});

test("logout reports a server revocation failure instead of claiming success", async () => {
  const app = setup(), login = await app.login(); app.store.delete = async () => { throw new Error("outage"); };
  const out = await app.handler(event("logout", { method: "POST", cookie: login.sessionCookie, headers: { origin: "https://thorshall.gg", "x-thorshall-request": "twitch-session" } }));
  assert.equal(out.statusCode, 503); assert.equal(out.cookies, undefined);
});

test("token expiry limits visitor session lifetime and encryption tampering fails closed", async () => {
  const app = setup({ overrideFetch: async url => url.endsWith("/token") ? Response.json({ access_token: ACCESS_TOKEN })
    : url.endsWith("/validate") ? Response.json({ client_id: ENV.TWITCH_CLIENT_ID, user_id: "123456789", login: "testviewer", expires_in: 1200 })
      : Response.json({ data: [{ id: "123456789", login: "testviewer", display_name: "TestViewer" }] }) });
  const login = await app.login(); assert.match(login.response.cookies.find(c => c.startsWith(auth.SESSION_COOKIE + "=")), /Max-Age=1200/);
  app.advance(1200000); assert.equal(await auth.getPredictionUser(event("session", { cookie: login.sessionCookie }), app.options), null);
  const other = setup(), good = await other.login();
  const entry = [...other.store.records.entries()].find(([key]) => key.startsWith("session-"));
  entry[1].data.token.tag = "invalid"; other.advance(auth.VALIDATE_MS);
  await assert.rejects(() => auth.getPredictionUser(event("session", { cookie: good.sessionCookie }), other.options), /temporarily unavailable/);
});

test("modern function rejects duplicate or unsupported OAuth query parameters", async () => {
  const { pathToFileURL } = require("node:url");
  const modern = await import(pathToFileURL(path.resolve(__dirname, "../netlify/functions/hunt-twitch.mjs")).href);
  for (const suffix of ["?action=session&action=login", "?action=session&unexpected=1"]) {
    const response = await modern.default(new Request("https://thorshall.gg" + auth.ENDPOINT + suffix));
    assert.equal(response.status, 400); assert.equal((await response.json()).ok, false);
  }
});
