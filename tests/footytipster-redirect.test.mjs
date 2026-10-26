import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import handler, { config } from "../netlify/functions/footytipster-redirect.mjs";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeContext(countryCode) {
  const pending = [];
  return {
    geo: countryCode === undefined ? {} : { country: { code: countryCode } },
    pending,
    waitUntil(promise) {
      pending.push(promise);
    }
  };
}

function stubTracking(submissions) {
  globalThis.fetch = async (url, options) => {
    submissions.push({ url: String(url), options });
    return new Response(null, { status: 200 });
  };
}

for (const country of ["IS", "CA"]) {
  test(`${country} is sent to the exact THORSHALL referral URL`, async () => {
    const submissions = [];
    stubTracking(submissions);
    const context = makeContext(country);
    const request = new Request("https://thorshall.gg/go/footytipster", {
      headers: { referer: "https://thefootytipster.example/sidebar" }
    });

    const response = await handler(request, context);
    await Promise.all(context.pending);

    assert.equal(config.path, "/go/footytipster");
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "https://rainbet.com?r=thorshall");
    assert.equal(response.headers.get("cache-control"), "private, no-store, no-cache, must-revalidate");
    assert.equal(submissions.length, 1);

    const tracked = new URLSearchParams(submissions[0].options.body);
    assert.equal(tracked.get("source"), "footytipster-sidebar");
    assert.equal(tracked.get("campaign"), "thorshall-code");
    assert.equal(tracked.get("country"), country);
    assert.equal(tracked.get("outcome"), "allowed");
    assert.equal(tracked.get("destination"), "https://rainbet.com?r=thorshall");
    assert.equal(tracked.get("referrer"), "https://thefootytipster.example");
  });
}

for (const country of ["GB", "SE", "US", "NL"]) {
  test(`${country} is stopped before the external destination`, async () => {
    const submissions = [];
    stubTracking(submissions);
    const context = makeContext(country);
    const response = await handler(
      new Request("https://thorshall.gg/go/footytipster"),
      context
    );
    await Promise.all(context.pending);

    assert.equal(response.status, 451);
    assert.equal(response.headers.get("location"), null);
    assert.match(await response.text(), /unavailable in your location/i);
    assert.equal(submissions.length, 1);

    const tracked = new URLSearchParams(submissions[0].options.body);
    assert.equal(tracked.get("country"), country);
    assert.equal(tracked.get("outcome"), "blocked");
    assert.equal(tracked.get("destination"), "blocked");
  });
}

test("missing country data fails closed", async () => {
  const submissions = [];
  stubTracking(submissions);
  const context = makeContext(undefined);
  const response = await handler(
    new Request("https://thorshall.gg/go/footytipster"),
    context
  );
  await Promise.all(context.pending);

  assert.equal(response.status, 451);
  const tracked = new URLSearchParams(submissions[0].options.body);
  assert.equal(tracked.get("country"), "unknown");
  assert.equal(tracked.get("outcome"), "blocked");
});

test("HEAD returns the route result without recording a click", async () => {
  const submissions = [];
  stubTracking(submissions);
  const context = makeContext("IS");
  const response = await handler(
    new Request("https://thorshall.gg/go/footytipster", { method: "HEAD" }),
    context
  );

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://rainbet.com?r=thorshall");
  assert.equal(submissions.length, 0);
});

test("unsupported methods are rejected and not tracked", async () => {
  const submissions = [];
  stubTracking(submissions);
  const context = makeContext("IS");
  const response = await handler(
    new Request("https://thorshall.gg/go/footytipster", { method: "POST" }),
    context
  );

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD");
  assert.equal(submissions.length, 0);
});
