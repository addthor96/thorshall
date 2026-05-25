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

  const CREATORS = {
    mithra: {
      name: "Mithra",
      campaignId: "89073"
    }
  };

  const readValue = (value) => {
    if (value && typeof value === "object") return Number(value.amount || 0);
    return Number(value || 0);
  };

  const getTotal = (totals, name) => {
    const item = totals.find((x) => x.name === name);
    return item ? readValue(item.value) : 0;
  };

  async function fetchCreatorStats(campaignId) {
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
      "casino_ngr"
    ].forEach((c) => params.append("columns[]", c));

    params.append("campaign_ids[]", campaignId);

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
      registrations: getTotal(totals, "registrations_count"),
      ngr: getTotal(totals, "casino_ngr")
    };
  }

  try {
    const partners = {};

    for (const [key, creator] of Object.entries(CREATORS)) {
      partners[key] = {
        name: creator.name,
        campaignId: creator.campaignId,
        ...(await fetchCreatorStats(creator.campaignId))
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300"
      },
      body: JSON.stringify({
        partners,
        updated: new Date().toISOString()
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Rainbet partner stats error",
        details: err.message
      })
    };
  }
};