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

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ ok: false, error: "Invalid JSON body" })
    };
  }

  const signupId = String(body.signup_id || "").trim();
  const fileName = String(body.file_name || "").trim();
  const mimeType = String(body.mime_type || "").trim().toLowerCase();
  const base64Data = String(body.file_base64 || "").trim();

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(signupId)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ ok: false, error: "Valid signup_id required" })
    };
  }

  const allowedTypes = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp"
  };

  if (!allowedTypes[mimeType]) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ ok: false, error: "Only PNG, JPEG or WEBP images are allowed" })
    };
  }

  if (!base64Data) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ ok: false, error: "Screenshot data is required" })
    };
  }

  let fileBuffer;
  try {
    const cleaned = base64Data.includes(",")
      ? base64Data.split(",").pop()
      : base64Data;

    fileBuffer = Buffer.from(cleaned, "base64");
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ ok: false, error: "Invalid screenshot data" })
    };
  }

  // Keep well under Netlify's request-size ceiling because base64 increases size.
  const maxBytes = 4 * 1024 * 1024;
  if (!fileBuffer.length || fileBuffer.length > maxBytes) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        ok: false,
        error: "Screenshot must be 4 MB or smaller"
      })
    };
  }

  const ext = allowedTypes[mimeType];
  const safeOriginal = fileName
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, 80);

  const storagePath = `${signupId}/${Date.now()}-${safeOriginal || `proof.${ext}`}`;

  try {
    // 1) Make sure the signup exists and is not already finalized.
    const lookup = await fetch(
      `${supabaseUrl}/rest/v1/signups?id=eq.${encodeURIComponent(signupId)}&select=id,status`,
      {
        headers: {
          apikey: supabaseSecretKey,
          Authorization: `Bearer ${supabaseSecretKey}`
        }
      }
    );

    const rows = await lookup.json().catch(() => []);

    if (!lookup.ok) {
      console.error("Signup lookup failed:", lookup.status, rows);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ ok: false, error: "Could not check signup" })
      };
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ ok: false, error: "Signup not found" })
      };
    }

    const currentStatus = rows[0].status;
    if (["verified", "rejected", "paid"].includes(currentStatus)) {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({ ok: false, error: "This signup is already finalized" })
      };
    }

    // 2) Upload screenshot to the PRIVATE verification-proofs bucket.
    const upload = await fetch(
      `${supabaseUrl}/storage/v1/object/verification-proofs/${storagePath}`,
      {
        method: "POST",
        headers: {
          apikey: supabaseSecretKey,
          Authorization: `Bearer ${supabaseSecretKey}`,
          "Content-Type": mimeType,
          "x-upsert": "false"
        },
        body: fileBuffer
      }
    );

    const uploadData = await upload.json().catch(() => null);

    if (!upload.ok) {
      console.error("Proof upload failed:", upload.status, uploadData);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ ok: false, error: "Could not upload screenshot" })
      };
    }

    // 3) Update the signup row.
    const update = await fetch(
      `${supabaseUrl}/rest/v1/signups?id=eq.${encodeURIComponent(signupId)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseSecretKey,
          Authorization: `Bearer ${supabaseSecretKey}`,
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          proof_path: storagePath,
          status: "proof_submitted",
          proof_submitted_at: new Date().toISOString()
        })
      }
    );

    const updated = await update.json().catch(() => null);

    if (!update.ok) {
      console.error("Signup update failed:", update.status, updated);

      // Best-effort cleanup if DB update fails after upload.
      await fetch(
        `${supabaseUrl}/storage/v1/object/verification-proofs/${storagePath}`,
        {
          method: "DELETE",
          headers: {
            apikey: supabaseSecretKey,
            Authorization: `Bearer ${supabaseSecretKey}`
          }
        }
      ).catch(() => {});

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ ok: false, error: "Could not update signup" })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        signup_id: signupId,
        status: "proof_submitted",
        proof_path: storagePath
      })
    };
  } catch (error) {
    console.error("signup-proof-upload error:", error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: "Server error" })
    };
  }
};
