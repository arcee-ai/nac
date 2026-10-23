import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { expect, type EmbeddedHarness } from "./harness";

export function isSqliteObservationLock(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("errcode" in error)) return false;
  const code = error.errcode;
  if (typeof code !== "number" || !Number.isInteger(code) || code < 0) return false;
  // SQLite's low byte is the primary result code. BUSY/LOCKED can carry an
  // extended code, and native errors can originate outside this module's realm.
  const primary = code & 0xff;
  return primary === 5 || primary === 6;
}

/** Read the committed receipt before releasing a model barrier; never mutate fixture state. */
export async function waitForDelegatedInput(
  harness: EmbeddedHarness,
  topology: "child" | "orchestrator",
  sessionId: string,
  prompt: string,
) {
  await expect
    .poll(() => {
      let database: DatabaseSync | undefined;
      try {
        database = new DatabaseSync(path.join(harness.runRoot, "store.db"), {
          readOnly: true,
        });
        const query =
          topology === "child"
            ? "SELECT COUNT(*) AS count FROM session_inbox WHERE session_id = ? AND content = ?"
            : "SELECT COUNT(*) AS count FROM thread_steering WHERE session_id = ? AND instruction = ?";
        return database.prepare(query).get(sessionId, prompt)?.count;
      } catch (error) {
        // This external observer has no serving-owner connection. A concurrent
        // checkpoint/open can briefly lock it; retry only that observation,
        // never the product's submission or an arbitrary SQL failure.
        if (isSqliteObservationLock(error)) return 0;
        throw error;
      } finally {
        database?.close();
      }
    })
    .toBe(1);
}
