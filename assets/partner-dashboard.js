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

  rangeButtons.forEach(button => button.addEventListener("click", () => loadStats(button.dataset.range)));
  refresh.addEventListener("click", () => loadStats());
  retry.addEventListener("click", () => loadStats());

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
  window.addEventListener("pageshow", event => { if (event.persisted) loadStats(); });
  window.addEventListener("pagehide", () => { requestNumber += 1; if (controller) controller.abort(); clearMetrics(); });
  loadStats();
})();
