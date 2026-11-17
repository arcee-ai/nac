"use strict";

const {
  validate,
  decisionKey,
  requireValue: check,
} = require("./attention-protocol.cjs");
const { bytes, clone } = require("./notification-state.cjs");
const facet = (decision) =>
  ({ permission: "permissions", review: "reviews", question: "questions" })[
    decision.kind
  ];
const keyOf = (session, identity) => JSON.stringify([session, identity]);

// Current decision metadata only. Completion delivery uses the durable semantic
// pages, never work_settled heuristics or transcript/permission-presence reads.
class AttentionProjection {
  constructor() {
    this.boundary = null;
    this.sources = new Map();
    this.seen = new Set();
    this.candidates = new Map();
  }
  retention() {
    const identities = new Set([...this.seen, ...this.candidates.keys()]);
    let metadataBytes = 0,
      pending = 0;
    for (const current of this.sources.values()) {
      metadataBytes += bytes(JSON.stringify(current));
      pending += current.pending.length;
      for (const value of current.pending)
        identities.add(keyOf(current.source.session_id, decisionKey(value)));
    }
    return {
      sources: this.sources.size,
      identities: identities.size,
      pending,
      metadataBytes,
      dedupBytes: [...identities].reduce((sum, key) => sum + bytes(key), 0),
    };
  }
  isCurrent(notice) {
    const current = this.sources.get(notice.session);
    return (
      current?.source.epoch === notice.sourceEpoch &&
      current.availability.topology === "available" &&
      current.availability[facet(notice.decision)] === "available" &&
      current.pending.some((value) => decisionKey(value) === notice.identity)
    );
  }
  install(snapshot, resume) {
    this.sources.set(snapshot.source.session_id, clone(snapshot));
    for (const decision of snapshot.pending) {
      const identity = decisionKey(decision),
        key = keyOf(snapshot.source.session_id, identity);
      if (resume && !this.seen.has(key))
        this.candidates.set(key, {
          session: snapshot.source.session_id,
          identity,
          sourceEpoch: snapshot.source.epoch,
          decision: clone(decision),
        });
      else this.seen.add(key);
    }
  }
  accept(frame, engine) {
    validate(frame);
    check(frame.boundary?.engine.toLowerCase() === engine.toLowerCase());
    const resolved = [];
    if (frame.kind === "baseline") {
      check(this.boundary === null);
      this.boundary = clone(frame.boundary);
      // Resume decisions after process restart; persistent seenDecisions in the
      // coordinator suppresses previous notices. No historical work notices.
      for (const snapshot of frame.sources) this.install(snapshot, true);
    } else {
      check(
        frame.kind === "record" &&
          this.boundary &&
          frame.boundary.epoch === this.boundary.epoch,
      );
      if (frame.boundary.sequence <= this.boundary.sequence)
        return { notices: [], resolved: [] };
      check(frame.boundary.sequence === this.boundary.sequence + 1);
      const session = frame.source.session_id,
        change = frame.change;
      const current = this.sources.get(session);
      if (change.kind === "source_replaced") {
        check(
          !frame.new_attention &&
            change.snapshot.revision === frame.source_revision &&
            current?.source.epoch !== frame.source.epoch,
        );
        for (const [key, value] of this.candidates)
          if (value.session === session) this.candidates.delete(key);
        this.install(change.snapshot, true);
      } else {
        check(
          current &&
            current.source.epoch === frame.source.epoch &&
            frame.source_revision === current.revision + 1,
        );
        current.revision = frame.source_revision;
        switch (change.kind) {
          case "decision_pending": {
            const identity = decisionKey(change.decision),
              key = keyOf(session, identity);
            const previous = current.pending.find(
              (value) => decisionKey(value) === identity,
            );
            check(
              !previous ||
                previous.kind !== "question" ||
                change.decision.revision >= previous.revision,
            );
            current.pending = current.pending.filter(
              (value) => decisionKey(value) !== identity,
            );
            current.pending.push(clone(change.decision));
            if (frame.new_attention && !this.seen.has(key))
              this.candidates.set(key, {
                session,
                identity,
                sourceEpoch: frame.source.epoch,
                decision: clone(change.decision),
              });
            break;
          }
          case "decision_resolved": {
            check(!frame.new_attention);
            const identity = decisionKey(change.decision),
              key = keyOf(session, identity);
            const previous = current.pending.find(
              (value) => decisionKey(value) === identity,
            );
            check(
              !previous ||
                previous.kind !== "question" ||
                change.decision.revision >= previous.revision,
            );
            current.pending = current.pending.filter(
              (value) => decisionKey(value) !== identity,
            );
            this.candidates.delete(key);
            this.seen.add(key);
            resolved.push({ session, identity });
            break;
          }
          case "session_deleted":
            check(!frame.new_attention);
            this.sources.delete(session);
            for (const [key, value] of this.candidates)
              if (value.session === session) this.candidates.delete(key);
            break;
          case "availability":
            check(!frame.new_attention);
            current.availability = clone(change.availability);
            break;
          case "work_settled":
            check(
              !frame.new_attention || change.work.disposition === "completed",
            );
            current.work = clone(change.work);
            break;
          case "work_cleared":
            check(!frame.new_attention);
            current.work = null;
            break;
          case "checkpoint":
            check(!frame.new_attention);
            break;
          default:
            check(false);
        }
      }
      this.boundary = clone(frame.boundary);
    }
    const notices = [];
    for (const [key, notice] of this.candidates) {
      const current = this.sources.get(notice.session);
      if (this.isCurrent(notice)) {
        this.seen.add(key);
        notices.push(notice);
        this.candidates.delete(key);
      } else if (
        !current ||
        current.availability.topology === "unsupported" ||
        current.availability[facet(notice.decision)] === "unsupported"
      )
        this.candidates.delete(key);
    }
    const retained = this.retention();
    check(
      retained.sources <= 1024 &&
        retained.identities <= 1024 &&
        retained.metadataBytes <= 1024 * 1024 &&
        retained.dedupBytes <= 2 * 1024 * 1024,
    );
    return { notices, resolved };
  }
}
module.exports = { AttentionProjection };
