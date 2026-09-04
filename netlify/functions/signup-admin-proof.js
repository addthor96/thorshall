const { authorized } = require("./_signup-admin-auth");

exports.handler = async function (event) {
  const headers = { "Content-Type":"application/json" };

  if (event.httpMethod !== "GET") {
    return { statusCode:405, headers, body:JSON.stringify({ ok:false, error:"Method not allowed" }) };
  }

  if (!authorized(event)) {
    return { statusCode:401, headers, body:JSON.stringify({ ok:false, error:"Unauthorized" }) };
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const id = String(event.queryStringParameters?.id || "").trim();

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return { statusCode:400, headers, body:JSON.stringify({ ok:false, error:"Invalid signup id" }) };
  }

  const lookup = await fetch(
    `${url}/rest/v1/signups?id=eq.${encodeURIComponent(id)}&select=proof_path`,
    { headers:{ apikey:key, Authorization:`Bearer ${key}` } }
  );
  const rows = await lookup.json().catch(() => []);
  if (!lookup.ok || !rows?.[0]?.proof_path) {
    return { statusCode:404, headers, body:JSON.stringify({ ok:false, error:"Proof not found" }) };
  }

  const res = await fetch(`${url}/storage/v1/object/sign/verification-proofs/${rows[0].proof_path}`, {
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      apikey:key,
      Authorization:`Bearer ${key}`
    },
    body:JSON.stringify({ expiresIn:300 })
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.signedURL) {
    console.error("Signed proof URL failed:", res.status, data);
    return { statusCode:500, headers, body:JSON.stringify({ ok:false, error:"Could not open proof" }) };
  }

  return {
    statusCode:200,
    headers,
    body:JSON.stringify({ ok:true, url:`${url}/storage/v1${data.signedURL}` })
  };
};