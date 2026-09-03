"use strict";

const {
  COOKIE_NAME,
  SESSION_SECONDS,
  authenticate,
  createSession,
  isAuthorized,
  isConfigured
} = require("../lib/stats-auth");

const RETURN_ACCESS = new Map([
  ["/manuel-stats1", "manuel"],
  ["/piyush-stats1", "piyush"],
  ["/radhika-stats1", "radhika"],
  ["/aditya-stats1", "aditya"],
  ["/arshan-stats1", "arshan"]
]);

function safeReturn(value) {
  const path = String(value || "").trim();
  return RETURN_ACCESS.has(path) ? path : "/";
}

function requestedAccess(returnTo) {
  return RETURN_ACCESS.get(returnTo) || "admin";
}

function displayName(access) {
  return access === "admin" ? "Partner" : `${access.charAt(0).toUpperCase()}${access.slice(1)}`;
}

function parseForm(body) {
  return new URLSearchParams(String(body || ""));
}

function headers(extra = {}) {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self'; script-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    ...extra
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function loginPage(returnTo, access, message = "") {
  const notice = message ? `<p class="notice">${escapeHtml(message)}</p>` : "";
  const label = displayName(access);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Private ${escapeHtml(label)} Statistics | Thor's Hall</title><style>:root{color-scheme:dark;--gold:#efc865;--line:#624923;--muted:#b8aa94}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:22px;background:radial-gradient(circle at 50% 0,#2d1d0d,#070504 52%);font-family:Inter,Arial,sans-serif;color:#f7f0e5}.card{width:min(450px,100%);padding:34px;border:1px solid var(--line);border-radius:22px;background:linear-gradient(180deg,#1d160e,#100d09);box-shadow:0 30px 90px #000}.brand{color:var(--gold);font:900 13px Georgia,serif;letter-spacing:.18em;text-transform:uppercase}h1{margin:11px 0 9px;font:900 34px/1.05 Georgia,serif;color:#ffe5a0}.sub{color:var(--muted);line-height:1.55}label{display:block;margin:22px 0 7px;color:#e0cc9d;font-weight:800}input{width:100%;padding:14px;border:1px solid #725628;border-radius:11px;background:#090806;color:#fff;font-size:16px}button{width:100%;margin-top:13px;padding:14px;border:0;border-radius:11px;background:linear-gradient(180deg,#f5d77d,#c99837);color:#211504;font-weight:900;cursor:pointer}.notice{padding:11px;border:1px solid #8d3f35;border-radius:10px;background:#2b1310;color:#ffd5cf}.small{margin-top:17px;color:#8f826f;font-size:12px;text-align:center}</style></head><body><main class="card"><div class="brand">Thor's Hall</div><h1>Private ${escapeHtml(label)} statistics</h1><p class="sub">Enter the password assigned to this statistics page.</p>${notice}<form method="post" action="/.netlify/functions/stats-session"><input type="hidden" name="return" value="${escapeHtml(returnTo)}"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus><button type="submit">Open statistics</button></form><div class="small">Access is limited to this creator · expires after 8 hours</div></main></body></html>`;
}

exports.handler = async function (event) {
  const query = event.queryStringParameters || {};
  const method = String(event.httpMethod || "GET").toUpperCase();

  if (query.logout === "1") {
    return {
      statusCode: 303,
      headers: headers({
        Location: "/",
        "Set-Cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
      }),
      body: ""
    };
  }

  const form = method === "POST" ? parseForm(event.body) : null;
  const returnTo = safeReturn(form?.get("return") || query.return);
  const access = requestedAccess(returnTo);

  if (!isConfigured(access)) {
    return {
      statusCode: 503,
      headers: headers(),
      body: loginPage(returnTo, access, "This statistics login is not configured in Netlify.")
    };
  }

  if (isAuthorized(event, access)) {
    return { statusCode: 303, headers: headers({ Location: returnTo }), body: "" };
  }

  if (method === "POST") {
    const grantedAccess = authenticate(form.get("password") || "", access);
    if (grantedAccess) {
      return {
        statusCode: 303,
        headers: headers({
          Location: returnTo,
          "Set-Cookie": `${COOKIE_NAME}=${encodeURIComponent(createSession(grantedAccess))}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`
        }),
        body: ""
      };
    }
    return { statusCode: 401, headers: headers(), body: loginPage(returnTo, access, "Incorrect password for this statistics page.") };
  }

  return { statusCode: 200, headers: headers(), body: loginPage(returnTo, access) };
};
