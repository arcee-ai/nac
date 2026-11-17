"use strict";
const { randomUUID } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const LIMIT = 16 * 1024;
const failures = Object.freeze({
  store_owned:
    "Another NAC process owns the selected store. Quit that process yourself, then choose Retry. This app will not attach to or stop it.",
  store_schema_incompatible:
    "The selected store uses a newer database schema. Reopen it with a compatible newer NAC app. Keep your configuration and data; do not delete or downgrade the store. No alternative store was selected.",
  engine_unavailable:
    "The bundled engine could not initialize its selected store or listener. Check the selected directory and configuration, then choose Retry.",
});
class LaunchError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
function invalid() {
  return new LaunchError(
    "invalid_receipt",
    "The bundled engine sent an invalid launch receipt. Replace the complete app bundle or retry after its child has stopped.",
  );
}
function keys(value, names) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...names].sort().join(",")
  );
}
function validIdentity(value) {
  return (
    keys(value, ["product_version", "build_id", "source_revision", "track"]) &&
    ["product_version", "build_id", "source_revision"].every(
      (k) => typeof value[k] === "string" && value[k].length > 0 && value[k].length <= 512,
    ) &&
    ["dev", "beta", "stable"].includes(value.track) &&
    !value.build_id.startsWith("native-auth-fixture-")
  );
}
class LaunchProtocol {
  constructor(identity, store, schema) {
    if (
      !validIdentity(identity) ||
      typeof store !== "string" ||
      !store.startsWith("/") ||
      !Number.isSafeInteger(schema) ||
      schema < 1
    )
      throw invalid();
    this.identity = identity;
    this.store = store;
    this.schema = schema;
    this.incarnation = randomUUID();
    this.pending = Buffer.alloc(0);
    this.ready = null;
  }
  hello() {
    return this.record({
      kind: "hello",
      version: 1,
      incarnation: this.incarnation,
      identity: this.identity,
      store: this.store,
    });
  }
  stop() {
    return this.record({ kind: "stop", version: 1, incarnation: this.incarnation });
  }
  record(value) {
    const bytes = Buffer.from(JSON.stringify(value) + "\n");
    if (bytes.length > LIMIT) throw invalid();
    return bytes;
  }
  receive(bytes) {
    let published = null;
    for (const byte of bytes) {
      if (this.ready) throw invalid();
      if (this.pending.length >= LIMIT) throw invalid();
      this.pending = Buffer.concat([this.pending, Buffer.from([byte])]);
      if (byte !== 10) continue;
      let value;
      try {
        value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(this.pending));
      } catch {
        throw invalid();
      }
      this.pending = Buffer.alloc(0);
      if (!value || value.version !== 1 || value.incarnation !== this.incarnation || this.ready)
        throw invalid();
      if (value.kind === "failed") {
        if (
          !keys(value, ["kind", "version", "incarnation", "stage", "code", "message"]) ||
          value.stage !== "startup" ||
          typeof value.message !== "string"
        )
          throw invalid();
        const code = Object.hasOwn(failures, value.code) ? value.code : "engine_unavailable";
        throw new LaunchError(code, failures[code]);
      }
      if (
        !keys(value, [
          "kind",
          "version",
          "incarnation",
          "endpoint",
          "identity",
          "store",
          "schema",
        ]) ||
        value.kind !== "ready" ||
        !isDeepStrictEqual(value.identity, this.identity) ||
        value.store !== this.store ||
        value.schema !== this.schema ||
        typeof value.endpoint !== "string" ||
        !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(value.endpoint)
      )
        throw invalid();
      const url = new URL(value.endpoint);
      if (Number(url.port) > 65535 || !url.port) throw invalid();
      this.ready = value;
      published = value;
    }
    return published;
  }
}
module.exports = { LaunchProtocol, LaunchError, validIdentity, LIMIT, failures };
