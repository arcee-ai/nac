"use strict";

// Swift's WorkspaceNotificationState payload is intentionally unversioned and
// strict. The presentation store owns its versioned migration envelope.
const { createHash } = require("node:crypto");
const bytes = (value) => Buffer.byteLength(value, "utf8");
const id = (value, limit = 512) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  bytes(value) <= limit &&
  !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const uint = (value) => Number.isSafeInteger(value) && value >= 0;
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  ) &&
  value !== "00000000-0000-0000-0000-000000000000";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const defaults = () => ({
  enabled: false,
  muted: false,
  unreadCompletions: 0,
  deliveryUncertain: false,
  seenDecisions: [],
  cutoff: null,
  frontier: null,
  receipts: [],
});
const clone = (value) => structuredClone(value);

function decodeState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(defaults());
  if (
    Object.keys(value).some((key) => !keys.includes(key)) ||
    typeof value.enabled !== "boolean" ||
    !Array.isArray(value.receipts)
  )
    return null;
  const next = { ...defaults(), ...clone(value) };
  if (
    typeof next.muted !== "boolean" ||
    typeof next.deliveryUncertain !== "boolean" ||
    !uint(next.unreadCompletions) ||
    !Array.isArray(next.seenDecisions) ||
    next.seenDecisions.length > 1024 ||
    new Set(next.seenDecisions).size !== next.seenDecisions.length ||
    !next.seenDecisions.every(
      (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
    ) ||
    ![next.cutoff, next.frontier].every(
      (value) => value === null || id(value, 2048),
    ) ||
    (next.enabled && (!next.cutoff || !next.frontier)) ||
    next.receipts.length > 64 ||
    !next.receipts.every(
      (receipt) =>
        receipt &&
        Object.keys(receipt).sort().join(",") ===
          "cursor,occurrence,phase,session" &&
        id(receipt.occurrence) &&
        id(receipt.session) &&
        id(receipt.cursor, 2048) &&
        ["reserved", "scheduled"].includes(receipt.phase),
    ) ||
    new Set(next.receipts.map((receipt) => receipt.occurrence)).size !==
      next.receipts.length ||
    bytes(JSON.stringify(next)) > 256 * 1024
  )
    return null;
  return next;
}

function sequence(cursor, store) {
  if (typeof cursor !== "string") return null;
  const parts = cursor.split(":");
  if (
    parts.length !== 2 ||
    !uuid(parts[0]) ||
    parts[0].toLowerCase() !== store.toLowerCase() ||
    !/^(0|[1-9][0-9]*)$/.test(parts[1])
  )
    return null;
  const value = Number(parts[1]);
  return uint(value) ? value : null;
}
function destination(profile, session, occurrence) {
  if (!/^[a-f0-9]{64}$/.test(profile) || !id(session) || !id(occurrence))
    throw Error("Invalid notification destination");
  return Object.freeze({
    profile,
    session,
    occurrence,
    identifier:
      "nac-attention-" +
      hash(`nac-attention-v1\0${profile}\0${session}\0${occurrence}`),
  });
}
const decisionHash = (profile, session, identity) =>
  hash(`decision-v1\0${profile}\0${session}\0${identity}`);

module.exports = {
  defaults,
  decodeState,
  sequence,
  destination,
  decisionHash,
  id,
  uuid,
  uint,
  bytes,
  clone,
};
