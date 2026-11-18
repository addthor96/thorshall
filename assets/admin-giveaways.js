"use strict";

(() => {
  const $ = id => document.getElementById(id);
  const panel = $("giveaways-panel");
  if (!panel) return;
  const API = "/.netlify/functions/giveaways";
  const EXPIRED = "thorshall:admin-session-expired";
  const amount = $("giveaway-amount"), submit = $("giveaway-submit"), retry = $("giveaway-retry");
  const total = $("giveaway-total"), count = $("giveaway-count"), history = $("giveaway-history");
  const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const money = minor => "$" + whole.format(BigInt(minor) / 100n) + "." + (BigInt(minor) % 100n).toString().padStart(2, "0");
  let saved = null, pending = null, busy = false, locked = false, leaving = false, loadFailed = false, generation = 0;
  const controllers = new Set();
  const undoButtons = [];

  function message(text, error = false) {
    $("giveaway-status").textContent = text;
    $("giveaway-status").dataset.state = error ? "error" : "ready";
    $("giveaway-error").textContent = error ? text : "";
    $("giveaway-error").hidden = !error;
  }

  function controls() {
    const unavailable = !saved || busy || locked || leaving || Boolean(pending);
    amount.disabled = unavailable;
    submit.disabled = unavailable;
    submit.textContent = busy && pending?.method === "POST" ? "Recording…" : "Record giveaway";
    retry.hidden = locked || leaving || (!pending && !loadFailed);
    retry.disabled = busy || locked || leaving;
    retry.textContent = pending ? "Retry same save" : "Try again";
    for (const button of undoButtons) button.disabled = unavailable;
    history.setAttribute("aria-busy", String(busy));
  }

  function clearPrivate() {
    generation += 1;
    controllers.forEach(controller => controller.abort());
    controllers.clear();
    saved = null; pending = null; busy = false; loadFailed = false;
    amount.value = "";
    total.textContent = "—"; count.textContent = "—";
    history.replaceChildren(); undoButtons.length = 0;
    $("giveaway-empty").hidden = true;
    $("giveaway-error").hidden = true;
    $("giveaway-error").textContent = "";
    controls();
  }

  function lock() {
    if (locked) return;
    locked = true;
    clearPrivate();
    message("Sign in again to manage giveaways.", true);
    window.__thorshallAdminExpired = true;
    if (typeof window.dispatchEvent === "function") window.dispatchEvent(new Event(EXPIRED));
  }

  async function request(method, body) {
    const sequence = generation, controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(API, { method, credentials: "same-origin", cache: "no-store", signal: controller.signal,
        headers: method === "GET" ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json", "X-Thorshall-Request": "giveaways" },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      if ((response.status === 401 || response.status === 403) && sequence === generation && !leaving) lock();
      let data;
      try { data = await response.json(); } catch { data = null; }
      if (!response.ok || !data || data.ok !== true) {
        const error = new Error(data?.error || "Giveaway data is unavailable."); error.status = response.status; throw error;
      }
      return data;
    } finally { clearTimeout(timeout); controllers.delete(controller); }
  }

  function validate(data) {
    if (data.currency !== "USD" || !Number.isSafeInteger(data.totalMinor) || data.totalMinor < 0 ||
      !Number.isSafeInteger(data.count) || data.count < 0 || !Number.isSafeInteger(data.revision) || data.revision < 0 ||
      !Array.isArray(data.entries) || data.entries.length > 20 || new Set(data.entries.map(row => row?.id)).size !== data.entries.length) throw new Error("Invalid giveaway data.");
    for (const row of data.entries) {
      if (!row || typeof row.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(row.id) || !Number.isSafeInteger(row.amountMinor) || row.amountMinor <= 0 ||
        !["recorded", "void"].includes(row.status) || typeof row.createdAt !== "string" || !Number.isFinite(Date.parse(row.createdAt))) throw new Error("Invalid giveaway record.");
    }
    return data;
  }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function render(data) {
    saved = validate(data);
    loadFailed = false;
    total.textContent = money(data.totalMinor);
    count.textContent = data.count + " recorded " + (data.count === 1 ? "giveaway" : "giveaways");
    history.replaceChildren(); undoButtons.length = 0;
    $("giveaway-empty").hidden = data.entries.length !== 0;
    for (const entry of data.entries) {
      const row = element("article", null, "giveaway-record" + (entry.status === "void" ? " is-void" : ""));
      const detail = element("div");
      const time = new Date(entry.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
      detail.append(element("strong", money(entry.amountMinor)), element("span", time));
      row.append(detail);
      if (entry.status === "void") row.append(element("span", "Undone", "giveaway-record-state"));
      else {
        const button = element("button", "Undo", "quiet-button"); button.type = "button";
        button.setAttribute("aria-label", "Undo giveaway of " + money(entry.amountMinor) + " recorded " + time);
        button.addEventListener("click", () => undo(entry.id));
        undoButtons.push(button); row.append(button);
      }
      history.append(row);
    }
    controls();
  }

  async function load() {
    if (locked || leaving || busy || pending) return;
    const sequence = ++generation;
    busy = true; loadFailed = false; controls(); message("Loading giveaway total…");
    try {
      const data = validate(await request("GET"));
      if (sequence !== generation || locked || leaving) return;
      render(data); message("All giveaway records saved.");
    } catch {
      if (sequence !== generation || locked || leaving) return;
      saved = null; loadFailed = true; total.textContent = "—"; count.textContent = "—"; history.replaceChildren(); undoButtons.length = 0; $("giveaway-empty").hidden = true;
      message("Giveaway total unavailable. Try again before recording an amount.", true);
    } finally { if (sequence === generation && !locked && !leaving) { busy = false; controls(); } }
  }

  async function savePending() {
    if (!pending || busy || locked || leaving || !saved) return;
    const operation = pending, sequence = generation;
    busy = true; controls(); message(operation.method === "POST" ? "Recording giveaway…" : "Undoing giveaway…");
    try {
      const data = validate(await request(operation.method, operation.body));
      if (sequence !== generation || locked || leaving) return;
      pending = null; busy = false;
      if (operation.method === "POST") amount.value = "";
      render(data); message(operation.method === "POST" ? "Giveaway recorded. Total updated." : "Giveaway undone. Total updated.");
      if (operation.method === "POST") amount.focus();
    } catch (error) {
      if (sequence !== generation || locked || leaving) return;
      busy = false;
      if (error.status && error.status >= 400 && error.status < 500) {
        pending = null;
        if (error.status === 409) { saved = null; loadFailed = true; total.textContent = "—"; count.textContent = "—"; history.replaceChildren(); undoButtons.length = 0; $("giveaway-empty").hidden = true; message("The giveaway history changed. Reload it before trying again.", true); }
        else message(error.message || "Check the amount and try again.", true);
      } else message("The save was not confirmed. Retry the same save to check it safely.", true);
      controls();
    }
  }

  function undo(entryId) {
    if (!saved || pending || busy || locked || leaving) return;
    pending = { method: "PATCH", body: { requestId: crypto.randomUUID(), entryId, expectedRevision: saved.revision } };
    savePending();
  }

  $("giveaway-form").addEventListener("submit", event => {
    event.preventDefault();
    if (!saved || pending || busy || locked || leaving) return;
    const raw = amount.value.trim();
    if (!/^(0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(raw) || Number(raw) <= 0 || Number(raw) > 100000000) { message("Enter a USD amount such as 100 or 100.50.", true); amount.focus(); return; }
    pending = { method: "POST", body: { requestId: crypto.randomUUID(), amount: raw } };
    savePending();
  });
  retry.addEventListener("click", () => pending ? savePending() : load());
  $("refresh-all").addEventListener("click", () => { if (!pending && !busy && !locked && !leaving) load(); });
  window.addEventListener(EXPIRED, lock);
  window.addEventListener("beforeunload", event => { if (pending) { event.preventDefault(); event.returnValue = ""; } });
  window.addEventListener("pagehide", () => { leaving = true; clearPrivate(); message("Giveaway data cleared."); });
  window.addEventListener("pageshow", event => { if (event.persisted) { leaving = false; locked = false; window.__thorshallAdminExpired = false; load(); } });
  if (window.__thorshallAdminExpired) lock(); else load();
})();
