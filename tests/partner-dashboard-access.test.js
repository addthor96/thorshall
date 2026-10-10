"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

// Test-only values. Production credentials belong in Netlify environment variables.
process.env.STATS_SESSION_SECRET = "test-only-session-secret-not-for-production";
process.env.STATS_ADMIN_PASSWORD = "test-only-admin-password";
process.env.STATS_PASSWORD_T2 = "test-only-t2-password";
process.env.STATS_PASSWORD_ADITYA = "test-only-aditya-password";

const auth = require("../netlify/lib/stats-auth");
const { handler: login } = require("../netlify/functions/stats-session");
const { handler: dashboard } = require("../netlify/functions/partner-dashboard");

function event(access, extra = {}) {
  return {
    httpMethod: "GET", path: "/t2-dashboard", queryStringParameters: { partner: "t2" },
    headers: access ? { cookie: `${auth.COOKIE_NAME}=${auth.createSession(access)}` } : {},
    ...extra
  };
}

test("T2 password creates only T2 access; admin and legacy logins retain their scopes", () => {
  assert.equal(auth.authenticate("test-only-t2-password", "t2"), "t2");
  assert.equal(auth.authenticate("test-only-t2-password", "aditya"), "");
  assert.equal(auth.authenticate("test-only-t2-password", "admin"), "");
  assert.equal(auth.authenticate("test-only-aditya-password", "t2"), "");
  assert.equal(auth.authenticate("test-only-aditya-password", "aditya"), "aditya");
  assert.equal(auth.authenticate("test-only-admin-password", "t2"), "admin");
});

test("anonymous and other partner requests cannot read dashboard HTML", async () => {
  for (const access of [null, "aditya", "manuel"]) {
    const result = await dashboard(event(access));
    assert.equal(result.statusCode, 303);
    assert.equal(result.headers.Location, "/.netlify/functions/stats-session?return=%2Ft2-dashboard");
    assert.equal(result.body, "");
    assert.match(result.headers["Cache-Control"], /no-store/);
  }
});

test("T2 and admin can read T2 dashboard, protected responses are never shared-cacheable", async () => {
  for (const access of ["t2", "admin"]) {
    const result = await dashboard(event(access));
    assert.equal(result.statusCode, 200);
    assert.match(result.body, /Swagat Nayak/);
    assert.match(result.body, /150649/);
    assert.match(result.headers["Cache-Control"], /private, no-store/);
    assert.equal(result.headers["Netlify-CDN-Cache-Control"], "no-store");
    assert.equal(result.headers.Vary, "Cookie");
    assert.match(result.headers["X-Robots-Tag"], /noindex/);
    assert.equal(result.headers["X-Frame-Options"], "DENY");
  }
});

test("direct function URL also requires auth; unknown campaign is not selectable", async () => {
  assert.equal((await dashboard(event(null, { path: "/.netlify/functions/partner-dashboard" }))).statusCode, 303);
  assert.equal((await dashboard(event("t2", { path: "/.netlify/functions/partner-dashboard", queryStringParameters: { partner: "t3" } }))).statusCode, 404);
  const known = await dashboard(event("t2", { queryStringParameters: { partner: "aditya", campaignId: "124604" } }));
  assert.equal(known.statusCode, 200);
  assert.match(known.body, /150649/);
});

test("tampered, malformed, expired and non-expiring cookies fail closed", () => {
  const signed = payload => {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return encoded + "." + crypto.createHmac("sha256", process.env.STATS_SESSION_SECRET).update(encoded).digest("base64url");
  };
  for (const token of ["%broken", "bad.signature", auth.createSession("t2") + ".extra", signed({ access: "t2", exp: 1 }), signed({ access: "t2" }), signed({ access: "t2", exp: "not-a-time" })]) {
    assert.equal(auth.isAuthorized({ headers: { cookie: `${auth.COOKIE_NAME}=${token}` } }, "t2"), false);
  }
});

test("unconfigured signing key never grants access", () => {
  const valid = event("t2");
  const secret = process.env.STATS_SESSION_SECRET;
  process.env.STATS_SESSION_SECRET = "";
  try {
    assert.equal(auth.isConfigured("t2"), false);
    assert.equal(auth.isAuthorized(valid, "t2"), false);
  } finally { process.env.STATS_SESSION_SECRET = secret; }
});

test("T2 login returns scoped secure cookie and the intended route", async () => {
  const response = await login({ httpMethod: "POST", headers: { origin: "https://thorshall.gg", host: "thorshall.gg" }, body: new URLSearchParams({ return: "/t2-dashboard", password: "test-only-t2-password" }).toString() });
  assert.equal(response.statusCode, 303);
  assert.equal(response.headers.Location, "/t2-dashboard");
  assert.match(response.headers["Set-Cookie"], /HttpOnly; Secure; SameSite=Strict/);
  assert.match(response.headers["Cache-Control"], /private, no-store/);
  const cookie = response.headers["Set-Cookie"].split(";")[0];
  assert.equal(auth.sessionAccess({ headers: { cookie } }), "t2");
  assert.equal(auth.isAuthorized({ headers: { cookie } }, "admin"), false);
});

test("login handles base64 form posts and rejects cross-origin forms", async () => {
  const body = new URLSearchParams({ return: "/t2-dashboard", password: "test-only-t2-password" }).toString();
  const good = await login({ httpMethod: "POST", headers: {}, isBase64Encoded: true, body: Buffer.from(body).toString("base64") });
  assert.equal(good.statusCode, 303);
  const blocked = await login({ httpMethod: "POST", headers: { origin: "https://elsewhere.invalid", host: "thorshall.gg" }, body });
  assert.equal(blocked.statusCode, 403);
  assert.equal(blocked.headers["Set-Cookie"], undefined);
});

test("login does not redirect to supplied external locations", async () => {
  const result = await login({ httpMethod: "POST", headers: {}, body: new URLSearchParams({ return: "https://elsewhere.invalid", password: "test-only-admin-password" }).toString() });
  assert.equal(result.statusCode, 303);
  assert.equal(result.headers.Location, "/");
});

test("logout expires the cookie and unsupported methods are rejected", async () => {
  const result = await login(event("t2", { queryStringParameters: { logout: "1" } }));
  assert.match(result.headers["Set-Cookie"], /Max-Age=0/);
  assert.equal((await dashboard(event("t2", { httpMethod: "POST" }))).statusCode, 405);
  assert.equal((await login(event("t2", { httpMethod: "PUT" }))).statusCode, 405);
});
