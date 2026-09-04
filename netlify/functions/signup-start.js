exports.handler = async function (event) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "https://thorshall.gg",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ ok: false, error: "Method not allowed" })
    };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: "Server configuration missing" })
    };
  }

  let body = {};
  try {
    const contentType =
      event.headers["content-type"] ||
      event.headers["Content-Type"] ||
      "";

    if (contentType.includes("application/json")) {
      body = JSON.parse(event.body || "{}");
    } else {
      body = Object.fromEntries(
        new URLSearchParams(event.body || "").entries()
      );
    }
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ ok: false, error: "Invalid request body" })
    };
  }

  const username = String(body.rainbet_username || "").trim();
  const source = String(body.source || "direct").trim();
  const partner = String(body.partner || "Aditya").trim();

  if (!username || username.length > 64) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        ok: false,
        error: "Valid Rainbet username required"
      })
    };
  }

  if (!/^[A-Za-z0-9_.-]+$/.test(username)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        ok: false,
        error: "Username contains unsupported characters"
      })
    };
  }

  if (!/^[A-Za-z0-9_.-]{1,60}$/.test(source)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ ok: false, error: "Invalid source" })
    };
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/signups`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseSecretKey,
        Authorization: `Bearer ${supabaseSecretKey}`,
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        rainbet_username: username,
        partner,
        source,
        status: "started"
      })
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const details = JSON.stringify(data || "");

      if (
        response.status === 409 ||
        details.includes("signups_username_unique") ||
        details.includes("duplicate key")
      ) {
        return {
          statusCode: 409,
          headers,
          body: JSON.stringify({
            ok: false,
            error: "This Rainbet username has already been submitted"
          })
        };
      }

      console.error("Supabase insert failed:", response.status, data);

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          ok: false,
          error: "Could not save signup"
        })
      };
    }

    const signup = Array.isArray(data) ? data[0] : data;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        signup_id: signup?.id || null,
        rainbet_username: username,
        source
      })
    };
  } catch (error) {
    console.error("signup-start error:", error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: "Server error" })
    };
  }
};
