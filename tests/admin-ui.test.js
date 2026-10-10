"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

process.env.STATS_SESSION_SECRET = "test-only-admin-ui-signing-secret-not-for-production";
const auth = require("../netlify/lib/stats-auth");
const { renderAdminPage } = require("../netlify/lib/admin-page");
const { handler } = require("../netlify/functions/admin-dashboard");

const fixture = [
  { code: "t1", name: "Motion review Agency", campaignId: "130933", landingPath: "/t1", dashboardPath: "/t1-dashboard", campaignUrl: "https://playrainbet.com/t5cni9vfb", passwordConfigured: false, management: { workflow: "active", notes: "", revision: 0, updatedAt: null } },
  { code: "t2", name: "Swagat Nayak", campaignId: "150649", landingPath: "/t2", dashboardPath: "/t2-dashboard", campaignUrl: "https://playrainbet.com/tggbn1yfr", passwordConfigured: true, management: { workflow: "review", notes: "Follow up", revision: 1, updatedAt: "2026-10-10T12:00:00Z" } }
];

class Element {
  constructor(id = "", tagName = "div") { this.id = id; this.tagName = tagName; this.children = []; this.dataset = {}; this.listeners = {}; this.attributes = {}; this._text = ""; this.value = ""; this.hidden = false; this.disabled = false; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this._text = ""; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  fire(type) { return this.listeners[type]?.({ preventDefault() {} }); }
  focus() {}
  descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
  find(className) { return this.descendants().find(child => child.className === className); }
}

async function start({ directory = () => ({ ok: true, partners: structuredClone(fixture) }), stats = () => ({ ok: true, metrics: { visits: 12, registrations: 3, ftd: 1, ngr: 17.2 }, range: { key: "month" } }), payments = () => ({ ok: true, canManage: true, payments: [] }), mutate = async (url, payload) => ({ ok: true, partner: { ...structuredClone(fixture.find(entry => url.endsWith(entry.code))), management: { workflow: payload.workflow, notes: payload.notes, revision: payload.expectedRevision + 1 } } }) } = {}) {
  const nodes = new Map();
  for (const [, tag, attributes, id] of renderAdminPage().matchAll(/<([a-z]+)([^>]*\bid="([^"]+)"[^>]*)>/g)) { const node = new Element(id, tag); node.hidden = /\bhidden\b/.test(attributes); node.disabled = /\bdisabled\b/.test(attributes); nodes.set(id, node); }
  const calls = [];
  const events = new Map();
  const context = {
    document: { getElementById: id => nodes.get(id), createElement: tag => new Element("", tag) },
    window: { addEventListener: (type, fn) => events.set(type, fn) },
    Intl, Date, URLSearchParams, AbortController, setTimeout: () => 1, clearTimeout() {}, navigator: { clipboard: { writeText: async () => {} } },
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      let value;
      if (options.method) value = await mutate(url, JSON.parse(options.body));
      else if (url.includes("admin-data")) value = await directory();
      else { const code = new URL(url, "https://thorshall.gg").searchParams.get("partner"); value = { partner: { code }, ...(url.includes("partner-stats") ? await stats(code) : await payments(code)) }; }
      if (value instanceof Error) throw value;
      return { ok: !value.status || value.status < 400, status: value.status || 200, json: async () => value };
    }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../assets/admin.js"), "utf8"), context);
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
  await settle();
  const card = code => nodes.get("partner-list").children.find(node => node.dataset.partner === code);
  return { nodes, calls, events, settle, card };
}

test("admin HTML and direct function require the master session with private headers", async () => {
  for (const path of ["/admin", "/.netlify/functions/admin-dashboard"]) {
    for (const access of [null, "t1", "t2", "manuel"]) {
      const response = await handler({ httpMethod: "GET", path, headers: access ? { cookie: `${auth.COOKIE_NAME}=${auth.createSession(access)}` } : {} });
      assert.equal(response.statusCode, 303);
      assert.equal(response.headers.Location, "/.netlify/functions/stats-session?return=%2Fadmin");
      assert.equal(response.body, "");
    }
    const response = await handler({ httpMethod: "GET", path, headers: { cookie: `${auth.COOKIE_NAME}=${auth.createSession("admin")}` } });
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /OWNER WORKSPACE/);
    assert.equal(response.headers.Vary, "Cookie");
    assert.equal(response.headers["Cache-Control"], "private, no-store");
    assert.equal(response.headers["Netlify-CDN-Cache-Control"], "no-store");
    assert.match(response.headers["Content-Security-Policy"], /frame-ancestors 'none'/);
    assert.match(response.headers["X-Robots-Tag"], /noindex/);
  }
  assert.equal((await handler({ httpMethod: "POST", headers: {} })).statusCode, 405);
});

test("directory storage failure blocks editing and is not represented as zero partners", async () => {
  const app = await start({ directory: () => ({ status: 503 }) });
  assert.equal(app.nodes.get("summary-total").textContent, "—");
  assert.equal(app.nodes.get("directory-error").hidden, false);
  assert.equal(app.nodes.get("partner-list").children.length, 0);
  assert.equal(app.calls.some(call => call.url.includes("partner-stats")), false);
  assert.match(app.nodes.get("payments-status").textContent, /could not be loaded/);
});

test("independent report and payment failures preserve useful data without inventing zero", async () => {
  const app = await start({ stats: code => code === "t1" ? { status: 503 } : { ok: true, metrics: { visits: 9, ngr: 20 }, range: { key: "month" } }, payments: code => code === "t2" ? { status: 503 } : { ok: true, canManage: true, payments: [{ amountPaid: "10.50", currency: "USD", paidAt: "2026-10-01", reportingMonth: "2026-09", reference: "<img src=x>" }] } });
  assert.equal(app.nodes.get("summary-total").textContent, "2");
  assert.equal(app.nodes.get("summary-ready").textContent, "1");
  assert.match(app.card("t1").find("partner-source").textContent, /unavailable/);
  assert.match(app.card("t1").find("partner-metrics").textContent, /—/);
  assert.match(app.card("t2").find("partner-metrics").textContent, /9/);
  assert.match(app.nodes.get("recent-payments").textContent, /10.50 USD/);
  assert.match(app.nodes.get("recent-payments").textContent, /<img src=x>/);
  assert.equal(app.nodes.get("recent-payments").descendants().some(node => node.tagName === "img"), false);
  assert.match(app.nodes.get("payments-status").textContent, /History unavailable for T2/);
});

test("search and private workflow filtering use registry data", async () => {
  const app = await start();
  app.nodes.get("partner-search").value = "150649";
  app.nodes.get("partner-search").fire("input");
  assert.equal(app.card("t1").hidden, true);
  assert.equal(app.card("t2").hidden, false);
  app.nodes.get("partner-search").value = "";
  app.nodes.get("workflow-filter").value = "paused";
  app.nodes.get("workflow-filter").fire("change");
  assert.equal(app.nodes.get("no-matches").hidden, false);
});

test("private note saves use expected revision and an ambiguous retry keeps the identical payload", async () => {
  let attempt = 0;
  const app = await start({ mutate: async (url, payload) => ++attempt === 1 ? new Error("Connection lost") : { ok: true, partner: { ...structuredClone(fixture[1]), management: { ...payload, revision: 2 } } } });
  const card = app.card("t2");
  card.find("partner-edit-toggle").fire("click");
  const form = card.find("notes-form");
  const notes = form.descendants().find(node => node.tagName === "textarea");
  const workflow = form.descendants().find(node => node.tagName === "select");
  notes.value = "Contact partner next week"; notes.fire("input");
  workflow.value = "paused";
  assert.equal(app.nodes.get("refresh-all").disabled, true);
  card.find("partner-edit-toggle").fire("click");
  assert.equal(notes.value, "Contact partner next week");
  await form.fire("submit");
  assert.equal(notes.disabled, true);
  assert.match(form.textContent, /Retry save/);
  let prevented = false;
  app.events.get("beforeunload")({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  await form.fire("submit");
  const writes = app.calls.filter(call => call.options.method);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].options.body, writes[1].options.body);
  assert.equal(JSON.parse(writes[0].options.body).expectedRevision, 1);
  assert.equal(form.hidden, true);
  assert.equal(card.find("partner-workflow").textContent, "On hold");
  assert.equal(app.nodes.get("summary-review").textContent, "0");
});

test("revision conflict reload failure blocks another write until workspace refresh", async () => {
  let reads = 0;
  const app = await start({ directory: () => ++reads > 1 ? { status: 503 } : { ok: true, partners: structuredClone(fixture) }, mutate: async () => ({ status: 409 }) });
  const card = app.card("t2");
  card.find("partner-edit-toggle").fire("click");
  await card.find("notes-form").fire("submit");
  assert.equal(card.find("partner-edit-toggle").disabled, true);
  assert.match(card.find("card-message").textContent, /before editing/);
});

test("expired session clears all private data and stops queued requests", async () => {
  const app = await start({ payments: () => ({ status: 401 }) });
  assert.equal(app.nodes.get("session-error").hidden, false);
  assert.equal(app.nodes.get("partner-list").children.length, 0);
  assert.equal(app.nodes.get("recent-payments").children.length, 0);
  assert.equal(app.nodes.get("summary-total").textContent, "—");
  assert.equal(app.nodes.get("refresh-all").disabled, true);
});

test("bfcache leaving clears notes and restore refetches authorized directory", async () => {
  const app = await start();
  const card = app.card("t2");
  card.find("partner-edit-toggle").fire("click");
  const notes = card.find("notes-form").descendants().find(node => node.tagName === "textarea");
  notes.value = "Private unsaved notes";
  app.events.get("pagehide")();
  assert.equal(notes.value, "");
  assert.equal(app.nodes.get("partner-list").children.length, 0);
  app.events.get("pageshow")({ persisted: true });
  await app.settle();
  assert.equal(app.nodes.get("partner-list").children.length, 2);
  assert.equal(app.calls.filter(call => call.url === "/.netlify/functions/admin-data").length, 2);
});
