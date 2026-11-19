(function () {
  'use strict';

  // Predictions use their own requests; the live hunt/OBS refresh loop is unchanged.
  var API = '/.netlify/functions/hunt-predictions';
  var entries = new Map(), current = null, generation = 0, privacyEpoch = 0, controllers = new Set();
  var places = ['1st place', '2nd place', '3rd place'];

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function append(parent) {
    Array.prototype.slice.call(arguments, 1).forEach(function (child) { parent.appendChild(child); });
    return parent;
  }

  function money(minor, currency) {
    if (!Number.isSafeInteger(minor) || minor < 0) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(minor / 100);
  }

  function requestId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    if (!window.crypto || typeof window.crypto.getRandomValues !== 'function') throw new Error('Use an updated browser to submit a prediction.');
    var bytes = window.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
    var hex = Array.from(bytes, function (value) { return value.toString(16).padStart(2, '0'); }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function stateFor(id) {
    if (!entries.has(id)) entries.set(id, { epoch: privacyEpoch, draft: { username: '', amount: '', website: '' }, summary: null, loading: false, saving: false, needsRefresh: false, error: '', notice: '', pending: null, request: 0 });
    return entries.get(id);
  }

  function active(context) { return current === context && document.getElementById('hunt-predictions') === context.mount; }

  function settled(state) {
    if (!current || current.state !== state || !active(current)) return;
    update(current);
    if (state.needsRefresh && !state.saving && !state.loading) { state.needsRefresh = false; load(current); }
  }

  function makeInput(id, label, options) {
    var wrapper = element('div', 'prediction-field');
    var caption = element('label', '', label); caption.htmlFor = id;
    var input = element('input'); input.id = id; input.name = options.name; input.type = 'text';
    input.required = true; input.autocomplete = options.autocomplete || 'off';
    Object.keys(options).forEach(function (key) { if (!['name', 'autocomplete'].includes(key)) input.setAttribute(key, options[key]); });
    append(wrapper, caption, input);
    return { wrapper: wrapper, input: input, label: caption };
  }

  function build(context) {
    var mount = context.mount, state = context.state, nodes = {};
    mount.classList.add('hunt-predictions'); mount.setAttribute('aria-labelledby', 'predictions-title');
    mount.replaceChildren();

    var heading = element('div', 'prediction-heading');
    var headingText = element('div');
    var kicker = element('span', 'eyebrow', 'END BALANCE PREDICTIONS');
    var title = element('h3', '', 'What will the hunt finish at?'); title.id = 'predictions-title';
    append(headingText, kicker, title);
    nodes.badge = element('span', 'prediction-badge', 'Loading');
    append(heading, headingText, nodes.badge);

    var content = element('div', 'prediction-content');
    var entry = element('div', 'prediction-entry');
    nodes.intro = element('p', 'prediction-intro', 'Predict the final end balance while bonuses are being collected.');
    nodes.form = element('form', 'prediction-form'); nodes.form.noValidate = true;
    var username = makeInput('prediction-username', 'Twitch username', { name: 'username', autocomplete: 'nickname', maxlength: '26', autocapitalize: 'none', spellcheck: 'false', placeholder: 'Your Twitch username' });
    var amount = makeInput('prediction-amount', 'Final end balance (' + context.hunt.currency + ')', { name: 'amount', inputmode: 'decimal', maxlength: '13', placeholder: '0.00' });
    nodes.username = username.input; nodes.amount = amount.input; nodes.amountLabel = amount.label;
    nodes.username.value = state.draft.username; nodes.amount.value = state.draft.amount;
    var hidden = element('div', 'prediction-honeypot'); hidden.setAttribute('aria-hidden', 'true');
    var hiddenLabel = element('label', '', 'Website'); hiddenLabel.htmlFor = 'prediction-website';
    nodes.website = element('input'); nodes.website.id = 'prediction-website'; nodes.website.name = 'website'; nodes.website.type = 'text'; nodes.website.tabIndex = -1; nodes.website.autocomplete = 'off'; nodes.website.value = state.draft.website;
    append(hidden, hiddenLabel, nodes.website);
    nodes.submit = element('button', 'prediction-submit', 'Submit prediction'); nodes.submit.type = 'submit';
    var rules = element('p', 'prediction-rules', 'One entry per username and browser for each hunt. Your username and guess can appear in the final top three. Free to enter.');
    rules.id = 'prediction-rules'; nodes.form.setAttribute('aria-describedby', rules.id);
    append(nodes.form, username.wrapper, amount.wrapper, hidden, nodes.submit, rules);
    nodes.mine = element('div', 'prediction-mine'); nodes.mine.hidden = true;
    nodes.mineTitle = element('span', 'prediction-mine-label', 'Your prediction');
    nodes.mineAmount = element('strong'); nodes.mineName = element('span', 'prediction-mine-name');
    append(nodes.mine, nodes.mineTitle, nodes.mineAmount, nodes.mineName);
    nodes.closed = element('p', 'prediction-closed'); nodes.closed.hidden = true;
    nodes.message = element('p', 'prediction-message'); nodes.message.id = 'prediction-message'; nodes.message.setAttribute('role', 'status'); nodes.message.setAttribute('aria-live', 'polite');
    append(entry, nodes.intro, nodes.form, nodes.mine, nodes.closed, nodes.message);

    var standings = element('div', 'prediction-standings');
    var standingsHeader = element('div', 'prediction-standings-heading');
    nodes.count = element('span', 'prediction-count', 'Loading predictions…');
    nodes.refresh = element('button', 'prediction-refresh', 'Refresh predictions'); nodes.refresh.type = 'button';
    append(standingsHeader, nodes.count, nodes.refresh);
    var podium = element('ol', 'prediction-podium'); podium.setAttribute('aria-label', 'Prediction podium');
    nodes.places = places.map(function (place, index) {
      var card = element('li', 'prediction-place prediction-place-' + (index + 1));
      var rank = element('span', 'prediction-rank', place);
      var name = element('strong', 'prediction-winner-name', 'To be decided');
      var guess = element('span', 'prediction-winner-guess'); guess.hidden = true;
      var difference = element('span', 'prediction-winner-difference'); difference.hidden = true;
      append(card, rank, name, guess, difference); podium.appendChild(card);
      return { name: name, guess: guess, difference: difference };
    });
    nodes.podiumNote = element('p', 'prediction-podium-note', 'The closest guesses appear here once the hunt is finished. Ties go to the earlier entry.');
    append(standings, standingsHeader, podium, nodes.podiumNote);
    append(content, entry, standings); append(mount, heading, content);
    context.nodes = nodes;

    [nodes.username, nodes.amount, nodes.website].forEach(function (input) {
      input.addEventListener('input', function () {
        state.draft[input.name] = input.value;
        input.removeAttribute('aria-invalid');
        if (!state.saving && !state.pending) { state.error = ''; update(context); }
      });
    });
    nodes.form.addEventListener('submit', function (event) { event.preventDefault(); submit(context); });
    nodes.refresh.addEventListener('click', function () { if (!state.saving) load(context); });
    update(context);
  }

  function update(context) {
    if (!active(context)) return;
    var nodes = context.nodes, state = context.state, data = state.summary;
    var complete = (data ? data.status : context.hunt.status) === 'complete';
    var accepting = !!data && data.accepting === true && context.hunt.status === 'collecting' && context.hunt.id === context.activeId;
    var mine = data && data.mine;
    var locked = state.loading || state.saving;
    nodes.badge.textContent = !data ? state.error ? 'Unavailable' : 'Loading' : complete ? 'Finished' : accepting ? 'Open' : 'Locked';
    nodes.badge.dataset.state = !data ? 'loading' : complete ? 'complete' : accepting ? 'open' : 'locked';
    nodes.amountLabel.textContent = 'Final end balance (' + context.hunt.currency + ')';
    nodes.form.hidden = !accepting || !!mine;
    nodes.intro.textContent = complete ? 'The closest predictions to the final end balance take the top three places.' : accepting ? 'Predict the final end balance while bonuses are being collected.' : 'Entries close when bonus opening begins.';
    nodes.username.disabled = nodes.amount.disabled = nodes.website.disabled = locked || !!state.pending;
    nodes.submit.disabled = locked;
    nodes.submit.textContent = state.saving ? 'Saving prediction…' : state.pending ? 'Retry prediction' : 'Submit prediction';
    nodes.refresh.disabled = locked;
    nodes.count.textContent = data ? data.count + (data.count === 1 ? ' prediction' : ' predictions') : state.loading ? 'Loading predictions…' : 'Predictions unavailable';
    nodes.mine.hidden = !mine;
    if (mine) {
      nodes.mineAmount.textContent = money(mine.amountMinor, context.hunt.currency);
      nodes.mineName.textContent = '@' + mine.username + ' · Saved for this hunt';
    }
    nodes.closed.hidden = !data || accepting || !!mine;
    nodes.closed.textContent = complete ? 'Predictions are closed. The final podium is shown here.' : data && data.message ? data.message : 'Predictions are closed for this hunt. Check back for the final podium.';
    nodes.message.textContent = state.error || state.notice || (!data && state.loading ? 'Loading predictions…' : '');
    nodes.message.dataset.state = state.error ? 'error' : state.notice ? 'success' : 'loading';
    nodes.places.forEach(function (place, index) {
      var winner = complete && data && Array.isArray(data.podium) && data.podium.find(function (entry) { return entry.place === index + 1; });
      place.name.textContent = winner ? '@' + winner.username : complete ? 'No entry' : 'To be decided';
      place.guess.hidden = place.difference.hidden = !winner;
      place.guess.textContent = winner ? money(winner.amountMinor, context.hunt.currency) : '';
      place.difference.textContent = winner ? winner.differenceMinor === 0 ? 'Exact prediction' : money(winner.differenceMinor, context.hunt.currency) + ' away' : '';
    });
    nodes.podiumNote.textContent = complete ? 'Ranked by distance from the final end balance. Ties go to the earlier entry.' : 'The closest guesses appear here once the hunt is finished. Ties go to the earlier entry.';
  }

  async function api(method, payload) {
    var epoch = privacyEpoch, controller = new AbortController(), timeout = setTimeout(function () { controller.abort(); }, 15000);
    controllers.add(controller);
    try {
      var response = await fetch(API + (method === 'GET' ? '?hunt=' + encodeURIComponent(payload) : ''), {
        method: method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Thorshall-Request': 'hunt-prediction' },
        body: method === 'GET' ? undefined : JSON.stringify(payload)
      });
      var data;
      try { data = await response.json(); } catch (_) {
        var unreadable = new Error('Predictions are temporarily unavailable. Please try again.');
        unreadable.status = response.status; throw unreadable;
      }
      if (epoch !== privacyEpoch) { var discarded = new Error('Prediction view changed.'); discarded.discard = true; throw discarded; }
      if (!response.ok || !data.ok) {
        var error = new Error(typeof data.error === 'string' ? data.error : 'Predictions are temporarily unavailable. Please try again.');
        error.status = response.status; throw error;
      }
      if (data.huntId !== (method === 'GET' ? payload : payload.huntId) || typeof data.accepting !== 'boolean' || !Number.isSafeInteger(data.count) || data.count < 0) throw new Error('Predictions could not be confirmed. Please refresh predictions.');
      return data;
    } finally { clearTimeout(timeout); controllers.delete(controller); }
  }

  function apply(state, data) {
    if (state.epoch !== privacyEpoch) return false;
    state.summary = data;
    if (data.mine || !data.accepting) state.pending = null;
    return true;
  }

  function reset() {
    privacyEpoch++;
    controllers.forEach(function (controller) { controller.abort(); }); controllers.clear();
    entries.clear();
  }

  function deny(context, message) {
    // A late response from another hunt can still report a site-wide privacy
    // change. Scrub the currently visible prediction view as well as caches.
    var visible = current && active(current) ? current : null;
    reset();
    if (!visible) { current = null; return; }
    context = visible;
    context.state = stateFor(context.hunt.id);
    context.state.error = message || 'Predictions are unavailable for this hunt.';
    build(context);
  }

  async function load(context) {
    if (!active(context)) return;
    if (context.state.loading || context.state.saving) { context.state.needsRefresh = true; return; }
    var state = context.state, request = ++state.request;
    state.loading = true; state.error = ''; update(context);
    try {
      var data = await api('GET', context.hunt.id);
      if (request !== state.request) return;
      apply(state, data);
    } catch (error) {
      if (error.status === 403) { deny(context, error.message); return; }
      if (!error.discard && state.epoch === privacyEpoch && request === state.request) state.error = error.message || 'Predictions are temporarily unavailable. Please try again.';
    } finally {
      if (request === state.request) state.loading = false;
      settled(state);
    }
  }

  async function submit(context) {
    var state = context.state, nodes = context.nodes;
    if (!active(context) || state.loading || state.saving || !state.summary || !state.summary.accepting || state.summary.mine || context.hunt.id !== context.activeId || context.hunt.status !== 'collecting') return;
    state.error = ''; state.notice = '';
    if (!state.pending) {
      var username = nodes.username.value.trim().replace(/^@/, ''), amount = nodes.amount.value.trim();
      if (!/^[A-Za-z0-9_]{3,25}$/.test(username)) {
        state.error = 'Enter a Twitch username using 3–25 letters, numbers or underscores.';
        nodes.username.setAttribute('aria-invalid', 'true'); update(context); nodes.username.focus(); return;
      }
      if (!/^(0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(amount) || Number(amount) > 1000000000) {
        state.error = 'Enter an end balance from 0 to 1,000,000,000 using at most two decimal places.';
        nodes.amount.setAttribute('aria-invalid', 'true'); update(context); nodes.amount.focus(); return;
      }
      try { state.pending = { huntId: context.hunt.id, requestId: requestId(), username: username, amount: amount, website: nodes.website.value }; }
      catch (error) { state.error = error.message; update(context); return; }
    }
    var payload = state.pending;
    state.saving = true; update(context);
    try {
      var data = await api('POST', payload);
      if (!apply(state, data)) return;
      state.pending = null; state.notice = 'Your prediction is saved. Good luck!';
    } catch (error) {
      if (error.discard || state.epoch !== privacyEpoch) return;
      if (error.status === 403) { deny(context, error.message); return; }
      if ([400, 403, 404, 409, 422].includes(error.status)) state.pending = null;
      state.error = error.status ? error.message : 'The save could not be confirmed. Retry to safely submit the same prediction.';
      if (error.status === 409 || error.status === 404) {
        try {
          var latest = await api('GET', context.hunt.id); apply(state, latest);
          if (latest.mine) { state.error = ''; state.notice = 'Your prediction is already saved for this hunt.'; }
        } catch (refreshError) { if (refreshError.status === 403) deny(context, refreshError.message); }
      }
    } finally {
      state.saving = false;
      settled(state);
    }
  }

  document.addEventListener('hunt:view', function (event) {
    var detail = event.detail, hunt = detail && detail.hunt, mount = document.getElementById('hunt-predictions');
    if (!mount || !hunt || typeof hunt.id !== 'string' || !['USD', 'EUR', 'GBP', 'CAD', 'AUD'].includes(hunt.currency)) return;
    var signature = [hunt.id, hunt.status, hunt.currency, detail.activeId, hunt.status === 'complete' ? detail.revision : ''].join('|');
    if (current && current.mount === mount && current.hunt.id === hunt.id) {
      var changed = current.signature !== signature;
      current.hunt = hunt; current.activeId = detail.activeId; current.signature = signature;
      update(current);
      if (changed) load(current);
      return;
    }
    current = { mount: mount, hunt: hunt, activeId: detail.activeId, signature: signature, generation: ++generation, state: stateFor(hunt.id) };
    build(current); load(current);
  });

  document.addEventListener('hunt:unavailable', function () {
    reset();
    if (current) current.mount.replaceChildren();
    current = null;
  });
})();
