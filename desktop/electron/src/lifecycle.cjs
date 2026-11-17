"use strict";
const { randomUUID } = require("node:crypto");
/** One protected transaction. Unknown activity always requires a choice. */
class Lifecycle {
  constructor() {
    this.phase = "running";
    this.launch = null;
    this.transaction = null;
    this.stopToken = null;
  }
  beginLaunch() {
    if (this.launch || !["running", "confirming"].includes(this.phase)) return null;
    return (this.launch = randomUUID());
  }
  childExited(launch) {
    if (this.launch === launch) this.launch = null;
  }
  get canHide() {
    return this.phase === "running";
  }
  requestQuit() {
    if (this.phase === "finished") return { kind: "terminate" };
    if (this.phase === "confirming") return { kind: "pending" };
    if (this.phase === "stopping") return { kind: "wait", token: this.stopToken };
    if (this.phase === "pending-cleanup") {
      this.phase = "stopping";
      return { kind: "wait", token: this.stopToken };
    }
    this.phase = "confirming";
    this.transaction = randomUUID();
    return { kind: "confirm", transaction: this.transaction };
  }
  answer(transaction, stop) {
    if (this.phase !== "confirming" || transaction !== this.transaction) return { kind: "ignored" };
    this.transaction = null;
    if (!stop) {
      this.phase = "running";
      return { kind: "cancel" };
    }
    this.phase = "stopping";
    this.stopToken = { id: randomUUID(), launch: this.launch };
    return { kind: "stop", token: this.stopToken };
  }
  timedOut(token) {
    if (this.phase !== "stopping" || this.stopToken !== token) return false;
    this.phase = "pending-cleanup";
    return true;
  }
  stopped(token, ownedChildExited) {
    if (
      !ownedChildExited ||
      this.stopToken !== token ||
      !["stopping", "pending-cleanup"].includes(this.phase) ||
      (this.launch && this.launch !== token.launch)
    )
      return "ignored";
    const result = this.phase === "pending-cleanup" ? "settled-after-timeout" : "terminate";
    this.launch = null;
    this.phase = "finished";
    return result;
  }
}
module.exports = { Lifecycle };
