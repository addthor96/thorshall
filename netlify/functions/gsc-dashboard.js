const crypto = require("crypto");

const COOKIE_NAME = "th_gsc_session";
const SESSION_SECONDS = 60 * 60 * 8;

function envSecret() {
  return process.env.DASHBOARD_SESSION_SECRET ||
    process.env.GSC_OAUTH_STATE_SECRET ||
    "";
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function sign(value) {
  return crypto.createHmac("sha256", envSecret()).update(value).digest("base64url");
}

function makeSession() {
  const payload = Buffer.from(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readCookie(header, name) {
  const cookies = String(header || "").split(";");
  for (const cookie of cookies) {
    const index = cookie.indexOf("=");
    if (index < 0) continue;
    const key = cookie.slice(0, index).trim();
    if (key === name) return decodeURIComponent(cookie.slice(index + 1).trim());
  }
  return "";
}

function validSession(event) {
  const token = readCookie(event.headers?.cookie || event.headers?.Cookie, COOKIE_NAME);
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !envSecret()) return false;
  if (!safeEqual(sign(payload), signature)) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(decoded.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function headers(extra = {}) {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, private",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    ...extra
  };
}

function loginPage(message = "") {
  const notice = message ? `<div class="notice">${escapeHtml(message)}</div>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>Thor's Hall — GSC Login</title>
<style>
:root{--bg:#090806;--panel:#15110c;--panel2:#1d160e;--gold:#efc865;--gold2:#b9872c;--text:#f6efe2;--muted:#bcae97;--line:#5b4522;--red:#ef7d70}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 50% 0,#2a1b0d 0,#0b0907 45%,#050504 100%);font-family:Inter,Arial,sans-serif;color:var(--text)}
.card{width:min(460px,100%);padding:34px;border:1px solid var(--line);border-radius:22px;background:linear-gradient(180deg,rgba(29,22,14,.98),rgba(16,13,9,.98));box-shadow:0 30px 90px #000}
.brand{font-family:Georgia,serif;color:var(--gold);font-size:14px;letter-spacing:.22em;text-transform:uppercase}
h1{font:700 34px/1.05 Georgia,serif;margin:12px 0 10px;color:#ffe5a0}.sub{color:var(--muted);line-height:1.55;margin-bottom:24px}
label{display:block;color:#dbcba9;font-weight:700;margin:0 0 8px}input{width:100%;padding:14px 15px;border-radius:12px;border:1px solid #725628;background:#090806;color:white;font-size:16px;outline:none}
input:focus{border-color:var(--gold);box-shadow:0 0 0 3px rgba(239,200,101,.12)}button{width:100%;margin-top:14px;padding:14px;border:0;border-radius:12px;background:linear-gradient(180deg,#f5d77d,#c99837);color:#211504;font-weight:900;font-size:15px;cursor:pointer}
.notice{padding:11px 12px;margin:0 0 16px;border:1px solid #8d3f35;border-radius:10px;background:#2b1310;color:#ffd5cf}.small{font-size:12px;color:#8f826f;margin-top:17px;text-align:center}
</style>
</head>
<body>
<main class="card">
<div class="brand">Thor's Hall</div>
<h1>Private GSC Dashboard</h1>
<p class="sub">Enter the dashboard password to view private Search Console performance.</p>
${notice}
<form method="post" action="/.netlify/functions/gsc-dashboard">
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
<button type="submit">Open dashboard</button>
</form>
<div class="small">Protected by a secure, HTTP-only session cookie.</div>
</main>
</body>
</html>`;
}

function dashboardPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>Thor's Hall — Search Console</title>
<style>
:root{--bg:#080705;--panel:#14110d;--panel2:#1b150e;--gold:#efc865;--gold2:#ae7f2d;--text:#f5efe5;--muted:#b9ab95;--line:#49391f;--good:#73d99a;--bad:#ff887c;--blue:#84b9ff}
*{box-sizing:border-box}html{color-scheme:dark}body{margin:0;background:radial-gradient(circle at 50% -20%,#32200f 0,#0b0907 38%,#060504 100%);font-family:Inter,Arial,sans-serif;color:var(--text);min-height:100vh}
.wrap{width:min(1400px,calc(100% - 32px));margin:0 auto;padding:28px 0 60px}
header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:22px}.brand{display:flex;align-items:center;gap:13px}.mark{width:42px;height:42px;border:1px solid #88682e;border-radius:11px;display:grid;place-items:center;background:#151009;color:var(--gold);font:700 22px Georgia,serif}.brand h1{font:700 25px Georgia,serif;margin:0;color:#ffe5a0}.brand p{margin:4px 0 0;color:var(--muted);font-size:13px}
.actions{display:flex;gap:9px}.btn{border:1px solid #72582e;background:#17120c;color:#f7e7bc;border-radius:10px;padding:10px 13px;font-weight:800;cursor:pointer;text-decoration:none}.btn:hover{border-color:var(--gold)}
.status{border:1px solid var(--line);background:rgba(20,17,13,.86);border-radius:14px;padding:12px 15px;color:var(--muted);display:flex;justify-content:space-between;gap:12px;margin-bottom:17px;font-size:13px}.status strong{color:#ead7aa}
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:13px}.card{border:1px solid var(--line);background:linear-gradient(180deg,rgba(27,21,14,.96),rgba(16,13,9,.96));border-radius:17px;padding:19px;box-shadow:0 18px 45px rgba(0,0,0,.2)}
.metric .label{color:var(--muted);font-size:12px;letter-spacing:.11em;text-transform:uppercase;font-weight:800}.metric .value{font:700 34px/1.1 Georgia,serif;color:#ffe291;margin:10px 0 7px}.delta{font-size:13px;color:var(--muted)}.delta.good{color:var(--good)}.delta.bad{color:var(--bad)}
.grid{display:grid;grid-template-columns:1.55fr .9fr;gap:13px;margin-top:13px}.section-title{display:flex;justify-content:space-between;align-items:end;gap:12px;margin-bottom:15px}.section-title h2{margin:0;font:700 20px Georgia,serif;color:#f7d983}.section-title span{font-size:12px;color:var(--muted)}
.chart-wrap{height:310px;position:relative}.chart-wrap canvas{width:100%;height:100%;display:block}
.legend{display:flex;gap:18px;flex-wrap:wrap;margin-top:10px;font-size:12px;color:var(--muted)}.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px}.legend .clicks i{background:#efc865}.legend .impressions i{background:#84b9ff}
.sitemap{display:grid;gap:11px}.sitemap-item{padding:14px;border:1px solid #3e321f;background:#100d09;border-radius:12px}.sitemap-item strong{display:block;color:#f2d48a;word-break:break-all}.sitemap-row{display:flex;justify-content:space-between;gap:10px;margin-top:10px;color:var(--muted);font-size:13px}.ok{color:var(--good)}
.tables{display:grid;grid-template-columns:1.25fr .75fr;gap:13px;margin-top:13px}table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;color:#a9987e;font-size:11px;text-transform:uppercase;letter-spacing:.08em;padding:0 10px 11px}td{padding:11px 10px;border-top:1px solid #352b1c;vertical-align:top}td.num{text-align:right;white-space:nowrap}.page{max-width:540px;word-break:break-word;color:#e8d8bc}.position{color:#f4d789}.empty{color:var(--muted);padding:24px 10px}
.error{border:1px solid #8f4038;background:#2d1512;color:#ffd3ce;padding:16px;border-radius:13px;margin-top:13px;display:none}
.loading{opacity:.55;pointer-events:none}
@media(max-width:950px){.metrics{grid-template-columns:repeat(2,1fr)}.grid,.tables{grid-template-columns:1fr}}@media(max-width:580px){.wrap{width:min(100% - 20px,1400px);padding-top:17px}header{align-items:flex-start}.brand h1{font-size:21px}.metrics{grid-template-columns:1fr 1fr}.metric .value{font-size:27px}.card{padding:15px}.status{display:block}.status span{display:block;margin-top:5px}.actions{flex-direction:column}.chart-wrap{height:250px}th:nth-child(4),td:nth-child(4){display:none}}
</style>
</head>
<body>
<div class="wrap" id="app">
<header>
<div class="brand"><div class="mark">ᚦ</div><div><h1>Search Console Dashboard</h1><p>Private Thor's Hall performance report</p></div></div>
<div class="actions"><button class="btn" id="refresh">Refresh</button><a class="btn" href="/.netlify/functions/gsc-dashboard?logout=1">Log out</a></div>
</header>
<div class="status"><strong id="property">Loading property…</strong><span id="generated">Connecting to Google Search Console…</span></div>
<section class="metrics">
<div class="card metric"><div class="label">Clicks</div><div class="value" id="clicks">—</div><div class="delta" id="clicksDelta">—</div></div>
<div class="card metric"><div class="label">Impressions</div><div class="value" id="impressions">—</div><div class="delta" id="impressionsDelta">—</div></div>
<div class="card metric"><div class="label">CTR</div><div class="value" id="ctr">—</div><div class="delta" id="ctrDelta">—</div></div>
<div class="card metric"><div class="label">Avg. position</div><div class="value" id="position">—</div><div class="delta" id="positionDelta">—</div></div>
</section>
<section class="grid">
<div class="card"><div class="section-title"><h2>28-day performance</h2><span id="period"></span></div><div class="chart-wrap"><canvas id="chart"></canvas></div><div class="legend"><span class="clicks"><i></i>Clicks</span><span class="impressions"><i></i>Impressions</span></div></div>
<div class="card"><div class="section-title"><h2>Sitemap status</h2><span id="sitemapSummary"></span></div><div class="sitemap" id="sitemaps"><div class="empty">Loading…</div></div></div>
</section>
<section class="tables">
<div class="card"><div class="section-title"><h2>Top pages</h2><span>Current period</span></div><div style="overflow:auto"><table><thead><tr><th>Page</th><th>Clicks</th><th>Impr.</th><th>CTR</th><th>Pos.</th></tr></thead><tbody id="pages"><tr><td class="empty" colspan="5">Loading…</td></tr></tbody></table></div></div>
<div class="card"><div class="section-title"><h2>Top queries</h2><span>Current period</span></div><div style="overflow:auto"><table><thead><tr><th>Query</th><th>Clicks</th><th>Impr.</th><th>Pos.</th></tr></thead><tbody id="queries"><tr><td class="empty" colspan="4">Loading…</td></tr></tbody></table></div></div>
</section>
<div class="error" id="error"></div>
</div>
<script>
const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const num = value => new Intl.NumberFormat().format(Number(value || 0));
const pct = value => (Number(value || 0) * 100).toFixed(2) + "%";
const pos = value => Number(value || 0).toFixed(2);
const dateText = value => new Date(value).toLocaleString();
function changeText(value, kind) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "No comparison";
  const n = Number(value);
  const improvement = kind === "position" ? n < 0 : n > 0;
  const cls = n === 0 ? "" : improvement ? "good" : "bad";
  const formatted = kind === "position" ? Math.abs(n).toFixed(2) : Math.abs(n * 100).toFixed(1) + "%";
  return { text: (n > 0 ? "▲ " : n < 0 ? "▼ " : "• ") + formatted + " vs previous 28 days", cls };
}
function applyDelta(id, value, kind) {
  const result = changeText(value, kind);
  const el = $(id);
  if (typeof result === "string") { el.textContent = result; return; }
  el.textContent = result.text;
  el.className = "delta " + result.cls;
}
function drawChart(rows) {
  const canvas = $("chart");
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.floor(rect.width * ratio);
  canvas.height = Math.floor(rect.height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  const w = rect.width, h = rect.height, pad = {l:38,r:18,t:18,b:30};
  const cw = w-pad.l-pad.r, ch = h-pad.t-pad.b;
  ctx.clearRect(0,0,w,h);
  ctx.strokeStyle="#33291b";ctx.lineWidth=1;ctx.fillStyle="#8f806b";ctx.font="11px Arial";
  for(let i=0;i<=4;i++){const y=pad.t+ch*i/4;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke()}
  const maxI=Math.max(1,...rows.map(r=>Number(r.impressions||0)));
  const maxC=Math.max(1,...rows.map(r=>Number(r.clicks||0)));
  function line(key,max,color){
    ctx.beginPath();rows.forEach((r,i)=>{const x=pad.l+(rows.length===1?0:cw*i/(rows.length-1));const y=pad.t+ch-(Number(r[key]||0)/max)*ch;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.strokeStyle=color;ctx.lineWidth=2.3;ctx.stroke();
    rows.forEach((r,i)=>{if(!Number(r[key]||0))return;const x=pad.l+(rows.length===1?0:cw*i/(rows.length-1));const y=pad.t+ch-(Number(r[key]||0)/max)*ch;ctx.beginPath();ctx.arc(x,y,2.7,0,Math.PI*2);ctx.fillStyle=color;ctx.fill()})
  }
  line("impressions",maxI,"#84b9ff");line("clicks",maxC,"#efc865");
  ctx.fillStyle="#8f806b";ctx.textAlign="center";
  const indexes=[0,Math.floor((rows.length-1)/2),rows.length-1];
  indexes.forEach(i=>{if(!rows[i])return;const x=pad.l+(rows.length===1?0:cw*i/(rows.length-1));ctx.fillText(rows[i].date.slice(5),x,h-8)});
}
async function load() {
  $("app").classList.add("loading"); $("error").style.display="none";
  try {
    const response = await fetch("/.netlify/functions/gsc-report", {credentials:"same-origin", cache:"no-store"});
    if (response.status === 401) { location.href="/.netlify/functions/gsc-dashboard"; return; }
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || data.message || "Could not load Search Console report.");
    $("property").textContent = data.property.siteUrl + " · " + data.property.permissionLevel;
    $("generated").textContent = "Updated " + dateText(data.generatedAt);
    $("period").textContent = data.period.current.startDate + " → " + data.period.current.endDate;
    $("clicks").textContent=num(data.totals.clicks); $("impressions").textContent=num(data.totals.impressions); $("ctr").textContent=pct(data.totals.ctr); $("position").textContent=pos(data.totals.position);
    applyDelta("clicksDelta",data.change.clicks,"clicks"); applyDelta("impressionsDelta",data.change.impressions,"impressions"); applyDelta("ctrDelta",data.change.ctr,"ctr"); applyDelta("positionDelta",data.change.position,"position");
    drawChart(data.daily || []);
    const sitemaps=data.sitemaps||[]; $("sitemapSummary").textContent=sitemaps.length+" detected";
    $("sitemaps").innerHTML=sitemaps.length?sitemaps.map(s=>{const content=(s.contents||[])[0]||{};return '<div class="sitemap-item"><strong>'+esc(s.path)+'</strong><div class="sitemap-row"><span>Submitted: '+esc(content.submitted??"—")+'</span><span>Indexed: '+esc(content.indexed??"—")+'</span></div><div class="sitemap-row"><span>Warnings: '+num(s.warnings)+'</span><span class="'+(!s.errors?"ok":"")+'">Errors: '+num(s.errors)+'</span></div></div>'}).join(""):'<div class="empty">No sitemap returned.</div>';
    const pages=data.topPages||[]; $("pages").innerHTML=pages.length?pages.slice(0,30).map(r=>'<tr><td class="page">'+esc(r.page.replace("https://thorshall.gg","")||"/")+'</td><td class="num">'+num(r.clicks)+'</td><td class="num">'+num(r.impressions)+'</td><td class="num">'+pct(r.ctr)+'</td><td class="num position">'+pos(r.position)+'</td></tr>').join(""):'<tr><td class="empty" colspan="5">No page data yet.</td></tr>';
    const queries=data.topQueries||[]; $("queries").innerHTML=queries.length?queries.slice(0,30).map(r=>'<tr><td class="page">'+esc(r.query)+'</td><td class="num">'+num(r.clicks)+'</td><td class="num">'+num(r.impressions)+'</td><td class="num position">'+pos(r.position)+'</td></tr>').join(""):'<tr><td class="empty" colspan="4">Google has not returned query rows yet.</td></tr>';
  } catch (error) {
    $("error").textContent=error.message; $("error").style.display="block";
  } finally { $("app").classList.remove("loading"); }
}
$("refresh").addEventListener("click",load); window.addEventListener("resize",()=>{clearTimeout(window.__chartTimer);window.__chartTimer=setTimeout(load,180)}); load();
</script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));
}

exports.handler = async function (event) {
  const password = process.env.DASHBOARD_PASSWORD || "";
  if (!password || !envSecret()) {
    return {
      statusCode: 503,
      headers: headers(),
      body: loginPage("Dashboard security variables are not configured.")
    };
  }

  if (event.queryStringParameters?.logout === "1") {
    return {
      statusCode: 302,
      headers: headers({
        "Location": "/.netlify/functions/gsc-dashboard",
        "Set-Cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
      }),
      body: ""
    };
  }

  if (event.httpMethod === "POST") {
    const params = new URLSearchParams(event.body || "");
    const supplied = params.get("password") || "";
    if (safeEqual(supplied, password)) {
      return {
        statusCode: 302,
        headers: headers({
          "Location": "/.netlify/functions/gsc-dashboard",
          "Set-Cookie": `${COOKIE_NAME}=${encodeURIComponent(makeSession())}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`
        }),
        body: ""
      };
    }
    return { statusCode: 401, headers: headers(), body: loginPage("Incorrect password.") };
  }

  if (!validSession(event)) {
    return { statusCode: 200, headers: headers(), body: loginPage() };
  }

  return { statusCode: 200, headers: headers(), body: dashboardPage() };
};
