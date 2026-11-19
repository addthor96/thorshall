"use strict";

const crypto = require("node:crypto");
const ENDPOINT = "/.netlify/functions/hunt-twitch";
const DEFAULT_REDIRECT = "https://thorshall.gg" + ENDPOINT + "?action=callback";
const SESSION_COOKIE = "thorshall_twitch_session";
const STATE_COOKIE = "thorshall_twitch_oauth";
const SESSION_MS = 8 * 60 * 60 * 1000;
const VALIDATE_MS = 55 * 60 * 1000;
const STATE_MS = 10 * 60 * 1000;
const LOGIN_LIMIT = 30;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/;
const USER_ID = /^[1-9]\d{0,19}$/;
const LOGIN = /^[a-z0-9_]{1,25}$/;
const HEADERS = {
  "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store, max-age=0",
  "CDN-Cache-Control": "no-store", "Netlify-CDN-Cache-Control": "no-store", "Vary": "Cookie",
  "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow, noarchive"
};

class AuthUnavailable extends Error {
  constructor() { super("Twitch sign-in is temporarily unavailable. Please try again."); }
}
class LoginLimited extends Error {
  constructor(retryAfter) { super("Too many Twitch sign-in attempts. Please try again shortly."); this.retryAfter = retryAfter; }
}
function header(event, name) { return Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === name)?.[1] || ""; }
function urlFor(event) {
  const url = new URL(event.rawUrl), host = header(event, "host");
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || (host && host.toLowerCase() !== url.host.toLowerCase())) throw new AuthUnavailable();
  return url;
}
function local(url) { return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname); }
function configFor(event, env = process.env) {
  let url, redirect;
  try {
    url = urlFor(event); redirect = new URL(env.TWITCH_REDIRECT_URI || DEFAULT_REDIRECT);
    if (redirect.pathname !== ENDPOINT || redirect.search !== "?action=callback" || redirect.hash || redirect.username || redirect.password
        || (redirect.protocol !== "https:" && !(redirect.protocol === "http:" && local(redirect))) || url.origin !== redirect.origin) return null;
  } catch { return null; }
  const clientId = env.TWITCH_CLIENT_ID, clientSecret = env.TWITCH_CLIENT_SECRET;
  const secret = env.STATS_SESSION_SECRET || env.DASHBOARD_SESSION_SECRET || "";
  if (typeof clientId !== "string" || !/^[A-Za-z0-9]{4,100}$/.test(clientId)
      || typeof clientSecret !== "string" || !clientSecret.trim() || clientSecret.length > 1024 || typeof secret !== "string" || secret.length < 32) return null;
  return { origin: url.origin, redirect: redirect.href, clientId, clientSecret, secret, secure: url.protocol === "https:" };
}
function storeName(event) {
  const url = urlFor(event);
  if (url.origin === "https://thorshall.gg" && event.deployContext === "production" && event.published === true) return "thorshall-hunt-twitch-v1";
  const context = String(event.deployContext || "unverified").toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 20);
  return "thorshall-hunt-twitch-v1-preview-" + context + "-" + crypto.createHash("sha256").update(url.origin).digest("hex").slice(0, 10);
}
async function openStore(event) {
  const { getStore } = require("@netlify/blobs");
  return getStore({ name: storeName(event), consistency: "strong" });
}
function safeReturn(value) {
  if (typeof value !== "string" || value.length > 200 || /[\u0000-\u0020\\]/.test(value)) return "/bonus-hunt";
  return /^\/bonus-hunt(?:#hunt=[A-Za-z0-9_-]{1,80})?$/.test(value) ? value : "/bonus-hunt";
}
function readCookie(event, name) {
  const items = String(header(event, "cookie")).split(";");
  const found = items.filter(item => item.slice(0, item.indexOf("=")).trim() === name);
  if (found.length !== 1) return "";
  const item = found[0];
  try { return decodeURIComponent(item.slice(item.indexOf("=") + 1).trim()); } catch { return ""; }
}
function equal(a, b) { const left = Buffer.from(String(a)), right = Buffer.from(String(b)); return left.length === right.length && crypto.timingSafeEqual(left, right); }
function signature(config, purpose, value) { return crypto.createHmac("sha256", config.secret).update(purpose + ":" + config.origin + ":" + value).digest("base64url"); }
function opaque(config, purpose) { const id = crypto.randomBytes(32).toString("base64url"); return id + "." + signature(config, purpose, id); }
function validOpaque(config, purpose, value) { if (!TOKEN_PATTERN.test(value)) return false; const [id, sig] = value.split("."); return equal(signature(config, purpose, id), sig); }
function keyFor(type, value) { return type + "-" + crypto.createHash("sha256").update(value.split(".")[0]).digest("hex"); }
function cookie(config, name, value, maxAge, path = "/") { return name + "=" + value + "; Path=" + path + "; HttpOnly; SameSite=Lax; Max-Age=" + maxAge + (config.secure ? "; Secure" : ""); }
function encrypt(config, key, token) {
  const aesKey = crypto.createHmac("sha256", config.secret).update("thorshall-twitch-access-token-v1").digest();
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
  cipher.setAAD(Buffer.from(config.origin + "|" + config.clientId + "|" + key));
  return { iv: iv.toString("base64url"), data: Buffer.concat([cipher.update(token, "utf8"), cipher.final()]).toString("base64url"), tag: cipher.getAuthTag().toString("base64url") };
}
function decrypt(config, key, encrypted) {
  if (!encrypted || typeof encrypted.iv !== "string" || typeof encrypted.data !== "string" || typeof encrypted.tag !== "string"
      || encrypted.data.length > 4096) throw new AuthUnavailable();
  const aesKey = crypto.createHmac("sha256", config.secret).update("thorshall-twitch-access-token-v1").digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, Buffer.from(encrypted.iv, "base64url"));
  decipher.setAAD(Buffer.from(config.origin + "|" + config.clientId + "|" + key));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted.data, "base64url")), decipher.final()]).toString("utf8");
}
function validUser(user) {
  return user && typeof user.id === "string" && USER_ID.test(user.id) && typeof user.login === "string" && LOGIN.test(user.login)
    && typeof user.displayName === "string" && user.displayName.length > 0 && user.displayName.length <= 50 && !/[\u0000-\u001f\u007f]/.test(user.displayName);
}
function deps(options = {}) { return { env: options.env || process.env, connectStore: options.connectStore || openStore, fetcher: options.fetcher || fetch, now: options.now || (() => new Date()) }; }
async function fetchJson(fetcher, url, options) {
  const response = await fetcher(url, { ...options, redirect: "error", signal: AbortSignal.timeout(10000) });
  let value; try { value = await response.json(); } catch { throw new AuthUnavailable(); }
  return { status: response.status, ok: response.ok, value };
}
async function twitchIdentity(config, token, fetcher, clock = () => Date.now()) {
  const observedAt = clock();
  const check = await fetchJson(fetcher, "https://id.twitch.tv/oauth2/validate", { headers: { Authorization: "OAuth " + token } });
  if (check.status === 401) return null;
  const value = check.value;
  if (!check.ok || value.client_id !== config.clientId || typeof value.user_id !== "string" || !USER_ID.test(value.user_id)
      || typeof value.login !== "string" || !LOGIN.test(value.login) || !Number.isFinite(value.expires_in) || value.expires_in <= 0) throw new AuthUnavailable();
  const profile = await fetchJson(fetcher, "https://api.twitch.tv/helix/users", { headers: { Authorization: "Bearer " + token, "Client-Id": config.clientId } });
  if (profile.status === 401) return null;
  if (!profile.ok || !Array.isArray(profile.value.data) || profile.value.data.length !== 1) throw new AuthUnavailable();
  const item = profile.value.data[0], user = { id: item.id, login: item.login, displayName: item.display_name };
  if (!validUser(user) || user.id !== value.user_id || user.login !== value.login) throw new AuthUnavailable();
  return { user, remaining: Math.floor(value.expires_in), observedAt };
}
async function remove(store, key) { try { if (typeof store.delete === "function") await store.delete(key); } catch { /* Expiry is enforced even if cleanup is temporarily unavailable. */ } }
async function limitLogin(store, config, event, now) {
  const ip = typeof event.clientIp === "string" && event.clientIp.length < 100 ? event.clientIp : "unavailable";
  const digest = crypto.createHmac("sha256", config.secret).update("twitch-login-rate-v1:" + config.origin + ":" + ip).digest("hex");
  const key = "rate-" + digest, windowStart = Math.floor(now / STATE_MS) * STATE_MS;
  for (let attempt = 0; attempt < 8; attempt++) {
    const entry = await store.getWithMetadata(key, { type: "json", consistency: "strong" });
    let count = 0;
    if (entry) {
      const rate = entry.data;
      if (!rate || rate.schema !== 1 || !Number.isSafeInteger(rate.windowStart) || !Number.isSafeInteger(rate.count) || rate.count < 0 || rate.count > LOGIN_LIMIT) throw new AuthUnavailable();
      if (rate.windowStart === windowStart) count = rate.count;
    }
    if (count >= LOGIN_LIMIT) throw new LoginLimited(Math.max(1, Math.ceil((windowStart + STATE_MS - now) / 1000)));
    const result = await store.setJSON(key, { schema: 1, windowStart, count: count + 1 }, entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true });
    if (result?.modified === true && typeof result.etag === "string") return;
    if (result?.modified !== false) throw new AuthUnavailable();
  }
  throw new LoginLimited(1);
}
function validSession(record, config, now) {
  return record && record.schema === 1 && record.origin === config.origin && record.clientId === config.clientId && validUser(record.user)
    && Number.isSafeInteger(record.createdAt) && record.createdAt >= 0 && Number.isSafeInteger(record.expiresAt) && Number.isSafeInteger(record.checkedAt)
    && Number.isSafeInteger(record.tokenExpiresAt) && record.createdAt <= record.checkedAt && record.checkedAt <= now
    && record.expiresAt <= record.createdAt + SESSION_MS && record.expiresAt <= record.tokenExpiresAt && record.expiresAt > now && record.tokenExpiresAt > now;
}
async function readSession(event, config, options) {
  const supplied = readCookie(event, SESSION_COOKIE);
  if (!validOpaque(config, "twitch-session-v1", supplied)) return null;
  const store = await options.connectStore(event), key = keyFor("session", supplied);
  const entry = await store.getWithMetadata(key, { type: "json", consistency: "strong" });
  if (!entry) return null;
  const record = entry.data, now = options.now().getTime();
  if (!validSession(record, config, now)) {
    await remove(store, key); return null;
  }
  if (now - record.checkedAt < VALIDATE_MS) return record;
  const identity = await twitchIdentity(config, decrypt(config, key, record.token), options.fetcher, () => options.now().getTime());
  if (!identity) { await remove(store, key); return null; }
  if (identity.user.id !== record.user.id) { await remove(store, key); return null; }
  const updated = { ...record, user: identity.user, checkedAt: now, tokenExpiresAt: Math.min(record.tokenExpiresAt, identity.observedAt + identity.remaining * 1000) };
  updated.expiresAt = Math.min(updated.expiresAt, updated.tokenExpiresAt);
  const result = await store.setJSON(key, updated, { onlyIfMatch: entry.etag });
  if (!result?.modified) {
    const latest = await store.getWithMetadata(key, { type: "json", consistency: "strong" });
    if (!validSession(latest?.data, config, options.now().getTime()) || latest.data.checkedAt < now - VALIDATE_MS || latest.data.user.id !== record.user.id) throw new AuthUnavailable();
    return latest.data;
  }
  return updated;
}
async function predictionAuthInfo(event, options = {}) {
  const settings = deps(options), config = configFor(event, settings.env);
  const returnPath = safeReturn(event.queryStringParameters?.return);
  const info = { viewer: null, authConfigured: Boolean(config), loginUrl: ENDPOINT + "?action=login&return=" + encodeURIComponent(returnPath), logoutUrl: ENDPOINT + "?action=logout", authExpiresAt: null, authRevalidateAt: null };
  if (!config) return info;
  try {
    const session = await readSession(event, config, settings);
    if (session) { info.viewer = { ...session.user }; info.authExpiresAt = new Date(session.expiresAt).toISOString(); info.authRevalidateAt = new Date(Math.min(session.expiresAt, session.checkedAt + VALIDATE_MS)).toISOString(); }
    return info;
  } catch { throw new AuthUnavailable(); }
}
async function getPredictionUser(event, options = {}) { return (await predictionAuthInfo(event, options)).viewer; }
function result(statusCode, payload, headers = {}) { return { statusCode, headers: { ...HEADERS, ...headers }, body: JSON.stringify(payload) }; }
function redirect(location, cookies = []) { return { statusCode: 303, headers: { ...HEADERS, Location: location }, cookies, body: "" }; }
function returnError(path, value) { const [pathname, hash] = safeReturn(path).split("#"); return pathname + "?twitch=" + value + (hash ? "#" + hash : ""); }
function returnSuccess(path) {
  // An explicit destination query prevents Netlify from carrying OAuth callback
  // parameters into the public hunt URL. The page removes this safe marker.
  const [pathname, hash] = safeReturn(path).split("#");
  return pathname + "?twitch=connected" + (hash ? "#" + hash : "");
}
function sameOrigin(event, config) { return header(event, "origin") === config.origin && (!header(event, "sec-fetch-site") || header(event, "sec-fetch-site") === "same-origin") && header(event, "x-thorshall-request") === "twitch-session"; }
function createHandler(options = {}) {
  const settings = deps(options);
  return async event => {
    const action = event.queryStringParameters?.action || "session", method = String(event.httpMethod || "GET").toUpperCase();
    if (!["session", "login", "callback", "logout"].includes(action)) return result(400, { ok: false, error: "Unknown Twitch action." });
    if ((action === "logout" && method !== "POST") || (action !== "logout" && method !== "GET")) return result(405, { ok: false, error: "Method not allowed." });
    const config = configFor(event, settings.env);
    if (action === "session") {
      try {
        const info = await predictionAuthInfo(event, settings);
        const now = settings.now().getTime();
        return result(200, { ok: true, configured: info.authConfigured, user: info.viewer, loginUrl: info.loginUrl, logoutUrl: info.logoutUrl, expiresAt: info.authExpiresAt, revalidateAt: info.authRevalidateAt,
          revalidateAfter: info.authRevalidateAt ? Math.max(0, Math.ceil((Date.parse(info.authRevalidateAt) - now) / 1000)) : null });
      } catch { return result(503, { ok: false, error: new AuthUnavailable().message }); }
    }
    if (!config) {
      if (action !== "callback") return result(503, { ok: false, error: "Twitch sign-in has not been connected yet." });
      let secure = true; try { secure = urlFor(event).protocol === "https:"; } catch { /* Clear only the browser's existing cookie. */ }
      return redirect(returnError("/bonus-hunt", "unavailable"), [cookie({ secure }, STATE_COOKIE, "", 0, ENDPOINT)]);
    }
    const clearState = cookie(config, STATE_COOKIE, "", 0, ENDPOINT);
    if (action === "logout") {
      if (!sameOrigin(event, config)) return result(403, { ok: false, error: "Sign out from this hunt page." });
      try {
        const supplied = readCookie(event, SESSION_COOKIE);
        if (validOpaque(config, "twitch-session-v1", supplied)) {
          const sessions = await settings.connectStore(event);
          if (typeof sessions.delete !== "function") throw new AuthUnavailable();
          const key = keyFor("session", supplied);
          await sessions.delete(key);
          if (await sessions.getWithMetadata(key, { type: "json", consistency: "strong" })) throw new AuthUnavailable();
        }
      }
      catch { return result(503, { ok: false, error: new AuthUnavailable().message }); }
      return { ...result(200, { ok: true, user: null }), cookies: [cookie(config, SESSION_COOKIE, "", 0), clearState] };
    }
    let store, returnPath = "/bonus-hunt";
    try {
      store = await settings.connectStore(event);
      const now = settings.now().getTime();
      if (action === "login") {
        returnPath = safeReturn(event.queryStringParameters?.return);
        const reusable = readCookie(event, STATE_COOKIE);
        if (validOpaque(config, "twitch-state-v1", reusable)) {
          const pending = await store.getWithMetadata(keyFor("pending", reusable), { type: "json", consistency: "strong" });
          const data = pending?.data;
          if (data?.schema === 1 && data.origin === config.origin && data.returnPath === returnPath && data.consumed === false
              && Number.isSafeInteger(data.createdAt) && data.createdAt <= now && Number.isSafeInteger(data.expiresAt) && data.expiresAt > now && data.expiresAt <= data.createdAt + STATE_MS) {
            const url = new URL("https://id.twitch.tv/oauth2/authorize");
            url.search = new URLSearchParams({ response_type: "code", client_id: config.clientId, redirect_uri: config.redirect, scope: "", state: reusable }).toString();
            return redirect(url.href, [cookie(config, STATE_COOKIE, reusable, Math.ceil((data.expiresAt - now) / 1000), ENDPOINT)]);
          }
        }
        await limitLogin(store, config, event, now);
        const state = opaque(config, "twitch-state-v1");
        const saved = await store.setJSON(keyFor("pending", state), { schema: 1, origin: config.origin, returnPath, createdAt: now, expiresAt: now + STATE_MS, consumed: false }, { onlyIfNew: true });
        if (!saved?.modified || typeof saved.etag !== "string") throw new AuthUnavailable();
        const url = new URL("https://id.twitch.tv/oauth2/authorize");
        url.search = new URLSearchParams({ response_type: "code", client_id: config.clientId, redirect_uri: config.redirect, scope: "", state }).toString();
        return redirect(url.href, [cookie(config, STATE_COOKIE, state, STATE_MS / 1000, ENDPOINT)]);
      }
      const supplied = event.queryStringParameters?.state || "", browser = readCookie(event, STATE_COOKIE);
      if (!validOpaque(config, "twitch-state-v1", supplied) || !equal(browser, supplied)) return redirect(returnError(returnPath, "expired"), [clearState]);
      const key = keyFor("pending", supplied), entry = await store.getWithMetadata(key, { type: "json", consistency: "strong" });
      const pending = entry?.data;
      if (!pending || pending.schema !== 1 || pending.origin !== config.origin || pending.consumed !== false || !Number.isSafeInteger(pending.createdAt)
          || pending.createdAt > now || !Number.isSafeInteger(pending.expiresAt) || pending.expiresAt <= now || pending.expiresAt > pending.createdAt + STATE_MS) {
        if (entry) await remove(store, key);
        return redirect(returnError(returnPath, "expired"), [clearState]);
      }
      returnPath = safeReturn(pending.returnPath);
      const consumed = await store.setJSON(key, { ...pending, consumed: true }, { onlyIfMatch: entry.etag });
      if (!consumed?.modified) return redirect(returnError(returnPath, "expired"), [clearState]);
      await remove(store, key);
      const params = event.queryStringParameters || {};
      if (params.error) return redirect(returnError(returnPath, "cancelled"), [clearState]);
      if (typeof params.code !== "string" || !/^[A-Za-z0-9_-]{1,1024}$/.test(params.code)) return redirect(returnError(returnPath, "failed"), [clearState]);
      const exchanged = await fetchJson(settings.fetcher, "https://id.twitch.tv/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code: params.code, grant_type: "authorization_code", redirect_uri: config.redirect }).toString() });
      const token = exchanged.value.access_token;
      if (!exchanged.ok || typeof token !== "string" || !/^[A-Za-z0-9_-]{1,2048}$/.test(token)) throw new AuthUnavailable();
      const identity = await twitchIdentity(config, token, settings.fetcher, () => settings.now().getTime()); if (!identity) throw new AuthUnavailable();
      const sessionId = opaque(config, "twitch-session-v1"), sessionKey = keyFor("session", sessionId), createdAt = settings.now().getTime();
      const tokenExpiresAt = identity.observedAt + identity.remaining * 1000, expiresAt = Math.min(createdAt + SESSION_MS, tokenExpiresAt);
      if (expiresAt <= createdAt) throw new AuthUnavailable();
      const session = { schema: 1, origin: config.origin, clientId: config.clientId, createdAt, expiresAt, checkedAt: createdAt, tokenExpiresAt, user: identity.user, token: encrypt(config, sessionKey, token) };
      const saved = await store.setJSON(sessionKey, session, { onlyIfNew: true });
      if (!saved?.modified || typeof saved.etag !== "string") throw new AuthUnavailable();
      return redirect(returnSuccess(returnPath), [clearState, cookie(config, SESSION_COOKIE, sessionId, Math.floor((expiresAt - createdAt) / 1000))]);
    } catch (error) {
      if (error instanceof LoginLimited) return result(429, { ok: false, error: error.message }, { "Retry-After": String(error.retryAfter) });
      return redirect(returnError(returnPath, "failed"), [clearState]);
    }
  };
}

module.exports = { createHandler, getPredictionUser, predictionAuthInfo, configFor, storeName, safeReturn, validUser, HEADERS,
  ENDPOINT, DEFAULT_REDIRECT, SESSION_COOKIE, STATE_COOKIE, SESSION_MS, VALIDATE_MS, STATE_MS, LOGIN_LIMIT, AuthUnavailable };
