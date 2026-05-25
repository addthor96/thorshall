exports.handler = async function () {
  const token = process.env.RAINBET_STATISTIC_TOKEN;

  if (!token) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Missing RAINBET_STATISTIC_TOKEN" })
    };
  }

  const from = "2019-01-01";
  const to = new Date().toISOString().split("T")[0];
  const MITHRA_CAMPAIGN_ID = "89073";

  const readValue = (value) => {
    if (value && typeof value === "object") return Number(value.amount || 0);
    return Number(value || 0);
  };

  const getTotal = (totals, name) => {
    const item = totals.find((x) => x.name === name);
    return item ? readValue(item.value) : 0;
  };

  async function fetchReport(campaignId = null) {
    const params = new URLSearchParams({
      async: "false",
      from,
      to,
      exchange_rates_date: "2019-01-01",
      conversion_currency: "USD"
    });

    ["wager", "deposits_sum", "visits_count", "registrations_count"]
      .forEach((c) => params.append("columns[]", c));

    if (campaignId) params.append("campaign_ids[]", campaignId);

    const response = await fetch(
      "https://portal.rainbetpartners.com/api/customer/v1/partner/report?" + params.toString(),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: token
        }
      }
    );

    const data = await response.json();

    if (!response.ok) throw new Error(JSON.stringify(data));

    const totals = data?.totals?.data?.[0] || data?.rows?.totals?.data?.[0] || [];

    return {
      wager: getTotal(totals, "wager"),
      deposits: getTotal(totals, "deposits_sum"),
      visits: getTotal(totals, "visits_count"),
      registrations: getTotal(totals, "registrations_count")
    };
  }

  try {
    const overall = await fetchReport();
    const mithra = await fetchReport(MITHRA_CAMPAIGN_ID);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
      body: JSON.stringify({ overall, partners: { mithra }, updated: new Date().toISOString() })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Rainbet API error", details: err.message })
    };
  }
};