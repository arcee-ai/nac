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
      const database = new DatabaseSync(path.join(harness.runRoot, "store.db"), {
        readOnly: true,
      });
      try {
        const query =
          topology === "child"
            ? "SELECT COUNT(*) AS count FROM session_inbox WHERE session_id = ? AND content = ?"
            : "SELECT COUNT(*) AS count FROM thread_steering WHERE session_id = ? AND instruction = ?";
        return database.prepare(query).get(sessionId, prompt)?.count;
      } finally {
        database.close();
      }
    })
    .toBe(1);
}
