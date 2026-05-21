exports.handler = async function () {
  const token = process.env.RAINBET_STATISTIC_TOKEN;

  if (!token) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Missing RAINBET_STATISTIC_TOKEN" })
    };
  }

  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
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
    "deposits_sum",
    "visits_count",
    "registrations_count",
    "ngr",
    "first_deposits_count"
  ].forEach((c) => params.append("columns[]", c));

  params.append("group_by[]", "day");

  const url = `https://portal.rainbetpartners.com/api/customer/v1/partner/report?${params.toString()}`;

  const readValue = (value) => {
    if (value && typeof value === "object") {
      return Number(value.amount || 0);
    }
    return Number(value || 0);
  };

  const getTotal = (totals, name) => {
    const item = totals.find((x) => x.name === name);
    return item ? readValue(item.value) : 0;
  };

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

    const totals =
      data?.totals?.data?.[0] ||
      data?.rows?.totals?.data?.[0] ||
      [];

    const stats = {
      wager: getTotal(totals, "wager"),
      deposits: getTotal(totals, "deposits_sum"),
      visits: getTotal(totals, "visits_count"),
      registrations: getTotal(totals, "registrations_count"),

      // saved for /partners later
      ngr: getTotal(totals, "ngr"),
      ftd: getTotal(totals, "first_deposits_count"),

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
      body: JSON.stringify({ error: err.message })
    };
  }
};