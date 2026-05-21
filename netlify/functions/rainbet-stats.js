exports.handler = async function () {
  const token = process.env.RAINBET_STATISTIC_TOKEN;

  if (!token) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Missing token" })
    };
  }

  const now = new Date();

  const from = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  )
    .toISOString()
    .split("T")[0];

  const to = now.toISOString().split("T")[0];

  const params = new URLSearchParams({
    async: "false",
    from,
    to,
    exchange_rates_date: "2019-01-01",
    conversion_currency: "USD"
  });

  [
    "wager",
    "ngr",
    "deposits_sum",
    "first_deposits_count",
    "visits_count",
    "registrations_count"
  ].forEach((c) => params.append("columns[]", c));

  params.append("group_by[]", "day");

  const url =
    `https://portal.rainbetpartners.com/api/customer/v1/partner/report?${params.toString()}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: token
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({
          error: "Rainbet API error",
          details: data
        })
      };
    }

    const totals = data?.totals?.data?.[0] || data?.rows?.totals?.data?.[0] || [];

    const get = (name) => {
      const item = totals.find((x) => x.name === name);

      if (!item) return 0;

      if (typeof item.value === "object") {
        return Number(item.value.amount || 0);
      }

      return Number(item.value || 0);
    };

    const stats = {
      visits: get("visits_count"),
      registrations: get("registrations_count"),
      wager: get("wager"),
      ngr: get("ngr"),
      deposits: get("deposits_sum"),
      ftd: get("first_deposits_count"),
      updated: new Date().toISOString()
    };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300"
      },
      body: JSON.stringify(stats)
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: err.message
      })
    };
  }
};