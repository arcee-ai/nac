"use strict";

const { id, uuid, uint, bytes } = require("./notification-state.cjs");
const EVENT_BYTES = 8 * 1024 * 1024;
const requireValue = (value) => {
  if (!value) throw Error("Invalid attention metadata");
};
const exact = (value, keys) =>
  value && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const part = (value) => `${bytes(value)}:${value}`;
function decisionKey(value) {
  requireValue(value && typeof value === "object");
  if (value.kind === "permission") {
    requireValue(id(value.request_id));
    return "p" + part(value.request_id);
  }
  if (value.kind === "review") {
    requireValue(id(value.review_id));
    return "r" + part(value.review_id);
  }
  requireValue(
    value.kind === "question" &&
      [value.request_id, value.run_id, value.generation].every((value) =>
        id(value),
      ) &&
      uint(value.revision) &&
      value.revision > 0,
  );
  return (
    "q" + part(value.request_id) + part(value.run_id) + part(value.generation)
  );
}
function source(value) {
  requireValue(value && id(value.session_id) && uuid(value.epoch));
}
function availability(value) {
  requireValue(
    value &&
      ["work", "questions", "permissions", "reviews", "topology"].every((key) =>
        ["available", "unknown", "unsupported"].includes(value[key]),
      ),
  );
}
function work(value) {
  requireValue(
    value &&
      id(value.run_id) &&
      Object.hasOwn(value, "goal") &&
      ["completed", "continuing", "waiting_for_decision"].includes(
        value.disposition,
      ),
  );
  if (value.goal !== null)
    requireValue(
      value.goal &&
        id(value.goal.id) &&
        uint(value.goal.version) &&
        value.goal.version > 0,
    );
}
function snapshot(value) {
  requireValue(
    value &&
      uint(value.revision) &&
      Object.hasOwn(value, "work") &&
      Array.isArray(value.pending) &&
      value.pending.length <= 1024,
  );
  source(value.source);
  availability(value.availability);
  if (value.work !== null) work(value.work);
  const identities = value.pending.map(decisionKey);
  requireValue(new Set(identities).size === identities.length);
}
function completionPage(page) {
  requireValue(
    exact(page, [
      "store_id",
      "cursor",
      "high_water",
      "baseline",
      "more",
      "items",
    ]) &&
      uuid(page.store_id) &&
      uint(page.cursor) &&
      uint(page.high_water) &&
      page.cursor <= page.high_water &&
      typeof page.baseline === "boolean" &&
      typeof page.more === "boolean" &&
      Array.isArray(page.items) &&
      page.items.length <= 128 &&
      (!page.baseline ||
        (!page.items.length &&
          !page.more &&
          page.cursor === page.high_water)) &&
      (page.more || page.cursor === page.high_water) &&
      bytes(JSON.stringify(page)) <= 64 * 1024 + 1024,
  );
  let previous = 0;
  for (const item of page.items) {
    requireValue(
      exact(item, [
        "sequence",
        "session_id",
        "run_id",
        "behavior",
        "kind",
        "goal_id",
        "mark_version",
      ]) &&
        uint(item.sequence) &&
        item.sequence > previous &&
        item.sequence <= page.cursor &&
        id(item.session_id) &&
        id(item.run_id) &&
        ["orchestrator", "direct", "direct-with-orchestrator"].includes(
          item.behavior,
        ),
    );
    if (item.kind === "request")
      requireValue(item.goal_id === null && item.mark_version === null);
    else
      requireValue(
        item.kind === "goal" && id(item.goal_id) && uint(item.mark_version),
      );
    previous = item.sequence;
  }
  requireValue(
    !page.more || (page.items.length > 0 && previous === page.cursor),
  );
  return page;
}
function validate(frame) {
  requireValue(frame && typeof frame === "object");
  if (frame.kind === "completions") {
    completionPage(frame.page);
    return frame;
  }
  if (frame.kind === "reset") {
    requireValue(
      ["incarnation", "replay_gap", "invalid_cursor"].includes(frame.reason),
    );
    return frame;
  }
  const boundary = frame.boundary;
  requireValue(
    boundary &&
      uuid(boundary.engine) &&
      uuid(boundary.epoch) &&
      uint(boundary.sequence),
  );
  if (frame.kind === "baseline") {
    requireValue(
      Array.isArray(frame.sources) &&
        frame.sources.length <= 1024 &&
        Object.hasOwn(frame, "reset") &&
        (frame.reset === null ||
          ["incarnation", "replay_gap", "invalid_cursor"].includes(
            frame.reset,
          )),
    );
    frame.sources.forEach(snapshot);
    requireValue(
      new Set(frame.sources.map((value) => value.source.session_id)).size ===
        frame.sources.length,
    );
  } else {
    requireValue(
      frame.kind === "record" &&
        uint(frame.source_revision) &&
        typeof frame.new_attention === "boolean",
    );
    source(frame.source);
    const change = frame.change;
    requireValue(change && typeof change === "object");
    switch (change.kind) {
      case "source_replaced":
        snapshot(change.snapshot);
        requireValue(
          change.snapshot.source.session_id === frame.source.session_id &&
            change.snapshot.source.epoch === frame.source.epoch,
        );
        break;
      case "work_settled":
        work(change.work);
        break;
      case "decision_pending":
      case "decision_resolved":
        decisionKey(change.decision);
        break;
      case "availability":
        availability(change.availability);
        break;
      default:
        requireValue(
          ["work_cleared", "session_deleted", "checkpoint"].includes(
            change.kind,
          ),
        );
    }
  }
  return frame;
}

// One bounded event, no decoded-frame queue. Awaiting receive applies HTTP
// backpressure while native accounting waits for the original durable ACK.
class AttentionSSEParser {
  get retainedWireBytes() {
    return (
      this.lineLength +
      this.data.reduce((sum, value) => sum + bytes(value) + 1, 0) +
      bytes(this.event) +
      (this.id ? bytes(this.id) : 0)
    );
  }
  constructor() {
    this.line = Buffer.alloc(1024);
    this.lineLength = 0;
    this.data = [];
    this.event = "";
    this.id = null;
    this.size = 0;
    this.cr = false;
  }
  async consume(chunk, receive) {
    for (const byte of chunk) {
      if (this.cr) {
        this.cr = false;
        if (byte === 10) continue;
      }
      requireValue(++this.size <= EVENT_BYTES);
      if (byte === 10 || byte === 13) {
        this.cr = byte === 13;
        const text = new TextDecoder("utf-8", { fatal: true }).decode(
          this.line.subarray(0, this.lineLength),
        );
        this.lineLength = 0;
        if (!text) {
          if (this.data.length) {
            requireValue(this.event === "attention");
            const raw = this.data.join("\n");
            const frame = validate(JSON.parse(raw));
            if (frame.boundary) {
              const b = frame.boundary;
              requireValue(this.id === `${b.engine}:${b.epoch}:${b.sequence}`);
            } else requireValue(this.id === null);
            requireValue((await receive(frame)) !== false);
          }
          this.data = [];
          this.event = "";
          this.id = null;
          this.size = 0;
        } else if (!text.startsWith(":")) {
          const colon = text.indexOf(":");
          const key = colon < 0 ? text : text.slice(0, colon);
          let value = colon < 0 ? "" : text.slice(colon + 1);
          if (value.startsWith(" ")) value = value.slice(1);
          if (key === "event") this.event = value;
          if (key === "id") {
            requireValue(
              this.id === null && bytes(value) <= 100 && !value.includes("\0"),
            );
            this.id = value;
          }
          if (key === "data") this.data.push(value);
        }
      } else {
        if (this.lineLength === this.line.length) {
          const grown = Buffer.allocUnsafe(
            Math.min(EVENT_BYTES, this.line.length * 2),
          );
          this.line.copy(grown);
          this.line = grown;
        }
        this.line[this.lineLength++] = byte;
      }
    }
  }
}
module.exports = {
  AttentionSSEParser,
  validate,
  completionPage,
  decisionKey,
  requireValue,
  EVENT_BYTES,
};
