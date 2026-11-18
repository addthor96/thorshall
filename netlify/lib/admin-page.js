"use strict";

function renderAdminPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <meta name="theme-color" content="#0e1219">
  <title>Admin | Thor's Hall</title>
  <link rel="icon" href="/favicon.ico">
  <link rel="stylesheet" href="/assets/partner-dashboard.css">
  <link rel="stylesheet" href="/assets/admin.css?v=20261118-compact">
  <script src="/assets/admin.js?v=20261118-compact" defer></script>
  <script src="/assets/admin-giveaways.js?v=20261118-giveaways" defer></script>
</head>
<body class="admin-workspace">
  <a class="skip-link" href="#main">Skip to admin</a>
  <header class="site-header"><div class="shell header-inner">
    <a class="brand" href="/admin" aria-label="Thor's Hall admin home">
      <svg class="brand-mark" viewBox="0 0 64 64" fill="none" aria-hidden="true"><circle cx="32" cy="32" r="30" stroke="currentColor" stroke-width="1.5"/><path d="M18 18l10 7 4-13 4 13 10-7-5 14v18l-9 6-9-6V32l-5-14Z" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><path d="M23 32h18M27 37l5 6 5-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
      <span>THOR'S HALL<small>OWNER WORKSPACE</small></span>
    </a>
    <nav class="header-nav" aria-label="Admin navigation"><a href="/">View website <span aria-hidden="true">↗</span></a><a class="logout" href="/.netlify/functions/stats-session?logout=1">Sign out</a></nav>
  </div></header>
  <main class="shell admin-shell" id="main">
    <section class="admin-intro" aria-labelledby="page-title">
      <div><p class="eyebrow">WORKSPACE</p><h1 id="page-title">Admin</h1></div>
      <div class="admin-access"><span class="access-dot" aria-hidden="true"></span>Private workspace</div>
    </section>
    <div class="error-panel" id="session-error" hidden><div><strong>Admin access required</strong><p>Your private workspace has been cleared. Sign in with your master password to continue.</p></div><a class="button button-small" href="/.netlify/functions/stats-session?return=%2Fadmin">Sign in</a></div>
    <noscript><div class="error-panel"><p>Enable JavaScript to load and manage your partner workspace.</p></div></noscript>
    <div class="workspace-top">
      <aside class="panel giveaways-panel" id="giveaways-panel" aria-labelledby="giveaways-title">
        <div class="section-toolbar"><div><h2 id="giveaways-title">Giveaway tracker</h2></div><span class="section-meta">USD</span></div>
        <div class="giveaway-workspace">
          <div class="giveaway-counter" aria-label="Recorded giveaway totals"><span class="giveaway-counter-label">Total given away</span><strong id="giveaway-total">—</strong><p><span id="giveaway-count">—</span></p></div>
          <div class="giveaway-entry-panel">
            <form id="giveaway-form" class="giveaway-form"><label for="giveaway-amount">Amount (USD)</label><div class="giveaway-amount-row"><div class="giveaway-input-wrap"><span aria-hidden="true">$</span><input id="giveaway-amount" name="amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" required disabled></div><button type="submit" class="button" id="giveaway-submit" disabled>Record giveaway</button></div></form>
            <p id="giveaway-status" class="giveaway-status" role="status">Loading giveaway records…</p>
            <div id="giveaway-error" class="error-panel giveaway-error" role="alert" hidden></div><button id="giveaway-retry" type="button" class="quiet-button" hidden disabled>Try again</button>
          </div>
        </div>
        <details class="giveaway-history-details"><summary>Recent giveaways</summary><div id="giveaway-history" class="giveaway-history" aria-busy="true"></div><p id="giveaway-empty" class="giveaway-empty" hidden>No giveaways recorded yet.</p></details>
      </aside>
      <section class="tools-section" aria-labelledby="tools-title">
        <div class="section-toolbar"><div><h2 id="tools-title">Tools</h2></div></div>
        <div class="tools-grid">
          <a class="tool-card" href="/admin?view=hunts"><span class="tool-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M7 15l3-4 3 2 4-6M7 7h2"/></svg></span><div><strong>Bonus hunts</strong><p>Hunts &amp; stream overlay</p></div><span class="tool-arrow" aria-hidden="true">↗</span></a>
          <a class="tool-card" href="#campaigns-title"><span class="tool-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M17 13a5 5 0 0 1 4 5v3"/></svg></span><div><strong>Partners</strong><p>Campaigns &amp; payments</p></div><span class="tool-arrow" aria-hidden="true">↓</span></a>
          <a class="tool-card" href="https://app.netlify.com/projects/gentle-mandazi-f0e944/forms" target="_blank" rel="noopener noreferrer"><span class="tool-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/></svg></span><div><strong>Forms</strong><p>Applications &amp; clicks</p></div><span class="tool-arrow" aria-hidden="true">↗</span></a>
          <a class="tool-card" href="https://app.netlify.com/projects/gentle-mandazi-f0e944/configuration/env" target="_blank" rel="noopener noreferrer"><span class="tool-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/></svg></span><div><strong>Access &amp; settings</strong><p>Passwords &amp; configuration</p></div><span class="tool-arrow" aria-hidden="true">↗</span></a>
          <a class="tool-card" href="/gsc-dashboard"><span class="tool-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M7 11l2-3 3 2"/></svg></span><div><strong>Search performance</strong><p>Google Search Console</p></div><span class="tool-arrow" aria-hidden="true">↗</span></a>
        </div>
      </section>
    </div>
    <section class="admin-summary" aria-label="Partner overview">
      <article class="summary-card"><span>Partner campaigns</span><strong id="summary-total">—</strong><p>Your numbered partner pages</p></article>
      <article class="summary-card"><span>Partner login ready</span><strong id="summary-ready">—</strong><p>Password configured for their dashboard</p></article>
      <article class="summary-card summary-card-gold"><span>Marked for review</span><strong id="summary-review">—</strong><p>Your private follow-up list</p></article>
    </section>
    <section class="campaigns-section" aria-labelledby="campaigns-title">
      <div class="section-toolbar"><div><p class="panel-kicker">PARTNER DIRECTORY</p><h2 id="campaigns-title">Manage your campaigns</h2><p>Open a dashboard to review activity or record a payment.</p></div><button type="button" class="refresh-button" id="refresh-all">Refresh workspace</button></div>
      <div class="directory-controls"><label class="search-label" for="partner-search"><span>Search partners</span><input type="search" id="partner-search" placeholder="Name, T number or campaign ID" autocomplete="off" disabled></label><label for="workflow-filter"><span>Private workflow</span><select id="workflow-filter" disabled><option value="all">All partners</option><option value="active">Active</option><option value="review">Needs review</option><option value="paused">On hold</option></select></label></div>
      <p class="directory-status" id="directory-status" role="status" aria-live="polite">Loading your partner directory…</p>
      <div class="error-panel" id="directory-error" hidden><p id="directory-error-message">The partner directory could not be loaded. No changes can be saved until it is available.</p><button type="button" class="button button-small" id="retry-directory">Try again</button></div>
      <div class="partner-grid" id="partner-list" aria-busy="true"></div>
      <p id="no-matches" class="empty-panel" hidden>No partners match your search.</p>
      <p class="admin-footnote">Workflow labels and notes are private; they do not change live campaign pages. “On hold” does not disable a partner’s links or dashboard.</p>
    </section>
    <footer class="dashboard-footer"><span>THOR'S HALL <span class="footer-separator">/</span> ADMIN</span><p>Campaign activity is not affiliate commission or partner earnings. Reporting periods use UTC.</p></footer>
  </main>
</body>
</html>`;
}

module.exports = { renderAdminPage };
