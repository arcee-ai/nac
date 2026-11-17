"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawn } = require("node:child_process");
const LIMIT = 8 * 1024 * 1024;
const fields = ["owner", "profile", "organization", "host", "store", "track"];
const record = (value) => value && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) =>
  record(value) && Object.keys(value).sort().join() === [...keys].sort().join();
const clone = (value) => JSON.parse(JSON.stringify(value));
const empty = () => ({ preferences: {}, drafts: {} });

function storageProfile(receipt, configuration) {
  const home = fs.realpathSync(configuration.env.HOME);
  const track = receipt.identity.track,
    store = receipt.store;
  if (
    !path.isAbsolute(home) ||
    !path.isAbsolute(store) ||
    !["dev", "beta", "stable"].includes(track)
  )
    throw new Error("Invalid presentation identity");
  const digest = createHash("sha256")
    .update(`nac-presentation-v1\0${home}\0${track}\0${store}`)
    .digest("hex");
  const binding = Object.freeze({
    owner: `desktop-${digest}`,
    profile: digest,
    organization: "local",
    host: "local",
    store: digest,
    track,
  });
  return Object.freeze({
    home,
    track,
    digest,
    binding,
    draftKey: "nac:prompt-drafts:v2:" + JSON.stringify(fields.map((key) => binding[key])),
  });
}
function validKey(profile, namespace, key) {
  if (typeof key !== "string" || Buffer.byteLength(key) > 512) return false;
  if (namespace === "drafts") return key === profile.draftKey;
  return (
    namespace === "preferences" &&
    ([
      "nac-panel-list-width",
      "nac-thread-log-height-ratio",
      "nac.last-light-model",
      "nac.chatTabs",
      "nac.sessionNavigation",
      "nac.sidebar.open",
      "nac.sidebar.view",
      "nac.sidebar.collapsed-projects",
      "nac.inbox.read.v1",
      "nac.transcriptDensity",
    ].includes(key) ||
      key.startsWith("nac.rightSidebar.collapsed."))
  );
}
function decode(profile, bytes) {
  if (!bytes.length) return { values: empty(), notifications: null, restored: false };
  const object = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (
    bytes.length > LIMIT ||
    ![1, 2].includes(object.version) ||
    object.profile !== profile.digest ||
    !exact(
      object,
      object.version === 1
        ? ["version", "profile", "values"]
        : ["version", "profile", "values", "native"],
    ) ||
    !exact(object.values, ["preferences", "drafts"])
  )
    throw new Error("Invalid checkpoint");
  for (const [namespace, entries] of Object.entries(object.values)) {
    if (
      !record(entries) ||
      Object.keys(entries).length > 256 ||
      Object.entries(entries).some(
        ([key, value]) => !validKey(profile, namespace, key) || typeof value !== "string",
      )
    )
      throw new Error("Invalid checkpoint");
  }
  if (
    object.version === 2 &&
    (!exact(object.native, ["notifications"]) || !record(object.native.notifications))
  )
    throw new Error("Invalid native checkpoint");
  return {
    values: object.values,
    notifications: object.native?.notifications ?? null,
    restored: object.version === 2,
  };
}

/** One outstanding helper operation. Its stdio is private to main. */
class Checkpoint {
  constructor(executable, profile) {
    this.child = spawn(executable, [profile.home, profile.track, profile.digest], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    this.buffer = Buffer.alloc(0);
    this.waiter = null;
    this.failed = false;
    this.loaded = new Promise((resolve) => {
      this.waiter = resolve;
    });
    this.closed = new Promise((resolve) =>
      this.child.once("close", () => {
        this.fail();
        resolve();
      }),
    );
    this.child.once("error", () => this.fail());
    this.child.stdin.on("error", () => this.fail());
    this.child.stdout.on("data", (bytes) => {
      if (this.buffer.length + bytes.length > LIMIT + 5) return this.fail();
      this.buffer = Buffer.concat([this.buffer, bytes]);
      if (this.buffer.length < 5) return;
      const length = this.buffer.readUInt32BE(1);
      if (length > LIMIT) return this.fail();
      if (this.buffer.length < length + 5) return;
      if (!this.waiter || this.buffer.length !== length + 5) return this.fail();
      const resolve = this.waiter;
      this.waiter = null;
      const result = this.buffer[0] === 0 ? this.buffer.subarray(5) : null;
      this.buffer = Buffer.alloc(0);
      if (result === null) this.failed = true;
      resolve(result);
    });
  }
  fail() {
    this.failed = true;
    this.waiter?.(null);
    this.waiter = null;
    this.child.stdin.end();
  }
  request(bytes) {
    if (this.failed || this.waiter) return Promise.resolve(false);
    return new Promise((resolve) => {
      this.waiter = (result) => resolve(result !== null);
      const header = Buffer.alloc(4);
      header.writeUInt32BE(bytes.length);
      this.child.stdin.write(Buffer.concat([header, bytes]));
    });
  }
  async write(bytes) {
    if (!(await this.request(bytes))) return false;
    // The write ACK is now observed by this exact parent. Only this explicit
    // acknowledgment permits deletion of its unique migration recovery source.
    return this.request(Buffer.alloc(0));
  }
  async close() {
    this.child.stdin.end();
    await this.closed;
  }
}
const bounded = async (promise, milliseconds, fallback) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
};

/** Stable profile lifetime, independent of HTTP origin and renderer documents.
 * v1/v2 Swift bytes are read in place without destructive migration. The first
 * replacement is the same versioned format and is ACKed only after directory
 * fsync. Until that replacement the original source remains recoverable. */
class PresentationStorage {
  static async open({ receipt, configuration, executable }) {
    const owner = new PresentationStorage(storageProfile(receipt, configuration));
    try {
      owner.checkpoint = new Checkpoint(executable, owner.profile);
      const bytes = await bounded(owner.checkpoint.loaded, 500, null);
      if (bytes === null) throw new Error("Unavailable checkpoint");
      const saved = decode(owner.profile, bytes);
      owner._values = saved.values;
      owner.notificationState = saved.notifications;
      owner.restored = saved.restored;
      owner.available = true;
    } catch {
      // Invalid/contended profiles never fall back to ambient Chromium storage.
      owner.available = false;
      void owner.checkpoint?.close();
    }
    return owner;
  }
  constructor(profile) {
    this.profile = profile;
    this._values = empty();
    this.available = false;
    this.pending = Promise.resolve(true);
    this.revision = 0;
    this.closed = false;
    this.pendingCount = 0;
    this.pendingBytes = 0;
    this.notificationState = null;
    this.notificationRevision = 0;
    this.notificationGeneration = -1;
    this.notificationToken = null;
    this.restored = false;
  }
  get binding() {
    return this.profile.binding;
  }
  get values() {
    return clone(this._values);
  }
  encode(values, state) {
    const bytes = Buffer.from(
      JSON.stringify({
        version: state === null ? 1 : 2,
        profile: this.profile.digest,
        values,
        ...(state === null ? {} : { native: { notifications: state } }),
      }),
    );
    if (bytes.length > LIMIT) throw new Error("Checkpoint full");
    return bytes;
  }
  enqueue(bytes) {
    const revision = ++this.revision;
    this.pendingCount++;
    this.pendingBytes += bytes.length;
    const promise = this.pending
      .then(async () => {
        const durable = this.available && (await this.checkpoint.write(bytes));
        if (!durable) this.available = false;
        return durable;
      })
      .catch(() => {
        this.available = false;
        return false;
      })
      .finally(() => {
        this.pendingCount--;
        this.pendingBytes -= bytes.length;
      });
    this.pending = promise;
    return promise.then((durable) => ({ revision, durable }));
  }
  hasCapacity(bytes) {
    return (
      this.pendingCount < 128 &&
      this.pendingBytes + bytes.length <= 2 * LIMIT &&
      this.revision < Number.MAX_SAFE_INTEGER
    );
  }
  write(namespace, key, value) {
    if (
      this.closed ||
      !validKey(this.profile, namespace, key) ||
      !(value === null || typeof value === "string")
    )
      return null;
    const values = this.values;
    if (value === null) delete values[namespace][key];
    else
      Object.defineProperty(values[namespace], key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    if (Object.keys(values[namespace]).length > 256) return null;
    let bytes;
    try {
      bytes = this.encode(values, this.notificationState);
    } catch {
      return null;
    }
    if (!this.hasCapacity(bytes)) return null;
    this._values = values;
    return this.enqueue(bytes);
  }
  async flush() {
    return bounded(
      this.pending.then(() => this.available),
      500,
      false,
    );
  }
  async snapshot() {
    const available = !this.closed && (await this.flush());
    return { available, values: available ? this.values : empty() };
  }
  beginNotifications(generation) {
    if (
      this.closed ||
      this.notificationToken ||
      !Number.isSafeInteger(generation) ||
      generation <= this.notificationGeneration
    )
      return null;
    this.notificationGeneration = generation;
    return (this.notificationToken = Object.freeze({ generation, profile: this.profile.digest }));
  }
  current(token) {
    return !this.closed && token && token === this.notificationToken;
  }
  async readNotifications(token) {
    if (!this.current(token)) return { status: "stale" };
    const durable = await this.flush();
    if (!this.current(token)) return { status: "stale" };
    return durable
      ? {
          status: "available",
          revision: this.notificationRevision,
          state: clone(this.notificationState),
          restored: this.restored,
        }
      : { status: "unavailable" };
  }
  updateNotifications(token, expectedRevision, next) {
    if (!this.current(token) || expectedRevision !== this.notificationRevision)
      return Promise.resolve({ status: "stale" });
    if (!this.available)
      return Promise.resolve({ status: "unavailable", revision: this.notificationRevision });
    let bytes, state;
    try {
      if (next !== null && !record(next)) throw new Error("Invalid native state");
      state = clone(next);
      bytes = this.encode(this._values, state);
    } catch {
      return Promise.resolve({ status: "unavailable", revision: this.notificationRevision });
    }
    if (!this.hasCapacity(bytes) || this.notificationRevision >= Number.MAX_SAFE_INTEGER)
      return Promise.resolve({ status: "unavailable", revision: this.notificationRevision });
    const revision = ++this.notificationRevision;
    this.notificationState = state;
    return this.enqueue(bytes).then(({ durable }) => {
      if (!this.current(token)) return { status: "stale", revision };
      if (durable && revision === this.notificationRevision) this.restored = false;
      return { status: durable ? "durable" : "unavailable", revision };
    });
  }
  async flushNotifications(token) {
    if (!this.current(token)) return { status: "stale" };
    const revision = this.notificationRevision,
      durable = await this.flush();
    return {
      status: !this.current(token) ? "stale" : durable ? "durable" : "unavailable",
      revision,
    };
  }
  retireNotifications(token) {
    if (!this.current(token)) return Promise.resolve({ status: "stale" });
    this.notificationToken = null;
    const revision = this.notificationRevision;
    return this.pending.then(() => ({
      status: this.available ? "durable" : "unavailable",
      revision,
    }));
  }
  close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.notificationToken = null;
    return (this.closePromise = this.pending.then(() => this.checkpoint?.close()));
  }
}
module.exports = { PresentationStorage, storageProfile, validKey, decode, LIMIT };
