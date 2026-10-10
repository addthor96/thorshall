"use strict";

function renderAdminPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <meta name="theme-color" content="#0a0908">
  <title>Admin | Thor's Hall</title>
  <link rel="icon" href="/favicon.ico">
  <link rel="stylesheet" href="/assets/partner-dashboard.css">
  <link rel="stylesheet" href="/assets/admin.css">
  <script src="/assets/admin.js" defer></script>
</head>
<body>
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
      <div><p class="eyebrow">THOR'S HALL / PRIVATE ADMIN</p><h1 id="page-title">Everything in one place<span class="title-dot">.</span></h1><p class="intro-description">Your partners, campaign results and recorded payments.</p></div>
      <div class="admin-access"><span class="access-dot" aria-hidden="true"></span>Owner access<span>Visible only with your master login</span></div>
    </section>
    <nav class="workspace-nav" aria-label="Workspace sections"><a href="#campaigns-title">Campaigns</a><a href="#payments-title">Payments</a><a href="#tools-title">Site tools</a></nav>
    <div class="error-panel" id="session-error" hidden><div><strong>Admin access required</strong><p>Your private workspace has been cleared. Sign in with your master password to continue.</p></div><a class="button button-small" href="/.netlify/functions/stats-session?return=%2Fadmin">Sign in</a></div>
    <noscript><div class="error-panel"><p>Enable JavaScript to load and manage your partner workspace.</p></div></noscript>
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
    <section class="panel admin-payments" aria-labelledby="payments-title">
      <div class="section-toolbar"><div><p class="panel-kicker">ACROSS YOUR PARTNERS</p><h2 id="payments-title">Recent recorded payments</h2><p>The latest 12 entries, with each payment shown in its own currency.</p></div></div>
      <p id="payments-status" class="directory-status" role="status" aria-live="polite">Loading payment history…</p><div id="recent-payments" class="recent-payments" aria-busy="true"></div>
      <p class="admin-footnote">Record or correct a payment from the partner’s dashboard. Entries document payments you have already sent; they do not transfer funds.</p>
    </section>
    <section class="tools-section" aria-labelledby="tools-title">
      <div class="section-toolbar"><div><p class="panel-kicker">QUICK ACCESS</p><h2 id="tools-title">Site tools</h2><p>Your existing tools, a click away.</p></div></div>
      <div class="tools-grid">
        <a class="tool-card" href="https://app.netlify.com/projects/gentle-mandazi-f0e944/forms" target="_blank" rel="noopener noreferrer"><span class="tool-icon" aria-hidden="true">01</span><div><strong>Forms &amp; applications</strong><p>Review submissions and tracked clicks in Netlify.</p></div><span aria-hidden="true">↗</span></a>
        <a class="tool-card" href="https://app.netlify.com/projects/gentle-mandazi-f0e944/configuration/env" target="_blank" rel="noopener noreferrer"><span class="tool-icon" aria-hidden="true">02</span><div><strong>Access &amp; configuration</strong><p>Manage partner passwords and deployment settings.</p></div><span aria-hidden="true">↗</span></a>
        <a class="tool-card" href="https://github.com/addthor96/thorshall" target="_blank" rel="noopener noreferrer"><span class="tool-icon" aria-hidden="true">03</span><div><strong>Website repository</strong><p>Open the source and campaign registry on GitHub.</p></div><span aria-hidden="true">↗</span></a>
        <a class="tool-card" href="/gsc-dashboard"><span class="tool-icon" aria-hidden="true">04</span><div><strong>Search performance</strong><p>Open the Google Search Console dashboard. Separate sign-in.</p></div><span aria-hidden="true">↗</span></a>
        <a class="tool-card" href="/signup-admin"><span class="tool-icon" aria-hidden="true">05</span><div><strong>Signup management</strong><p>Open the existing signup admin. Separate sign-in.</p></div><span aria-hidden="true">↗</span></a>
      </div>
    </section>
    <footer class="dashboard-footer"><span>THOR'S HALL <span class="footer-separator">/</span> ADMIN</span><p>Campaign activity is not affiliate commission or partner earnings. Reporting periods use UTC.</p></footer>
  </main>
</body>
</html>`;
}

module.exports = { renderAdminPage };
