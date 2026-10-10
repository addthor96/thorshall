"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHandler, rangeDates, extractReportMetrics } = require("../netlify/functions/partner-stats");
const { partners, getPartner } = require("../netlify/lib/partner-campaigns");

const NOW = new Date("2026-10-10T11:04:08.000Z");
const TOTALS = {
  wager: "1,250.50", deposits_sum: { amount: "100.25" }, visits_count: 9,
  registrations_count: 2, first_deposits_count: 1, ggr: -20, ngr: -24, sb_ngr: 4
};
const report = (totals = TOTALS) => ({ totals: { data: [totals] } });
const event = (query = {}, extra = {}) => ({ httpMethod: "GET", queryStringParameters: { partner: "t2", ...query }, ...extra });
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
const bodyOf = result => JSON.parse(result.body);
const options = (changes = {}) => ({
  authorize: (_event, scope) => scope === "t2", now: () => new Date(NOW),
  getToken: () => "test-token", fetchImpl: async () => response(report()), wait: async () => {}, ...changes
});

test("registry owns fixed T2 identity and rejects inherited or unregistered codes", () => {
  assert.equal(getPartner("T2"), partners.t2);
  assert.equal(getPartner("t2").campaignId, "150649");
  assert.equal(getPartner("t2").dashboardPath, "/t2-dashboard");
  for (const key of ["t1", "t3", "constructor", "__proto__", "150649", ""]) assert.equal(getPartner(key), null);
  assert.ok(Object.isFrozen(partners));
  assert.ok(Object.isFrozen(partners.t2));
});

test("date ranges are UTC and monthly boundaries don't retain the old day", () => {
  const expected = {
    today: "2026-10-10T00:00:00.000Z",
    "7d": "2026-10-04T00:00:00.000Z",
    month: "2026-10-01T00:00:00.000Z",
    all: "2019-01-01T00:00:00.000Z"
  };
  for (const [key, from] of Object.entries(expected)) {
    assert.deepEqual(rangeDates(key, NOW), { key, from, to: NOW.toISOString() });
  }
  assert.equal(rangeDates("7d", new Date("2026-01-01T00:10:00Z")).from, "2025-12-26T00:00:00.000Z");
  assert.equal(rangeDates("7d", new Date("2024-03-01T01:00:00Z")).from, "2024-02-24T00:00:00.000Z");
  assert.equal(rangeDates("month", new Date("2026-01-31T23:59:59Z")).from, "2026-01-01T00:00:00.000Z");
  assert.throws(() => rangeDates("30d", NOW));
});

test("report parser uses campaign totals, includes sportsbook and preserves negative revenue", () => {
  const expected = { wager: 1250.5, deposits: 100.25, visits: 9, registrations: 2, ftd: 1, ggr: -20, ngr: -24, sbNgr: 4 };
  assert.deepEqual(extractReportMetrics(report()), expected);
  const named = Object.entries(TOTALS).map(([name, value]) => ({ name, value }));
  assert.deepEqual(extractReportMetrics({ data: { totals: { data: named } } }), expected);
  assert.deepEqual(extractReportMetrics({ rows: { totals: { data: [named] }, data: [{ ...TOTALS, wager: 99 }] } }), expected);
  assert.deepEqual(extractReportMetrics({ result: { summary: TOTALS } }), expected);
});

test("missing optional columns remain unavailable and an explicit empty report alone becomes zero", () => {
  const { first_deposits_count, ggr, ngr, sb_ngr, ...core } = TOTALS;
  const metrics = extractReportMetrics(report(core));
  for (const key of ["ftd", "ggr", "ngr", "sbNgr"]) assert.equal(metrics[key], null);
  for (const empty of [
    { rows: { data: [] }, totals: { data: [] } },
    { rows: [], total_count: 0 },
    { data: [], total: "0" }
  ]) {
    assert.ok(Object.values(extractReportMetrics(empty)).every(value => value === 0));
  }
});

test("explicit optional null is unavailable while core null and malformed optional values fail", () => {
  const nullable = { ...TOTALS, first_deposits_count: null, ggr: { amount: null }, ngr: { value: null }, sb_ngr: null };
  for (const data of [report(nullable), { totals: { data: Object.entries(nullable).map(([name, value]) => ({ name, value })) } }]) {
    const metrics = extractReportMetrics(data);
    assert.equal(metrics.wager, 1250.5);
    for (const key of ["ftd", "ggr", "ngr", "sbNgr"]) assert.equal(metrics[key], null);
  }
  for (const field of ["wager", "deposits_sum", "visits_count", "registrations_count"]) {
    assert.throws(() => extractReportMetrics(report({ ...TOTALS, [field]: null })));
  }
  for (const value of ["not a number", "", false, {}, { amount: "invalid" }]) {
    assert.throws(() => extractReportMetrics(report({ ...TOTALS, sb_ngr: value })));
  }
});

test("malformed, partial, error and individual-row responses never become false zero totals", () => {
  for (const invalid of [
    null, [], {}, { rows: [] }, { totals: { data: [] } },
    { message: "Invalid campaign", data: [] },
    { success: false, rows: [], total: 0 },
    { errors: ["Denied"], rows: [], total: 0 },
    { data: { error: "Denied", rows: [], total: 0 } },
    report({ wager: 0 }),
    report({ ...TOTALS, deposits_sum: "not a number" }),
    report({ ...TOTALS, visits_count: false }),
    { rows: { data: [TOTALS] } },
    { rows: [], total: 0, totals: { wager: 0 } },
    { rows: [], total: 0, total_count: 3 },
    { rows: [], total: 0, totals: { data: [{ unrecognized: 1 }] } },
    { rows: [], total: 0, data: { rows: [TOTALS] } },
    { totals: { data: [{ name: "wager", value: 1 }, { name: "wager", value: 2 }] } }
  ]) assert.throws(() => extractReportMetrics(invalid), JSON.stringify(invalid));
});

test("unauthenticated requests cannot read the cache, token or upstream", async () => {
  const handler = createHandler(options({
    authorize: (_event, scope) => { assert.equal(scope, "t2"); return false; },
    getToken: () => { throw new Error("token touched before authentication"); },
    cache: { get: () => { throw new Error("cache touched before authentication"); } },
    wait: () => { throw new Error("retry wait touched before authentication"); },
    fetchImpl: () => { throw new Error("upstream touched before authentication"); }
  }));
  const result = await handler(event());
  assert.equal(result.statusCode, 401);
  assert.equal(result.headers["Cache-Control"], "private, no-store, max-age=0");
  assert.equal(result.headers["Netlify-CDN-Cache-Control"], "no-store");
  assert.equal(result.headers["CDN-Cache-Control"], "no-store");
});

test("authorization is rechecked before warm-cache results and logout cannot leak stats", async () => {
  let allowed = true;
  let calls = 0;
  let authorizations = 0;
  const handler = createHandler(options({
    authorize: () => { authorizations += 1; return allowed; },
    fetchImpl: async () => { calls += 1; return response(report()); }
  }));
  assert.equal(bodyOf(await handler(event())).cached, false);
  assert.equal(bodyOf(await handler(event())).cached, true);
  allowed = false;
  const result = await handler(event());
  assert.equal(result.statusCode, 401);
  assert.equal(bodyOf(result).metrics, undefined);
  assert.equal(calls, 1);
  assert.equal(authorizations, 3);
});

test("outgoing report always has the registry campaign and the chosen range; no commission is invented", async () => {
  let requested;
  const handler = createHandler(options({ fetchImpl: async (url, init) => {
    requested = new URL(url);
    assert.equal(init.headers.Authorization, "test-token");
    return response(report());
  } }));
  const result = await handler(event());
  assert.equal(result.statusCode, 200);
  assert.deepEqual(requested.searchParams.getAll("campaign_ids[]"), ["150649"]);
  assert.ok(requested.searchParams.getAll("columns[]").includes("sb_ngr"));
  assert.equal(requested.searchParams.get("from"), "2026-10-01T00:00:00.000Z");
  assert.equal(requested.searchParams.get("to"), NOW.toISOString());
  const payload = bodyOf(result);
  assert.equal(payload.partner.name, "Swagat Nayak");
  assert.equal(payload.partner.campaignId, "150649");
  assert.equal(payload.range.key, "month");
  assert.equal(payload.metrics.ngr, -24);
  assert.equal(payload.updated, NOW.toISOString());
  assert.equal(payload.commission, undefined);
  assert.equal(payload.payout, undefined);
});

test("different ranges have separate cache entries and month rollover fetches new totals", async () => {
  let now = new Date(NOW);
  let calls = 0;
  const handler = createHandler(options({ now: () => new Date(now), fetchImpl: async () => { calls += 1; return response(report()); } }));
  await handler(event());
  await handler(event({ range: "7d" }));
  await handler(event());
  assert.equal(calls, 2);
  now = new Date("2026-11-01T00:00:01Z");
  assert.equal(bodyOf(await handler(event())).range.from, "2026-11-01T00:00:00.000Z");
  assert.equal(calls, 3);
});

test("generic campaign overrides and unregistered partners never reach upstream", async () => {
  let calls = 0;
  const handler = createHandler(options({ fetchImpl: async () => { calls += 1; return response(report()); } }));
  for (const query of [{ campaignId: "89073" }, { campaign_id: "89073" }, { "campaign_ids[]": "89073" }, { range: "invalid" }]) {
    assert.equal((await handler(event(query))).statusCode, 400);
  }
  assert.equal((await handler(event({ partner: "t1" }))).statusCode, 404);
  assert.equal((await handler(event({ partner: "admin" }))).statusCode, 404);
  assert.equal((await handler(event({}, { httpMethod: "POST" }))).statusCode, 405);
  assert.equal(calls, 0);
});

test("upstream failures and malformed JSON return sanitized errors and never cache false zeros", async () => {
  let calls = 0;
  const handler = createHandler(options({ fetchImpl: async () => {
    calls += 1;
    if (calls === 1) throw new Error("SECRET upstream token and PII");
    if (calls === 2) return { ok: true, status: 200, text: async () => "not JSON SECRET" };
    if (calls === 3) return response({ rows: [] });
    return response(report());
  } }));
  for (let index = 0; index < 3; index += 1) {
    const result = await handler(event());
    assert.equal(result.statusCode, 502);
    assert.equal(bodyOf(result).metrics, undefined);
    assert.ok(!result.body.includes("SECRET"));
  }
  assert.equal((await handler(event())).statusCode, 200);
  assert.equal(calls, 4);
});

test("only an upstream auth failure retries the alternate Authorization format", async () => {
  const authorization = [];
  const handler = createHandler(options({ fetchImpl: async (_url, init) => {
    authorization.push(init.headers.Authorization);
    return authorization.length === 1 ? response({ error: "SECRET" }, 401) : response(report());
  } }));
  assert.equal((await handler(event())).statusCode, 200);
  assert.deepEqual(authorization, ["test-token", "Bearer test-token"]);
  let calls = 0;
  const waits = [];
  const limited = createHandler(options({ wait: async ms => { waits.push(ms); }, fetchImpl: async () => { calls += 1; return response({ message: "SECRET" }, 429); } }));
  const result = await limited(event());
  assert.equal(result.statusCode, 502);
  assert.equal(calls, 2);
  assert.equal(waits.length, 1);
  assert.ok(waits[0] > 0 && waits[0] <= 1500);
  assert.ok(!result.body.includes("SECRET"));
});

test("one bounded rate-limit retry can recover and remains behind authentication", async () => {
  const actions = [];
  let requests = 0;
  const handler = createHandler(options({
    authorize: () => { actions.push("authorize"); return true; },
    wait: async ms => { actions.push(`wait:${ms}`); },
    fetchImpl: async (_url, init) => {
      actions.push(`fetch:${init.headers.Authorization}`);
      requests += 1;
      return requests === 1 ? response({}, 429) : response(report());
    }
  }));
  assert.equal((await handler(event())).statusCode, 200);
  assert.deepEqual(actions, ["authorize", "fetch:test-token", "wait:1200", "fetch:test-token"]);
  assert.equal(bodyOf(await handler(event())).cached, true);
  assert.equal(requests, 2);
});

test("missing reporting configuration is honest and doesn't call upstream", async () => {
  const handler = createHandler(options({ getToken: () => "", fetchImpl: () => { throw new Error("must not fetch"); } }));
  const result = await handler(event());
  assert.equal(result.statusCode, 503);
  assert.equal(bodyOf(result).metrics, undefined);
  assert.ok(!result.body.includes("RAINBET_STATISTIC_TOKEN"));
});
