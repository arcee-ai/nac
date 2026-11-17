"use strict";
const { isDeepStrictEqual } = require("node:util");

/** Readiness supplements the retained private launch receipt. It cannot discover
 * or adopt an engine, choose an endpoint or establish process custody. */
async function checkReadiness(engine, pinned, fetcher = fetch) {
  const same = () => engine.pid > 0 && !engine.exited && engine.receipt === pinned;
  if (!pinned || !same())
    throw new Error("The original engine is unavailable. Restart it explicitly after cleanup.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetcher(pinned.endpoint + "/readyz", {
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok || !response.body) throw new Error("Unavailable engine");
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 16384) throw new Error("Oversized readiness");
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
    if (
      !same() ||
      value.status !== "ok" ||
      value.opened_schema_version !== pinned.schema ||
      !isDeepStrictEqual(
        {
          product_version: value.product_version,
          build_id: value.build_id,
          source_revision: value.source_revision,
          track: value.build_track,
        },
        pinned.identity,
      )
    )
      throw new Error("Changed readiness binding");
  } finally {
    clearTimeout(timer);
  }
}

function routeFragment(url, endpoint) {
  try {
    const parsed = new URL(url);
    return parsed.origin === endpoint && parsed.hash.length <= 8192 ? parsed.hash : "";
  } catch {
    return "";
  }
}
module.exports = { checkReadiness, routeFragment };
