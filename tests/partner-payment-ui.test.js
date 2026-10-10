"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { renderDashboard } = require("../netlify/lib/partner-dashboard-page");
const { partners } = require("../netlify/lib/partner-campaigns");

const partner = partners.t2;
const fixture = {
  id: "payment-1", reportingMonth: "2026-09", amountPaid: "125.50", currency: "USD", paidAt: "2026-10-01",
  reference: "<img src=x onerror=alert(1)>", revision: 1, status: "paid", createdAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-01T12:00:00Z", history: []
};

class Element {
  constructor(id = "", tag = "div") {
    this.id = id; this.tagName = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.attributes = {};
    this._text = ""; this.hidden = false; this.disabled = false; this.value = ""; this.classList = { add() {}, remove() {} };
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; this._text = ""; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  async fire(type) { return this.listeners[type]?.({ preventDefault() {} }); }
  focus() {} select() {}
  querySelectorAll(selector) {
    const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll("*")]);
    return selector === "[data-correct-payment]" ? descendants.filter(node => node.dataset.correctPayment) : descendants;
  }
}

async function start({ admin = true, ledger = () => ({ ok: true, partner: { code: "t2" }, canManage: admin, payments: [] }), mutate = async () => ({ ok: true, payment: fixture }), statsStatus = 200 } = {}) {
  const html = renderDashboard(partner, { isAdmin: admin, partners: Object.values(partners) });
  const nodes = new Map();
  for (const [, tag, id] of html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"/g)) nodes.set(id, new Element(id, tag));
  const fields = ["payment-month", "payment-amount", "payment-currency", "payment-date", "payment-reference", "payment-correction-reason"].map(id => nodes.get(id)).filter(Boolean);
  if (admin) {
    nodes.get("payment-form").querySelectorAll = () => fields;
    nodes.get("payment-form").reportValidity = () => true;
    nodes.get("payment-form").reset = () => fields.forEach(node => { node.value = node.id === "payment-currency" ? "USD" : ""; });
  }
  const metric = new Element(); metric.dataset = { metric: "visits", format: "count" };
  const ranges = ["today", "7d", "month", "all"].map(range => { const node = new Element(); node.dataset.range = range; return node; });
  const windowEvents = new Map();
  const calls = [];
  const window = { addEventListener: (name, fn) => windowEvents.set(name, fn) };
  const context = {
    document: {
      body: { dataset: { partner: "t2" } },
      getElementById: id => nodes.get(id) || null,
      querySelectorAll: selector => selector === "[data-metric]" ? [metric] : selector === "[data-range]" ? ranges : [],
      createElement: tag => new Element("", tag)
    }, window, URLSearchParams, AbortController, Intl, Date, console, crypto: webcrypto,
    setTimeout: () => 1, clearTimeout() {}, navigator: {},
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.includes("partner-stats")) return { ok: statsStatus === 200, status: statsStatus, json: async () => ({ ok: true, partner: { code: "t2" }, metrics: { visits: 2 }, range: { key: "month" } }) };
      const value = options.method ? await mutate(options) : await ledger();
      if (value instanceof Error) throw value;
      return { ok: !value.status || value.status < 400, status: value.status || 200, json: async () => value };
    }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../assets/partner-dashboard.js"), "utf8"), context);
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
  await settle();
  return { nodes, calls, windowEvents, settle, metric };
}

function fill(nodes) {
  nodes.get("payment-month").value = "2026-09";
  nodes.get("payment-amount").value = "125.50";
  nodes.get("payment-currency").value = "USD";
  nodes.get("payment-date").value = "2026-10-01";
  nodes.get("payment-reference").value = "transfer-123";
}

test("payment editing and partner navigation are absent from non-admin HTML", () => {
  const html = renderDashboard(partner);
  assert.match(html, /id="payment-list"/);
  assert.doesNotMatch(html, /id="payment-form"|id="new-payment"|aria-label="Partner dashboards"/);
  const admin = renderDashboard(partner, { isAdmin: true, partners: Object.values(partners) });
  assert.match(admin, /id="payment-form"/);
  assert.match(admin, /href="\/t1-dashboard"/);
  assert.match(admin, /href="\/t2-dashboard" aria-current="page"/);
  assert.doesNotMatch(renderDashboard(partner, { isAdmin: "true" }), /id="payment-form"/);
});

test("ledger failure never appears as an empty history and disables payment writes", async () => {
  const app = await start({ ledger: () => ({ status: 503 }) });
  assert.equal(app.nodes.get("payment-empty").hidden, true);
  assert.equal(app.nodes.get("payments-error").hidden, false);
  assert.equal(app.nodes.get("new-payment").disabled, true);
  assert.equal(app.metric.textContent, "2");
});

test("Rainbet reporting failure does not block independently loaded payment history", async () => {
  const app = await start({ statsStatus: 503, ledger: () => ({ ok: true, partner: { code: "t2" }, canManage: true, payments: [fixture] }) });
  assert.equal(app.nodes.get("new-payment").disabled, false);
  assert.match(app.nodes.get("payment-list").textContent, /125.50 USD/);
  assert.match(app.nodes.get("payment-list").textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(app.nodes.get("payment-list").querySelectorAll("*").some(node => node.tagName === "img"), false);
});

test("ambiguous save freezes values and retries the identical request without a duplicate", async () => {
  let attempt = 0;
  const app = await start({ mutate: async () => ++attempt === 1 ? new Error("Connection lost") : ({ ok: true, duplicate: true, payment: fixture }) });
  await app.nodes.get("new-payment").fire("click");
  fill(app.nodes);
  await app.nodes.get("payment-form").fire("submit");
  assert.equal(app.nodes.get("payment-amount").disabled, true);
  assert.equal(app.nodes.get("cancel-payment").disabled, true);
  assert.equal(app.nodes.get("save-payment").disabled, false);
  assert.match(app.nodes.get("payment-form-message").textContent, /wasn’t confirmed/);
  let prevented = false;
  app.windowEvents.get("beforeunload")({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  await app.nodes.get("payment-form").fire("submit");
  const mutations = app.calls.filter(call => call.options.method);
  assert.equal(mutations.length, 2);
  assert.equal(mutations[0].options.body, mutations[1].options.body);
  assert.match(JSON.parse(mutations[0].options.body).requestId, /^[0-9a-f-]{36}$/);
  assert.equal(app.nodes.get("payment-editor").hidden, true);
  prevented = false;
  app.windowEvents.get("beforeunload")({ preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
});

test("correction uses revision and reason; conflict reloads instead of overwriting", async () => {
  let reads = 0;
  const app = await start({ ledger: () => { reads++; return { ok: true, partner: { code: "t2" }, canManage: true, payments: [fixture] }; }, mutate: async () => ({ status: 409 }) });
  const button = app.nodes.get("payment-list").querySelectorAll("[data-correct-payment]")[0];
  await button.fire("click");
  app.nodes.get("payment-amount").value = "126.50";
  app.nodes.get("payment-correction-reason").value = "Corrected transfer amount";
  await app.nodes.get("payment-form").fire("submit");
  const request = app.calls.find(call => call.options.method);
  assert.equal(request.options.method, "PATCH");
  const body = JSON.parse(request.options.body);
  assert.equal(body.id, fixture.id);
  assert.equal(body.expectedRevision, 1);
  assert.equal(body.correctionReason, "Corrected transfer amount");
  assert.equal(reads, 2);
  assert.equal(app.nodes.get("payment-editor").hidden, true);
  assert.match(app.nodes.get("payments-status").textContent, /changed elsewhere/);
});

test("expired session clears existing private entries and prevents further edits", async () => {
  let expired = false;
  const app = await start({ ledger: () => expired ? { status: 401 } : { ok: true, partner: { code: "t2" }, canManage: true, payments: [fixture] } });
  await app.nodes.get("new-payment").fire("click");
  fill(app.nodes);
  expired = true;
  await app.nodes.get("refresh-payments").fire("click");
  assert.equal(app.nodes.get("payment-list").children.length, 0);
  assert.equal(app.nodes.get("payment-amount").value, "");
  assert.equal(app.nodes.get("payment-editor").hidden, true);
  assert.equal(app.nodes.get("save-payment").disabled, true);
  assert.equal(app.nodes.get("payments-login").hidden, false);
});

test("pagehide clears private history and unsaved fields before bfcache restore", async () => {
  const app = await start({ ledger: () => ({ ok: true, partner: { code: "t2" }, canManage: true, payments: [fixture] }) });
  await app.nodes.get("new-payment").fire("click");
  fill(app.nodes);
  app.windowEvents.get("pagehide")();
  assert.equal(app.nodes.get("payment-list").children.length, 0);
  assert.equal(app.nodes.get("payment-amount").value, "");
  assert.equal(app.nodes.get("new-payment").disabled, true);
  app.windowEvents.get("pageshow")({ persisted: true });
  await app.settle();
  assert.match(app.nodes.get("payment-list").textContent, /125.50 USD/);
});
