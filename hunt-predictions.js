(function () {
  'use strict';

  // Predictions use their own requests; the live hunt/OBS refresh loop is unchanged.
  var API = '/.netlify/functions/hunt-predictions';
  var AUTH = '/.netlify/functions/hunt-twitch', DRAFT_PREFIX = 'thorshall-prediction-draft-v2:';
  var entries = new Map(), current = null, generation = 0, privacyEpoch = 0, controllers = new Set(), authTimer = null, authDue = null;
  var places = ['1st place', '2nd place', '3rd place'];
  var motionQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var callbackMessage = (function () {
    var messages = {
      cancelled: 'Twitch sign-in was cancelled. You can try again.',
      failed: 'Twitch sign-in could not be completed. Please try again.',
      expired: 'That Twitch sign-in link expired. Please try again.',
      unavailable: 'Twitch sign-in is temporarily unavailable. Please try again later.'
    };
    var message = '';
    try {
      var flag = new URLSearchParams(location.search || '').get('twitch');
      message = Object.prototype.hasOwnProperty.call(messages, flag) ? messages[flag] : '';
    } catch (_) {}
    try {
      // Netlify can pass callback parameters through a redirect. Remove them
      // before the hunt viewer builds links, without discarding source labels.
      var url = new URL(location.href), changed = false;
      if (url.origin !== location.origin || !/^https?:$/.test(url.protocol)) return message;
      ['action', 'code', 'state', 'scope', 'error', 'error_description'].forEach(function (key) {
        if (url.searchParams.has(key)) { url.searchParams.delete(key); changed = true; }
      });
      var flags = url.searchParams.getAll('twitch');
      var retained = flags.filter(function (value) { return value !== 'connected' && !Object.prototype.hasOwnProperty.call(messages, value); });
      if (retained.length !== flags.length) {
        url.searchParams.delete('twitch');
        retained.forEach(function (value) { url.searchParams.append('twitch', value); });
        changed = true;
      }
      if (changed && window.history && typeof window.history.replaceState === 'function') {
        window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
      }
    } catch (_) { /* A restricted history API must not block predictions. */ }
    return message;
  })();

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
    if (!entries.has(id)) {
      var amount = readDraft(id);
      entries.set(id, { epoch: privacyEpoch, windowEpoch: 0, draft: { amount: amount, website: '' }, summary: null, loading: false, saving: false, signingOut: false, needsRefresh: false, editing: false, dirty: !!amount, editRevision: null, error: '', notice: '', authMessage: '', pending: null, request: 0 });
    }
    return entries.get(id);
  }

  function readDraft(id) {
    try {
      var draft = JSON.parse(sessionStorage.getItem(DRAFT_PREFIX + id));
      return draft && typeof draft.amount === 'string' && /^[0-9.]{0,13}$/.test(draft.amount) && Number.isFinite(draft.savedAt) && draft.savedAt <= Date.now() && Date.now() - draft.savedAt < 86400000 ? draft.amount : '';
    } catch (_) { return ''; }
  }

  function saveDraft(context) {
    try {
      var amount = context.state.draft.amount;
      if (/^[0-9.]{0,13}$/.test(amount) && amount) sessionStorage.setItem(DRAFT_PREFIX + context.hunt.id, JSON.stringify({ amount: amount, savedAt: Date.now() }));
      else sessionStorage.removeItem(DRAFT_PREFIX + context.hunt.id);
    } catch (_) { /* The entry form works when browser storage is unavailable. */ }
  }

  function clearDraft(id) { try { sessionStorage.removeItem(DRAFT_PREFIX + id); } catch (_) {} }

  function loginHref(value) {
    try {
      var url = new URL(value, location.origin);
      if (url.origin !== location.origin || url.username || url.password || url.hash || url.pathname !== AUTH || url.searchParams.get('action') !== 'login'
          || Array.from(url.searchParams.keys()).some(function (key) { return key !== 'action' && key !== 'return'; })) return null;
      return url.pathname + url.search;
    } catch (_) { return null; }
  }

  function validViewer(value) {
    return value === null || !!value && typeof value.id === 'string' && /^\d{1,30}$/.test(value.id) && typeof value.login === 'string' && /^[a-z0-9_]{1,25}$/.test(value.login)
      && typeof value.displayName === 'string' && value.displayName.length <= 100;
  }

  function scheduleAuth(data) {
    clearTimeout(authTimer); authTimer = null; authDue = null;
    if (!data || !data.viewer || !data.authRevalidateAt) return;
    var due = Date.parse(data.authRevalidateAt);
    if (!Number.isFinite(due)) return;
    authDue = due;
    if (!document.hidden) authTimer = setTimeout(refreshAuth, Math.max(1000, due - Date.now()));
  }

  function refreshAuth() {
    authTimer = null;
    if (document.hidden || !current || !active(current)) return;
    load(current);
  }

  function active(context) { return current === context && document.getElementById('hunt-predictions') === context.mount; }

  function revision(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

  function validWindowId(value) { return value === '0' || revision(value); }

  function windowId(context) {
    var metadata = context.predictionWindow;
    return metadata ? validWindowId(metadata.windowId) ? metadata.windowId.toLowerCase() : '0' : null;
  }

  function accepting(context, data) {
    var metadata = context.predictionWindow, token = windowId(context);
    return !!data && data.accepting === true && data.status === 'collecting' && context.hunt.status === 'collecting' && context.hunt.id === context.activeId
      && (token === null || token === data.windowId) && (!metadata || metadata.accepting === true && !metadata.closedAt);
  }

  function stopScroll(context) {
    if (!context || !context.scroller) return;
    clearTimeout(context.scroller.timer); context.scroller.timer = null; context.scroller.lastTick = null;
  }

  function stopRefresh(context) {
    if (context) { clearTimeout(context.refreshTimer); context.refreshTimer = null; }
  }

  function dispose(context) {
    if (!context) return;
    stopScroll(context); stopRefresh(context);
    if (context.resizeObserver) context.resizeObserver.disconnect();
    if (context.intersectionObserver) context.intersectionObserver.disconnect();
    context.resizeObserver = context.intersectionObserver = null;
  }

  function scrollAllowed(context) {
    var state = context.scroller, viewport = context.nodes.feedViewport;
    return active(context) && !document.hidden && context.inViewport !== false && state && !state.paused && !state.hovered && !state.focused
      && !(motionQuery && motionQuery.matches) && viewport.scrollHeight > viewport.clientHeight + 1;
  }

  function syncScroll(context, delay) {
    stopScroll(context);
    if (!active(context) || !context.nodes || !context.scroller) return;
    var scroll = context.scroller, viewport = context.nodes.feedViewport;
    context.nodes.scrollToggle.hidden = viewport.scrollHeight <= viewport.clientHeight + 1 || !!(motionQuery && motionQuery.matches);
    context.nodes.scrollToggle.textContent = scroll.paused ? 'Resume scrolling' : 'Pause scrolling';
    context.nodes.scrollToggle.setAttribute('aria-pressed', scroll.paused ? 'true' : 'false');
    if (!scrollAllowed(context)) return;
    scroll.timer = setTimeout(function tick() {
      scroll.timer = null;
      if (!scrollAllowed(context)) return;
      var now = Date.now(), elapsed = scroll.lastTick === null ? 0 : Math.min(100, now - scroll.lastTick);
      scroll.lastTick = now;
      scroll.position = Math.min(viewport.scrollHeight - viewport.clientHeight, scroll.position + elapsed * .022);
      viewport.scrollTop = scroll.position;
      if (scroll.position >= viewport.scrollHeight - viewport.clientHeight - 1) {
        // Continue in one direction only. Reset immediately, then rest at the top.
        viewport.scrollTop = scroll.position = 0; scroll.lastTick = null;
        scroll.timer = setTimeout(tick, 2000);
      } else scroll.timer = setTimeout(tick, 50);
    }, delay === undefined ? 2000 : delay);
  }

  function scheduleRefresh(context) {
    stopRefresh(context);
    if (!active(context) || document.hidden || context.inViewport === false || context.hunt.status === 'complete' || !context.state.summary || context.state.editing || context.state.dirty || context.state.pending) return;
    context.refreshTimer = setTimeout(function () {
      context.refreshTimer = null;
      if (!active(context) || document.hidden || context.inViewport === false) return;
      if (context.state.loading || context.state.saving || context.state.signingOut) { scheduleRefresh(context); return; }
      load(context);
    }, 60000);
  }

  function updateEntries(context, data) {
    var nodes = context.nodes, items = data && Array.isArray(data.entries) ? data.entries : [];
    var signature = JSON.stringify([accepting(context, data), items]);
    if (context.entrySignature === signature) return;
    context.entrySignature = signature;
    var previousTop = nodes.feedViewport.scrollTop || 0;
    nodes.feedList.replaceChildren();
    items.forEach(function (item, index) {
      var row = element('li', 'prediction-feed-row' + (item.isMine ? ' prediction-feed-mine' : ''));
      var number = element('span', 'prediction-feed-number', String(index + 1).padStart(2, '0'));
      var identity = element('div', 'prediction-feed-person');
      var name = element('strong', 'prediction-feed-name', '@' + item.username);
      var detail = element('span', 'prediction-feed-detail', item.isMine ? accepting(context, data) ? 'Your prediction' : 'Your locked prediction' : item.verified ? 'Twitch prediction' : 'Earlier unverified entry');
      var amount = element('strong', 'prediction-feed-amount', money(item.amountMinor, context.hunt.currency));
      append(identity, name, detail); append(row, number, identity, amount); nodes.feedList.appendChild(row);
    });
    nodes.feedEmpty.hidden = items.length > 0;
    nodes.feedList.hidden = items.length === 0;
    nodes.feedViewport.scrollTop = previousTop;
    context.scroller.position = nodes.feedViewport.scrollTop;
    syncScroll(context);
  }

  function settled(state) {
    if (!current || current.state !== state || !active(current)) return;
    update(current);
    if (state.needsRefresh && !state.saving && !state.loading && !state.signingOut) { state.needsRefresh = false; load(current); }
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
    dispose(context); context.entrySignature = null;
    mount.classList.add('hunt-predictions'); mount.setAttribute('aria-labelledby', 'predictions-title');
    mount.replaceChildren();

    var heading = element('div', 'prediction-heading');
    var headingText = element('div');
    var kicker = element('span', 'eyebrow', 'END BALANCE PREDICTIONS');
    var title = element('h2', '', 'What will the hunt finish at?'); title.id = 'predictions-title';
    nodes.huntName = element('p', 'prediction-hunt-name', 'For ' + context.hunt.title);
    append(headingText, kicker, title, nodes.huntName);
    nodes.badge = element('span', 'prediction-badge', 'Loading');
    append(heading, headingText, nodes.badge);

    var content = element('div', 'prediction-content');
    var entry = element('div', 'prediction-entry');
    nodes.intro = element('p', 'prediction-intro', 'Predict the final end balance. You can change your guess until predictions close.');
    nodes.auth = element('div', 'prediction-auth');
    nodes.loginPrompt = element('div', 'prediction-login-prompt');
    nodes.login = element('a', 'prediction-twitch-login', 'Log in with Twitch');
    nodes.loginUnavailable = element('button', 'prediction-twitch-login', 'Log in with Twitch'); nodes.loginUnavailable.type = 'button'; nodes.loginUnavailable.disabled = true;
    nodes.loginNote = element('p', 'prediction-auth-note', 'Use your Twitch account to enter. One prediction per account for each hunt.');
    append(nodes.loginPrompt, nodes.login, nodes.loginUnavailable, nodes.loginNote);
    nodes.account = element('div', 'prediction-account');
    var accountText = element('div'); nodes.accountLabel = element('span', 'prediction-account-label', 'Signed in with Twitch'); nodes.accountName = element('strong', 'prediction-account-name');
    append(accountText, nodes.accountLabel, nodes.accountName);
    nodes.logout = element('button', 'prediction-signout', 'Sign out'); nodes.logout.type = 'button';
    append(nodes.account, accountText, nodes.logout); append(nodes.auth, nodes.loginPrompt, nodes.account);
    nodes.form = element('form', 'prediction-form'); nodes.form.noValidate = true;
    var amount = makeInput('prediction-amount', 'Final end balance (' + context.hunt.currency + ')', { name: 'amount', inputmode: 'decimal', maxlength: '13', placeholder: '0.00' });
    nodes.amount = amount.input; nodes.amountLabel = amount.label; nodes.amount.value = state.draft.amount;
    var hidden = element('div', 'prediction-honeypot'); hidden.setAttribute('aria-hidden', 'true');
    var hiddenLabel = element('label', '', 'Website'); hiddenLabel.htmlFor = 'prediction-website';
    nodes.website = element('input'); nodes.website.id = 'prediction-website'; nodes.website.name = 'website'; nodes.website.type = 'text'; nodes.website.tabIndex = -1; nodes.website.autocomplete = 'off'; nodes.website.value = state.draft.website;
    append(hidden, hiddenLabel, nodes.website);
    nodes.submit = element('button', 'prediction-submit', 'Submit prediction'); nodes.submit.type = 'submit';
    nodes.cancel = element('button', 'prediction-cancel', 'Cancel'); nodes.cancel.type = 'button'; nodes.cancel.hidden = true;
    var formActions = element('div', 'prediction-form-actions'); append(formActions, nodes.submit, nodes.cancel);
    var rules = element('p', 'prediction-rules', 'One prediction per Twitch account for this hunt. Your latest saved guess appears in the public list. Free to enter.');
    rules.id = 'prediction-rules'; nodes.form.setAttribute('aria-describedby', rules.id);
    append(nodes.form, amount.wrapper, hidden, formActions, rules);
    nodes.mine = element('div', 'prediction-mine'); nodes.mine.hidden = true;
    nodes.mineTitle = element('span', 'prediction-mine-label', 'Your locked prediction');
    nodes.mineAmount = element('strong'); nodes.mineName = element('span', 'prediction-mine-name');
    nodes.mineNote = element('span', 'prediction-mine-note', 'Saved · cannot be changed');
    nodes.edit = element('button', 'prediction-edit', 'Change prediction'); nodes.edit.type = 'button';
    append(nodes.mine, nodes.mineTitle, nodes.mineAmount, nodes.mineName, nodes.mineNote, nodes.edit);
    nodes.closed = element('p', 'prediction-closed'); nodes.closed.hidden = true;
    nodes.message = element('p', 'prediction-message'); nodes.message.id = 'prediction-message'; nodes.message.setAttribute('role', 'status'); nodes.message.setAttribute('aria-live', 'polite');
    append(entry, nodes.intro, nodes.auth, nodes.mine, nodes.form, nodes.closed, nodes.message);

    var standings = element('div', 'prediction-standings');
    var standingsHeader = element('div', 'prediction-standings-heading');
    nodes.count = element('span', 'prediction-count', 'Loading predictions…');
    nodes.refresh = element('button', 'prediction-refresh', 'Refresh predictions'); nodes.refresh.type = 'button';
    append(standingsHeader, nodes.count, nodes.refresh);
    var feed = element('section', 'prediction-feed'); feed.setAttribute('aria-labelledby', 'prediction-feed-title');
    var feedHeading = element('div', 'prediction-feed-heading');
    var feedTitle = element('h3', '', 'Every prediction'); feedTitle.id = 'prediction-feed-title';
    nodes.scrollToggle = element('button', 'prediction-scroll-toggle', 'Pause scrolling'); nodes.scrollToggle.type = 'button'; nodes.scrollToggle.hidden = true;
    append(feedHeading, feedTitle, nodes.scrollToggle);
    nodes.feedViewport = element('div', 'prediction-feed-viewport'); nodes.feedViewport.tabIndex = 0;
    nodes.feedViewport.setAttribute('role', 'region'); nodes.feedViewport.setAttribute('aria-label', 'All predictions, in entry order. Scroll to browse.');
    nodes.feedList = element('ol', 'prediction-feed-list');
    nodes.feedEmpty = element('div', 'prediction-feed-empty');
    append(nodes.feedEmpty, element('strong', '', 'The first guess starts it.'), element('span', '', 'Saved predictions will appear here as viewers enter.'));
    append(nodes.feedViewport, nodes.feedList, nodes.feedEmpty); append(feed, feedHeading, nodes.feedViewport);
    var results = element('section', 'prediction-results');
    results.setAttribute('aria-labelledby', 'prediction-podium-title'); results.setAttribute('data-hunt-id', context.hunt.id);
    var resultsHeading = element('div', 'prediction-results-heading');
    var podiumTitle = element('h2', '', 'Prediction podium'); podiumTitle.id = 'prediction-podium-title';
    nodes.podiumHunt = element('p', 'prediction-podium-hunt', 'For ' + context.hunt.title);
    append(resultsHeading, podiumTitle, nodes.podiumHunt);
    var podium = element('ol', 'prediction-podium'); podium.setAttribute('aria-label', 'Prediction podium');
    nodes.places = places.map(function (place, index) {
      var card = element('li', 'prediction-place prediction-place-' + (index + 1));
      card.setAttribute('value', index + 1);
      var rank = element('span', 'prediction-rank', place);
      var name = element('strong', 'prediction-winner-name', 'To be decided');
      var guess = element('span', 'prediction-winner-guess'); guess.hidden = true;
      var difference = element('span', 'prediction-winner-difference'); difference.hidden = true;
      var details = element('div', 'prediction-place-content'); append(details, rank, name, guess, difference);
      var pedestal = element('div', 'prediction-pedestal');
      var placeNumber = element('span', 'prediction-place-number', String(index + 1)); placeNumber.setAttribute('aria-hidden', 'true');
      pedestal.appendChild(placeNumber); append(card, details, pedestal);
      return { card: card, name: name, guess: guess, difference: difference };
    });
    // Keep result lookup in rank order while the podium places the winner in the center.
    [1, 0, 2].forEach(function (index) { podium.appendChild(nodes.places[index].card); });
    nodes.podiumNote = element('p', 'prediction-podium-note', 'The closest guesses appear here once the hunt is finished. Ties go to the guess saved first; editing resets that time.');
    append(results, resultsHeading, podium, nodes.podiumNote);
    append(standings, standingsHeader, feed);
    var panel = element('section', 'prediction-panel'); panel.setAttribute('aria-labelledby', 'predictions-title');
    append(content, entry, standings); append(panel, heading, content); append(mount, results, panel);
    context.nodes = nodes;
    context.scroller = { timer: null, lastTick: null, position: 0, paused: false, hovered: false, focused: false };
    context.inViewport = typeof window.IntersectionObserver !== 'function';
    if (typeof window.ResizeObserver === 'function') {
      context.resizeObserver = new window.ResizeObserver(function () { syncScroll(context); });
      context.resizeObserver.observe(nodes.feedViewport); context.resizeObserver.observe(nodes.feedList);
    }
    if (typeof window.IntersectionObserver === 'function') {
      context.intersectionObserver = new window.IntersectionObserver(function (observations) {
        if (!active(context)) return;
        var visible = observations.some(function (observation) { return observation.isIntersecting; });
        if (visible === context.inViewport) return;
        context.inViewport = visible;
        if (visible) { syncScroll(context); scheduleRefresh(context); }
        else { stopScroll(context); stopRefresh(context); }
      });
      context.intersectionObserver.observe(mount);
    }
    nodes.scrollToggle.addEventListener('click', function () { context.scroller.paused = !context.scroller.paused; context.scroller.position = nodes.feedViewport.scrollTop; syncScroll(context); });
    nodes.feedViewport.addEventListener('mouseenter', function () { context.scroller.hovered = true; stopScroll(context); });
    nodes.feedViewport.addEventListener('mouseleave', function () { context.scroller.hovered = false; context.scroller.position = nodes.feedViewport.scrollTop; syncScroll(context); });
    nodes.feedViewport.addEventListener('focusin', function () { context.scroller.focused = true; stopScroll(context); });
    nodes.feedViewport.addEventListener('focusout', function (event) { context.scroller.focused = !!event.relatedTarget && nodes.feedViewport.contains(event.relatedTarget); syncScroll(context); });
    ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(function (eventName) {
      nodes.feedViewport.addEventListener(eventName, function () { context.scroller.paused = true; context.scroller.position = nodes.feedViewport.scrollTop; syncScroll(context); });
    });

    [nodes.amount, nodes.website].forEach(function (input) {
      input.addEventListener('input', function () {
        state.draft[input.name] = input.value;
        if (input === nodes.amount) { state.dirty = true; saveDraft(context); stopRefresh(context); }
        input.removeAttribute('aria-invalid');
        if (!state.saving && !state.pending) { state.error = ''; update(context); }
      });
    });
    nodes.form.addEventListener('submit', function (event) { event.preventDefault(); submit(context); });
    nodes.refresh.addEventListener('click', function () { if (!state.saving) load(context); });
    nodes.logout.addEventListener('click', function () { signOut(context); });
    nodes.edit.addEventListener('click', function () {
      var mine = state.summary && state.summary.mine;
      if (!mine || !revision(mine.revision) || !accepting(context, state.summary) || state.loading || state.saving || state.signingOut || state.pending) return;
      state.editing = true; state.dirty = false; state.editRevision = mine.revision; state.error = ''; state.notice = '';
      state.draft.amount = (mine.amountMinor / 100).toFixed(2); nodes.amount.value = state.draft.amount;
      saveDraft(context); stopRefresh(context); update(context); nodes.amount.focus();
    });
    nodes.cancel.addEventListener('click', function () {
      if (!state.editing || state.saving || state.pending) return;
      state.editing = false; state.dirty = false; state.editRevision = null; state.draft.amount = ''; nodes.amount.value = '';
      state.error = ''; state.notice = ''; clearDraft(context.hunt.id); update(context); scheduleRefresh(context); nodes.edit.focus();
    });
    update(context);
  }

  function update(context) {
    if (!active(context)) return;
    var nodes = context.nodes, state = context.state, data = state.summary;
    var complete = context.hunt.status === 'complete' || !!data && data.status === 'complete';
    var isOpen = accepting(context, data);
    var mine = data && data.mine, viewer = data && data.viewer;
    var locked = state.loading || state.saving || state.signingOut;
    nodes.badge.textContent = !data ? state.error ? 'Unavailable' : 'Loading' : complete ? 'Finished' : isOpen ? 'Open' : 'Closed';
    nodes.badge.dataset.state = !data ? 'loading' : complete ? 'complete' : isOpen ? 'open' : 'locked';
    nodes.amountLabel.textContent = 'Final end balance (' + context.hunt.currency + ')';
    nodes.huntName.textContent = 'For ' + context.hunt.title;
    nodes.podiumHunt.textContent = 'For ' + context.hunt.title;
    nodes.form.hidden = !isOpen || !viewer || !data.authConfigured || !!mine && !state.editing;
    nodes.intro.textContent = complete ? 'The closest predictions to the final end balance take the top three places.' : isOpen ? 'Predict the final end balance. You can change your guess until predictions close.' : 'Predictions are closed for this hunt.';
    nodes.amount.disabled = nodes.website.disabled = locked || !!state.pending;
    var href = data && data.authConfigured && loginHref(data.loginUrl);
    nodes.auth.hidden = !data || (!viewer && !isOpen);
    nodes.account.hidden = !viewer;
    nodes.loginPrompt.hidden = !!viewer;
    nodes.login.hidden = !href;
    nodes.loginUnavailable.hidden = !!href;
    if (href) nodes.login.setAttribute('href', href); else nodes.login.removeAttribute('href');
    nodes.loginNote.textContent = data && data.authConfigured ? 'Use your Twitch account to enter. One prediction per account for each hunt.' : 'Twitch sign-in is being connected. Please check back soon.';
    nodes.accountName.textContent = viewer ? '@' + viewer.login : '';
    nodes.logout.disabled = locked;
    nodes.logout.textContent = state.signingOut ? 'Signing out…' : 'Sign out';
    nodes.submit.disabled = locked;
    nodes.submit.textContent = state.saving ? 'Saving prediction…' : state.pending ? 'Retry prediction' : state.editing ? 'Save changes' : 'Submit prediction';
    nodes.cancel.hidden = !state.editing; nodes.cancel.disabled = locked || !!state.pending;
    nodes.refresh.disabled = locked;
    nodes.count.textContent = data ? data.count + (data.count === 1 ? ' prediction' : ' predictions') : state.loading ? 'Loading predictions…' : 'Predictions unavailable';
    nodes.mine.hidden = !mine;
    if (mine) {
      nodes.mineTitle.textContent = isOpen ? 'Your prediction' : 'Your locked prediction';
      nodes.mineAmount.textContent = money(mine.amountMinor, context.hunt.currency);
      nodes.mineName.textContent = '@' + mine.username + ' · Saved for this hunt';
      nodes.mineNote.textContent = isOpen ? 'Saved · editable until predictions close' : 'Predictions closed · final guess locked';
    }
    nodes.edit.hidden = !mine || !isOpen || state.editing || !revision(mine.revision);
    nodes.edit.disabled = locked || !!state.pending;
    nodes.closed.hidden = !data || isOpen || !!mine;
    nodes.closed.textContent = complete ? 'Predictions are closed. The final podium is shown here.' : data && data.message ? data.message : 'Predictions are closed for this hunt. Check back for the final podium.';
    nodes.message.textContent = state.error || state.notice || state.authMessage || (!data && state.loading ? 'Loading predictions…' : '');
    nodes.message.dataset.state = state.error ? 'error' : state.notice ? 'success' : state.authMessage ? 'info' : 'loading';
    nodes.places.forEach(function (place, index) {
      var winner = complete && data && Array.isArray(data.podium) && data.podium.find(function (entry) { return entry.place === index + 1; });
      place.name.textContent = winner ? '@' + winner.username : complete ? 'No entry' : 'To be decided';
      place.guess.hidden = place.difference.hidden = !winner;
      place.guess.textContent = winner ? money(winner.amountMinor, context.hunt.currency) : '';
      place.difference.textContent = winner ? winner.differenceMinor === 0 ? 'Exact prediction' : money(winner.differenceMinor, context.hunt.currency) + ' away' : '';
    });
    nodes.podiumNote.textContent = complete ? 'Ranked by distance from the final end balance. Ties go to the guess saved first; editing resets that time.' : 'The closest guesses appear here once the hunt is finished. Ties go to the guess saved first; editing resets that time.';
    updateEntries(context, data);
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
      if (data.huntId !== (method === 'GET' ? payload : payload.huntId) || !validWindowId(data.windowId) || typeof data.accepting !== 'boolean' || !Number.isSafeInteger(data.count) || data.count < 0
          || typeof data.authConfigured !== 'boolean' || !validViewer(data.viewer)
          || data.mine !== null && (!data.mine || !revision(data.mine.revision) || typeof data.mine.username !== 'string' || !/^[a-z0-9_]{1,25}$/.test(data.mine.username)
            || !Number.isSafeInteger(data.mine.amountMinor) || data.mine.amountMinor < 0 || data.mine.amountMinor > 100000000000)
          || !Array.isArray(data.entries) || data.entries.length > 2000 || data.entries.some(function (item) {
            return !item || typeof item.username !== 'string' || !/^[A-Za-z0-9_]{1,25}$/.test(item.username) || !Number.isSafeInteger(item.amountMinor)
              || item.amountMinor < 0 || item.amountMinor > 100000000000 || typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt))
              || typeof item.isMine !== 'boolean' || typeof item.verified !== 'boolean';
          })) throw new Error('Predictions could not be confirmed. Please refresh predictions.');
      return data;
    } finally { clearTimeout(timeout); controllers.delete(controller); }
  }

  function apply(state, data) {
    if (state.epoch !== privacyEpoch) return false;
    var context = current && current.state === state ? current : null;
    if (context && windowId(context) !== null && windowId(context) !== data.windowId) return false;
    var previousViewer = state.summary && state.summary.viewer;
    state.summary = data;
    if (data.viewer) state.authMessage = '';
    if (state.pending && state.pending.windowId !== data.windowId) {
      state.pending = null; state.editing = false; state.editRevision = null;
      state.dirty = !!state.draft.amount; state.notice = '';
    }
    var open = current && current.state === state ? accepting(current, data) : data.accepting;
    if (!open) {
      state.pending = null; state.editing = false; state.editRevision = null;
    }
    if (!data.viewer || previousViewer && previousViewer.id !== data.viewer.id || state.pending && state.pending.viewerId !== data.viewer.id) {
      state.pending = null; state.editing = false; state.editRevision = null; state.dirty = false;
    }
    if (state.pending && data.mine && data.mine.revision === state.pending.requestId) {
      state.pending = null; state.editing = false; state.editRevision = null; state.dirty = false;
    }
    if (open && data.viewer && data.mine && state.dirty && state.draft.amount && !state.editing && !state.pending) {
      state.editing = true; state.editRevision = data.mine.revision;
    }
    if (data.mine && !state.editing && !state.pending && !state.dirty) clearDraft(data.huntId);
    if (current && current.state === state) scheduleAuth(data);
    return true;
  }

  function reset(preserveDrafts) {
    privacyEpoch++;
    dispose(current);
    clearTimeout(authTimer); authTimer = null; authDue = null;
    controllers.forEach(function (controller) { controller.abort(); }); controllers.clear();
    if (!preserveDrafts) entries.forEach(function (_, id) { clearDraft(id); });
    entries.clear();
  }

  function signedOut(context, message) {
    var visible = current && active(current) ? current : null;
    if (visible) saveDraft(visible);
    reset(true);
    if (!visible) { current = null; return; }
    var previous = visible.state.summary;
    visible.state = stateFor(visible.hunt.id);
    if (previous) visible.state.summary = Object.assign({}, previous, { viewer: null, mine: null, entries: (previous.entries || []).map(function (item) { return Object.assign({}, item, { isMine: false }); }) });
    visible.state.error = message || '';
    build(visible);
  }

  async function signOut(context) {
    if (!active(context) || context.state.loading || context.state.saving || context.state.signingOut) return;
    var state = context.state, epoch = privacyEpoch;
    state.signingOut = true; state.error = ''; update(context);
    var controller = new AbortController(), timeout = setTimeout(function () { controller.abort(); }, 15000);
    controllers.add(controller);
    try {
      var response = await fetch(AUTH + '?action=logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Thorshall-Request': 'twitch-session' }, body: '{}' });
      var data = await response.json();
      if (epoch !== privacyEpoch) return;
      if (!response.ok || !data.ok) throw new Error('Could not sign out. Please try again.');
      signedOut(context);
      if (current && active(current)) load(current);
    } catch (error) {
      if (epoch === privacyEpoch) { state.error = error.message || 'Could not sign out. Please try again.'; update(context); }
    } finally {
      clearTimeout(timeout); controllers.delete(controller); state.signingOut = false; settled(state);
    }
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
    stopRefresh(context);
    if (context.state.loading || context.state.saving || context.state.signingOut) { context.state.needsRefresh = true; return; }
    var state = context.state, request = ++state.request, windowEpoch = state.windowEpoch;
    state.loading = true; state.error = ''; update(context);
    try {
      var data = await api('GET', context.hunt.id);
      if (request !== state.request || windowEpoch !== state.windowEpoch) return;
      apply(state, data);
    } catch (error) {
      if (error.status === 401) { signedOut(context, 'Your Twitch sign-in expired. Log in again to submit your prediction.'); return; }
      if (error.status === 403) { deny(context, error.message); return; }
      if (!error.discard && state.epoch === privacyEpoch && request === state.request && windowEpoch === state.windowEpoch) state.error = error.message || 'Predictions are temporarily unavailable. Please try again.';
    } finally {
      if (request === state.request) state.loading = false;
      settled(state);
      if (active(context) && context.state === state && state.epoch === privacyEpoch && state.summary) scheduleRefresh(context);
    }
  }

  async function submit(context) {
    var state = context.state, nodes = context.nodes;
    if (!active(context) || state.loading || state.saving || state.signingOut || !state.summary || !state.summary.viewer || !state.summary.authConfigured || !accepting(context, state.summary) || state.summary.mine && !state.editing && !state.pending) return;
    state.error = ''; state.notice = ''; state.authMessage = '';
    if (!state.pending) {
      var amount = nodes.amount.value.trim();
      if (!/^(0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(amount) || Number(amount) > 1000000000) {
        state.error = 'Enter an end balance from 0 to 1,000,000,000 using at most two decimal places.';
        nodes.amount.setAttribute('aria-invalid', 'true'); update(context); nodes.amount.focus(); return;
      }
      try { state.pending = { huntId: context.hunt.id, windowId: state.summary.windowId, requestId: requestId(), viewerId: state.summary.viewer.id, expectedRevision: state.editing ? state.editRevision : null, amount: amount, website: nodes.website.value }; }
      catch (error) { state.error = error.message; update(context); return; }
    }
    var payload = state.pending, windowEpoch = state.windowEpoch;
    state.saving = true; update(context);
    try {
      var data = await api('POST', payload);
      if (windowEpoch !== state.windowEpoch) return;
      if (!apply(state, data)) return;
      state.pending = null; state.editing = false; state.editRevision = null; state.dirty = false; state.draft.amount = ''; nodes.amount.value = ''; clearDraft(context.hunt.id);
      state.notice = data.duplicate && data.mine && data.mine.revision !== payload.requestId ? 'Your latest saved prediction is shown.' : payload.expectedRevision ? 'Your prediction is updated.' : 'Your prediction is saved. Good luck!';
    } catch (error) {
      if (error.discard || state.epoch !== privacyEpoch) return;
      if (error.status === 401) { signedOut(context, 'Your Twitch sign-in expired. Log in again to submit your prediction.'); return; }
      if (error.status === 403) { deny(context, error.message); return; }
      if (windowEpoch !== state.windowEpoch) return;
      if ([400, 403, 404, 409, 422, 429].includes(error.status)) state.pending = null;
      state.error = error.status ? error.message : 'The save could not be confirmed. Retry to safely submit the same prediction.';
      if (error.status === 409 || error.status === 404) {
        try {
          var latest = await api('GET', context.hunt.id);
          if (windowEpoch !== state.windowEpoch || !apply(state, latest)) return;
          if (latest.mine && accepting(context, latest)) {
            state.error = ''; state.editing = true; state.editRevision = latest.mine.revision; state.dirty = true;
            state.notice = 'This hunt has a saved prediction from another session. Review your amount, then save changes.';
          } else if (latest.mine) { state.error = ''; state.notice = 'Predictions closed. Your last accepted guess is shown.'; }
        } catch (refreshError) { if (refreshError.status === 403) deny(context, refreshError.message); }
      }
    } finally {
      state.saving = false;
      settled(state);
      if (active(context) && context.state === state) scheduleRefresh(context);
    }
  }

  document.addEventListener('hunt:view', function (event) {
    var detail = event.detail, hunt = detail && detail.hunt, mount = document.getElementById('hunt-predictions');
    if (!mount || !hunt || typeof hunt.id !== 'string' || !['USD', 'EUR', 'GBP', 'CAD', 'AUD'].includes(hunt.currency)) return;
    var predictionWindow = detail.predictionWindow && typeof detail.predictionWindow.accepting === 'boolean' ? detail.predictionWindow : null;
    var signature = [hunt.id, hunt.status, hunt.currency, detail.activeId, predictionWindow ? predictionWindow.windowId || '0' : '', predictionWindow ? predictionWindow.closedAt || '' : '', predictionWindow ? predictionWindow.accepting : '', hunt.status === 'complete' ? detail.revision : ''].join('|');
    if (current && current.mount === mount && current.hunt.id === hunt.id) {
      var changed = current.signature !== signature;
      if (changed) {
        current.state.windowEpoch++;
        if (windowId(current) !== (predictionWindow ? validWindowId(predictionWindow.windowId) ? predictionWindow.windowId.toLowerCase() : '0' : null)) {
          // An unconfirmed retry from the previous collection window must never
          // be replayed in a reopened window. Keep the amount for explicit review.
          current.state.pending = null; current.state.editing = false; current.state.editRevision = null;
          current.state.dirty = !!current.state.draft.amount;
          current.state.error = ''; current.state.notice = '';
        }
      }
      current.hunt = hunt; current.activeId = detail.activeId; current.predictionWindow = predictionWindow; current.signature = signature;
      update(current);
      if (changed) load(current);
      return;
    }
    dispose(current);
    current = { mount: mount, hunt: hunt, activeId: detail.activeId, predictionWindow: predictionWindow, signature: signature, generation: ++generation, state: stateFor(hunt.id) };
    if (callbackMessage) { current.state.authMessage = callbackMessage; callbackMessage = ''; }
    build(current); load(current);
  });

  document.addEventListener('hunt:unavailable', function () {
    reset();
    if (current) current.mount.replaceChildren();
    current = null;
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { clearTimeout(authTimer); authTimer = null; stopScroll(current); stopRefresh(current); return; }
    if (current && active(current)) { syncScroll(current); scheduleRefresh(current); }
    if (authDue !== null && current && active(current)) {
      if (Date.now() >= authDue) refreshAuth();
      else scheduleAuth(current.state.summary);
    }
  });
  if (motionQuery && typeof motionQuery.addEventListener === 'function') motionQuery.addEventListener('change', function () { if (current && active(current)) syncScroll(current); });
})();
