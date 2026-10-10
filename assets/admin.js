"use strict";

(() => {
  const byId = id => document.getElementById(id);
  const directory = byId("partner-list");
  const recentPayments = byId("recent-payments");
  const search = byId("partner-search");
  const filter = byId("workflow-filter");
  const refresh = byId("refresh-all");
  const workflows = { active: "Active", review: "Needs review", paused: "On hold" };
  const countFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const usdFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  const controllers = new Set();
  let entries = [];
  let cards = new Map();
  let paymentResults = new Map();
  let generation = 0;
  let locked = false;
  let leaving = false;
  let editor = null;
  let saving = false;
  let pendingSave = null;

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function link(text, href, className) {
    const node = element("a", text, className);
    node.href = href;
    return node;
  }

  function button(text, className, action) {
    const node = element("button", text, className);
    node.type = "button";
    node.addEventListener("click", action);
    return node;
  }

  function message(node, text, error = false) {
    node.textContent = text;
    node.dataset.state = error ? "error" : "ready";
  }

  function validEntry(entry) {
    return entry && /^t[1-9]\d*$/.test(entry.code) && typeof entry.name === "string" && /^\d+$/.test(entry.campaignId) &&
      entry.landingPath === `/${entry.code}` && entry.dashboardPath === `/${entry.code}-dashboard` &&
      typeof entry.campaignUrl === "string" && /^https:\/\/playrainbet\.com\/[a-z0-9]+$/i.test(entry.campaignUrl) &&
      typeof entry.passwordConfigured === "boolean" && entry.management && Object.hasOwn(workflows, entry.management.workflow) &&
      typeof entry.management.notes === "string" && entry.management.notes.length <= 2000 && Number.isInteger(entry.management.revision) && entry.management.revision >= 0;
  }

  function hasUnsavedChanges() {
    if (saving || pendingSave) return true;
    return Boolean(editor && (editor.notes.value !== editor.entry.management.notes || editor.workflow.value !== editor.entry.management.workflow));
  }

  function controls() {
    const busy = locked || saving || Boolean(pendingSave);
    refresh.disabled = busy || hasUnsavedChanges();
    if (editor) {
      editor.notes.disabled = busy;
      editor.workflow.disabled = busy;
      editor.cancel.disabled = busy;
      editor.submit.disabled = locked || saving;
      editor.submit.textContent = pendingSave ? "Retry save" : "Save changes";
    }
    for (const card of cards.values()) card.edit.disabled = busy || card.blocked === true;
  }

  function clearPrivate() {
    controllers.forEach(controller => controller.abort());
    controllers.clear();
    generation += 1;
    if (editor) { editor.notes.value = ""; editor.workflow.value = ""; }
    entries = [];
    cards.clear();
    paymentResults.clear();
    editor = null;
    pendingSave = null;
    saving = false;
    directory.replaceChildren();
    recentPayments.replaceChildren();
    search.value = "";
    filter.value = "all";
    search.disabled = true;
    filter.disabled = true;
    ["summary-total", "summary-ready", "summary-review"].forEach(id => { byId(id).textContent = "—"; });
    byId("no-matches").hidden = true;
    directory.setAttribute("aria-busy", "false");
    recentPayments.setAttribute("aria-busy", "false");
  }

  function lock() {
    locked = true;
    clearPrivate();
    byId("session-error").hidden = false;
    byId("directory-error").hidden = true;
    message(byId("directory-status"), "Admin session unavailable. Sign in again to continue.", true);
    message(byId("payments-status"), "Payment history cleared.");
    controls();
  }

  async function request(url, options = {}) {
    const requestGeneration = generation;
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...options, headers: { Accept: "application/json", ...options.headers }, signal: controller.signal });
      if (response.status === 401 || response.status === 403) {
        if (requestGeneration === generation && !leaving) lock();
        const error = new Error("Admin access required"); error.status = response.status; throw error;
      }
      if (!response.ok) { const error = new Error("Request failed"); error.status = response.status; throw error; }
      const data = await response.json();
      if (!data || data.ok !== true) throw new Error("Invalid response");
      return data;
    } finally { clearTimeout(timeout); controllers.delete(controller); }
  }

  function totals() {
    byId("summary-total").textContent = countFormat.format(entries.length);
    byId("summary-ready").textContent = countFormat.format(entries.filter(entry => entry.passwordConfigured).length);
    byId("summary-review").textContent = countFormat.format(entries.filter(entry => entry.management.workflow === "review").length);
  }

  function applyFilter() {
    const query = search.value.trim().toLowerCase();
    let visible = 0;
    for (const entry of entries) {
      const matches = (!query || `${entry.code} ${entry.name} ${entry.campaignId}`.toLowerCase().includes(query)) && (filter.value === "all" || entry.management.workflow === filter.value);
      cards.get(entry.code).root.hidden = !matches;
      if (matches) visible += 1;
    }
    byId("no-matches").hidden = visible !== 0 || entries.length === 0;
    message(byId("directory-status"), `${visible} of ${entries.length} partner campaigns · Activity below covers this month, UTC.`);
  }

  async function copyUrl(entry, campaign = false) {
    const card = cards.get(entry.code);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(campaign ? entry.campaignUrl : `https://thorshall.gg${entry.landingPath}`);
      if (!locked && cards.get(entry.code) === card) message(card.message, campaign ? "Campaign link copied." : "Landing page link copied.");
    } catch {
      if (!locked && cards.get(entry.code) === card) message(card.message, `Copy this link: ${campaign ? entry.campaignUrl : `https://thorshall.gg${entry.landingPath}`}`);
    }
  }

  function makeCard(entry) {
    const root = element("article", null, "partner-card");
    root.dataset.partner = entry.code;
    const header = element("div", null, "partner-card-header");
    const identity = element("div");
    identity.append(element("h3", entry.name, "partner-name"), element("p", `Rainbet campaign #${entry.campaignId}`, "partner-id"));
    const workflow = element("span", workflows[entry.management.workflow], "partner-workflow");
    workflow.dataset.workflow = entry.management.workflow;
    header.append(element("span", entry.code.toUpperCase(), "partner-code"), identity, workflow);
    const setup = element("p", entry.passwordConfigured ? "Partner login ready" : "Partner password needs setup in Netlify", "partner-setup");
    setup.dataset.ready = String(entry.passwordConfigured);
    const metrics = element("div", null, "partner-metrics");
    const metricNodes = {};
    for (const [key, label] of [["visits", "Visits"], ["registrations", "Registrations"], ["ftd", "First depositors"]]) {
      const cell = element("div", null, "partner-metric");
      metricNodes[key] = element("strong", "—");
      cell.append(element("span", label), metricNodes[key]); metrics.append(cell);
    }
    const revenue = element("div", null, "partner-revenue");
    metricNodes.ngr = element("strong", "—");
    revenue.append(element("span", "Casino NGR · USD"), metricNodes.ngr);
    const source = element("p", "Loading Rainbet report…", "partner-source");
    const actions = element("div", null, "partner-actions");
    const landing = link("View page ↗", entry.landingPath, "quiet-button");
    landing.target = "_blank"; landing.rel = "noopener noreferrer";
    actions.append(link("Open dashboard", entry.dashboardPath, "button"), landing,
      button("Copy page link", "quiet-button", () => copyUrl(entry)), button("Copy campaign link", "quiet-button", () => copyUrl(entry, true)));
    const edit = button("Private workflow & notes", "partner-edit-toggle", () => openEditor(entry.code));
    edit.setAttribute("aria-expanded", "false");
    const form = element("form", null, "notes-form");
    form.id = `notes-${entry.code}`;
    edit.setAttribute("aria-controls", form.id);
    form.hidden = true;
    const workflowLabel = element("label");
    const workflowInput = element("select"); workflowInput.name = "workflow";
    for (const [value, text] of Object.entries(workflows)) { const option = element("option", text); option.value = value; workflowInput.append(option); }
    workflowLabel.append(element("span", "Private workflow"), workflowInput);
    const notesLabel = element("label");
    const notes = element("textarea"); notes.name = "notes"; notes.maxLength = 2000; notes.rows = 4; notes.placeholder = "Next steps, contact updates or partner notes…";
    notesLabel.append(element("span", "Owner notes"), notes);
    const formActions = element("div", null, "notes-actions");
    const submit = element("button", "Save changes", "button"); submit.type = "submit";
    const cancel = button("Cancel", "quiet-button", closeEditor);
    const formMessage = element("p", "", "notes-message"); formMessage.setAttribute("role", "status"); formMessage.setAttribute("aria-live", "polite");
    formActions.append(submit, cancel);
    form.append(workflowLabel, notesLabel, element("p", "Only you can see these notes. Workflow labels do not change the live page.", "editor-help"), formActions, formMessage);
    notes.addEventListener("input", controls); workflowInput.addEventListener("change", controls);
    form.addEventListener("submit", saveNotes);
    const cardMessage = element("p", "", "card-message"); cardMessage.setAttribute("role", "status"); cardMessage.setAttribute("aria-live", "polite");
    root.append(header, setup, metrics, revenue, source, actions, edit, form, cardMessage);
    return { root, entry, workflowBadge: workflow, metrics: metricNodes, source, edit, form, workflow: workflowInput, notes, submit, cancel, formMessage, message: cardMessage };
  }

  function openEditor(code) {
    if (locked || saving || pendingSave) return;
    if (cards.get(code)?.blocked) return;
    if (editor?.entry.code === code) { editor.notes.focus(); return; }
    if (editor && editor.entry.code !== code && hasUnsavedChanges()) { message(editor.formMessage, "Save or cancel your changes before editing another partner.", true); editor.notes.focus(); return; }
    closeEditor();
    const card = cards.get(code);
    editor = card;
    card.notes.value = card.entry.management.notes;
    card.workflow.value = card.entry.management.workflow;
    card.form.hidden = false;
    card.edit.setAttribute("aria-expanded", "true");
    message(card.formMessage, "");
    controls();
    card.notes.focus();
  }

  function closeEditor() {
    if (saving || pendingSave || !editor) return;
    editor.form.hidden = true;
    editor.edit.setAttribute("aria-expanded", "false");
    editor.notes.value = "";
    editor = null;
    controls();
  }

  async function saveNotes(event) {
    event.preventDefault();
    if (!editor || locked || saving) return;
    const card = editor;
    const sequence = generation;
    const payload = pendingSave || { expectedRevision: card.entry.management.revision, workflow: card.workflow.value, notes: card.notes.value };
    if (payload.notes.length > 2000 || !Object.hasOwn(workflows, payload.workflow)) { message(card.formMessage, "Use a listed workflow and no more than 2,000 characters.", true); return; }
    saving = true;
    message(card.formMessage, "Saving private notes…");
    controls();
    try {
      const data = await request(`/.netlify/functions/admin-data?partner=${encodeURIComponent(card.entry.code)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (sequence !== generation || locked) return;
      if (!validEntry(data.partner) || data.partner.code !== card.entry.code) throw new Error("Invalid saved partner");
      const index = entries.findIndex(entry => entry.code === card.entry.code);
      entries[index] = data.partner;
      card.entry = data.partner;
      card.workflowBadge.textContent = workflows[data.partner.management.workflow];
      card.workflowBadge.dataset.workflow = data.partner.management.workflow;
      pendingSave = null;
      saving = false;
      closeEditor();
      totals(); applyFilter();
      message(card.message, "Private workflow and notes saved.");
    } catch (error) {
      if (sequence !== generation || locked || leaving) return;
      saving = false;
      if (error.status === 409) {
        pendingSave = null;
        message(card.formMessage, "This partner changed in another session. Reloading the current record…", true);
        await refreshConflictedPartner(card);
      } else if (error.status && error.status >= 400 && error.status < 500) {
        pendingSave = null;
        message(card.formMessage, "These changes could not be saved. Check the fields and try again.", true);
      } else {
        pendingSave = payload;
        message(card.formMessage, "The save wasn’t confirmed. Retry the same save to check it safely; your fields are locked until it is resolved.", true);
      }
    } finally { if (sequence === generation && !locked) { saving = false; controls(); } }
  }

  async function refreshConflictedPartner(card) {
    const sequence = generation;
    try {
      const data = await request("/.netlify/functions/admin-data");
      if (sequence !== generation || locked) return;
      const current = data.partners?.find(entry => entry.code === card.entry.code);
      if (!validEntry(current)) throw new Error("Invalid partner");
      entries[entries.findIndex(entry => entry.code === current.code)] = current;
      card.entry = current;
      card.workflowBadge.textContent = workflows[current.management.workflow];
      card.workflowBadge.dataset.workflow = current.management.workflow;
      card.notes.value = current.management.notes;
      card.workflow.value = current.management.workflow;
      totals();
      message(card.formMessage, "Loaded the newer saved record. Review it before making further changes.", true);
    } catch {
      if (sequence !== generation || locked) return;
      closeEditor();
      card.edit.disabled = true;
      message(card.message, "Current notes could not be loaded. Refresh the workspace before editing this partner.", true);
      card.blocked = true;
    }
  }

  async function loadStats(entry, sequence) {
    const card = cards.get(entry.code);
    try {
      const data = await request(`/.netlify/functions/partner-stats?${new URLSearchParams({ partner: entry.code, range: "month" })}`);
      if (sequence !== generation || locked) return;
      const code = typeof data.partner === "string" ? data.partner : data.partner?.code;
      if (code !== entry.code || data.range?.key !== "month" || !data.metrics) throw new Error("Invalid campaign report");
      for (const [key, node] of Object.entries(card.metrics)) {
        const value = data.metrics[key];
        if (typeof value === "number" && Number.isFinite(value)) node.textContent = key === "ngr" ? usdFormat.format(value) : countFormat.format(value);
      }
      const updated = typeof data.updated === "string" ? new Date(data.updated) : null;
      const time = updated && Number.isFinite(updated.getTime()) ? ` · Updated ${updated.toISOString().slice(11, 16)} UTC` : "";
      message(card.source, `This month${time} · NGR is not partner earnings.`);
    } catch {
      if (sequence !== generation || locked || leaving) return;
      message(card.source, "Rainbet report unavailable. Missing figures are not zero. Open the dashboard to retry.", true);
    }
  }

  function amount(record) {
    const places = { USD: 2, EUR: 2, GBP: 2, ISK: 0, USDT: 6, USDC: 6 };
    if (!Object.hasOwn(places, record.currency) || !Number.isFinite(Number(record.amountPaid))) return "Amount unavailable";
    return `${new Intl.NumberFormat("en-US", { minimumFractionDigits: places[record.currency] === 0 ? 0 : 2, maximumFractionDigits: places[record.currency] }).format(Number(record.amountPaid))} ${record.currency}`;
  }

  function renderPayments() {
    recentPayments.replaceChildren();
    const pending = entries.filter(entry => !paymentResults.has(entry.code));
    const failed = entries.filter(entry => paymentResults.get(entry.code)?.error);
    const rows = entries.flatMap(entry => (paymentResults.get(entry.code)?.payments || []).map(payment => ({ entry, payment })));
    rows.sort((a, b) => String(b.payment.paidAt).localeCompare(String(a.payment.paidAt)) || String(b.payment.createdAt).localeCompare(String(a.payment.createdAt)));
    for (const { entry, payment } of rows.slice(0, 12)) {
      const row = element("article", null, "recent-payment");
      const detail = element("div");
      detail.append(element("h3", `${entry.code.toUpperCase()} · ${entry.name}`), element("p", `Paid ${payment.paidAt} · Reporting month ${payment.reportingMonth}`));
      if (payment.reference) detail.append(element("p", payment.reference));
      row.append(detail, element("strong", amount(payment), "recent-payment-amount"), link("View / manage →", `${entry.dashboardPath}#payments-title`));
      recentPayments.append(row);
    }
    const parts = [];
    if (rows.length) parts.push(`Showing ${Math.min(12, rows.length)} of ${rows.length} recorded payments.`);
    else if (!pending.length && !failed.length) parts.push("No payments have been recorded yet.");
    else parts.push("No payment entries available from the histories loaded so far.");
    if (pending.length) parts.push(`Loading ${pending.length} partner ${pending.length === 1 ? "history" : "histories"}…`);
    if (failed.length) parts.push(`History unavailable for ${failed.map(entry => entry.code.toUpperCase()).join(", ")}. Refresh to retry; this is not confirmation of an empty history.`);
    message(byId("payments-status"), parts.join(" "), failed.length > 0);
    recentPayments.setAttribute("aria-busy", String(pending.length > 0));
  }

  async function loadPayments(entry, sequence) {
    try {
      const data = await request(`/.netlify/functions/partner-payments?partner=${encodeURIComponent(entry.code)}`);
      if (sequence !== generation || locked) return;
      if (data.partner?.code !== entry.code || data.canManage !== true || !Array.isArray(data.payments)) throw new Error("Invalid history");
      paymentResults.set(entry.code, { payments: data.payments });
    } catch {
      if (sequence !== generation || locked || leaving) return;
      paymentResults.set(entry.code, { error: true });
    }
    renderPayments();
  }

  async function runJobs(jobs, sequence) {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => {
      while (next < jobs.length && sequence === generation && !locked && !leaving) { const job = jobs[next++]; await job(); }
    }));
  }

  async function loadAll() {
    if (locked || saving || pendingSave || hasUnsavedChanges()) return;
    clearPrivate();
    const sequence = generation;
    refresh.disabled = true;
    leaving = false;
    byId("directory-error").hidden = true;
    message(byId("directory-status"), "Loading your partner directory…");
    message(byId("payments-status"), "Loading payment history…");
    directory.setAttribute("aria-busy", "true");
    recentPayments.setAttribute("aria-busy", "true");
    try {
      const data = await request("/.netlify/functions/admin-data");
      if (sequence !== generation || locked) return;
      if (!Array.isArray(data.partners) || !data.partners.every(validEntry) || new Set(data.partners.map(entry => entry.code)).size !== data.partners.length) throw new Error("Invalid partner directory");
      entries = data.partners;
      for (const entry of entries) { const card = makeCard(entry); cards.set(entry.code, card); directory.append(card.root); }
      search.disabled = false; filter.disabled = false;
      totals(); applyFilter();
      directory.setAttribute("aria-busy", "false");
      controls();
      renderPayments();
      await runJobs(entries.flatMap(entry => [() => loadStats(entry, sequence), () => loadPayments(entry, sequence)]), sequence);
    } catch {
      if (sequence !== generation || locked || leaving) return;
      message(byId("directory-status"), "Partner directory unavailable. Editing is disabled.", true);
      byId("directory-error").hidden = false;
      message(byId("payments-status"), "Payment history could not be loaded without the partner directory.", true);
    } finally {
      if (sequence === generation && !locked) { directory.setAttribute("aria-busy", "false"); recentPayments.setAttribute("aria-busy", "false"); controls(); }
    }
  }

  search.addEventListener("input", applyFilter);
  filter.addEventListener("change", applyFilter);
  refresh.addEventListener("click", loadAll);
  byId("retry-directory").addEventListener("click", loadAll);
  window.addEventListener("beforeunload", event => { if (hasUnsavedChanges()) { event.preventDefault(); event.returnValue = ""; } });
  window.addEventListener("pagehide", () => { leaving = true; clearPrivate(); refresh.disabled = true; });
  window.addEventListener("pageshow", event => { if (event.persisted) { leaving = false; locked = false; byId("session-error").hidden = true; loadAll(); } });
  loadAll();
})();
