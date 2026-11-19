'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../hunt-predictions.js'), 'utf8');
const clone = value => structuredClone(value);
const viewer = { id: '123456', login: 'thor_viewer', displayName: 'Thor_Viewer' };
const MINE_REVISION = '11111111-1111-4111-8111-111111111111';
const REOPENED_WINDOW = '99999999-9999-4999-8999-999999999999';
const summary = (huntId = 'hunt-a', extra = {}) => {
  const value = { ok: true, huntId, windowId: '0', currency: 'USD', status: 'collecting', accepting: true, count: 0, mine: null, podium: [], entries: [], viewer: clone(viewer), authConfigured: true, loginUrl: '/.netlify/functions/hunt-twitch?action=login&return=%2Fbonus-hunt%23hunt%3D' + huntId, logoutUrl: '/.netlify/functions/hunt-twitch?action=logout', authExpiresAt: null, authRevalidateAt: null, ...extra };
  if (value.mine) value.mine = { username: viewer.login, createdAt: '2026-11-19T01:00:00.000Z', updatedAt: '2026-11-19T01:00:00.000Z', revision: MINE_REVISION, ...value.mine };
  return value;
};
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => clone(data) });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

async function start(handler, options = {}) {
  const events = new Map(), calls = [], timers = new Map(), storage = options.storage || new Map(); let timerId = 0, uuid = 0, clock = Date.now();
  class TestDate extends Date { static now() { return clock; } }
  class Node {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.listeners = new Map(); this.className = ''; this.textContent = ''; this.value = ''; this.disabled = false; this.hidden = false; this.dataset = {}; this.id = ''; this.name = ''; this.scrollTop = 0; this.scrollHeight = 256; this.clientHeight = 256; this.classList = { add: name => { this.className += (this.className ? ' ' : '') + name; } }; }
    appendChild(child) { this.children.push(child); child.parent = this; return child; }
    replaceChildren(...children) { this.children = []; children.forEach(child => this.appendChild(child)); }
    setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'id') this.id = String(value); }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(name, fn) { this.listeners.set(name, fn); }
    focus() { document.activeElement = this; }
    fire(name, extra = {}) { return this.listeners.get(name)?.({ preventDefault() {}, ...extra }); }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  }
  const mount = new Node('section'); mount.id = 'hunt-predictions';
  const all = node => [node, ...node.children.flatMap(all)];
  const document = { activeElement: null, hidden: false, createElement: tag => new Node(tag), getElementById: id => all(mount).find(node => node.id === id) || null, addEventListener: (name, fn) => events.set(name, fn) };
  const observers = [], motion = { matches: !!options.reducedMotion, addEventListener: (name, fn) => { motion.change = fn; } };
  const initialUrl = new URL(options.href || 'https://thorshall.test/bonus-hunt' + (options.search || '') + (options.hash || ''));
  const pageLocation = { href: initialUrl.href, origin: options.locationOrigin || initialUrl.origin, pathname: initialUrl.pathname, search: initialUrl.search, hash: initialUrl.hash };
  const historyCalls = [], historyState = { view: 'test' };
  const browser = { crypto: { randomUUID: () => '00000000-0000-4000-8000-' + String(++uuid).padStart(12, '0') }, matchMedia: () => motion };
  if (!options.noHistory) browser.history = { state: historyState, replaceState(state, title, url) {
    if (options.historyThrows) throw new Error('History is restricted');
    historyCalls.push({ state, title, url });
    const next = new URL(url, pageLocation.href);
    Object.assign(pageLocation, { href: next.href, pathname: next.pathname, search: next.search, hash: next.hash });
  } };
  if (options.observers) browser.IntersectionObserver = class { constructor(fn) { this.fn = fn; this.disconnected = false; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } fire(visible) { this.fn([{ isIntersecting: visible }]); } };
  const context = { document, window: browser, Intl, Map, Set, AbortController, Uint8Array, URL, URLSearchParams, Date: TestDate, location: pageLocation, sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => {
      const call = { url, method: options.method, credentials: options.credentials, headers: clone(options.headers), body: options.body ? JSON.parse(options.body) : undefined, signal: options.signal }; calls.push(call);
      return handler ? handler(call, calls.length) : response(summary(new URL(url, 'https://test').searchParams.get('hunt') || call.body.huntId));
    }
  };
  vm.runInNewContext(source, context);
  const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };
  const view = async (id = 'hunt-a', status = 'collecting', revision = 'v1', activeId = 'hunt-a', predictionWindow) => { events.get('hunt:view')({ detail: { hunt: { id, title: id, status, currency: 'USD' }, activeId, revision, predictionWindow } }); await settle(); };
  const byClass = name => all(mount).filter(node => node.className.split(' ').includes(name));
  const node = id => document.getElementById(id);
  const input = (id, value) => { node(id).value = value; node(id).fire('input'); };
  const submit = async () => { byClass('prediction-form')[0].fire('submit'); await settle(); };
  const tick = async ms => { const selected = [...timers].find(([, timer]) => timer.ms === ms); assert.ok(selected, 'Expected a ' + ms + 'ms timer'); timers.delete(selected[0]); clock += ms; selected[1].fn(); await settle(); };
  return { mount, node, byClass, events, calls, settle, view, input, submit, document, timers, observers, motion, tick, advance: ms => { clock += ms; }, storage, location: pageLocation, historyCalls, historyState, text: () => all(mount).map(node => node.textContent).join(' ') };
}

test('collecting hunt revisions preserve drafts and keep a single moderate refresh timer', async () => {
  const app = await start(); await app.view();
  assert.equal(app.calls.length, 1); assert.equal(app.calls[0].credentials, 'same-origin');
  const amount = app.node('prediction-amount'); app.input(amount.id, '1234.50'); amount.focus(); await app.view('hunt-a', 'collecting', 'v2');
  assert.equal(app.calls.length, 1); assert.equal(app.node(amount.id), amount); assert.equal(app.document.activeElement, amount); assert.equal(amount.value, '1234.50'); assert.equal(app.node('prediction-username'), null);
  assert.equal(app.byClass('prediction-place').length, 3); assert.match(app.text(), /2nd place.*1st place.*3rd place/); assert.doesNotMatch(app.text(), /\$[0-9]/);
  assert.deepEqual(app.mount.children.map(node => node.className), ['prediction-results', 'prediction-panel']);
  assert.deepEqual(app.byClass('prediction-place').map(node => node.attributes.value), ['2', '1', '3']);
  assert.equal(app.byClass('prediction-podium-hunt')[0].textContent, 'For hunt-a');
  assert.deepEqual([...app.timers.values()].map(timer => timer.ms), []);
});

test('valid entry posts the free prediction and shows the confirmed saved entry', async () => {
  const app = await start(call => call.method === 'GET' ? response(summary()) : response(summary('hunt-a', { count: 1, mine: { username: viewer.login, amountMinor: 123450, createdAt: '2026-11-19T01:00:00.000Z' } }), 201));
  await app.view(); app.input('prediction-amount', '1234.50'); await app.submit();
  const call = app.calls[1]; assert.equal(call.method, 'POST'); assert.equal(call.headers['X-Thorshall-Request'], 'hunt-prediction');
  assert.equal(call.body.username, undefined); assert.equal(call.body.viewerId, viewer.id); assert.equal(call.body.amount, '1234.50'); assert.equal(call.body.website, ''); assert.match(call.body.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(call.body.expectedRevision, null);
  assert.equal(call.body.windowId, '0');
  assert.equal(app.byClass('prediction-form')[0].hidden, true); assert.match(app.text(), /\$1,234\.50.*@thor_viewer · Saved for this hunt/); assert.match(app.text(), /Your prediction is saved/);
});

test('invalid fractional cents cannot submit', async () => {
  const app = await start(); await app.view(); app.input('prediction-amount', '20.001'); await app.submit();
  assert.equal(app.calls.length, 1); assert.equal(app.node('prediction-amount').attributes['aria-invalid'], 'true');
});

test('an unconfirmed save retries the identical payload and request ID', async () => {
  let posts = 0;
  const app = await start(call => {
    if (call.method === 'GET') return response(summary());
    if (++posts === 1) throw new Error('Offline');
    return response(summary('hunt-a', { count: 1, mine: { username: viewer.login, amountMinor: 2500, revision: call.body.requestId } }));
  });
  await app.view(); app.input('prediction-amount', '25'); await app.submit();
  assert.equal(app.node('prediction-amount').disabled, true); assert.equal(app.byClass('prediction-submit')[0].textContent, 'Retry prediction');
  await app.submit();
  assert.deepEqual(app.calls.filter(call => call.method === 'POST').map(call => call.body), [app.calls[1].body, app.calls[1].body]);
  assert.match(app.text(), /Your prediction is saved/);
});

test('a duplicate response refreshes the existing entry instead of claiming a second save', async () => {
  let reads = 0;
  const app = await start(call => call.method === 'GET' ? response(summary('hunt-a', ++reads === 1 ? {} : { count: 1, mine: { username: 'original_user', amountMinor: 9900 } })) : response({ ok: false, error: 'One entry per browser.' }, 409));
  await app.view(); app.input('prediction-amount', '25'); await app.submit();
  assert.equal(app.calls.length, 3); assert.match(app.text(), /@original_user · Saved for this hunt/); assert.match(app.text(), /another session.*Review your amount/); assert.doesNotMatch(app.text(), /@new_user · Saved/);
});

test('owner closure locks the form immediately and a busy save is followed by one status refresh', async () => {
  const post = deferred(); let opened = false;
  const app = await start(call => call.method === 'POST' ? post.promise : response(summary('hunt-a', opened ? { status: 'opening', accepting: false, count: 1, mine: { username: 'thor_viewer', amountMinor: 2500 } } : {})));
  await app.view(); app.input('prediction-amount', '25');
  app.byClass('prediction-form')[0].fire('submit'); await app.settle(); opened = true; await app.view('hunt-a', 'opening', 'v2', 'hunt-a', { accepting: false, closedAt: '2026-11-19T02:00:00.000Z' });
  assert.equal(app.byClass('prediction-form')[0].hidden, true);
  post.resolve(response(summary('hunt-a', { mine: { username: 'thor_viewer', amountMinor: 2500 }, count: 1 })));
  await app.settle(); assert.equal(app.calls.filter(call => call.method === 'GET').length, 2); assert.equal(app.byClass('prediction-badge')[0].textContent, 'Closed');
});

test('switching hunts ignores stale display results and restores each hunt draft', async () => {
  const wait = deferred();
  const app = await start(call => call.url.includes('hunt=hunt-b') ? wait.promise : response(summary()));
  await app.view(); app.input('prediction-amount', '350');
  await app.view('hunt-b', 'complete', 'v1'); await app.view('hunt-a');
  wait.resolve(response(summary('hunt-b', { status: 'complete', accepting: false, count: 1, podium: [{ place: 1, username: 'other_hunt', amountMinor: 70000, differenceMinor: 1 }] })));
  await app.settle(); assert.equal(app.node('prediction-amount').value, '350'); assert.doesNotMatch(app.text(), /other_hunt/);
});

test('completed results render safe text and refresh only when the final revision changes', async () => {
  let empty = false;
  const app = await start(() => response(summary('hunt-a', { status: 'complete', accepting: false, count: empty ? 0 : 2, podium: empty ? [] : [{ place: 1, username: '<img src=x>', amountMinor: 15000, differenceMinor: 0 }, { place: 2, username: 'second_user', amountMinor: 15500, differenceMinor: 500 }] })));
  await app.view('hunt-a', 'complete'); assert.equal(app.byClass('prediction-form')[0].hidden, true);
  assert.deepEqual(app.byClass('prediction-winner-name').map(node => node.textContent), ['@second_user', '@<img src=x>', 'No entry']);
  const winner = app.byClass('prediction-place-1')[0];
  const winnerDetails = winner.children[0];
  assert.equal(winnerDetails.children.some(node => node.tagName === 'IMG'), false); assert.match(app.text(), /Exact prediction/);
  assert.equal(winnerDetails.children[2].textContent, '$150.00'); assert.equal(winnerDetails.children[3].textContent, 'Exact prediction');
  assert.equal(app.byClass('prediction-place-3')[0].children[0].children[2].hidden, true);
  await app.view('hunt-a', 'complete'); assert.equal(app.calls.length, 1); await app.view('hunt-a', 'complete', 'v2'); assert.equal(app.calls.length, 2);
  empty = true; await app.view('hunt-a', 'complete', 'v3');
  assert.deepEqual(app.byClass('prediction-winner-name').map(node => node.textContent), ['No entry', 'No entry', 'No entry']);
  assert.ok(app.byClass('prediction-winner-guess').every(node => node.hidden)); assert.ok(app.byClass('prediction-winner-difference').every(node => node.hidden));
});

test('privacy loss discards cached names, drafts and delayed responses', async () => {
  const wait = deferred(); let delay = false;
  const app = await start(() => delay ? wait.promise : response(summary()));
  await app.view(); app.input('prediction-amount', '45'); delay = true; app.byClass('prediction-refresh')[0].fire('click'); await app.settle();
  app.events.get('hunt:unavailable')({ detail: null }); assert.equal(app.mount.children.length, 0);
  wait.resolve(response(summary('hunt-a', { count: 1, mine: { username: 'private_result', amountMinor: 5000 } }))); await app.settle(); assert.equal(app.mount.children.length, 0);
  delay = false; await app.view(); assert.equal(app.node('prediction-amount').value, ''); assert.doesNotMatch(app.text(), /private_result|private_draft/);
});

test('a forbidden refresh clears a previously displayed podium immediately', async () => {
  let forbidden = false;
  const app = await start(() => forbidden ? response({ ok: false, error: 'This hunt is private.' }, 403) : response(summary('hunt-a', { status: 'complete', accepting: false, count: 1, podium: [{ place: 1, username: 'visible_then_private', amountMinor: 2000, differenceMinor: 100 }] })));
  await app.view('hunt-a', 'complete'); assert.match(app.text(), /visible_then_private/);
  forbidden = true; app.byClass('prediction-refresh')[0].fire('click'); await app.settle();
  assert.doesNotMatch(app.text(), /visible_then_private/); assert.match(app.text(), /This hunt is private/); assert.equal(app.byClass('prediction-form')[0].hidden, true);
});

test('a delayed forbidden response also clears the currently selected other hunt', async () => {
  const wait = deferred(); let delay = false;
  const app = await start(call => call.url.includes('hunt=hunt-a') ? delay ? wait.promise : response(summary()) : response(summary('hunt-b', { status: 'complete', accepting: false, count: 1, podium: [{ place: 1, username: 'current_private_name', amountMinor: 5000, differenceMinor: 0 }] })));
  await app.view(); delay = true; app.byClass('prediction-refresh')[0].fire('click'); await app.settle();
  await app.view('hunt-b', 'complete'); assert.match(app.text(), /current_private_name/);
  wait.resolve(response({ ok: false, error: 'This hunt is private.' }, 403)); await app.settle();
  assert.doesNotMatch(app.text(), /current_private_name/); assert.match(app.text(), /This hunt is private/); assert.equal(app.byClass('prediction-refresh')[0].disabled, false);
});

test('anonymous visitors see Twitch login and cannot post a manually named prediction', async () => {
  const app = await start(() => response(summary('hunt-a', { viewer: null })));
  await app.view();
  assert.equal(app.byClass('prediction-form')[0].hidden, true);
  assert.equal(app.byClass('prediction-twitch-login')[0].hidden, false);
  assert.match(app.byClass('prediction-twitch-login')[0].attributes.href, /^\/\.netlify\/functions\/hunt-twitch\?action=login/);
  assert.equal(app.node('prediction-username'), null);
  await app.submit(); assert.equal(app.calls.length, 1);
  assert.deepEqual([...app.timers.values()].map(timer => timer.ms), [60000]);
});

test('unconfigured Twitch login fails closed with a clear disabled prompt', async () => {
  const app = await start(() => response(summary('hunt-a', { viewer: null, authConfigured: false, loginUrl: null })));
  await app.view();
  assert.equal(app.byClass('prediction-form')[0].hidden, true);
  assert.equal(app.byClass('prediction-twitch-login')[0].hidden, true);
  assert.equal(app.byClass('prediction-twitch-login')[1].disabled, true);
  assert.match(app.text(), /Twitch sign-in is being connected/);
});

test('login links reject remote, javascript, and unrelated same-origin destinations', async () => {
  for (const loginUrl of ['https://attacker.test/login', 'javascript:alert(1)', '/admin?action=login', '/.netlify/functions/hunt-twitch?action=callback', '/.netlify/functions/hunt-twitch?action=login&token=secret']) {
    const app = await start(() => response(summary('hunt-a', { viewer: null, loginUrl })));
    await app.view();
    assert.equal(app.byClass('prediction-twitch-login')[0].hidden, true);
    assert.equal(app.byClass('prediction-twitch-login')[0].attributes.href, undefined);
  }
});

test('expired Twitch identity hides the form and keeps only the amount draft for login return', async () => {
  let loggedIn = true;
  const app = await start(call => call.method === 'GET' ? response(summary('hunt-a', { viewer: loggedIn ? viewer : null })) : response({ ok: false, error: 'Twitch sign-in required.' }, 401));
  await app.view(); app.input('prediction-amount', '678.90'); await app.submit();
  assert.equal(app.byClass('prediction-form')[0].hidden, true);
  assert.equal(app.byClass('prediction-account')[0].hidden, true);
  assert.equal(app.byClass('prediction-twitch-login')[0].hidden, false);
  assert.equal(app.node('prediction-amount').value, '678.90');
  assert.match(app.text(), /Your Twitch sign-in expired/);
  assert.equal(app.storage.size, 1);
  assert.equal(app.calls[1].body.username, undefined);
});

test('sign out uses the dedicated endpoint and clears saved account data in every hunt view', async () => {
  let loggedIn = true;
  const app = await start(call => {
    if (call.url.includes('action=logout')) { loggedIn = false; return response({ ok: true }); }
    return response(summary('hunt-a', loggedIn ? { count: 1, mine: { username: viewer.login, amountMinor: 9500 } } : { viewer: null }));
  });
  await app.view(); assert.match(app.text(), /@thor_viewer · Saved for this hunt/);
  app.byClass('prediction-signout')[0].fire('click'); await app.settle();
  const logout = app.calls.find(call => call.url.includes('action=logout'));
  assert.equal(logout.url, '/.netlify/functions/hunt-twitch?action=logout');
  assert.equal(logout.method, 'POST'); assert.equal(logout.credentials, 'same-origin');
  assert.equal(logout.headers['X-Thorshall-Request'], 'twitch-session');
  assert.deepEqual(logout.body, {});
  assert.doesNotMatch(app.text(), /@thor_viewer · Saved for this hunt/);
  assert.equal(app.byClass('prediction-twitch-login')[0].hidden, false);
});

test('Twitch revalidation uses one server deadline, pauses hidden, and refreshes on return', async () => {
  const base = Date.now(); let reads = 0;
  const app = await start(() => response(summary('hunt-a', { authRevalidateAt: new Date(base + (++reads) * 55 * 60000).toISOString() })));
  await app.view();
  assert.equal(app.timers.size, 2);
  assert.equal(Array.from(app.timers.values()).some(timer => timer.ms > 54 * 60000), true);
  await app.view('hunt-a', 'collecting', 'v2'); assert.equal(app.calls.length, 1);
  app.document.hidden = true; app.events.get('visibilitychange')(); assert.equal(app.timers.size, 0);
  app.advance(56 * 60000); app.document.hidden = false; app.events.get('visibilitychange')(); await app.settle();
  assert.equal(app.calls.length, 2); assert.equal(app.timers.size, 2);
  app.events.get('hunt:unavailable')(); assert.equal(app.timers.size, 0);
});

test('OAuth return messages use only known safe statuses and disappear with private access', async () => {
  const messages = { cancelled: /sign-in was cancelled/, failed: /could not be completed/, expired: /sign-in link expired/, unavailable: /temporarily unavailable/ };
  for (const [status, expected] of Object.entries(messages)) {
    const app = await start(() => response(summary('hunt-a', { viewer: null })), { search: '?twitch=' + status + '&error_description=private_raw_error&code=secret' });
    assert.equal(app.location.search, '');
    await app.view(); assert.match(app.text(), expected); assert.doesNotMatch(app.text(), /private_raw_error|secret/);
    app.events.get('hunt:unavailable')(); await app.view(); assert.doesNotMatch(app.text(), expected);
  }
  const unknown = await start(() => response(summary('hunt-a', { viewer: null })), { search: '?twitch=%3Cimg%20src%3Dx%3E&error_description=raw_error' });
  await unknown.view(); assert.doesNotMatch(unknown.text(), /<img|raw_error/);
  assert.equal(new URL(unknown.location.href).searchParams.get('twitch'), '<img src=x>');
});

test('OAuth callback details are removed before rendering while the source and selected hunt survive', async () => {
  const app = await start(null, { search: '?src=telegram&action=callback&code=temporary_code&state=temporary_state&scope=&error=provider_error&error_description=private_error&twitch=connected', hash: '#hunt=hunt-b' });
  assert.equal(app.location.href, 'https://thorshall.test/bonus-hunt?src=telegram#hunt=hunt-b');
  assert.equal(app.calls.length, 0);
  assert.deepEqual(app.historyCalls, [{ state: app.historyState, title: '', url: '/bonus-hunt?src=telegram#hunt=hunt-b' }]);
  await app.view('hunt-b');
  assert.doesNotMatch(app.text(), /temporary_code|temporary_state|private_error|provider_error|connected/);
  assert.equal(new URL(app.calls[0].url, app.location.origin).searchParams.get('hunt'), 'hunt-b');
});

test('URL cleanup removes known markers only and leaves unrelated query values intact', async () => {
  const app = await start(null, { search: '?src=youtube&src=telegram&twitch=connected&twitch=unknown&custom=keep%20this', hash: '#hunt=hunt-a' });
  const cleaned = new URL(app.location.href);
  assert.deepEqual(cleaned.searchParams.getAll('src'), ['youtube', 'telegram']);
  assert.deepEqual(cleaned.searchParams.getAll('twitch'), ['unknown']);
  assert.equal(cleaned.searchParams.get('custom'), 'keep this');
  assert.equal(cleaned.hash, '#hunt=hunt-a');
  const unchanged = await start(null, { search: '?src=youtube&twitch=unknown', hash: '#hunt=hunt-a' });
  assert.equal(unchanged.historyCalls.length, 0);
});

test('restricted or unavailable history does not interrupt prediction loading or safe return messages', async () => {
  for (const limitation of [{ noHistory: true }, { historyThrows: true }]) {
    const app = await start(() => response(summary('hunt-a', { viewer: null })), { ...limitation, search: '?twitch=expired&code=private_callback', hash: '#hunt=hunt-a' });
    await app.view();
    assert.equal(app.calls.length, 1);
    assert.match(app.text(), /sign-in link expired/);
    assert.doesNotMatch(app.text(), /private_callback/);
    assert.equal(app.historyCalls.length, 0);
  }
});

test('URL cleanup never replaces history for a foreign origin or a non-HTTP page', async () => {
  for (const options of [{ href: 'https://foreign.test/bonus-hunt?code=private', locationOrigin: 'https://thorshall.test' }, { href: 'file:///bonus-hunt?code=private' }]) {
    const app = await start(null, options);
    await app.view();
    assert.equal(app.historyCalls.length, 0);
    assert.equal(app.calls.length, 1);
    assert.doesNotMatch(app.text(), /private/);
  }
});

const publicEntries = (length = 18) => Array.from({ length }, (_, index) => ({ username: index === 2 ? viewer.login : 'viewer_' + index, amountMinor: 50000 + index * 1250, createdAt: new Date(Date.UTC(2026, 10, 19, 1, 0, index)).toISOString(), verified: index !== 1, isMine: index === 2 }));

test('all public predictions render while the owner amount remains separately saved and editable', async () => {
  const entries = publicEntries();
  const app = await start(() => response(summary('hunt-a', { entries, count: entries.length, mine: { username: viewer.login, amountMinor: entries[2].amountMinor } })));
  await app.view();
  assert.equal(app.byClass('prediction-feed-row').length, 18);
  assert.equal(app.byClass('prediction-feed-mine').length, 1);
  assert.equal(app.byClass('prediction-mine')[0].hidden, false);
  assert.match(app.text(), /Your prediction.*\$525\.00.*@thor_viewer.*Saved · editable until predictions close/);
  assert.equal(app.byClass('prediction-edit')[0].hidden, false);
  assert.match(app.byClass('prediction-feed-row')[1].children[1].children[1].textContent, /Earlier unverified entry/);
  assert.equal(app.byClass('prediction-form')[0].hidden, true);
  assert.equal(app.byClass('prediction-feed-viewport')[0].attributes['aria-live'], undefined);
});

test('prediction scroll only travels down, resets at the bottom and rests for two seconds', async () => {
  const entries = publicEntries(); const app = await start(() => response(summary('hunt-a', { entries, count: entries.length })));
  await app.view();
  const viewport = app.byClass('prediction-feed-viewport')[0], toggle = app.byClass('prediction-scroll-toggle')[0];
  viewport.scrollHeight = 512; toggle.fire('click'); toggle.fire('click');
  await app.tick(2000); await app.tick(50); const first = viewport.scrollTop;
  await app.tick(50); assert.equal(viewport.scrollTop > first, true); assert.equal(app.calls.length, 1);
  viewport.scrollHeight = 300; viewport.scrollTop = 42;
  toggle.fire('click'); toggle.fire('click'); await app.tick(2000); await app.tick(50);
  assert.equal(viewport.scrollTop, 0);
  assert.equal([...app.timers.values()].some(timer => timer.ms === 2000), true);
  assert.equal(app.calls.length, 1);
});

test('hover, focus and manual interaction pause motion without hiding predictions', async () => {
  const entries = publicEntries(); const app = await start(() => response(summary('hunt-a', { entries, count: entries.length })));
  await app.view();
  const viewport = app.byClass('prediction-feed-viewport')[0], toggle = app.byClass('prediction-scroll-toggle')[0];
  viewport.scrollHeight = 512; toggle.fire('click'); toggle.fire('click');
  viewport.fire('mouseenter'); assert.deepEqual([...app.timers.values()].map(timer => timer.ms), [60000]);
  viewport.fire('mouseleave'); assert.equal([...app.timers.values()].some(timer => timer.ms === 2000), true);
  viewport.fire('focusin'); assert.deepEqual([...app.timers.values()].map(timer => timer.ms), [60000]);
  viewport.fire('focusout', { relatedTarget: null }); viewport.fire('wheel');
  assert.equal(toggle.textContent, 'Resume scrolling'); assert.equal(toggle.attributes['aria-pressed'], 'true');
  assert.deepEqual([...app.timers.values()].map(timer => timer.ms), [60000]);
  assert.equal(app.byClass('prediction-feed-row').length, 18);
});

test('reduced motion leaves a manually scrollable list without automatic movement', async () => {
  const entries = publicEntries(); const app = await start(() => response(summary('hunt-a', { entries, count: entries.length })), { reducedMotion: true });
  await app.view();
  const viewport = app.byClass('prediction-feed-viewport')[0], toggle = app.byClass('prediction-scroll-toggle')[0];
  viewport.scrollHeight = 512; toggle.fire('click'); toggle.fire('click');
  assert.equal(toggle.hidden, true); assert.equal(viewport.tabIndex, 0);
  assert.deepEqual([...app.timers.values()].map(timer => timer.ms), [60000]);
  assert.equal(app.byClass('prediction-feed-row').length, 18);
});

test('automatic refresh is limited to one minute, pauses offscreen and hidden, and stops for completed hunts', async () => {
  const app = await start(null, { observers: true }); await app.view();
  assert.equal(app.timers.size, 0); app.observers[0].fire(true);
  assert.deepEqual([...app.timers.values()].map(timer => timer.ms), [60000]);
  await app.tick(60000); assert.equal(app.calls.length, 2);
  app.observers[0].fire(false); assert.equal(app.timers.size, 0);
  app.observers[0].fire(true); app.document.hidden = true; app.events.get('visibilitychange')(); assert.equal(app.timers.size, 0);
  app.document.hidden = false; app.events.get('visibilitychange')(); assert.equal(app.timers.size, 1);
  await app.view('hunt-b', 'complete'); assert.equal(app.observers[0].disconnected, true); app.observers[1].fire(true);
  assert.equal(app.timers.size, 0);
});

test('switching hunts and loss of public access discard scrolling and refresh timers', async () => {
  let forbidden = false; const entries = publicEntries();
  const app = await start(call => forbidden ? response({ ok: false, error: 'This hunt is private.' }, 403) : response(summary(new URL(call.url, 'https://test').searchParams.get('hunt'), { entries, count: entries.length })), { observers: true });
  await app.view(); app.observers[0].fire(true);
  let viewport = app.byClass('prediction-feed-viewport')[0], toggle = app.byClass('prediction-scroll-toggle')[0];
  viewport.scrollHeight = 512; toggle.fire('click'); toggle.fire('click'); assert.equal(app.timers.size, 2);
  await app.view('hunt-b'); assert.equal(app.observers[0].disconnected, true); assert.equal(app.timers.size, 0);
  app.observers[1].fire(true); assert.equal(app.timers.size, 1);
  forbidden = true; app.byClass('prediction-refresh')[0].fire('click'); await app.settle();
  app.observers.at(-1).fire(true);
  assert.equal(app.timers.size, 0); assert.equal(app.byClass('prediction-feed-row').length, 0);
  app.events.get('hunt:unavailable')(); assert.equal(app.mount.children.length, 0); assert.equal(app.timers.size, 0);
});

test('signout immediately clears own-row attribution even when the public refresh then fails', async () => {
  let signedOut = false; const entries = publicEntries();
  const app = await start(call => {
    if (call.url.includes('action=logout')) { signedOut = true; return response({ ok: true }); }
    if (signedOut) throw new Error('Offline');
    return response(summary('hunt-a', { entries, count: entries.length, mine: { username: viewer.login, amountMinor: entries[2].amountMinor } }));
  });
  await app.view(); assert.equal(app.byClass('prediction-feed-mine').length, 1);
  app.byClass('prediction-signout')[0].fire('click'); await app.settle();
  assert.equal(app.byClass('prediction-feed-mine').length, 0);
  assert.equal(app.byClass('prediction-mine')[0].hidden, true);
  assert.equal(app.byClass('prediction-feed-row').length, 18);
});

test('malformed public entry data cannot be displayed as a valid roster', async () => {
  const entries = publicEntries(1); entries[0].username = '<img src=x>';
  const app = await start(() => response(summary('hunt-a', { entries, count: 1 })));
  await app.view(); assert.equal(app.byClass('prediction-feed-row').length, 0);
  assert.match(app.text(), /Predictions could not be confirmed/);
  assert.doesNotMatch(app.text(), /<img/);
});

test('a saved prediction can be changed during collection and uses its own current revision', async () => {
  let saved = { username: viewer.login, amountMinor: 10000, revision: MINE_REVISION };
  const app = await start(call => {
    if (call.method === 'POST') saved = { ...saved, amountMinor: Math.round(Number(call.body.amount) * 100), revision: call.body.requestId };
    return response(summary('hunt-a', { mine: saved, count: 1, entries: [{ username: viewer.login, amountMinor: saved.amountMinor, createdAt: '2026-11-19T01:00:00.000Z', isMine: true, verified: true }] }));
  });
  await app.view('hunt-a', 'collecting', 'v1', 'hunt-a', { windowId: '0', accepting: true, closedAt: null });
  assert.equal(app.byClass('prediction-edit')[0].hidden, false);
  app.byClass('prediction-edit')[0].fire('click');
  assert.equal(app.node('prediction-amount').value, '100.00');
  assert.equal(app.byClass('prediction-mine')[0].hidden, false);
  assert.equal(app.byClass('prediction-form')[0].hidden, false);
  assert.equal(app.byClass('prediction-submit')[0].textContent, 'Save changes');
  assert.equal(app.timers.size, 0);
  app.input('prediction-amount', '222.22'); await app.submit();
  const post = app.calls.find(call => call.method === 'POST');
  assert.equal(post.body.expectedRevision, MINE_REVISION); assert.equal(post.body.huntId, 'hunt-a');
  assert.equal(post.body.viewerId, viewer.id); assert.equal(post.body.amount, '222.22');
  assert.equal(app.byClass('prediction-form')[0].hidden, true);
  assert.equal(app.byClass('prediction-feed-row').length, 1);
  assert.equal(app.byClass('prediction-mine')[0].children[1].textContent, '$222.22');
  assert.equal(app.byClass('prediction-edit')[0].hidden, false);
  assert.match(app.text(), /Your prediction is updated/);
  assert.match(app.text(), /Ties go to the guess saved first; editing resets that time/);
});

test('canceling an edit preserves the accepted amount and resumes moderate refresh', async () => {
  const app = await start(() => response(summary('hunt-a', { mine: { amountMinor: 15000 }, count: 1 })));
  await app.view(); app.byClass('prediction-edit')[0].fire('click'); app.input('prediction-amount', '987.65');
  app.byClass('prediction-cancel')[0].fire('click'); await app.settle();
  assert.equal(app.calls.length, 1); assert.equal(app.byClass('prediction-form')[0].hidden, true);
  assert.equal(app.byClass('prediction-mine')[0].children[1].textContent, '$150.00');
  assert.equal(app.storage.size, 0); assert.equal(app.document.activeElement, app.byClass('prediction-edit')[0]);
  assert.deepEqual([...app.timers.values()].map(timer => timer.ms), [60000]);
});

test('a stale edit refreshes the saved amount but keeps the draft for explicit review and resubmission', async () => {
  const newerRevision = '22222222-2222-4222-8222-222222222222'; let reads = 0, posts = 0;
  const app = await start(call => {
    if (call.method === 'GET') return response(summary('hunt-a', { count: 1, mine: { amountMinor: ++reads === 1 ? 10000 : 50000, revision: reads === 1 ? MINE_REVISION : newerRevision } }));
    if (++posts === 1) return response({ ok: false, error: 'Your prediction changed in another session.' }, 409);
    return response(summary('hunt-a', { count: 1, mine: { amountMinor: 77700, revision: call.body.requestId } }));
  });
  await app.view(); app.byClass('prediction-edit')[0].fire('click'); app.input('prediction-amount', '777'); await app.submit();
  assert.equal(posts, 1); assert.equal(app.node('prediction-amount').value, '777');
  assert.equal(app.byClass('prediction-form')[0].hidden, false);
  assert.equal(app.byClass('prediction-mine')[0].children[1].textContent, '$500.00');
  assert.match(app.text(), /another session.*Review your amount/); assert.equal(app.timers.size, 0);
  await app.submit();
  assert.equal(posts, 2); assert.equal(app.calls.filter(call => call.method === 'POST')[1].body.expectedRevision, newerRevision);
  assert.equal(app.byClass('prediction-mine')[0].children[1].textContent, '$777.00');
});

test('an unconfirmed edit retries the exact amount and revision without permitting a cancel', async () => {
  let posts = 0;
  const app = await start(call => {
    if (call.method === 'GET') return response(summary('hunt-a', { count: 1, mine: { amountMinor: 10000 } }));
    if (++posts === 1) throw new Error('Offline');
    return response(summary('hunt-a', { count: 1, mine: { amountMinor: 44400, revision: call.body.requestId } }));
  });
  await app.view(); app.byClass('prediction-edit')[0].fire('click'); app.input('prediction-amount', '444'); await app.submit();
  assert.equal(app.byClass('prediction-cancel')[0].disabled, true); assert.equal(app.node('prediction-amount').disabled, true);
  assert.equal(app.byClass('prediction-mine')[0].children[1].textContent, '$100.00');
  app.byClass('prediction-cancel')[0].fire('click'); assert.equal(app.byClass('prediction-form')[0].hidden, false);
  await app.submit(); const payloads = app.calls.filter(call => call.method === 'POST').map(call => call.body);
  assert.deepEqual(payloads[0], payloads[1]); assert.equal(payloads[0].expectedRevision, MINE_REVISION);
  assert.equal(app.byClass('prediction-mine')[0].children[1].textContent, '$444.00');
});

test('a manual per-hunt closure hides edit controls even if a delayed summary still says open', async () => {
  const wait = deferred(); let reads = 0;
  const app = await start(() => ++reads === 1 ? response(summary('hunt-a', { count: 1, mine: { amountMinor: 25000 } })) : wait.promise);
  await app.view(); app.byClass('prediction-edit')[0].fire('click'); app.input('prediction-amount', '999');
  await app.view('hunt-a', 'opening', 'v2', 'hunt-a', { accepting: false, closedAt: '2026-11-19T02:00:00.000Z' });
  assert.equal(app.byClass('prediction-form')[0].hidden, true); assert.equal(app.byClass('prediction-edit')[0].hidden, true);
  assert.equal(app.byClass('prediction-badge')[0].textContent, 'Closed');
  wait.resolve(response(summary('hunt-a', { status: 'opening', count: 1, mine: { amountMinor: 25000 } }))); await app.settle();
  assert.equal(app.byClass('prediction-form')[0].hidden, true); assert.equal(app.byClass('prediction-edit')[0].hidden, true);
  assert.match(app.text(), /Your locked prediction.*\$250\.00.*final guess locked/);
  await app.submit(); assert.equal(app.calls.filter(call => call.method === 'POST').length, 0);
});

test('opening always locks predictions even if an earlier summary still claims an open window', async () => {
  const app = await start(() => response(summary('hunt-a', { mine: { amountMinor: 25000 }, count: 1 })));
  await app.view('hunt-a', 'opening', 'v2', 'hunt-a', { windowId: '0', accepting: true, closedAt: null });
  assert.equal(app.byClass('prediction-form')[0].hidden, true);
  assert.equal(app.byClass('prediction-edit')[0].hidden, true);
  assert.equal(app.byClass('prediction-badge')[0].textContent, 'Closed');
  assert.match(app.text(), /Your locked prediction/);
  await app.submit(); assert.equal(app.calls.filter(call => call.method === 'POST').length, 0);
});

test('back to hunting unlocks the accepted prediction and ignores the prior closed-window response', async () => {
  const oldClosed = deferred(); let reads = 0;
  const app = await start(call => {
    if (call.method === 'POST') return response(summary('hunt-a', { windowId: REOPENED_WINDOW, mine: { amountMinor: 33300, revision: call.body.requestId }, count: 1 }));
    reads++;
    if (reads === 2) return oldClosed.promise;
    return response(summary('hunt-a', { windowId: reads === 1 ? '0' : REOPENED_WINDOW, mine: { amountMinor: 10000 }, count: 1 }));
  });
  await app.view('hunt-a', 'collecting', 'v1', 'hunt-a', { windowId: '0', accepting: true, closedAt: null });
  app.byClass('prediction-edit')[0].fire('click'); app.input('prediction-amount', '333');
  await app.view('hunt-a', 'opening', 'v2', 'hunt-a', { windowId: '0', accepting: false, closedAt: '2026-11-19T02:00:00.000Z' });
  assert.equal(app.byClass('prediction-form')[0].hidden, true);
  await app.view('hunt-a', 'collecting', 'v3', 'hunt-a', { windowId: REOPENED_WINDOW, accepting: true, closedAt: null });
  oldClosed.resolve(response(summary('hunt-a', { status: 'opening', accepting: false, mine: { amountMinor: 99000 }, count: 1 })));
  await app.settle();
  assert.equal(reads, 3);
  assert.equal(app.byClass('prediction-badge')[0].textContent, 'Open');
  assert.equal(app.byClass('prediction-mine')[0].children[1].textContent, '$100.00');
  assert.equal(app.byClass('prediction-form')[0].hidden, false);
  assert.equal(app.node('prediction-amount').value, '333');
  assert.equal(app.byClass('prediction-submit')[0].textContent, 'Save changes');
  await app.submit();
  const post = app.calls.find(call => call.method === 'POST');
  assert.equal(post.body.windowId, REOPENED_WINDOW);
  assert.equal(post.body.expectedRevision, MINE_REVISION);
  assert.equal(app.byClass('prediction-mine')[0].children[1].textContent, '$333.00');
});

test('an old-cycle save cannot overwrite the reopened accepted guess or be retried in the new window', async () => {
  const oldPost = deferred(); let reads = 0;
  const newerRevision = '22222222-2222-4222-8222-222222222222';
  const app = await start(call => {
    if (call.method === 'POST') return oldPost.promise;
    return response(summary('hunt-a', ++reads === 1 ? { mine: { amountMinor: 10000 }, count: 1 }
      : { windowId: REOPENED_WINDOW, mine: { amountMinor: 45000, revision: newerRevision }, count: 1 }));
  });
  await app.view('hunt-a', 'collecting', 'v1', 'hunt-a', { windowId: '0', accepting: true, closedAt: null });
  app.byClass('prediction-edit')[0].fire('click'); app.input('prediction-amount', '999');
  app.byClass('prediction-form')[0].fire('submit'); await app.settle();
  const oldPayload = app.calls.find(call => call.method === 'POST').body;
  await app.view('hunt-a', 'opening', 'v2', 'hunt-a', { windowId: '0', accepting: false, closedAt: '2026-11-19T02:00:00.000Z' });
  await app.view('hunt-a', 'collecting', 'v3', 'hunt-a', { windowId: REOPENED_WINDOW, accepting: true, closedAt: null });
  oldPost.resolve(response(summary('hunt-a', { mine: { amountMinor: 99900, revision: oldPayload.requestId }, count: 1 })));
  await app.settle();
  assert.equal(reads, 2);
  assert.equal(app.byClass('prediction-mine')[0].children[1].textContent, '$450.00');
  assert.equal(app.byClass('prediction-badge')[0].textContent, 'Open');
  assert.equal(app.byClass('prediction-submit')[0].textContent, 'Save changes');
  assert.equal(app.node('prediction-amount').value, '999');
  assert.doesNotMatch(app.text(), /Your prediction is updated/);
  assert.equal(app.calls.filter(call => call.method === 'POST').length, 1);
});

test('a reopened window refreshes the same collecting hunt and rejects a mismatched summary token', async () => {
  let reads = 0;
  const app = await start(() => response(summary('hunt-a', { windowId: ++reads < 3 ? '0' : REOPENED_WINDOW, mine: { amountMinor: 10000 }, count: 1 })));
  await app.view('hunt-a', 'collecting', 'v1', 'hunt-a', { windowId: '0', accepting: true, closedAt: null });
  await app.view('hunt-a', 'collecting', 'v2', 'hunt-a', { windowId: REOPENED_WINDOW, accepting: true, closedAt: null });
  assert.equal(reads, 2); assert.equal(app.byClass('prediction-edit')[0].hidden, true);
  app.byClass('prediction-refresh')[0].fire('click'); await app.settle();
  assert.equal(app.byClass('prediction-edit')[0].hidden, false);
  app.byClass('prediction-edit')[0].fire('click');
  assert.equal(app.node('prediction-amount').value, '100.00');
  assert.equal(app.byClass('prediction-form')[0].hidden, false);
});

test('missing or malformed prediction window tokens fail closed before a prediction can be sent', async () => {
  for (const windowId of [undefined, '', 'old-window', 1]) {
    const app = await start(() => response(summary('hunt-a', { windowId })));
    await app.view();
    assert.equal(app.byClass('prediction-form')[0].hidden, true);
    assert.match(app.text(), /Predictions could not be confirmed/);
    await app.submit();
    assert.equal(app.calls.filter(call => call.method === 'POST').length, 0);
  }
});

test('returning to a reopened hunt discards its earlier unconfirmed retry and keeps the amount for review', async () => {
  let reopened = false, posts = 0;
  const app = await start(call => {
    if (call.method === 'POST') {
      if (++posts === 1) throw new Error('Offline');
      return response(summary('hunt-a', { windowId: REOPENED_WINDOW, mine: { amountMinor: 77700, revision: call.body.requestId }, count: 1 }));
    }
    const huntId = new URL(call.url, 'https://test').searchParams.get('hunt');
    return response(summary(huntId, { windowId: huntId === 'hunt-a' && reopened ? REOPENED_WINDOW : '0', mine: { amountMinor: 10000 }, count: 1 }));
  });
  await app.view('hunt-a', 'collecting', 'v1', 'hunt-a', { windowId: '0', accepting: true, closedAt: null });
  app.byClass('prediction-edit')[0].fire('click'); app.input('prediction-amount', '777'); await app.submit();
  assert.equal(app.byClass('prediction-submit')[0].textContent, 'Retry prediction');
  await app.view('hunt-b', 'complete'); reopened = true;
  await app.view('hunt-a', 'collecting', 'v2', 'hunt-a', { windowId: REOPENED_WINDOW, accepting: true, closedAt: null });
  assert.equal(app.byClass('prediction-submit')[0].textContent, 'Save changes');
  assert.equal(app.node('prediction-amount').value, '777');
  assert.equal(app.node('prediction-amount').disabled, false);
  await app.submit();
  const payloads = app.calls.filter(call => call.method === 'POST').map(call => call.body);
  assert.equal(payloads[1].windowId, REOPENED_WINDOW);
  assert.notEqual(payloads[1].requestId, payloads[0].requestId);
  assert.equal(payloads[1].expectedRevision, MINE_REVISION);
});

test('editing drafts and operation revisions stay attached to the selected hunt', async () => {
  const app = await start(call => response(summary(new URL(call.url, 'https://test').searchParams.get('hunt') || call.body.huntId,
    call.method === 'GET' ? { mine: { amountMinor: call.url.includes('hunt-b') ? 20000 : 10000 }, count: 1 } : { mine: { amountMinor: 33300, revision: call.body.requestId }, count: 1 })));
  await app.view(); app.byClass('prediction-edit')[0].fire('click'); app.input('prediction-amount', '333');
  await app.view('hunt-b', 'opening', 'v1', 'hunt-b'); assert.match(app.byClass('prediction-hunt-name')[0].textContent, /hunt-b/);
  assert.equal(app.byClass('prediction-mine')[0].children[1].textContent, '$200.00');
  assert.equal(app.byClass('prediction-form')[0].hidden, true);
  await app.view('hunt-a'); assert.equal(app.node('prediction-amount').value, '333');
  assert.equal(app.byClass('prediction-form')[0].hidden, false); await app.submit();
  assert.equal(app.calls.find(call => call.method === 'POST').body.huntId, 'hunt-a');
});

test('ordinary hunt updates and manual refresh never replace a draft being edited', async () => {
  let saved = 10000;
  const app = await start(() => response(summary('hunt-a', { mine: { amountMinor: saved }, count: 1 })));
  await app.view(); app.byClass('prediction-edit')[0].fire('click'); app.input('prediction-amount', '123.45');
  await app.view('hunt-a', 'collecting', 'v2'); saved = 20000;
  app.byClass('prediction-refresh')[0].fire('click'); await app.settle();
  assert.equal(app.node('prediction-amount').value, '123.45');
  assert.equal(app.byClass('prediction-mine')[0].children[1].textContent, '$200.00');
  assert.equal(app.timers.size, 0);
});

test('an edited draft survives an expired sign-in and is restored after returning through Twitch', async () => {
  const saved = { mine: { amountMinor: 10000 }, count: 1 };
  const app = await start(call => call.method === 'GET' ? response(summary('hunt-a', saved)) : response({ ok: false, error: 'Sign in again.' }, 401));
  await app.view(); app.byClass('prediction-edit')[0].fire('click'); app.input('prediction-amount', '678.90'); await app.submit();
  assert.equal(app.byClass('prediction-form')[0].hidden, true); assert.equal(app.byClass('prediction-twitch-login')[0].hidden, false);
  assert.equal(app.storage.size, 1);
  const returned = await start(() => response(summary('hunt-a', saved)), { storage: app.storage }); await returned.view();
  assert.equal(returned.node('prediction-amount').value, '678.90');
  assert.equal(returned.byClass('prediction-form')[0].hidden, false);
  assert.equal(returned.byClass('prediction-submit')[0].textContent, 'Save changes');
  assert.equal(returned.byClass('prediction-mine')[0].children[1].textContent, '$100.00');
});
