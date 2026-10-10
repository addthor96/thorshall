"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
process.env.STATS_SESSION_SECRET = "test-only-admin-hub-session-secret-never-production";
process.env.STATS_ADMIN_PASSWORD = "test-only-owner-password";
process.env.STATS_PASSWORD_T1 = "test-only-t1-password";
process.env.STATS_PASSWORD_T2 = "test-only-t2-password";

const auth = require("../netlify/lib/stats-auth");
const { handler: login } = require("../netlify/functions/stats-session");
const { renderDashboard } = require("../netlify/lib/partner-dashboard-page");
const { partners } = require("../netlify/lib/partner-campaigns");

function signed(access) {
  return { cookie: `${auth.COOKIE_NAME}=${auth.createSession(access)}` };
}
function post(password, access, returnTo = "/admin") {
  return { httpMethod: "POST", headers: { ...signed(access || "t2"), origin: "https://thorshall.gg", host: "thorshall.gg" }, body: new URLSearchParams({ password, return: returnTo }).toString() };
}

test("admin return renders owner sign-in; existing partner sessions cannot skip it", async () => {
  for (const headers of [{}, signed("t1"), signed("t2")]) {
    const result = await login({ httpMethod: "GET", headers, queryStringParameters: { return: "/admin" } });
    assert.equal(result.statusCode, 200);
    assert.match(result.body, /Admin sign-in/);
    assert.match(result.body, /name="return" value="\/admin"/);
    assert.match(result.body, /Open admin/);
    assert.match(result.body, /Owner access only/);
    assert.match(result.headers["Cache-Control"], /no-store/);
    assert.equal(result.headers["Referrer-Policy"], "same-origin");
  }
});

test("only owner password grants admin; a partner session may upgrade through the owner form", async () => {
  for (const password of ["test-only-t1-password", "test-only-t2-password", "bad"]) {
    const rejected = await login(post(password, "t2"));
    assert.equal(rejected.statusCode, 401);
    assert.equal(rejected.headers["Set-Cookie"], undefined);
  }
  const accepted = await login(post("test-only-owner-password", "t2"));
  assert.equal(accepted.statusCode, 303);
  assert.equal(accepted.headers.Location, "/admin");
  assert.equal(auth.sessionAccess({ headers: { cookie: accepted.headers["Set-Cookie"].split(";")[0] } }), "admin");
});

test("owner session returns directly to hub, with no alternate open redirect", async () => {
  const result = await login({ httpMethod: "GET", headers: signed("admin"), queryStringParameters: { return: "/admin" } });
  assert.equal(result.statusCode, 303);
  assert.equal(result.headers.Location, "/admin");
  for (const returnTo of ["//outside.invalid", "/admin?return=https://outside.invalid", "/admin/../other"]) {
    assert.equal((await login(post("test-only-owner-password", "t2", returnTo))).headers.Location, "/");
  }
});

test("partner dashboards show an admin home link only for the owner", () => {
  assert.match(renderDashboard(partners.t1, { isAdmin: true, partners: Object.values(partners) }), /href="\/admin">Admin home/);
  assert.doesNotMatch(renderDashboard(partners.t1), /href="\/admin"/);
});
