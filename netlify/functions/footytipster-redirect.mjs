const RAINBET_DESTINATION = "https://rainbet.com?r=thorshall";
const TRACKING_SOURCE = "footytipster-sidebar";

// Rainbet-restricted countries plus the related overseas territories that
// Netlify can identify separately. Unknown locations fail closed below.
const RESTRICTED_COUNTRIES = new Set([
  "AS", "AT", "AU", "AW", "BL", "BQ", "CC", "CX", "CW", "CY", "DE",
  "ES", "FR", "GB", "GF", "GP", "GU", "HM", "MF", "MP", "MQ", "NC",
  "NF", "NL", "PF", "PM", "PR", "RE", "SE", "SX", "TF", "UM", "US",
  "VI", "WF", "YT"
]);

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
  "Netlify-CDN-Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive"
};

function unavailablePage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>Unavailable | Thor's Hall</title>
  <style>
    :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#080607;color:#f6f0e8;font-family:Inter,system-ui,sans-serif;text-align:center}.card{width:min(520px,100%);padding:36px 28px;border:1px solid #49382a;border-radius:18px;background:#100d0d}h1{margin:0 0 12px;font:800 34px Georgia,serif;color:#efb968}p{margin:0 0 24px;color:#b9afaa;line-height:1.55}a{display:inline-block;padding:12px 20px;border:1px solid #b46a25;border-radius:8px;color:#fff0dc;text-decoration:none;font-weight:800;background:#6f2d0b}
  </style>
</head>
<body><main class="card"><h1>Not available here</h1><p>This destination is unavailable in your location.</p><a href="/">Return to Thor's Hall</a></main></body>
</html>`;
}

function trackClick(request, context, country, outcome) {
  const destination = outcome === "allowed" ? RAINBET_DESTINATION : "blocked";
  let referrer = "";
  try {
    referrer = new URL(request.headers.get("referer") || "").origin;
  } catch {}
  const body = new URLSearchParams({
    "form-name": "thorshall-join-click",
    source: TRACKING_SOURCE,
    campaign: "thorshall-code",
    campaign_id: "",
    timestamp: new Date().toISOString(),
    referrer,
    destination,
    country: country || "unknown",
    outcome
  });

  const submission = fetch(new URL("/", request.url), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  }).catch(() => undefined);

  if (typeof context.waitUntil === "function") {
    context.waitUntil(submission);
  }
}

export default async (request, context) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { ...RESPONSE_HEADERS, Allow: "GET, HEAD" }
    });
  }

  const country = context.geo?.country?.code?.trim().toUpperCase() || "";
  const allowed = Boolean(country) && !RESTRICTED_COUNTRIES.has(country);

  // HEAD is intentionally not recorded so uptime checks do not inflate clicks.
  if (request.method === "GET") {
    trackClick(request, context, country, allowed ? "allowed" : "blocked");
  }

  if (allowed) {
    return new Response(null, {
      status: 302,
      headers: { ...RESPONSE_HEADERS, Location: RAINBET_DESTINATION }
    });
  }

  return new Response(request.method === "HEAD" ? null : unavailablePage(), {
    status: 451,
    headers: { ...RESPONSE_HEADERS, "Content-Type": "text/html; charset=utf-8" }
  });
};

export const config = {
  path: "/go/footytipster"
};
