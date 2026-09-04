const { authorized } = require("./_signup-admin-auth");

exports.handler = async function (event) {
  const headers = { "Content-Type": "application/json" };

  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers, body: JSON.stringify({ ok:false, error:"Method not allowed" }) };
  }

  if (!authorized(event)) {
    return { statusCode: 401, headers, body: JSON.stringify({ ok:false, error:"Unauthorized" }) };
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok:false, error:"Server configuration missing" }) };
  }

  const res = await fetch(
    `${url}/rest/v1/signups?select=id,rainbet_username,partner,source,status,proof_path,value_usd,created_at,proof_submitted_at,verified_at,rejected_at,paid_at,notes&order=created_at.desc`,
    { headers: { apikey:key, Authorization:`Bearer ${key}` } }
  );

  const data = await res.json().catch(() => []);
  if (!res.ok) {
    console.error("Admin list failed:", res.status, data);
    return { statusCode:500, headers, body:JSON.stringify({ ok:false, error:"Could not load signups" }) };
  }

  const counts = {
    submitted: data.length,
    pending: data.filter(x => x.status === "proof_submitted").length,
    verified: data.filter(x => x.status === "verified").length,
    rejected: data.filter(x => x.status === "rejected").length,
    paid: data.filter(x => x.status === "paid").length
  };

  const amountOwed = data
    .filter(x => x.status === "verified")
    .reduce((s, x) => s + Number(x.value_usd || 0), 0);

  const amountPaid = data
    .filter(x => x.status === "paid")
    .reduce((s, x) => s + Number(x.value_usd || 0), 0);

  return {
    statusCode:200,
    headers,
    body:JSON.stringify({ ok:true, signups:data, counts, amount_owed:amountOwed, amount_paid:amountPaid })
  };
};