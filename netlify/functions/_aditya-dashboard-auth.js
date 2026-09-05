const crypto = require("crypto");

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function authorized(event) {
  const auth = event.headers.authorization || event.headers.Authorization || "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  const partnerPassword = process.env.ADITYA_DASHBOARD_PASSWORD || "";
  const adminPassword = process.env.DASHBOARD_PASSWORD || "";

  const matchesPartner =
    partnerPassword && safeEqual(provided, partnerPassword);

  const matchesAdmin =
    adminPassword && safeEqual(provided, adminPassword);

  return Boolean(matchesPartner || matchesAdmin);
}

module.exports = { authorized };
