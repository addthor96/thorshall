"use strict";

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_WINDOWS = 10000;
function timestamp(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function cutoffFor(record, huntId) {
  const map = record?.predictionClosedAt;
  return map && Object.prototype.hasOwnProperty.call(map, huntId) && timestamp(map[huntId]) ? map[huntId] : null;
}
function collecting(hunt) {
  return Boolean(hunt && hunt.status === "collecting" && Array.isArray(hunt.rows)
    && hunt.rows.every(row => row.payout === null || row.payout === undefined));
}

// These cutoffs are server metadata, never part of the editable hunt state.
// Once a hunt ID closes, edits/imports cannot reopen its prediction window.
function closePredictionWindows(record, nextState, now = new Date()) {
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
    if (!next || (prior && !collecting(prior)) || !collecting(next) || wasDeactivated) {
      if (!Object.prototype.hasOwnProperty.call(closed, id)) closed[id] = at;
    }
  }
  if (Object.keys(closed).length > MAX_WINDOWS) throw new Error("Prediction window history is full");
  return Object.fromEntries(Object.entries(closed));
}

module.exports = { closePredictionWindows, cutoffFor, collecting, timestamp, MAX_WINDOWS };
