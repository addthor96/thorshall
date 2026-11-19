'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../hunt-predictions.js'), 'utf8');
const clone = value => structuredClone(value);
const viewer = { id: '123456', login: 'thor_viewer', displayName: 'Thor_Viewer' };
const summary = (huntId = 'hunt-a', extra = {}) => ({ ok: true, huntId, currency: 'USD', status: 'collecting', accepting: true, count: 0, mine: null, podium: [], viewer: clone(viewer), authConfigured: true, loginUrl: '/.netlify/functions/hunt-twitch?action=login&return=%2Fbonus-hunt%23hunt%3D' + huntId, logoutUrl: '/.netlify/functions/hunt-twitch?action=logout', authExpiresAt: null, authRevalidateAt: null, ...extra });
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => clone(data) });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

async function start(handler, options = {}) {
  const events = new Map(), calls = [], timers = new Map(), storage = new Map(); let timerId = 0, uuid = 0, clock = Date.now();
  class TestDate extends Date { static now() { return clock; } }
  class Node {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.listeners = new Map(); this.className = ''; this.textContent = ''; this.value = ''; this.disabled = false; this.hidden = false; this.dataset = {}; this.id = ''; this.name = ''; this.classList = { add: name => { this.className += (this.className ? ' ' : '') + name; } }; }
    appendChild(child) { this.children.push(child); child.parent = this; return child; }
    replaceChildren(...children) { this.children = []; children.forEach(child => this.appendChild(child)); }
    setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'id') this.id = String(value); }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(name, fn) { this.listeners.set(name, fn); }
    focus() { document.activeElement = this; }
    fire(name) { return this.listeners.get(name)?.({ preventDefault() {} }); }
  }
  const mount = new Node('section'); mount.id = 'hunt-predictions';
  const all = node => [node, ...node.children.flatMap(all)];
  const document = { activeElement: null, hidden: false, createElement: tag => new Node(tag), getElementById: id => all(mount).find(node => node.id === id) || null, addEventListener: (name, fn) => events.set(name, fn) };
  const context = { document, window: { crypto: { randomUUID: () => '00000000-0000-4000-8000-' + String(++uuid).padStart(12, '0') } }, Intl, Map, Set, AbortController, Uint8Array, URL, URLSearchParams, Date: TestDate, location: { origin: 'https://thorshall.test', search: options.search || '' }, sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => {
      const call = { url, method: options.method, credentials: options.credentials, headers: clone(options.headers), body: options.body ? JSON.parse(options.body) : undefined, signal: options.signal }; calls.push(call);
      return handler ? handler(call, calls.length) : response(summary(new URL(url, 'https://test').searchParams.get('hunt') || call.body.huntId));
    }
  };
  vm.runInNewContext(source, context);
  const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };
  const view = async (id = 'hunt-a', status = 'collecting', revision = 'v1', activeId = 'hunt-a') => { events.get('hunt:view')({ detail: { hunt: { id, title: id, status, currency: 'USD' }, activeId, revision } }); await settle(); };
  const byClass = name => all(mount).filter(node => node.className.split(' ').includes(name));
  const node = id => document.getElementById(id);
  const input = (id, value) => { node(id).value = value; node(id).fire('input'); };
  const submit = async () => { byClass('prediction-form')[0].fire('submit'); await settle(); };
  return { mount, node, byClass, events, calls, settle, view, input, submit, document, timers, advance: ms => { clock += ms; }, storage, text: () => all(mount).map(node => node.textContent).join(' ') };
}

test('collecting hunt revisions preserve drafts and do not add a prediction polling loop', async () => {
  const app = await start(); await app.view();
  assert.equal(app.calls.length, 1); assert.equal(app.calls[0].credentials, 'same-origin');
  const amount = app.node('prediction-amount'); app.input(amount.id, '1234.50'); amount.focus(); await app.view('hunt-a', 'collecting', 'v2');
  assert.equal(app.calls.length, 1); assert.equal(app.node(amount.id), amount); assert.equal(app.document.activeElement, amount); assert.equal(amount.value, '1234.50'); assert.equal(app.node('prediction-username'), null);
  assert.equal(app.byClass('prediction-place').length, 3); assert.match(app.text(), /1st place.*2nd place.*3rd place/); assert.doesNotMatch(app.text(), /\$[0-9]/);
});

test('valid entry posts the free prediction and shows the confirmed saved entry', async () => {
  const app = await start(call => call.method === 'GET' ? response(summary()) : response(summary('hunt-a', { count: 1, mine: { username: viewer.login, amountMinor: 123450, createdAt: '2026-11-19T01:00:00.000Z' } }), 201));
  await app.view(); app.input('prediction-amount', '1234.50'); await app.submit();
  const call = app.calls[1]; assert.equal(call.method, 'POST'); assert.equal(call.headers['X-Thorshall-Request'], 'hunt-prediction');
  assert.equal(call.body.username, undefined); assert.equal(call.body.viewerId, viewer.id); assert.equal(call.body.amount, '1234.50'); assert.equal(call.body.website, ''); assert.match(call.body.requestId, /^[0-9a-f-]{36}$/);
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
    return response(summary('hunt-a', { count: 1, mine: { username: call.body.username, amountMinor: 2500 } }));
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
  assert.equal(app.calls.length, 3); assert.match(app.text(), /@original_user · Saved for this hunt/); assert.match(app.text(), /already saved/); assert.doesNotMatch(app.text(), /@new_user · Saved/);
});

test('opening locks the form immediately and a busy save is followed by one status refresh', async () => {
  const post = deferred(); let opened = false;
  const app = await start(call => call.method === 'POST' ? post.promise : response(summary('hunt-a', opened ? { status: 'opening', accepting: false, count: 1, mine: { username: 'thor_viewer', amountMinor: 2500 } } : {})));
  await app.view(); app.input('prediction-amount', '25');
  app.byClass('prediction-form')[0].fire('submit'); await app.settle(); opened = true; await app.view('hunt-a', 'opening', 'v2');
  assert.equal(app.byClass('prediction-form')[0].hidden, true);
  post.resolve(response(summary('hunt-a', { mine: { username: 'thor_viewer', amountMinor: 2500 }, count: 1 })));
  await app.settle(); assert.equal(app.calls.filter(call => call.method === 'GET').length, 2); assert.equal(app.byClass('prediction-badge')[0].textContent, 'Locked');
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
  const app = await start(() => response(summary('hunt-a', { status: 'complete', accepting: false, count: 2, podium: [{ place: 1, username: '<img src=x>', amountMinor: 15000, differenceMinor: 0 }, { place: 2, username: 'second_user', amountMinor: 15500, differenceMinor: 500 }] })));
  await app.view('hunt-a', 'complete'); assert.equal(app.byClass('prediction-form')[0].hidden, true); assert.equal(app.byClass('prediction-winner-name')[0].textContent, '@<img src=x>');
  assert.equal(app.byClass('prediction-place')[0].children.some(node => node.tagName === 'IMG'), false); assert.match(app.text(), /Exact prediction/);
  await app.view('hunt-a', 'complete'); assert.equal(app.calls.length, 1); await app.view('hunt-a', 'complete', 'v2'); assert.equal(app.calls.length, 2);
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
  assert.equal(app.timers.size, 0);
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
  assert.equal(app.timers.size, 1);
  assert.equal(Array.from(app.timers.values())[0].ms > 54 * 60000, true);
  await app.view('hunt-a', 'collecting', 'v2'); assert.equal(app.calls.length, 1);
  app.document.hidden = true; app.events.get('visibilitychange')(); assert.equal(app.timers.size, 0);
  app.advance(56 * 60000); app.document.hidden = false; app.events.get('visibilitychange')(); await app.settle();
  assert.equal(app.calls.length, 2); assert.equal(app.timers.size, 1);
  app.events.get('hunt:unavailable')(); assert.equal(app.timers.size, 0);
});

test('OAuth return messages use only known safe statuses and disappear with private access', async () => {
  const messages = { cancelled: /sign-in was cancelled/, failed: /could not be completed/, expired: /sign-in link expired/, unavailable: /temporarily unavailable/ };
  for (const [status, expected] of Object.entries(messages)) {
    const app = await start(() => response(summary('hunt-a', { viewer: null })), { search: '?twitch=' + status + '&error_description=private_raw_error&code=secret' });
    await app.view(); assert.match(app.text(), expected); assert.doesNotMatch(app.text(), /private_raw_error|secret/);
    app.events.get('hunt:unavailable')(); await app.view(); assert.doesNotMatch(app.text(), expected);
  }
  const unknown = await start(() => response(summary('hunt-a', { viewer: null })), { search: '?twitch=%3Cimg%20src%3Dx%3E&error_description=raw_error' });
  await unknown.view(); assert.doesNotMatch(unknown.text(), /<img|raw_error/);
});
