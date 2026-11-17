"use strict";

const { destination } = require("./notification-state.cjs");

// Electron exposes Notification.isSupported(), show/failure/click/close, but no
// macOS authorization-status query or requestAuthorization method. The default
// reports system-managed permission, not a fabricated authorization grant.
// An optional platform permission probe can supply denied/pending explicitly.
class ElectronNotificationDelivery {
  constructor({ Notification, permission = null }) {
    this.Notification = Notification;
    this.permission = permission;
    this.notifications = new Map();
    this.retired = false;
    this.response = null;
    this.shouldPresent = null;
  }
  async settings() {
    if (this.retired || !this.Notification.isSupported())
      return { allowed: false, mayRequest: false, status: "unavailable" };
    if (this.permission) return this.permission.settings();
    return { allowed: true, mayRequest: false, status: "system-managed" };
  }
  async authorize() {
    return this.permission ? this.permission.authorize() : false;
  }
  add(target, title) {
    if (
      this.retired ||
      this.notifications.size >= 64 ||
      this.notifications.has(target.identifier) ||
      this.shouldPresent?.(target) !== true
    )
      return Promise.resolve(false);
    try {
      const validated = destination(
        target.profile,
        target.session,
        target.occurrence,
      );
      if (
        validated.identifier !== target.identifier ||
        !["Request completed", "Goal completed", "Decision needed"].includes(
          title,
        )
      )
        return Promise.resolve(false);
      const notification = new this.Notification({
        id: target.identifier,
        groupId: `nac-attention-${target.profile}`,
        title,
        body: "Open NAC to view current state.",
        silent: false,
        urgency: "normal",
        timeoutType: "default",
      });
      const entry = { target: validated, notification, settle: null };
      this.notifications.set(target.identifier, entry);
      return new Promise((resolve) => {
        let done = false;
        const finish = (accepted) => {
          if (!done) {
            done = true;
            clearTimeout(entry.timer);
            resolve(accepted);
          }
        };
        entry.settle = finish;
        notification.once("show", () => {
          if (
            this.retired ||
            this.notifications.get(target.identifier) !== entry ||
            this.shouldPresent?.(validated) !== true
          ) {
            notification.close();
            finish(false);
          } else finish(true); // OS submission receipt, never proof of a visible banner.
        });
        notification.once("failed", () => {
          finish(false);
          if (this.notifications.get(target.identifier) === entry)
            this.notifications.delete(target.identifier);
        });
        notification.once("close", () => {
          finish(false);
          if (this.notifications.get(target.identifier) === entry)
            this.notifications.delete(target.identifier);
        });
        notification.on("click", () => {
          if (
            !this.retired &&
            this.notifications.get(target.identifier) === entry
          )
            this.response?.(validated);
        });
        entry.timer = setTimeout(() => {
          finish(false);
          this.withdraw([target.identifier]);
        }, 5000);
        entry.timer.unref?.();
        notification.show();
      });
    } catch {
      this.withdraw([target.identifier]);
      return Promise.resolve(false);
    }
  }
  async present(target) {
    if (this.notifications.has(target.identifier)) return true;
    if (!this.Notification.getHistory) return false;
    const history = await this.Notification.getHistory();
    return (
      !this.retired &&
      history.some(
        (value) =>
          value.id === target.identifier &&
          value.groupId === `nac-attention-${target.profile}`,
      )
    );
  }
  withdraw(identifiers) {
    for (const identifier of identifiers) {
      const entry = this.notifications.get(identifier);
      if (!entry) continue;
      this.notifications.delete(identifier);
      clearTimeout(entry.timer);
      entry.settle?.(false);
      entry.notification.close();
    }
    this.Notification.remove?.(identifiers);
  }
  withdrawProfile(profile) {
    this.withdraw(
      [...this.notifications]
        .filter(([, entry]) => entry.target.profile === profile)
        .map(([key]) => key),
    );
    // The native group is scoped to one canonical profile; do not remove other
    // profiles or unrelated application notifications. No delayed enumeration
    // may withdraw a successor delivery.
    if (/^[a-f0-9]{64}$/.test(profile))
      this.Notification.removeGroup?.(`nac-attention-${profile}`);
  }
  retire() {
    this.retired = true;
    this.withdraw([...this.notifications.keys()]);
    this.response = null;
    this.shouldPresent = null;
  }
}
module.exports = { ElectronNotificationDelivery };
