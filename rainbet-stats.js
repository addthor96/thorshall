(function () {
  const statNodes = document.querySelectorAll('[data-rainbet-stat]');
  if (!statNodes.length) return;
  const widgets = document.querySelectorAll('.analytics-widget');

  const setStat = (key, value) => {
    document.querySelectorAll(`[data-rainbet-stat="${key}"]`).forEach((node) => {
      node.textContent = value;
    });
  };

  const isNumber = (value) =>
    value !== null && value !== undefined && Number.isFinite(Number(value));

  const money = (value) =>
    isNumber(value)
      ? `$${Number(value).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : '—';

  const count = (value) =>
    isNumber(value)
      ? Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 })
      : '—';

  fetch('/.netlify/functions/rainbet-stats', { cache: 'no-store' })
    .then((response) =>
      response.json().then((data) => {
        if (!response.ok || !data || data.available !== true) {
          throw new Error('Stats request failed');
        }
        return data;
      }),
    )
    .then((data) => {
      if (![data.wager, data.deposits, data.visits, data.registrations].some(isNumber)) {
        throw new Error('No metrics available');
      }
      setStat('wager', money(data.wager));
      setStat('deposits', money(data.deposits));
      setStat('visits', `${count(data.visits)} / ${count(data.registrations)}`);
      setStat('updated', 'Metrics sourced from live activity.');
      widgets.forEach((widget) => { widget.hidden = false; });
    })
    .catch(() => {
      // Keep the widget hidden when the report is unavailable.
    });
})();
