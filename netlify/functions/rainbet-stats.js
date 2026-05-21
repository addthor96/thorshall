exports.handler = async function() {
  const token = process.env.RAINBET_STATISTIC_TOKEN;
  if (!token) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing RAINBET_STATISTIC_TOKEN' }) };
  }

  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0)).toISOString();
  const to = now.toISOString();

  const params = new URLSearchParams();
  params.set('from', from);
  params.set('to', to);
  params.set('conversion_currency', 'USD');
  ['visits_count','registrations_count','deposits_sum','wager','ngr','first_deposits_count'].forEach(c => {
    params.append('columns[]', c);
  });

  const url = `https://portal.rainbetpartners.com/api/customer/v1/partner/report?${params.toString()}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': token
      }
    });

    const raw = await response.json();
    if (!response.ok) {
      return { statusCode: response.status, body: JSON.stringify({ error: 'Rainbet API error', details: raw }) };
    }

    const rows = Array.isArray(raw) ? raw
      : Array.isArray(raw.data) ? raw.data
      : Array.isArray(raw.items) ? raw.items
      : Array.isArray(raw.rows) ? raw.rows
      : Array.isArray(raw.report) ? raw.report
      : [raw];

    const num = v => Number(String(v ?? 0).replace(/[$,]/g, '')) || 0;
    const sum = keys => rows.reduce((total, row) => {
      for (const key of keys) {
        if (row && row[key] !== undefined) return total + num(row[key]);
      }
      return total;
    }, 0);

    const stats = {
      wager: sum(['wager', 'casino_bets_sum', 'casino_total_bets_sum']),
      ngr: sum(['ngr', 'casino_ngr']),
      deposits: sum(['deposits_sum', 'first_deposits_sum']),
      visits: sum(['visits_count']),
      registrations: sum(['registrations_count']),
      ftd: sum(['first_deposits_count']),
      updated: new Date().toISOString()
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600'
      },
      body: JSON.stringify(stats)
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
