"use strict";

// This registry is the allowlist for private partner reports. Campaign IDs are
// never accepted from a browser. Add future numbered partners here after setup.
const partners = Object.freeze({
  t2: Object.freeze({
    code: "t2",
    name: "Swagat Nayak",
    campaignId: "150649",
    landingPath: "/t2",
    dashboardPath: "/t2-dashboard",
    campaignUrl: "https://playrainbet.com/tggbn1yfr"
  })
});

function getPartner(code) {
  const key = String(code || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(partners, key) ? partners[key] : null;
}

module.exports = { partners, getPartner };
