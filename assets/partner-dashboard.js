"use strict";

(() => {
  const partner = document.body.dataset.partner;
  const metrics = document.querySelectorAll("[data-metric]");
  const rangeButtons = document.querySelectorAll("[data-range]");
  const grid = document.getElementById("metrics");
  const status = document.getElementById("stats-status");
  const statusText = document.getElementById("status-text");
  const refresh = document.getElementById("refresh");
  const errorPanel = document.getElementById("error-panel");
  const retry = document.getElementById("retry");
  const loginAgain = document.getElementById("login-again");
  const labels = { today: "Today", "7d": "Last 7 days", month: "This month", all: "All time" };
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const count = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const timestamp = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });
  let activeRange = "month";
  let requestNumber = 0;
  let controller;
  const paymentList = document.getElementById("payment-list");
  const paymentStatus = document.getElementById("payments-status");
  const paymentError = document.getElementById("payments-error");
  const paymentRefresh = document.getElementById("refresh-payments");
  const paymentRetry = document.getElementById("retry-payments");
  const paymentLogin = document.getElementById("payments-login");
  const paymentEmpty = document.getElementById("payment-empty");
  const paymentForm = document.getElementById("payment-form");
  const paymentEditor = document.getElementById("payment-editor");
  const newPayment = document.getElementById("new-payment");
  const savePayment = document.getElementById("save-payment");
  const cancelPayment = document.getElementById("cancel-payment");
  const paymentFields = paymentForm ? Array.from(paymentForm.querySelectorAll("input, select")) : [];
  const paymentEndpoint = `/.netlify/functions/partner-payments?${new URLSearchParams({ partner })}`;
  const currencyPlaces = { USD: 2, EUR: 2, GBP: 2, ISK: 0, USDT: 6, USDC: 6 };
  let paymentsRequest = 0;
  let paymentsController;
  let saveController;
  let canManagePayments = false;
  let savingPayment = false;
  let editingPayment = null;
  let pendingMutation = null;
  let uncertainSave = false;
  let pageLeaving = false;

  function setStatus(message, state) {
    statusText.textContent = message;
    status.dataset.state = state;
  }

  function clearMetrics() {
    metrics.forEach(element => {
      element.textContent = "—";
      element.classList.add("is-unavailable");
      element.setAttribute("aria-label", "Not available");
    });
    document.getElementById("updated-at").textContent = "Last updated: —";
  }

  function dateOrNull(value) {
    if (!value || (typeof value !== "string" && typeof value !== "number")) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function usableNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  async function loadStats(range = activeRange) {
    if (!Object.prototype.hasOwnProperty.call(labels, range)) return;
    activeRange = range;
    const sequence = ++requestNumber;
    if (controller) controller.abort();
    controller = new AbortController();
    const activeController = controller;
    const timeout = setTimeout(() => activeController.abort(), 25000);
    rangeButtons.forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.range === range));
      button.disabled = true;
    });
    document.getElementById("range-caption").textContent = `${labels[range]} · UTC`;
    errorPanel.hidden = true;
    grid.setAttribute("aria-busy", "true");
    refresh.disabled = true;
    clearMetrics();
    setStatus("Loading campaign results…", "loading");
    try {
      const query = new URLSearchParams({ partner, range });
      const response = await fetch(`/.netlify/functions/partner-stats?${query}`, {
        credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" }, signal: activeController.signal
      });
      if (sequence !== requestNumber) return;
      if (!response.ok) {
        const error = new Error("Request failed");
        error.status = response.status;
        throw error;
      }
      const data = await response.json();
      if (sequence !== requestNumber) return;
      if (!data || data.ok !== true || !data.metrics || !data.range || data.range.key !== range) throw new Error("Invalid report");
      const returnedCode = typeof data.partner === "string" ? data.partner : data.partner && data.partner.code;
      if (!returnedCode || returnedCode.toLowerCase() !== partner) throw new Error("Campaign mismatch");
      metrics.forEach(element => {
        const value = data.metrics[element.dataset.metric];
        if (!usableNumber(value)) return;
        element.textContent = element.dataset.format === "money" ? money.format(value) : count.format(value);
        element.classList.remove("is-unavailable");
        element.removeAttribute("aria-label");
      });
      const from = dateOrNull(data.range.from);
      const to = dateOrNull(data.range.to);
      if (from && to) document.getElementById("range-caption").textContent = `${labels[range]} · ${day.format(from)} – ${day.format(to)} · UTC`;
      const updated = dateOrNull(data.updated);
      document.getElementById("updated-at").textContent = updated ? `Last updated: ${timestamp.format(updated)}` : "Last updated: not supplied";
      const hasMetrics = Array.from(metrics).some(element => usableNumber(data.metrics[element.dataset.metric]));
      setStatus(hasMetrics ? (data.cached ? "Showing the latest cached campaign report" : "Campaign report loaded") : "Report loaded; figures are not available yet", hasMetrics ? "ready" : "loading");
    } catch (error) {
      if (sequence !== requestNumber) return;
      clearMetrics();
      const expired = error.status === 401;
      const denied = error.status === 403;
      if (expired || denied) lockPayments(expired);
      const unavailable = error.status === 503;
      document.getElementById("error-title").textContent = expired ? "Please sign in again" : denied ? "Campaign access unavailable" : "Results unavailable";
      document.getElementById("error-message").textContent = expired
        ? "Your session has ended. Sign in to load your private campaign results."
        : denied ? "This session cannot access this campaign. Contact Thor’s Hall if you need help."
          : unavailable ? "Campaign reporting is not available right now. Please try again later."
            : error.name === "AbortError" ? "The report took too long to respond. Please try again."
              : "We couldn’t load this report. Please try again. Unavailable figures are not shown as zero.";
      retry.hidden = expired || denied;
      loginAgain.hidden = !expired;
      errorPanel.hidden = false;
      setStatus(expired ? "Session expired" : "Campaign results could not be loaded", "error");
    } finally {
      clearTimeout(timeout);
      if (sequence === requestNumber) {
        grid.setAttribute("aria-busy", "false");
        refresh.disabled = false;
        rangeButtons.forEach(button => { button.disabled = false; });
      }
    }
  }

  function paymentMessage(message, isError = false) {
    const element = document.getElementById("payment-form-message");
    if (!element) return;
    element.textContent = message;
    element.dataset.state = isError ? "error" : "ready";
  }

  function setPaymentControls() {
    if (!paymentForm) return;
    const locked = !canManagePayments || savingPayment || uncertainSave;
    paymentFields.forEach(field => { field.disabled = locked; });
    newPayment.disabled = locked;
    savePayment.disabled = !canManagePayments || savingPayment;
    cancelPayment.disabled = savingPayment || uncertainSave;
    paymentList.querySelectorAll("[data-correct-payment]").forEach(button => { button.disabled = locked; });
    paymentRefresh.disabled = savingPayment || uncertainSave;
  }

  function clearPaymentHistory() {
    paymentList.replaceChildren();
    paymentEmpty.hidden = true;
  }

  function resetPaymentEditor() {
    if (!paymentForm) return;
    paymentForm.reset();
    paymentEditor.hidden = true;
    editingPayment = null;
    pendingMutation = null;
    uncertainSave = false;
    paymentMessage("");
  }

  function lockPayments(expired) {
    const hadPendingPayment = savingPayment || uncertainSave;
    paymentsRequest += 1;
    if (paymentsController) paymentsController.abort();
    requestNumber += 1;
    if (controller) controller.abort();
    clearMetrics();
    grid.setAttribute("aria-busy", "false");
    setStatus(expired ? "Session expired" : "Campaign access unavailable", "error");
    canManagePayments = false;
    clearPaymentHistory();
    resetPaymentEditor();
    setPaymentControls();
    paymentStatus.textContent = expired ? "Session expired" : "Payment history access unavailable";
    paymentList.setAttribute("aria-busy", "false");
    paymentError.hidden = false;
    document.getElementById("payments-error-message").textContent = expired
      ? hadPendingPayment ? "Your session ended during a save. Sign in again and review payment history before recording this payment again." : "Sign in again to view your private payment history."
      : "This session cannot access this campaign’s payment history.";
    paymentRetry.hidden = true;
    paymentLogin.hidden = !expired;
  }

  function textElement(tag, text, className) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function paymentAmount(record) {
    const places = currencyPlaces[record.currency];
    const value = Number(record.amountPaid);
    if (places == null || !Number.isFinite(value)) return "Amount unavailable";
    const amount = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: places === 0 ? 0 : 2,
      maximumFractionDigits: places
    }).format(value);
    return `${amount} ${record.currency}`;
  }

  function reportingMonth(value) {
    const date = /^\d{4}-\d{2}$/.test(value || "") ? dateOrNull(`${value}-01T00:00:00Z`) : null;
    return date ? new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(date) : "Month unavailable";
  }

  function paymentDate(value) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? dateOrNull(`${value}T00:00:00Z`) : null;
    return date ? day.format(date) : "Date unavailable";
  }

  function renderPayments(records) {
    clearPaymentHistory();
    records.forEach(record => {
      const article = document.createElement("article");
      article.className = "payment-record";
      const heading = document.createElement("div");
      heading.className = "payment-record-heading";
      const title = document.createElement("div");
      title.append(textElement("h3", reportingMonth(record.reportingMonth)), textElement("p", `Paid ${paymentDate(record.paidAt)}`));
      const value = document.createElement("div");
      value.className = "payment-record-value";
      value.append(textElement("strong", paymentAmount(record)), textElement("span", "Recorded as paid", "payment-paid"));
      heading.append(title, value);
      article.append(heading);
      if (record.reference) article.append(textElement("p", `Reference: ${record.reference}`, "payment-record-reference"));
      const updated = dateOrNull(record.updatedAt);
      if (updated) article.append(textElement("p", `${record.revision > 1 ? "Corrected" : "Recorded"} ${timestamp.format(updated)}`, "payment-record-meta"));
      if (canManagePayments) {
        const actions = document.createElement("div");
        actions.className = "payment-record-actions";
        const edit = textElement("button", "Correct entry", "button button-secondary button-small");
        edit.type = "button";
        edit.dataset.correctPayment = record.id;
        edit.addEventListener("click", () => openPaymentEditor(record));
        actions.append(edit);
        article.append(actions);
        if (Array.isArray(record.history) && record.history.length) {
          const history = document.createElement("details");
          history.className = "payment-history";
          history.append(textElement("summary", `Change history · ${record.history.length} ${record.history.length === 1 ? "version" : "versions"}`));
          const versions = document.createElement("ol");
          [...record.history].reverse().forEach(version => {
            const item = document.createElement("li");
            const recorded = dateOrNull(version.recordedAt);
            item.append(textElement("strong", `Version ${version.revision} · ${version.action === "corrected" ? "Corrected" : "Recorded"}`));
            item.append(textElement("p", `${reportingMonth(version.reportingMonth)} · ${paymentAmount(version)} · paid ${paymentDate(version.paidAt)}`));
            if (version.reference) item.append(textElement("p", `Reference: ${version.reference}`));
            if (version.correctionReason) item.append(textElement("p", `Reason: ${version.correctionReason}`));
            if (recorded) item.append(textElement("p", timestamp.format(recorded), "payment-record-meta"));
            versions.append(item);
          });
          history.append(versions);
          article.append(history);
        }
      }
      paymentList.append(article);
    });
    paymentEmpty.hidden = records.length !== 0;
  }

  async function loadPayments() {
    if (savingPayment || uncertainSave) return;
    const sequence = ++paymentsRequest;
    if (paymentsController) paymentsController.abort();
    paymentsController = new AbortController();
    const activeController = paymentsController;
    const timeout = setTimeout(() => activeController.abort(), 20000);
    canManagePayments = false;
    clearPaymentHistory();
    setPaymentControls();
    paymentRefresh.disabled = true;
    paymentList.setAttribute("aria-busy", "true");
    paymentError.hidden = true;
    paymentStatus.textContent = "Loading payment history…";
    try {
      const response = await fetch(paymentEndpoint, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" }, signal: activeController.signal });
      if (sequence !== paymentsRequest) return;
      if (!response.ok) { const error = new Error("Payment history unavailable"); error.status = response.status; throw error; }
      const data = await response.json();
      if (sequence !== paymentsRequest) return;
      if (!data || data.ok !== true || data.partner?.code !== partner || !Array.isArray(data.payments) || typeof data.canManage !== "boolean" || !data.payments.every(record => (
        record && typeof record.id === "string" && record.id && Number.isInteger(record.revision) && record.revision >= 1 &&
        /^\d{4}-\d{2}$/.test(record.reportingMonth) && /^\d{4}-\d{2}-\d{2}$/.test(record.paidAt) &&
        Object.prototype.hasOwnProperty.call(currencyPlaces, record.currency) && typeof record.amountPaid === "string" &&
        /^\d+(?:\.\d+)?$/.test(record.amountPaid) && Number.isFinite(Number(record.amountPaid)) && Number(record.amountPaid) > 0 &&
        typeof record.reference === "string"
      ))) throw new Error("Invalid payment history");
      canManagePayments = data.canManage === true && Boolean(paymentForm);
      if (!canManagePayments) resetPaymentEditor();
      renderPayments(data.payments);
      paymentStatus.textContent = data.payments.length ? `${data.payments.length} ${data.payments.length === 1 ? "payment" : "payments"} recorded` : "Payment history loaded";
    } catch (error) {
      if (sequence !== paymentsRequest) return;
      if (error.status === 401 || error.status === 403) { lockPayments(error.status === 401); return; }
      clearPaymentHistory();
      paymentStatus.textContent = "Payment history unavailable";
      document.getElementById("payments-error-message").textContent = "We couldn’t load payment history. Please try again. An unavailable history does not mean no payments were made.";
      paymentError.hidden = false;
      paymentRetry.hidden = false;
      paymentLogin.hidden = true;
    } finally {
      clearTimeout(timeout);
      if (sequence === paymentsRequest) {
        paymentList.setAttribute("aria-busy", "false");
        paymentRefresh.disabled = false;
        setPaymentControls();
      }
    }
  }

  function updateCurrencyInput() {
    if (!paymentForm) return;
    const places = currencyPlaces[document.getElementById("payment-currency").value];
    const amount = document.getElementById("payment-amount");
    const increment = places === 0 ? "1" : places === 6 ? "0.000001" : "0.01";
    amount.step = increment;
    amount.min = increment;
    amount.placeholder = places === 0 ? "0" : places === 6 ? "0.000000" : "0.00";
  }

  function openPaymentEditor(record = null) {
    if (!canManagePayments || savingPayment || uncertainSave) return;
    resetPaymentEditor();
    editingPayment = record;
    const today = new Date().toISOString().slice(0, 10);
    const month = document.getElementById("payment-month");
    const paidAt = document.getElementById("payment-date");
    month.max = today.slice(0, 7);
    paidAt.max = today;
    month.value = record ? record.reportingMonth : "";
    paidAt.value = record ? record.paidAt : today;
    document.getElementById("payment-amount").value = record ? record.amountPaid : "";
    document.getElementById("payment-currency").value = record ? record.currency : "USD";
    document.getElementById("payment-reference").value = record ? record.reference : "";
    document.getElementById("correction-reason-label").hidden = !record;
    document.getElementById("payment-correction-reason").required = Boolean(record);
    document.getElementById("payment-editor-title").textContent = record ? "Correct payment entry" : "Record payment";
    document.getElementById("payment-editor-note").textContent = record ? "This updates the recorded details, not the payment itself. Previous versions are retained in the change history." : "Record a payment you have already sent. This does not transfer money.";
    savePayment.textContent = record ? "Save correction" : "Save payment";
    paymentEditor.hidden = false;
    updateCurrencyInput();
    setPaymentControls();
    month.focus();
  }

  async function submitPayment(event) {
    event.preventDefault();
    if (!canManagePayments || savingPayment || !paymentForm) return;
    if (!uncertainSave && !paymentForm.reportValidity()) return;
    let payload;
    let method;
    if (uncertainSave && pendingMutation) {
      ({ payload, method } = pendingMutation);
    } else {
      payload = {
        reportingMonth: document.getElementById("payment-month").value,
        amountPaid: document.getElementById("payment-amount").value,
        currency: document.getElementById("payment-currency").value,
        paidAt: document.getElementById("payment-date").value,
        reference: document.getElementById("payment-reference").value.trim()
      };
      method = editingPayment ? "PATCH" : "POST";
      if (editingPayment) Object.assign(payload, { id: editingPayment.id, expectedRevision: editingPayment.revision, correctionReason: document.getElementById("payment-correction-reason").value.trim() });
      const signature = JSON.stringify({ method, payload });
      if (pendingMutation?.signature === signature) payload = pendingMutation.payload;
      else {
        if (!globalThis.crypto?.randomUUID) { paymentMessage("This browser cannot safely save payments. Use a current browser over HTTPS.", true); return; }
        payload.requestId = globalThis.crypto.randomUUID();
        pendingMutation = { signature, payload, method };
      }
    }
    savingPayment = true;
    setPaymentControls();
    paymentMessage("Saving payment entry…");
    saveController = new AbortController();
    const activeController = saveController;
    const timeout = setTimeout(() => activeController.abort(), 20000);
    let definitiveFailure = false;
    try {
      const response = await fetch(paymentEndpoint, {
        method, credentials: "same-origin", cache: "no-store", signal: activeController.signal,
        headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(payload)
      });
      if (pageLeaving) return;
      if (!response.ok) {
        definitiveFailure = response.status >= 400 && response.status < 500;
        const error = new Error("Payment save failed");
        error.status = response.status;
        throw error;
      }
      const data = await response.json();
      if (pageLeaving) return;
      if (!data || data.ok !== true || !data.payment?.id) throw new Error("Save not confirmed");
      resetPaymentEditor();
      paymentStatus.textContent = data.duplicate ? "Payment entry confirmed. Refreshing history…" : "Payment entry saved. Refreshing history…";
      savingPayment = false;
      await loadPayments();
    } catch (error) {
      if (pageLeaving) return;
      if (error.status === 401 || error.status === 403) { lockPayments(error.status === 401); return; }
      if (definitiveFailure) {
        uncertainSave = false;
        pendingMutation = null;
        if (error.status === 409) {
          resetPaymentEditor();
          savingPayment = false;
          await loadPayments();
          paymentStatus.textContent = "This entry changed elsewhere. Review its latest details before making another correction.";
        } else paymentMessage(error.status === 400 ? "Check the amount, currency, dates and correction reason. Dates cannot be in the future." : "The entry wasn’t saved. Please try again shortly.", true);
      } else {
        uncertainSave = true;
        savePayment.textContent = "Retry to confirm";
        paymentMessage("The save response wasn’t confirmed. Retry to confirm this same entry without creating a duplicate. If you leave or reload, review payment history before recording it again.", true);
      }
    } finally {
      clearTimeout(timeout);
      savingPayment = false;
      if (!pageLeaving) setPaymentControls();
    }
  }

  rangeButtons.forEach(button => button.addEventListener("click", () => loadStats(button.dataset.range)));
  refresh.addEventListener("click", () => loadStats());
  retry.addEventListener("click", () => loadStats());
  paymentRefresh.addEventListener("click", () => loadPayments());
  paymentRetry.addEventListener("click", () => loadPayments());
  if (paymentForm) {
    newPayment.addEventListener("click", () => openPaymentEditor());
    cancelPayment.addEventListener("click", () => { if (!savingPayment && !uncertainSave) { resetPaymentEditor(); setPaymentControls(); newPayment.focus(); } });
    document.getElementById("payment-currency").addEventListener("change", updateCurrencyInput);
    paymentForm.addEventListener("submit", submitPayment);
  }

  document.querySelectorAll("[data-copy]").forEach(button => {
    button.addEventListener("click", async () => {
      const input = document.getElementById(button.dataset.copy);
      const copyStatus = document.getElementById("copy-status");
      try {
        if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(input.value);
        copyStatus.textContent = button.dataset.copy === "landing-url" ? "Landing page link copied." : "Campaign link copied.";
      } catch (_) {
        input.focus();
        input.select();
        copyStatus.textContent = "Link selected. Copy it using your keyboard or device menu.";
      }
    });
  });

  // Reload if a browser restores this sensitive page from its back/forward cache.
  window.addEventListener("beforeunload", event => {
    if (!savingPayment && !uncertainSave) return;
    event.preventDefault();
    event.returnValue = "";
  });
  window.addEventListener("pageshow", event => { if (event.persisted) { pageLeaving = false; loadStats(); loadPayments(); } });
  window.addEventListener("pagehide", () => {
    pageLeaving = true;
    requestNumber += 1;
    paymentsRequest += 1;
    if (controller) controller.abort();
    if (paymentsController) paymentsController.abort();
    if (saveController) saveController.abort();
    clearMetrics();
    clearPaymentHistory();
    resetPaymentEditor();
    canManagePayments = false;
    savingPayment = false;
    setPaymentControls();
  });
  loadStats();
  loadPayments();
})();
