"use strict";

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function renderDashboard(partner, options = {}) {
  const code = String(partner.code || "").toLowerCase();
  if (!/^t[1-9][0-9]*$/.test(code)) throw new Error("Invalid partner code");
  const campaignUrl = new URL(partner.campaignUrl);
  if (campaignUrl.protocol !== "https:") throw new Error("Invalid campaign URL");
  const landingPath = String(partner.landingPath || "");
  if (landingPath !== `/${code}`) throw new Error("Invalid landing page");
  const name = escapeHtml(partner.name);
  const label = escapeHtml(code.toUpperCase());
  const campaignId = escapeHtml(partner.campaignId);
  const landingUrl = escapeHtml(`https://thorshall.gg${landingPath}`);
  const link = escapeHtml(campaignUrl.href);
  const loginUrl = `/.netlify/functions/stats-session?return=${encodeURIComponent(`/${code}-dashboard`)}`;
  const isAdmin = options.isAdmin === true;
  const adminPartners = Array.isArray(options.partners) ? options.partners : [];
  const adminNavigation = isAdmin ? `<nav class="admin-navigation" aria-label="Partner dashboards"><span>Admin access</span><a href="/admin">Admin home</a>${adminPartners.map(item => {
    const itemCode = String(item.code || "");
    if (!/^t[1-9][0-9]*$/.test(itemCode) || item.dashboardPath !== `/${itemCode}-dashboard`) return "";
    return `<a href="${escapeHtml(item.dashboardPath)}"${itemCode === code ? ' aria-current="page"' : ""}>${escapeHtml(itemCode.toUpperCase())}<span>${escapeHtml(item.name)}</span></a>`;
  }).join("")}</nav>` : "";
  const paymentEditor = isAdmin ? `
      <button type="button" class="button" id="new-payment" disabled>Record payment</button>
      <section class="payment-editor" id="payment-editor" aria-labelledby="payment-editor-title" hidden>
        <h3 id="payment-editor-title">Record payment</h3>
        <p id="payment-editor-note">Record a payment you have already sent. This does not transfer money.</p>
        <form id="payment-form" method="post" action="/.netlify/functions/partner-payments">
          <div class="payment-fields">
            <label>Reporting month<input type="month" id="payment-month" name="reportingMonth" required></label>
            <label>Amount paid<input type="number" id="payment-amount" name="amountPaid" min="0.01" max="1000000000" step="0.01" inputmode="decimal" placeholder="0.00" required></label>
            <label>Currency<select id="payment-currency" name="currency"><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option><option value="ISK">ISK</option><option value="USDT">USDT</option><option value="USDC">USDC</option></select></label>
            <label>Payment date<input type="date" id="payment-date" name="paidAt" required></label>
            <label class="payment-reference-field">Transaction reference <span>(optional)</span><input type="text" id="payment-reference" name="reference" maxlength="200" autocomplete="off" placeholder="Transfer or transaction reference"></label>
            <label class="payment-reference-field" id="correction-reason-label" hidden>Reason for correction<input type="text" id="payment-correction-reason" name="correctionReason" maxlength="200" autocomplete="off" placeholder="Briefly explain the correction"></label>
          </div>
          <p class="payment-form-message" id="payment-form-message" role="status" aria-live="polite"></p>
          <div class="payment-form-actions"><button class="button" type="submit" id="save-payment" disabled>Save payment</button><button class="button button-secondary" type="button" id="cancel-payment">Cancel</button></div>
        </form>
      </section>` : "";
  const metrics = [
    ["visits", "Visits", "Rainbet-tracked campaign visits", "count"],
    ["registrations", "Registrations", "Accounts attributed to your campaign", "count"],
    ["ftd", "First-time depositors", "Tracked first depositors", "count"],
    ["deposits", "Deposits", "Reported deposit total · USD", "money"],
    ["wager", "Wagered", "Reported wagering total · USD", "money"],
    ["ngr", "Casino NGR", "Net gaming revenue · USD", "money"]
  ];
  const cards = metrics.map(([key, title, description, format], index) => `
        <article class="metric-card${key === "ngr" ? " metric-card-gold" : ""}">
          <div class="metric-heading"><h3>${title}</h3><span class="metric-number" aria-hidden="true">0${index + 1}</span></div>
          <p class="metric-value" data-metric="${key}" data-format="${format}">—</p>
          <p class="metric-description">${description}</p>
        </article>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <meta name="theme-color" content="#0a0908">
  <title>${label} Partner Dashboard | Thor's Hall</title>
  <link rel="icon" href="/favicon.ico">
  <link rel="stylesheet" href="/assets/partner-dashboard.css">
  <script src="/assets/partner-dashboard.js" defer></script>
</head>
<body data-partner="${escapeHtml(code)}" data-login-url="${escapeHtml(loginUrl)}">
  <a class="skip-link" href="#main">Skip to dashboard</a>
  <header class="site-header">
    <div class="shell header-inner">
      <a class="brand" href="/" aria-label="Thor's Hall home">
        <svg class="brand-mark" viewBox="0 0 64 64" fill="none" aria-hidden="true"><circle cx="32" cy="32" r="30" stroke="currentColor" stroke-width="1.5"/><path d="M18 18l10 7 4-13 4 13 10-7-5 14v18l-9 6-9-6V32l-5-14Z" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><path d="M23 32h18M27 37l5 6 5-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
        <span>THOR'S HALL<small>PARTNER PORTAL</small></span>
      </a>
      <nav class="header-nav" aria-label="Dashboard navigation">
        <a href="${escapeHtml(landingPath)}">View landing page <span aria-hidden="true">↗</span></a>
        <a class="logout" href="/.netlify/functions/stats-session?logout=1">Sign out</a>
      </nav>
    </div>
  </header>
  <main class="shell" id="main">
    ${adminNavigation}
    <section class="intro" aria-labelledby="page-title">
      <div>
        <p class="eyebrow">YOUR CAMPAIGN. AT A GLANCE.</p>
        <h1 id="page-title">Partner dashboard<span class="title-dot">.</span></h1>
        <p class="intro-description">Welcome, ${name}. Here’s how your campaign is performing.</p>
      </div>
      <div class="campaign-badge"><span class="campaign-code">${label}</span><div><strong>Rainbet campaign</strong><span>#${campaignId}</span></div></div>
    </section>

    <section class="performance" aria-labelledby="performance-title">
      <div class="section-toolbar">
        <div><h2 id="performance-title">Campaign overview</h2><p id="range-caption">This month · UTC</p></div>
        <div class="period-controls" role="group" aria-label="Statistics date range">
          <button type="button" data-range="today" aria-pressed="false">Today</button>
          <button type="button" data-range="7d" aria-pressed="false">7 days</button>
          <button type="button" data-range="month" aria-pressed="true">This month</button>
          <button type="button" data-range="all" aria-pressed="false">All time</button>
        </div>
      </div>
      <div class="status-row">
        <div class="status-message" id="stats-status" role="status" aria-live="polite"><span class="status-dot" aria-hidden="true"></span><span id="status-text">Loading campaign results…</span></div>
        <button type="button" class="refresh-button" id="refresh"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Refresh</span></button>
      </div>
      <div class="error-panel" id="error-panel" hidden><div><strong id="error-title">Results unavailable</strong><p id="error-message"></p></div><button type="button" class="button button-small" id="retry">Try again</button><a class="button button-small" id="login-again" href="${escapeHtml(loginUrl)}" hidden>Sign in again</a></div>
      <noscript><div class="error-panel"><p>Enable JavaScript to load your campaign results. Your landing page links below remain available.</p></div></noscript>
      <div class="metrics-grid" id="metrics" aria-busy="true">${cards}
      </div>
      <div class="overview-footer"><p id="data-note">— means a figure is not available. It does not mean zero.</p><p id="updated-at">Last updated: —</p></div>
    </section>

    <div class="lower-grid">
      <section class="panel links-panel" aria-labelledby="links-title">
        <div class="panel-header"><span class="panel-kicker">YOUR LINKS</span><h2 id="links-title">Ready to share</h2><p>Use your landing page or the direct campaign link.</p></div>
        <label class="link-label" for="landing-url">Thor’s Hall landing page</label>
        <div class="copy-field"><input id="landing-url" type="url" value="${landingUrl}" readonly spellcheck="false"><button type="button" data-copy="landing-url" aria-label="Copy your Thor's Hall landing page link">Copy</button></div>
        <label class="link-label" for="campaign-url">Direct Rainbet campaign link</label>
        <div class="copy-field"><input id="campaign-url" type="url" value="${link}" readonly spellcheck="false"><button type="button" data-copy="campaign-url" aria-label="Copy your Rainbet campaign link">Copy</button></div>
        <p class="copy-status" id="copy-status" role="status" aria-live="polite"></p>
        <p class="attribution-note"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/><path d="M12 11v6M12 7v1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg><span>Results cover campaign ${campaignId}. Personal <strong>addthor</strong> referrals are excluded.</span></p>
      </section>
      <section class="panel settlement-panel" aria-labelledby="settlement-title">
        <div class="panel-header"><span class="panel-kicker">REVENUE CONTEXT</span><h2 id="settlement-title">Understanding your figures</h2><p>Your campaign activity and your final payout are different figures.</p></div>
        <div class="settlement-status"><span class="statement-icon" aria-hidden="true">≡</span><div><strong>Campaign revenue is not your payout</strong><p>Payments are reconciled against the affiliate commission Thor’s Hall actually receives, under your agreed terms. Payments recorded by Thor’s Hall appear below.</p></div></div>
        <div class="revenue-details"><div><span>Casino gross gaming revenue</span><strong data-metric="ggr" data-format="money">—</strong></div><div><span>Sportsbook net gaming revenue</span><strong data-metric="sbNgr" data-format="money">—</strong></div></div>
        <p class="settlement-note">Revenue totals are reported in USD and are not amounts payable to you.</p>
      </section>
    </div>
    <section class="panel payments-panel" aria-labelledby="payments-title">
      <div class="payments-heading"><div class="panel-header"><span class="panel-kicker">PAYMENT HISTORY</span><h2 id="payments-title">Recorded payments</h2><p>Payments recorded for ${label}. This history is separate from the statistics date range.</p></div><button type="button" class="refresh-button" id="refresh-payments">Refresh payments</button></div>
      <p class="payments-status" id="payments-status" role="status" aria-live="polite">Loading payment history…</p>
      <div class="error-panel" id="payments-error" hidden><p id="payments-error-message"></p><button class="button button-small" id="retry-payments" type="button">Try again</button><a class="button button-small" id="payments-login" href="${escapeHtml(loginUrl)}" hidden>Sign in again</a></div>
      ${paymentEditor}
      <div class="payment-list" id="payment-list" aria-busy="true"></div>
      <p class="payment-empty" id="payment-empty" hidden>No payments have been recorded yet.</p>
      <p class="settlement-note">A recorded payment is an entry maintained by Thor’s Hall, not a payment confirmation from Rainbet or a payment provider.</p>
    </section>
    <footer class="dashboard-footer"><span>THOR'S HALL <span class="footer-separator">/</span> ${label} PARTNER DASHBOARD</span><p>Reporting periods use UTC. Rainbet reporting may take time to update.</p><a href="mailto:arnar@thorshall.gg">Need help?</a></footer>
  </main>
</body>
</html>`;
}

module.exports = { renderDashboard };
