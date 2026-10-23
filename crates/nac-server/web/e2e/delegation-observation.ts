import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { expect, type EmbeddedHarness } from "./harness";

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
        if (
          error instanceof Error &&
          "errcode" in error &&
          (error.errcode === 5 || error.errcode === 6)
        )
          return 0;
        throw error;
      } finally {
        database?.close();
      }
    })
    .toBe(1);
}
