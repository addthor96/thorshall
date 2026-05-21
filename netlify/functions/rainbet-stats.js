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

  const params = new URLSearchParams();
  params.set("async", "false");
  params.set("from", from);
  params.set("to", to);
  params.set("exchange_rates_date", "2019-01-01");
  params.set("conversion_currency", "USD");

  [
    "wager",
    "ngr",
    "deposits_sum",
    "first_deposits_count",
    "visits_count",
    "registrations_count",
    "clean_net_revenue"
  ].forEach((c) => params.append("columns[]", c));

  params.append("group_by[]", "day");

  const url = `https://portal.rainbetpartners.com/api/customer/v1/partner/report?${params.toString()}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: token
      }
    });

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({
          error: "Rainbet API error",
          details: data
        })
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300"
      },
      body: JSON.stringify(data)
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};