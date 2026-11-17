"use strict";

const {
  defaults,
  decodeState,
  sequence,
  destination,
  decisionHash,
  clone,
  uint,
} = require("./notification-state.cjs");
const { completionPage } = require("./attention-protocol.cjs");
const {
  AttentionObserver,
  validBinding,
  sameBinding,
} = require("./attention-observer.cjs");

const SAVE_ERROR =
  "Notifications paused for this launch: this change could not be saved. The previous saved setting may return next launch.";
const restoredState = (value) =>
  value === null ? defaults() : decodeState(value);

// MAIN only. This port cannot approve, execute, replay input, select a backend,
// access a store path or accept renderer-provided URLs. Composition supplies an
// already verified current private engine/profile binding and bounded navigation.
class AttentionCoordinator {
  constructor({
    storage,
    getBinding,
    delivery,
    navigate,
    onStatus = () => {},
    observerFactory = (options) => new AttentionObserver(options),
  }) {
    Object.assign(this, { storage, getBinding, delivery, navigate, onStatus });
    this.saved = defaults();
    this.revision = 0;
    this.generation = 0;
    this.token = null;
    this.loaded = false;
    this.resettable = false;
    this.suspended = false;
    this.retired = false;
    this.held = true;
    this.focused = false;
    this.saving = false;
    this.enabledIntent = false;
    this.enabling = false;
    this.binding = null;
    this.message = "Loading saved settings…";
    this.authorization = {
      allowed: false,
      mayRequest: false,
      status: "unknown",
    };
    this.tail = Promise.resolve();
    this.queued = 0;
    this.pendingOperations = new Set();
    this.targets = new Map();
    this.observer = observerFactory({
      page: (page, context) =>
        this.enqueue(() => this.processPage(page, context)),
      notice: (notice, context) =>
        this.enqueue(() => this.processNotice(notice, context)),
      resolved: (keys, context) => {
        if (!this.contextCurrent(context)) return;
        for (const key of keys) this.withdrawDecision(key);
      },
      withdraw: () => this.withdrawDecisions(),
      status: (state) => {
        this.observerStatus = state;
        for (const [key, value] of this.targets)
          if (
            value.notice &&
            !this.observer?.isCurrent(value.notice, value.context)
          ) {
            this.targets.delete(key);
            this.delivery.withdraw([key]);
          }
        this.publish();
      },
    });
    delivery.shouldPresent = (target) =>
      this.operational() &&
      this.authorization.allowed &&
      !this.saved.muted &&
      !this.focused &&
      target.profile === this.binding.profile;
    delivery.response = (target) => this.respond(target);
  }
  snapshot() {
    return Object.freeze({
      loaded: this.loaded,
      resettable: this.resettable && this.current(this.generation),
      enabled: this.enabledIntent,
      muted: this.saved.muted,
      saving: this.saving || this.enabling,
      suspended: this.suspended,
      message: this.message,
      unreadCompletions: this.saved.unreadCompletions,
      deliveryUncertain: this.saved.deliveryUncertain,
      permission: this.authorization.status,
      observer: this.observerStatus,
    });
  }
  publish() {
    this.onStatus(this.snapshot());
  }
  current(generation) {
    return (
      !this.retired &&
      generation === this.generation &&
      sameBinding(this.binding, this.getBinding())
    );
  }
  operational() {
    return (
      this.loaded &&
      !this.suspended &&
      !this.held &&
      this.enabledIntent &&
      this.current(this.generation)
    );
  }
  contextCurrent(context) {
    return (
      context &&
      this.operational() &&
      sameBinding(context.binding, this.binding) &&
      context.generation === this.observer.generation
    );
  }
  pause(message = SAVE_ERROR) {
    this.suspended = true;
    this.enabling = false;
    this.held = true;
    this.message = message;
    this.observer.stop();
    this.delivery.withdrawProfile(this.binding?.profile);
    this.targets.clear();
    this.publish();
  }
  enqueue(work) {
    if (++this.queued > 1024) {
      --this.queued;
      this.pause("Notifications paused: attention capacity reached.");
      return Promise.resolve(false);
    }
    const generation = this.generation;
    const job = this.tail
      .then(() => (this.current(generation) ? work() : false))
      .catch(() => {
        if (this.current(generation)) this.pause();
        return false;
      })
      .finally(() => --this.queued);
    this.tail = job;
    return job;
  }
  async load() {
    if (this.retired || this.loaded) return false;
    this.binding = validBinding(this.getBinding())
      ? Object.freeze({ ...this.getBinding() })
      : null;
    const generation = this.generation;
    if (
      !this.binding ||
      !(this.token = this.storage.beginNotifications(generation))
    ) {
      this.pause("Notification settings unavailable.");
      return false;
    }
    let result;
    try {
      result = await this.storage.readNotifications(this.token);
    } catch {
      result = null;
    }
    if (!this.current(generation)) return false;
    this.resettable =
      result?.status === "available" &&
      uint(result.revision) &&
      Object.hasOwn(result, "state");
    if (this.resettable) this.revision = result.revision;
    const state = this.resettable ? restoredState(result.state) : null;
    if (!state) {
      this.pause(
        this.resettable
          ? "Notifications paused: saved notification state is invalid. Use Reset Notification State to clear only notifications."
          : "Notifications paused: saved settings unavailable.",
      );
      return false;
    }
    this.saved = state;
    this.revision = result.revision;
    this.loaded = true;
    this.enabledIntent = state.enabled;
    this.held = false;
    await this.refreshAuthorization(generation);
    if (!this.current(generation)) return false;
    if (state.enabled) {
      for (const receipt of state.receipts.filter((value) =>
        value.occurrence.startsWith("decision:"),
      )) {
        let present = false;
        try {
          present = await this.delivery.present(
            destination(
              this.binding.profile,
              receipt.session,
              receipt.occurrence,
            ),
          );
        } catch {
          /* uncertain */
        }
        if (!this.current(generation)) return false;
        const next = clone(this.saved),
          hash = receipt.occurrence.slice(9);
        if (!next.seenDecisions.includes(hash)) next.seenDecisions.push(hash);
        next.deliveryUncertain ||= !present;
        next.receipts = next.receipts.filter(
          (value) => value.occurrence !== receipt.occurrence,
        );
        if (!(await this.persist(next, generation))) return false;
      }
    }
    this.message = state.enabled ? "Saved" : "Off";
    this.start();
    this.publish();
    return true;
  }
  async refreshAuthorization(generation, request = false) {
    try {
      let value = await this.delivery.settings();
      if (!this.current(generation)) return;
      if (request && value.mayRequest) {
        await this.delivery.authorize();
        value = await this.delivery.settings();
      }
      if (this.current(generation)) this.authorization = value;
    } catch {
      if (this.current(generation))
        this.authorization = {
          allowed: false,
          mayRequest: false,
          status: "unavailable",
        };
    }
  }
  async persist(next, generation) {
    if (!this.current(generation) || !this.token) return false;
    if (next !== null && !decodeState(next)) {
      this.pause(
        "Notifications paused: attention state capacity or schema is unavailable.",
      );
      return false;
    }
    const expected = this.revision,
      token = this.token;
    if (!uint(expected + 1)) {
      this.pause();
      return false;
    }
    let operation;
    try {
      operation = Promise.resolve(
        this.storage.updateNotifications(
          token,
          expected,
          next === null ? null : clone(next),
        ),
      );
    } catch {
      operation = Promise.resolve(null);
    }
    this.pendingOperations.add(operation);
    let result;
    try {
      result = await operation;
    } catch {
      result = null;
    } finally {
      this.pendingOperations.delete(operation);
    }
    if (!this.current(generation) || this.token !== token) return false;
    if (result?.status !== "durable" || result.revision !== expected + 1) {
      this.pause();
      return false;
    }
    this.revision = result.revision;
    this.saved = next === null ? defaults() : clone(next);
    this.message = "Saved";
    this.publish();
    return true;
  }
  start() {
    if (this.operational())
      this.observer.start(
        this.binding,
        this.enabling ? null : this.saved.frontier,
      );
  }
  // The caller invokes this synchronously before awaiting a preference/reset/
  // profile transition. No in-flight ACK, click or OS callback may cross it.
  fence() {
    ++this.generation;
    this.held = true;
    this.enabling = false;
    this.observer.stop();
    this.delivery.withdrawProfile(this.binding?.profile);
    this.targets.clear();
    const token = this.token;
    this.token = null;
    let drain;
    try {
      drain = token ? this.storage.retireNotifications(token) : null;
    } catch {
      drain = { status: "unavailable" };
    }
    return { generation: this.generation, drain: Promise.resolve(drain) };
  }
  async preference(next, enable = false, changeKeys = []) {
    // Only an explicit null Reset may recover semantic notification corruption
    // after the store admitted a healthy known-version checkpoint and revision.
    const recovering = !this.loaded && next === null && this.resettable;
    if ((!this.loaded && !recovering) || this.retired) return false;
    const previous = clone(this.saved);
    const { generation, drain } = this.fence();
    this.enabledIntent = enable || next?.enabled === true;
    this.saving = true;
    this.publish();
    let result;
    try {
      result = await drain;
    } catch {
      result = { status: "unavailable" };
    }
    if (!this.current(generation)) return false;
    if (result?.status === "unavailable") {
      this.saving = false;
      this.pause();
      return false;
    }
    this.token = this.storage.beginNotifications(generation);
    if (!this.token) {
      this.saving = false;
      this.pause();
      return false;
    }
    // Retired admitted writes may have become durable. Re-read that revision;
    // never substitute a read/flush for an original write's exact ACK.
    let read;
    try {
      read = await this.storage.readNotifications(this.token);
    } catch {
      read = null;
    }
    if (!this.current(generation)) return false;
    this.resettable =
      read?.status === "available" &&
      uint(read.revision) &&
      Object.hasOwn(read, "state");
    if (!this.resettable || (!recovering && !restoredState(read.state))) {
      this.saving = false;
      this.pause();
      return false;
    }
    this.revision = read.revision;
    this.suspended = false;
    if (enable) {
      this.saved = {
        ...restoredState(read.state),
        enabled: false,
        cutoff: null,
        frontier: null,
      };
      this.enabling = true;
      this.held = false;
      this.saving = false;
      this.start();
      this.publish();
      return true;
    }
    // Retained admitted accounting may have settled during the fence. Apply
    // only the explicit preference delta to that current durable payload.
    if (next !== null) {
      const merged = restoredState(read.state);
      for (const key of Object.keys(next))
        if (
          changeKeys.includes(key) ||
          JSON.stringify(next[key]) !== JSON.stringify(previous[key])
        )
          merged[key] = clone(next[key]);
      next = merged;
    }
    const accepted = await this.persist(next, generation);
    if (!this.current(generation)) return false;
    this.saving = false;
    this.held = !accepted;
    if (accepted && recovering) this.loaded = true;
    if (accepted) this.start();
    this.publish();
    return accepted;
  }
  setEnabled(enabled) {
    if (typeof enabled !== "boolean") return Promise.resolve(false);
    if (
      this.loaded &&
      !this.saving &&
      this.saved.enabled === enabled &&
      !this.suspended &&
      !this.enabling &&
      enabled === this.enabledIntent
    )
      return Promise.resolve(true);
    if (!enabled) this.enabledIntent = false;
    return this.preference(
      {
        ...clone(this.saved),
        enabled,
        unreadCompletions: enabled ? this.saved.unreadCompletions : 0,
      },
      enabled,
      ["enabled", "unreadCompletions"],
    );
  }
  setMuted(muted) {
    return typeof muted === "boolean"
      ? this.preference({ ...clone(this.saved), muted }, false, ["muted"])
      : Promise.resolve(false);
  }
  reset() {
    this.enabledIntent = false;
    return this.preference(null);
  }
  clearIndicator() {
    return this.preference(
      {
        ...clone(this.saved),
        unreadCompletions: 0,
        deliveryUncertain: false,
      },
      false,
      ["unreadCompletions", "deliveryUncertain"],
    );
  }
  async requestPermission() {
    const generation = this.generation;
    if (this.operational()) await this.refreshAuthorization(generation, true);
    this.publish();
  }
  presentation(focused) {
    this.focused = focused === true;
    if (this.focused) {
      this.delivery.withdrawProfile(this.binding?.profile);
      this.targets.clear();
    }
    this.publish();
  }
  async processPage(page, context) {
    completionPage(page);
    if (!this.contextCurrent(context)) return false;
    const generation = this.generation,
      store = page.store_id.toLowerCase();
    if (page.baseline) {
      const cursor = `${store}:${page.cursor}`;
      if (
        !(await this.persist(
          {
            ...clone(this.saved),
            enabled: true,
            cutoff: cursor,
            frontier: cursor,
          },
          generation,
        ))
      )
        return false;
      await this.refreshAuthorization(generation, this.enabling);
      if (!this.contextCurrent(context)) return false;
      this.enabling = false;
      this.publish();
    } else if (sequence(this.saved.frontier, store) === null) {
      this.pause("Notifications paused: completion store changed.");
      return false;
    }
    for (const item of page.items) {
      if (!this.contextCurrent(context)) return false;
      if (item.sequence <= sequence(this.saved.frontier, store)) continue;
      const cursor = `${store}:${item.sequence}`;
      if (
        !(await this.account(
          destination(this.binding.profile, item.session_id, cursor),
          item.kind === "goal" ? "Goal completed" : "Request completed",
          cursor,
          generation,
          null,
          context,
        ))
      )
        return false;
    }
    if (!this.contextCurrent(context)) return false;
    if (page.cursor > sequence(this.saved.frontier, store)) {
      if (
        !(await this.persist(
          { ...clone(this.saved), frontier: `${store}:${page.cursor}` },
          generation,
        ))
      )
        return false;
    }
    return true;
  }
  processNotice(notice, context) {
    if (!this.contextCurrent(context)) return false;
    if (!this.observer.isCurrent(notice, context)) return true;
    const hash = decisionHash(
      this.binding.profile,
      notice.session,
      notice.identity,
    );
    if (
      this.saved.seenDecisions.includes(hash) &&
      !this.saved.receipts.some(
        (value) => value.occurrence === `decision:${hash}`,
      )
    )
      return true;
    return this.account(
      destination(this.binding.profile, notice.session, `decision:${hash}`),
      "Decision needed",
      `decision:${hash}`,
      this.generation,
      notice,
      context,
    );
  }
  async account(target, title, cursor, generation, notice, context) {
    const existing = this.saved.receipts.find(
      (value) => value.occurrence === target.occurrence,
    );
    if (!existing) {
      await this.refreshAuthorization(generation);
      if (!this.contextCurrent(context)) return false;
      const next = clone(this.saved);
      if (notice) {
        const hash = target.occurrence.slice(9);
        if (!next.seenDecisions.includes(hash)) next.seenDecisions.push(hash);
      } else ++next.unreadCompletions;
      if (!this.authorization.allowed || next.muted || this.focused) {
        if (!notice) next.frontier = cursor;
        return this.persist(next, generation);
      }
      next.receipts.push({
        occurrence: target.occurrence,
        session: target.session,
        cursor,
        phase: "reserved",
      });
      if (
        !(await this.persist(next, generation)) ||
        !this.contextCurrent(context)
      )
        return false;
      if (
        this.delivery.shouldPresent(target) &&
        (!notice || this.observer.isCurrent(notice, context))
      ) {
        if (this.targets.size >= 64) {
          const oldest = this.targets.keys().next().value;
          this.targets.delete(oldest);
          this.delivery.withdraw([oldest]);
        }
        this.targets.set(target.identifier, {
          target,
          binding: this.binding,
          generation,
          notice,
          context,
        });
        let accepted = false;
        try {
          accepted = await this.delivery.add(target, title);
        } catch {
          /* account uncertain below */
        }
        if (!this.contextCurrent(context)) {
          this.delivery.withdraw([target.identifier]);
          return false;
        }
        const scheduled = clone(this.saved);
        if (accepted)
          scheduled.receipts.find(
            (value) => value.occurrence === target.occurrence,
          ).phase = "scheduled";
        else {
          scheduled.deliveryUncertain = true;
          this.targets.delete(target.identifier);
        }
        if (!(await this.persist(scheduled, generation))) {
          this.delivery.withdraw([target.identifier]);
          return false;
        }
      }
    } else {
      // A crash between reservation/submission/final accounting must never
      // reissue. Native history presence is not a banner or a current-engine
      // click binding; old process targets are never reconstructed from it.
      let present = false;
      try {
        present = await this.delivery.present(target);
      } catch {
        /* uncertain */
      }
      if (!this.contextCurrent(context)) return false;
      if (
        !present &&
        !(await this.persist(
          { ...clone(this.saved), deliveryUncertain: true },
          generation,
        ))
      )
        return false;
    }
    if (!this.contextCurrent(context)) return false;
    const next = clone(this.saved);
    next.receipts = next.receipts.filter(
      (value) => value.occurrence !== target.occurrence,
    );
    if (!notice) next.frontier = cursor;
    return this.persist(next, generation);
  }
  withdrawDecision(key) {
    const occurrence = `decision:${decisionHash(this.binding.profile, key.session, key.identity)}`;
    const target = destination(this.binding.profile, key.session, occurrence);
    this.targets.delete(target.identifier);
    this.delivery.withdraw([target.identifier]);
  }
  withdrawDecisions() {
    for (const [key, value] of this.targets)
      if (value.notice) {
        this.targets.delete(key);
        this.delivery.withdraw([key]);
      }
  }
  async respond(target) {
    const value = this.targets.get(target.identifier);
    if (
      !value ||
      (value.target !== target &&
        value.target.identifier !== target.identifier) ||
      !this.operational() ||
      value.generation !== this.generation ||
      !sameBinding(value.binding, this.getBinding()) ||
      (value.notice && !this.observer.isCurrent(value.notice, value.context))
    )
      return false;
    // Defer/reject consumes this click. No later navigation/input action is
    // scheduled when an editor/modal guard changes or a document becomes ready.
    this.targets.delete(target.identifier);
    this.delivery.withdraw([target.identifier]);
    try {
      return (
        (await this.navigate(
          Object.freeze({ session: value.target.session }),
        )) === "opened"
      );
    } catch {
      return false;
    }
  }
  documentRetiring() {
    this.targets.clear();
    this.delivery.withdrawProfile(this.binding?.profile);
  }
  navigationReady() {
    /* A fresh user click is required; never replay deferred input/navigation. */
  }
  async rebind() {
    const { generation, drain } = this.fence();
    const result = await drain.catch(() => ({ status: "unavailable" }));
    if (this.retired || generation !== this.generation) return false;
    if (result?.status === "unavailable") {
      this.pause();
      return false;
    }
    this.binding = validBinding(this.getBinding())
      ? Object.freeze({ ...this.getBinding() })
      : null;
    this.loaded = false;
    this.resettable = false;
    this.suspended = false;
    this.saved = defaults();
    this.enabledIntent = false;
    return this.load();
  }
  async retire() {
    if (this.retired) return false;
    const { drain } = this.fence();
    this.retired = true;
    this.delivery.retire();
    const results = await Promise.allSettled([
      drain,
      this.observer.retire(),
      ...this.pendingOperations,
    ]);
    return results.every(
      (result) =>
        result.status === "fulfilled" && result.value?.status !== "unavailable",
    );
  }
}
module.exports = { AttentionCoordinator, SAVE_ERROR };
