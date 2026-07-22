exports.handler = async function () {
  const token = process.env.RAINBET_STATISTIC_TOKEN;

  if (!token) {
    return jsonResponse(500, {
      error: "Missing RAINBET_STATISTIC_TOKEN"
    });
  }

  const partnersConfig = {
    mithra: {
      name: "Mithra",
      campaignId: process.env.MITHRA_CAMPAIGN_ID || "89073"
    },
    georgina: {
      name: "Georgina",
      campaignId: process.env.GEORGINA_CAMPAIGN_ID || ""
    }
  };

  const from = "2019-01-01";

  // Use tomorrow because some reporting systems treat the end date as exclusive.
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const to = tomorrow.toISOString().slice(0, 10);

  function jsonResponse(statusCode, payload) {
    return {
      statusCode,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      },
      body: JSON.stringify(payload)
    };
  }

  function toNumber(value) {
    if (value && typeof value === "object") {
      return Number(value.amount || 0);
    }

    return Number(value || 0);
  }

  function getTotal(totals, fieldName) {
    const item = totals.find((entry) => entry && entry.name === fieldName);
    return item ? toNumber(item.value) : 0;
  }

  async function fetchCampaignStats(campaignId) {
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
      "ftd_count",
      "casino_ggr",
      "casino_ngr"
    ].forEach((column) => params.append("columns[]", column));

    params.append("campaign_ids[]", String(campaignId));

    const response = await fetch(
      "https://portal.rainbetpartners.com/api/customer/v1/partner/report?" +
        params.toString(),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: token
        }
      }
    );

    let data;

    try {
      data = await response.json();
    } catch (error) {
      throw new Error(
        `Rainbet returned an unreadable response (${response.status}).`
      );
    }

    if (!response.ok) {
      throw new Error(
        data?.message ||
          data?.error ||
          `Rainbet API request failed with status ${response.status}.`
      );
    }

    const totals =
      data?.totals?.data?.[0] ||
      data?.rows?.totals?.data?.[0] ||
      [];

    if (!Array.isArray(totals)) {
      throw new Error("Rainbet returned an unexpected totals format.");
    }

    return {
      wager: getTotal(totals, "wager"),
      deposits: getTotal(totals, "deposits_sum"),
      visits: getTotal(totals, "visits_count"),
      registrations: getTotal(totals, "registrations_count"),
      ftd: getTotal(totals, "ftd_count"),
      casinoGgr: getTotal(totals, "casino_ggr"),
      casinoNgr: getTotal(totals, "casino_ngr")
    };
  }

  try {
    const partners = {};

    for (const [key, config] of Object.entries(partnersConfig)) {
      if (!config.campaignId) {
        partners[key] = {
          name: config.name,
          connected: false,
          wager: 0,
          deposits: 0,
          visits: 0,
          registrations: 0,
          ftd: 0,
          casinoGgr: 0,
          casinoNgr: 0
        };
        continue;
      }

      partners[key] = {
        name: config.name,
        connected: true,
        ...(await fetchCampaignStats(config.campaignId))
      };
    }

    return jsonResponse(200, {
      partners,
      updated: new Date().toISOString()
    });
  } catch (error) {
    return jsonResponse(500, {
      error: "Rainbet partner stats error",
      details: error instanceof Error ? error.message : String(error)
    });
  }
};
