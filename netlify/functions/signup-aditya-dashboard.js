const { authorized } = require("./_aditya-dashboard-auth");

function displaySource(raw) {
  const source = String(raw || "direct");
  const oldVendor = source.match(/^vendor(\d+)$/i);
  if (oldVendor) return `Aditya-v${oldVendor[1]}`;
  return source;
}

exports.handler = async function (event) {
  const headers = { "Content-Type": "application/json" };

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ ok: false, error: "Method not allowed" })
    };
  }

  if (!authorized(event)) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ ok: false, error: "Unauthorized" })
    };
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: "Server configuration missing" })
    };
  }

  const res = await fetch(
    `${url}/rest/v1/signups?partner=eq.Aditya&select=source,status,value_usd,created_at&order=created_at.desc`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`
      }
    }
  );

  const rows = await res.json().catch(() => []);

  if (!res.ok) {
    console.error("Aditya dashboard load failed:", res.status, rows);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: "Could not load dashboard" })
    };
  }

  const pending = rows.filter(x => x.status === "proof_submitted").length;
  const verified = rows.filter(x => x.status === "verified").length;
  const rejected = rows.filter(x => x.status === "rejected").length;
  const paid = rows.filter(x => x.status === "paid").length;

  const earnings = rows
    .filter(x => x.status === "verified" || x.status === "paid")
    .reduce((sum, x) => sum + Number(x.value_usd || 0), 0);

  const paidAmount = rows
    .filter(x => x.status === "paid")
    .reduce((sum, x) => sum + Number(x.value_usd || 0), 0);

  const owed = Math.max(0, earnings - paidAmount);
  const pilotVerified = verified + paid;

  const vendors = {};

  for (const row of rows) {
    const source = displaySource(row.source);

    if (!vendors[source]) {
      vendors[source] = {
        source,
        submitted: 0,
        pending: 0,
        verified: 0,
        rejected: 0,
        paid: 0,
        earnings: 0
      };
    }

    const v = vendors[source];
    v.submitted++;

    if (row.status === "proof_submitted") v.pending++;

    if (row.status === "verified") {
      v.verified++;
      v.earnings += Number(row.value_usd || 0);
    }

    if (row.status === "rejected") v.rejected++;

    if (row.status === "paid") {
      v.paid++;
      v.earnings += Number(row.value_usd || 0);
    }
  }

  const vendorBreakdown = Object.values(vendors).sort((a, b) => {
    const aNum = Number((a.source.match(/Aditya-v(\d+)/i) || [])[1] || 999999);
    const bNum = Number((b.source.match(/Aditya-v(\d+)/i) || [])[1] || 999999);

    if (aNum !== bNum) return aNum - bNum;

    if (b.verified + b.paid !== a.verified + a.paid) {
      return (b.verified + b.paid) - (a.verified + a.paid);
    }

    return b.submitted - a.submitted;
  });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      ok: true,
      metrics: {
        pending,
        verified,
        rejected,
        paid,
        earnings,
        paid_amount: paidAmount,
        owed,
        pilot_verified: pilotVerified,
        pilot_cap: 500
      },
      vendors: vendorBreakdown
    })
  };
};
