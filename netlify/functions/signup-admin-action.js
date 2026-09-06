const { authorized } = require("./_signup-admin-auth");

exports.handler = async function (event) {
  const headers = { "Content-Type": "application/json" };

  if (event.httpMethod !== "POST") {
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

  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ ok: false, error: "Invalid JSON" })
    };
  }

  const id = String(body.id || "").trim();
  const action = String(body.action || "").trim();

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ ok: false, error: "Invalid signup id" })
    };
  }

  const authHeaders = {
    apikey: key,
    Authorization: `Bearer ${key}`
  };

  try {
    if (action === "verify") {
      const res = await fetch(`${url}/rest/v1/rpc/verify_aditya_signup_with_cap`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders
        },
        body: JSON.stringify({ p_signup_id: id })
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const details = JSON.stringify(data || "");

        if (details.includes("ADITYA_PILOT_CAP_REACHED")) {
          return {
            statusCode: 409,
            headers,
            body: JSON.stringify({
              ok: false,
              error: "Pilot cap reached: 500 verified users."
            })
          };
        }

        if (details.includes("SIGNUP_NOT_FOUND")) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ ok: false, error: "Signup not found" })
          };
        }

        console.error("Verify RPC failed:", res.status, data);

        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ ok: false, error: "Could not verify signup" })
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, signup: data })
      };
    }

    if (action === "delete") {
      // ADMIN FORCE DELETE:
      // Works regardless of started / proof_submitted / verified / rejected / paid.

      const lookup = await fetch(
        `${url}/rest/v1/signups?id=eq.${encodeURIComponent(id)}&select=id,proof_path`,
        { headers: authHeaders }
      );

      const rows = await lookup.json().catch(() => []);

      if (!lookup.ok || !Array.isArray(rows) || !rows[0]) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ ok: false, error: "Signup not found" })
        };
      }

      const proofPath = rows[0].proof_path || null;
      let proofDeleted = false;

      // Try to delete the private proof first.
      if (proofPath) {
        try {
          // Method 1: direct single-object delete.
          let proofRes = await fetch(
            `${url}/storage/v1/object/verification-proofs/${proofPath}`,
            {
              method: "DELETE",
              headers: authHeaders
            }
          );

          proofDeleted = proofRes.ok || proofRes.status === 404;

          // Method 2 fallback: Supabase bulk remove endpoint.
          if (!proofDeleted) {
            const firstError = await proofRes.text().catch(() => "");
            console.warn("Direct proof delete failed:", proofRes.status, firstError);

            proofRes = await fetch(
              `${url}/storage/v1/object/verification-proofs`,
              {
                method: "DELETE",
                headers: {
                  "Content-Type": "application/json",
                  ...authHeaders
                },
                body: JSON.stringify({ prefixes: [proofPath] })
              }
            );

            proofDeleted = proofRes.ok || proofRes.status === 404;

            if (!proofDeleted) {
              const secondError = await proofRes.text().catch(() => "");
              console.warn("Fallback proof delete failed:", proofRes.status, secondError);
            }
          }
        } catch (proofError) {
          console.warn("Proof cleanup error:", proofError);
        }
      } else {
        proofDeleted = true;
      }

      // IMPORTANT: proof cleanup can NEVER block the admin from deleting the signup.
      const deleteRow = await fetch(
        `${url}/rest/v1/signups?id=eq.${encodeURIComponent(id)}`,
        {
          method: "DELETE",
          headers: {
            ...authHeaders,
            Prefer: "return=representation"
          }
        }
      );

      const deleted = await deleteRow.json().catch(() => null);

      if (!deleteRow.ok) {
        console.error("Signup delete failed:", deleteRow.status, deleted);

        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ ok: false, error: "Could not delete signup" })
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          deleted: true,
          proof_deleted: proofDeleted
        })
      };
    }

    let patch;

    if (action === "reject") {
      patch = {
        status: "rejected",
        rejected_at: new Date().toISOString(),
        verified_at: null
      };
    } else if (action === "paid") {
      const lookup = await fetch(
        `${url}/rest/v1/signups?id=eq.${encodeURIComponent(id)}&select=id,status`,
        { headers: authHeaders }
      );

      const rows = await lookup.json().catch(() => []);

      if (!lookup.ok || !Array.isArray(rows) || !rows[0]) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ ok: false, error: "Signup not found" })
        };
      }

      if (rows[0].status !== "verified") {
        return {
          statusCode: 409,
          headers,
          body: JSON.stringify({
            ok: false,
            error: "Only verified signups can be marked paid."
          })
        };
      }

      patch = {
        status: "paid",
        paid_at: new Date().toISOString()
      };
    } else {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ ok: false, error: "Invalid action" })
      };
    }

    const res = await fetch(
      `${url}/rest/v1/signups?id=eq.${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
          Prefer: "return=representation"
        },
        body: JSON.stringify(patch)
      }
    );

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      console.error("Admin action failed:", res.status, data);

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
        signup: Array.isArray(data) ? data[0] : data
      })
    };
  } catch (error) {
    console.error("signup-admin-action error:", error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: "Server error" })
    };
  }
};
