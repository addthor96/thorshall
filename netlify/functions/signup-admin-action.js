const { authorized } = require("./_signup-admin-auth");

exports.handler = async function (event) {
  const headers = { "Content-Type":"application/json" };

  if (event.httpMethod !== "POST") {
    return { statusCode:405, headers, body:JSON.stringify({ ok:false, error:"Method not allowed" }) };
  }

  if (!authorized(event)) {
    return { statusCode:401, headers, body:JSON.stringify({ ok:false, error:"Unauthorized" }) };
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  let body = {};
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode:400, headers, body:JSON.stringify({ ok:false, error:"Invalid JSON" }) }; }

  const id = String(body.id || "").trim();
  const action = String(body.action || "").trim();

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return { statusCode:400, headers, body:JSON.stringify({ ok:false, error:"Invalid signup id" }) };
  }

  const now = new Date().toISOString();
  let patch;

  if (action === "verify") {
    patch = { status:"verified", verified_at:now, rejected_at:null };
  } else if (action === "reject") {
    patch = { status:"rejected", rejected_at:now, verified_at:null };
  } else if (action === "paid") {
    patch = { status:"paid", paid_at:now };
  } else {
    return { statusCode:400, headers, body:JSON.stringify({ ok:false, error:"Invalid action" }) };
  }

  const res = await fetch(`${url}/rest/v1/signups?id=eq.${encodeURIComponent(id)}`, {
    method:"PATCH",
    headers:{
      "Content-Type":"application/json",
      apikey:key,
      Authorization:`Bearer ${key}`,
      Prefer:"return=representation"
    },
    body:JSON.stringify(patch)
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    console.error("Admin action failed:", res.status, data);
    return { statusCode:500, headers, body:JSON.stringify({ ok:false, error:"Could not update signup" }) };
  }

  return { statusCode:200, headers, body:JSON.stringify({ ok:true, signup:Array.isArray(data)?data[0]:data }) };
};