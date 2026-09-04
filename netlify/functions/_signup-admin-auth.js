const crypto = require("crypto");

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function authorized(event) {
  const expected = process.env.DASHBOARD_PASSWORD || "";
  const auth = event.headers.authorization || event.headers.Authorization || "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return expected && safeEqual(provided, expected);
}

module.exports = { authorized };