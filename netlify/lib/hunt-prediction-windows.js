"use strict";

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_WINDOWS = 10000;
const MAX_CYCLES = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function timestamp(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function cutoffFor(record, huntId) {
  if (record?.predictionWindowHistory && Object.prototype.hasOwnProperty.call(record.predictionWindowHistory, huntId)) return historyFor(record, huntId).at(-1).closedAt;
  return legacyCutoffFor(record, huntId);
}
function legacyCutoffFor(record, huntId) {
  const map = record?.predictionClosedAt;
  return map && Object.prototype.hasOwnProperty.call(map, huntId) && timestamp(map[huntId]) ? map[huntId] : null;
}
function collecting(hunt) {
  return Boolean(hunt && hunt.status === "collecting" && Array.isArray(hunt.rows)
    && hunt.rows.every(row => row.payout === null || row.payout === undefined));
}
function running(hunt) {
  return Boolean(hunt && ["collecting", "opening"].includes(hunt.status));
}

function validWindowId(value) { return value === "0" || typeof value === "string" && UUID.test(value); }
function historyFor(record, huntId) {
  const map = record?.predictionWindowHistory;
  if (map === undefined || !Object.prototype.hasOwnProperty.call(map, huntId)) return [{ id: "0", openedAt: null, closedAt: legacyCutoffFor(record, huntId) }];
  const history = map[huntId];
  if (!Array.isArray(history) || !history.length || history.length > MAX_CYCLES) throw new Error("Invalid prediction cycle history");
  const ids = new Set();
  for (let index = 0; index < history.length; index++) {
    const window = history[index], prior = history[index - 1];
    if (!window || !validWindowId(window.id) || ids.has(window.id) || (index === 0 ? window.id !== "0" || window.openedAt !== null : !timestamp(window.openedAt))
        || window.closedAt !== null && !timestamp(window.closedAt) || index < history.length - 1 && !window.closedAt
        || window.openedAt && window.closedAt && window.closedAt < window.openedAt || prior && (!prior.closedAt || window.openedAt < prior.closedAt)) throw new Error("Invalid prediction cycle");
    ids.add(window.id);
  }
  return history;
}
function windowFor(record, huntId) { return historyFor(record, huntId).at(-1); }
function versionEligible(record, huntId, version) {
  if (version.admittedAt === null) return false;
  const at = version.admittedAt === undefined ? version.createdAt : version.admittedAt;
  const window = historyFor(record, huntId).find(item => item.id === (version.windowId || "0"));
  return Boolean(window && timestamp(at) && (!window.openedAt || at >= window.openedAt) && (!window.closedAt || at < window.closedAt));
}

// Historical intervals are never removed. New cycles require the explicit
// owner command; ordinary state imports cannot revive closed or retired IDs.
function updatePredictionWindows(record, nextState, now = new Date(), { closeHuntId = null, reopenHuntId = null, newWindowId = null } = {}) {
  const closed = closePredictionWindows(record, nextState, now, closeHuntId), history = Object.create(null), retired = Object.create(null);
  const priorRetired = record?.predictionPermanentlyClosed;
  if (priorRetired !== undefined && (!priorRetired || typeof priorRetired !== "object" || Array.isArray(priorRetired))) throw new Error("Invalid retired prediction windows");
  for (const [id, value] of Object.entries(priorRetired || {})) {
    if (!ID.test(id) || !timestamp(value)) throw new Error("Invalid retired prediction window");
    retired[id] = value;
  }
  const existingHistory = record?.predictionWindowHistory;
  if (existingHistory !== undefined && (!existingHistory || typeof existingHistory !== "object" || Array.isArray(existingHistory))) throw new Error("Invalid prediction cycle history");
  const before = new Map((record?.state?.hunts || []).map(hunt => [hunt.id, hunt])), after = new Map((nextState?.hunts || []).map(hunt => [hunt.id, hunt]));
  const ids = new Set([...before.keys(), ...after.keys(), ...Object.keys(record?.predictionClosedAt || {}), ...Object.keys(existingHistory || {})]);
  const at = now.toISOString();
  for (const id of ids) {
    if (!ID.test(id)) throw new Error("Invalid prediction history ID");
    const prior = before.get(id), next = after.get(id), cycles = historyFor(record, id).map(window => ({ ...window }));
    const priorHistory = Object.prototype.hasOwnProperty.call(existingHistory || {}, id) || Object.prototype.hasOwnProperty.call(record?.predictionClosedAt || {}, id);
    const legacyRetired = priorHistory && (!prior || record?.state?.activeId !== id && cutoffFor(record, id));
    const permanent = !next || prior?.status === "complete" || next.status === "complete" || record?.state?.activeId === id && nextState?.activeId !== id || legacyRetired;
    if (permanent && !Object.prototype.hasOwnProperty.call(retired, id)) retired[id] = at;
    const last = cycles.at(-1);
    if (Object.prototype.hasOwnProperty.call(closed, id) && !last.closedAt) last.closedAt = closed[id];
    if (last.closedAt && !Object.prototype.hasOwnProperty.call(closed, id)) closed[id] = last.closedAt;
    if (id === reopenHuntId) {
      if (retired[id] || !next || nextState.activeId !== id || next.status !== "collecting" || !last.closedAt || cycles.length >= MAX_CYCLES || !validWindowId(newWindowId) || newWindowId === "0") throw new Error("This prediction window cannot be reopened");
      if (at < last.closedAt) throw new Error("Invalid prediction reopen clock");
      cycles.push({ id: newWindowId, openedAt: at, closedAt: null });
      delete closed[id];
    }
    history[id] = cycles;
  }
  if (ids.size > MAX_WINDOWS || Object.keys(retired).length > MAX_WINDOWS || Object.values(history).reduce((count, cycles) => count + cycles.length, 0) > MAX_WINDOWS) throw new Error("Prediction window history is full");
  return { predictionClosedAt: closed, predictionWindowHistory: { ...history }, predictionPermanentlyClosed: { ...retired } };
}

// These cutoffs are server metadata, never part of the editable hunt state.
// Once a hunt ID closes, edits/imports cannot reopen its prediction window.
function closePredictionWindows(record, nextState, now = new Date(), closeHuntId = null) {
  const closed = Object.create(null), existing = record?.predictionClosedAt;
  if (existing !== undefined && (!existing || typeof existing !== "object" || Array.isArray(existing))) throw new Error("Invalid prediction windows");
  for (const [id, value] of Object.entries(existing || {})) {
    if (!ID.test(id) || !timestamp(value)) throw new Error("Invalid prediction cutoff");
    closed[id] = value;
  }
  const at = now.toISOString();
  if (!timestamp(at)) throw new Error("Invalid prediction clock");
  const before = new Map((record?.state?.hunts || []).map(hunt => [hunt.id, hunt]));
  const after = new Map((nextState?.hunts || []).map(hunt => [hunt.id, hunt]));
  const ids = new Set([...before.keys(), ...after.keys()]);
  for (const id of ids) {
    const prior = before.get(id), next = after.get(id);
    const wasDeactivated = record?.state?.activeId === id && nextState?.activeId !== id;
    if (!next || prior?.status === "complete" || next.status === "complete" || next.status === "opening" || wasDeactivated || id === closeHuntId) {
      if (!Object.prototype.hasOwnProperty.call(closed, id)) closed[id] = at;
    }
  }
  if (Object.keys(closed).length > MAX_WINDOWS) throw new Error("Prediction window history is full");
  return Object.fromEntries(Object.entries(closed));
}

module.exports = { closePredictionWindows, updatePredictionWindows, cutoffFor, collecting, running, timestamp, MAX_WINDOWS, MAX_CYCLES, validWindowId, historyFor, windowFor, versionEligible };
