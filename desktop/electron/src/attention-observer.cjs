"use strict";

const http = require("node:http");
const { AttentionSSEParser } = require("./attention-protocol.cjs");
const { AttentionProjection } = require("./attention-projection.cjs");
const { uuid } = require("./notification-state.cjs");

function validBinding(value) {
  if (!value || !/^[a-f0-9]{64}$/.test(value.profile) || !uuid(value.engine))
    return false;
  try {
    const url = new URL(value.endpoint);
    return (
      url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      +url.port > 0 &&
      +url.port <= 65535 &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/"
    );
  } catch {
    return false;
  }
}
const sameBinding = (a, b) =>
  validBinding(a) &&
  validBinding(b) &&
  a.profile === b.profile &&
  a.engine === b.engine &&
  new URL(a.endpoint).origin === new URL(b.endpoint).origin;

class AttentionObserver {
  constructor({
    page,
    notice,
    resolved = () => {},
    withdraw = () => {},
    status = () => {},
    request = http.get,
  }) {
    Object.assign(this, { page, notice, resolved, withdraw, status, request });
    this.generation = 0;
    this.active = null;
    this.retry = null;
    this.attempt = 0;
    this.retired = false;
    this.projection = new AttentionProjection();
    this.draining = new Set();
    this.notices = new Set();
  }
  start(binding, cursor = null) {
    this.stop();
    if (this.retired || !validBinding(binding)) return false;
    this.binding = Object.freeze({ ...binding });
    this.cursor = cursor;
    this.attempt = 0;
    this.connect(this.generation);
    return true;
  }
  current(generation) {
    return !this.retired && generation === this.generation;
  }
  publish(phase, tasks, retries) {
    this.status({
      phase,
      tasks,
      retries,
      generation: this.generation,
      ...this.projection.retention(),
      framingBytes: this.parser?.retainedWireBytes ?? 0,
      inflightNotices: this.notices.size,
      drainingStreams: this.draining.size,
      projectionAvailable: this.projection.boundary !== null,
    });
  }
  connect(generation) {
    if (!this.current(generation) || this.active) return;
    const binding = this.binding,
      parser = new AttentionSSEParser();
    this.parser = parser;
    this.projection = new AttentionProjection();
    this.publish("connecting", 1, 0);
    const job = this.run(generation, binding, parser);
    this.draining.add(job);
    job.finally(() => this.draining.delete(job));
  }
  async run(generation, binding, parser) {
    let retry = true;
    try {
      const response = await new Promise((resolve, reject) => {
        const req = this.request(
          new URL("/attention/events", binding.endpoint),
          {
            agent: false,
            headers: {
              Accept: "text/event-stream",
              "X-NAC-Completion-Cursor": this.cursor ?? "new",
            },
          },
          resolve,
        );
        this.active = req;
        req.on("error", reject);
      });
      if (!this.current(generation)) {
        response.destroy();
        return;
      }
      if (
        response.statusCode !== 200 ||
        response.headers["content-type"]?.split(";")[0] !== "text/event-stream"
      ) {
        retry = [409, 503].includes(response.statusCode);
        response.destroy();
        throw Error("Attention unavailable");
      }
      this.publish("observing", 1, 0);
      for await (const chunk of response) {
        try {
          await parser.consume(chunk, async (frame) => {
            if (!this.current(generation)) return false;
            if (frame.kind === "reset") {
              const error = Error("Attention rebaseline required");
              error.rebaseline = true;
              throw error;
            }
            if (frame.kind === "completions") {
              const accepted = await this.page(frame.page, {
                binding,
                generation,
              });
              if (!this.current(generation) || !accepted) {
                retry = false;
                return false;
              }
              this.cursor = `${frame.page.store_id.toLowerCase()}:${frame.page.cursor}`;
            } else {
              const effects = this.projection.accept(frame, binding.engine);
              this.resolved(effects.resolved, { binding, generation });
              for (const notice of effects.notices) {
                // Continue consuming resolution/availability metadata while an
                // exact durable notice reservation waits on disk. Bound all work.
                if (!this.current(generation) || this.notices.size >= 1024) {
                  retry = false;
                  return false;
                }
                const job = Promise.resolve().then(
                  () =>
                    this.current(generation) &&
                    this.notice(notice, { binding, generation }),
                );
                this.notices.add(job);
                job
                  .then(
                    (accepted) => {
                      if (!accepted && this.current(generation)) this.stop();
                    },
                    () => {
                      if (this.current(generation)) this.stop();
                    },
                  )
                  .finally(() => this.notices.delete(job));
              }
            }
            this.publish("observing", 1, 0);
            return this.current(generation);
          });
        } catch (error) {
          retry = error.rebaseline === true;
          throw error;
        }
      }
    } catch {
      /* A failed/malformed stream establishes no completion or resolution. */
    } finally {
      if (this.current(generation)) {
        this.active?.destroy();
        this.active = null;
        this.withdraw();
        this.parser = null;
        this.projection = new AttentionProjection();
        this.publish("unavailable", 0, retry ? 1 : 0);
        if (retry) {
          const delay = Math.min(
            30000,
            1000 * 2 ** Math.min(this.attempt++, 5),
          );
          this.retry = setTimeout(() => {
            this.retry = null;
            this.connect(generation);
          }, delay);
          this.retry.unref?.();
        }
      }
    }
  }
  isCurrent(notice, context) {
    return (
      this.current(context.generation) &&
      sameBinding(this.binding, context.binding) &&
      this.projection.isCurrent(notice)
    );
  }
  stop() {
    ++this.generation;
    clearTimeout(this.retry);
    this.retry = null;
    this.active?.destroy();
    this.active = null;
    this.binding = null;
    this.parser = null;
    this.projection = new AttentionProjection();
    this.withdraw();
    this.publish(this.retired ? "retired" : "disabled", 0, 0);
  }
  async retire() {
    this.retired = true;
    this.stop();
    await Promise.allSettled([...this.draining, ...this.notices]);
  }
}
module.exports = { AttentionObserver, validBinding, sameBinding };
