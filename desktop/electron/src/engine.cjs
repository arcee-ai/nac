"use strict";
const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const { LaunchProtocol, LaunchError } = require("./protocol.cjs");

/** Node owns the exact custody helper, which retains/reaps the Rust leader. */
class Engine extends EventEmitter {
  constructor({ executable, identity, schema, configuration, launcher }) {
    super();
    this.executable = executable;
    if (!path.isAbsolute(launcher ?? ""))
      throw new Error("An exact bundled engine launcher is required.");
    this.launcher = launcher;
    this.configuration = configuration;
    this.protocol = new LaunchProtocol(identity, configuration.store, schema);
    this.child = null;
    this.stopping = false;
    this.failed = false;
    this.exited = false;
    this.enginePid = 0;
    this.custodySettled = false;
    this.helperClosed = false;
    this.custodyPending = Buffer.alloc(0);
    this.readyPending = null;
    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
  }
  get pid() {
    return this.exited ? 0 : this.enginePid;
  }
  get receipt() {
    return !this.stopping && !this.failed ? this.protocol.ready : null;
  }
  launch() {
    if (this.child) throw new Error("This engine launch has already been used.");
    const config = this.configuration;
    const child = spawn(
      this.launcher,
      [
        this.executable,
        "--bind",
        "127.0.0.1:0",
        "--directory",
        config.cwd,
        "--store-path",
        config.store,
        "--worker-executable",
        this.executable,
        "--no-open",
      ],
      {
        cwd: config.cwd,
        env: { ...config.env, NAC_DESKTOP_CHANNEL_FD: "3" },
        detached: true,
        stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
      },
    );
    this.child = child;
    // Raw configuration/provider diagnostics never reach logs/UI.
    child.stdout.on("data", () => {});
    child.stderr.on("data", () => {});
    const channel = child.stdio[3],
      custody = child.stdio[4];
    // Only a validated terminal fact acknowledges the helper's read half.
    custody.allowHalfOpen = true;
    custody.on("data", (bytes) => {
      try {
        this.receiveCustody(bytes);
      } catch {
        this.custodySettled = false;
        this.fail(
          new LaunchError(
            "custody_invalid",
            "The engine custody adapter returned an invalid receipt. Cleanup is still pending.",
          ),
        );
        channel.destroy();
        custody.destroy();
      }
    });
    custody.on("end", () => {
      if (!this.custodySettled) custody.destroy();
    });
    custody.on("error", () => {
      channel.destroy();
      if (!this.custodySettled)
        this.fail(
          new LaunchError(
            "custody_lost",
            "The engine custody channel failed. Cleanup is still pending.",
          ),
        );
    });
    channel.on("error", () => {
      if (!this.stopping)
        this.fail(new LaunchError("channel_lost", "The bundled engine launch channel failed."));
    });
    channel.on("data", (bytes) => {
      if (this.stopping || this.failed) return;
      try {
        const ready = this.protocol.receive(bytes);
        if (ready) {
          this.readyPending = ready;
          this.publishReady();
        }
      } catch (error) {
        this.fail(error);
      }
    });
    channel.on("end", () => {
      if (!this.stopping)
        this.fail(
          new LaunchError("channel_lost", "The bundled engine launch channel closed unexpectedly."),
        );
    });
    child.once("error", () => {
      // spawn error proves the helper never existed, hence no Rust child.
      if (!child.pid) this.custodySettled = true;
      this.fail(
        new LaunchError(
          "engine_spawn",
          "The bundled NAC engine custody adapter could not be launched. Replace the complete app bundle, then Retry.",
        ),
      );
    });
    child.once("close", () => {
      this.helperClosed = true;
      clearTimeout(this.startupTimer);
      channel.destroy();
      custody.destroy();
      this.finishSettlement();
      if (!this.custodySettled)
        this.fail(
          new LaunchError(
            "cleanup_pending",
            "The engine custody adapter exited without proving descendant cleanup. The original cleanup remains pending; a new engine cannot be started.",
          ),
        );
      else if (!this.stopping && !this.failed)
        this.fail(
          new LaunchError(
            "engine_exit",
            "The bundled NAC engine exited. Choose Retry to start a new engine; input will not be replayed.",
          ),
        );
    });
    channel.write(this.protocol.hello());
    this.startupTimer = setTimeout(
      () =>
        this.fail(
          new LaunchError(
            "startup_timeout",
            "The bundled engine did not become ready within 30 seconds.",
          ),
        ),
      30000,
    );
    return this;
  }
  receiveCustody(bytes) {
    let terminal;
    for (const byte of bytes) {
      if (this.custodySettled || terminal) throw new Error("trailing custody");
      if (this.custodyPending.length >= 128) throw new Error("oversized custody");
      this.custodyPending = Buffer.concat([this.custodyPending, Buffer.from([byte])]);
      if (byte !== 10) continue;
      const value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(this.custodyPending),
      );
      this.custodyPending = Buffer.alloc(0);
      if (
        !value ||
        Object.keys(value).sort().join(",") !== "kind,pid" ||
        !Number.isSafeInteger(value.pid)
      )
        throw new Error("invalid custody");
      if (
        value.kind === "spawned" &&
        !this.enginePid &&
        !this.custodySettled &&
        value.pid > 0 &&
        value.pid <= 2147483647
      ) {
        this.enginePid = value.pid;
        this.publishReady();
      } else if (
        value.kind === "settled" &&
        this.enginePid &&
        value.pid === this.enginePid &&
        !this.custodySettled
      ) {
        terminal = "settled";
      } else if (
        value.kind === "failed" &&
        value.pid === 0 &&
        !this.enginePid &&
        !this.custodySettled
      ) {
        terminal = "failed";
      } else throw new Error("invalid custody sequence");
    }
    // A validated terminal fact acknowledges the helper's output half-close.
    // Keep reading until then: a late stop must never destroy unread proof.
    if (terminal) {
      this.custodySettled = true;
      this.child.stdio[4].end();
      if (terminal === "failed")
        this.fail(
          new LaunchError(
            "engine_spawn",
            "The bundled engine could not be spawned. Replace the complete app bundle, then Retry.",
          ),
        );
      else this.finishSettlement();
    }
  }
  publishReady() {
    if (!this.readyPending || !this.enginePid || this.stopping || this.failed) return;
    const receipt = this.readyPending;
    this.readyPending = null;
    clearTimeout(this.startupTimer);
    this.emit("ready", receipt);
  }
  finishSettlement() {
    if (this.exited || !this.helperClosed || !this.custodySettled) return;
    this.exited = true;
    this.resolveExit();
    this.emit("exit");
  }
  fail(error) {
    if (this.failed) return;
    this.failed = true;
    const observed = this.emit("failure", error);
    if (!observed) void this.stop();
  }
  stop() {
    if (this.exited || !this.child) return Promise.resolve();
    if (!this.stopping) {
      this.stopping = true;
      clearTimeout(this.startupTimer);
      const channel = this.child.stdio[3],
        custody = this.child.stdio[4];
      // The native owner starts its 23-second fallback exactly once, while
      // retaining the unreaped engine identity. Rust receives its ordinary
      // stop/EOF first and keeps the existing 20-second settlement watchdog.
      if (!this.custodySettled && !custody.destroyed && !custody.writableEnded)
        custody.write("stop\n", () => {});
      if (!channel.destroyed)
        channel.write(this.protocol.stop(), (error) => {
          if (error) channel.destroy();
        });
    }
    return this.exitPromise;
  }
}
module.exports = { Engine };
