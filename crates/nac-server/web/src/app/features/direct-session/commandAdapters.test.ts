import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries/keys";
import { resetRuntime, runtimeStore, syncRunFromSnapshot } from "@/app/store/runtimeStore";
import type { ManagedSessionSummary, SessionSnapshotResponse } from "@/app/types/api";
import { makeStopPorts } from "./commandAdapters";
import { runCommand, stopRun } from "./commandWorkflow";

const active = { run_id: "run-a", prompt_preview: "work", started_at_epoch_ms: 1 };
function summary(id: string, title = id): ManagedSessionSummary {
  // SAFETY: only the identity, active-run projection and title are used by this adapter.
  return {
    summary: { session_id: id, title },
    active: true,
    active_run: active,
  } as ManagedSessionSummary;
}
function snapshot(): SessionSnapshotResponse {
  // SAFETY: Stop reads/replaces only active_run; marker messages detect stale rollback.
  return { active_run: active, messages: [] } as unknown as SessionSnapshotResponse;
}
afterEach(() => {
  vi.restoreAllMocks();
  resetRuntime(null);
});

describe("origin-bound Stop settlement", () => {
  it("rolls back only its session entry while preserving unrelated/newer list writes", async () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.sessions(false), [summary("a"), summary("b")]);
    client.setQueryData(queryKeys.sessionSnapshot("a"), snapshot());
    resetRuntime("a");
    syncRunFromSnapshot(active);
    const response = Promise.withResolvers<void>();
    vi.spyOn(api, "cancelActiveRun").mockReturnValue(response.promise);
    const command = runCommand(stopRun(makeStopPorts(client, "a")));
    const failed = expect(command).rejects.toThrow("cancel failed");
    await vi.waitFor(() => expect(runtimeStore.getState().cancelArmed).toBe(true));
    client.setQueryData<ManagedSessionSummary[]>(queryKeys.sessions(false), (entries) =>
      entries?.map((entry) => (entry.summary.session_id === "b" ? summary("b", "newer") : entry)),
    );
    response.reject(new Error("cancel failed"));
    await failed;
    expect(
      client
        .getQueryData<ManagedSessionSummary[]>(queryKeys.sessions(false))
        ?.map((entry) => [entry.summary.title, entry.active]),
    ).toEqual([
      ["a", true],
      ["newer", true],
    ]);
    expect(runtimeStore.getState().running).toBe(true);
    expect(
      client.getQueryData<SessionSnapshotResponse>(queryKeys.sessionSnapshot("a"))?.active_run,
    ).toEqual(active);
  });

  for (const outcome of ["success", "failure"] as const) {
    it(`does not change another activation on late ${outcome}`, async () => {
      const client = new QueryClient();
      resetRuntime("a");
      syncRunFromSnapshot(active);
      const response = Promise.withResolvers<void>();
      vi.spyOn(api, "cancelActiveRun").mockReturnValue(response.promise);
      const command = runCommand(stopRun(makeStopPorts(client, "a")));
      const settled = outcome === "failure" ? expect(command).rejects.toThrow("late") : command;
      await vi.waitFor(() => expect(runtimeStore.getState().cancelArmed).toBe(true));
      // Same identity reopening must also get a fresh presentation activation.
      resetRuntime("a");
      syncRunFromSnapshot({ ...active, run_id: "new-run" });
      const next = runtimeStore.getState();
      if (outcome === "success") response.resolve();
      else response.reject(new Error("late"));
      await settled;
      expect(runtimeStore.getState()).toBe(next);
    });
  }

  it("keeps a newer canonical snapshot after failed cancellation", async () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.sessionSnapshot("a"), snapshot());
    const response = Promise.withResolvers<void>();
    vi.spyOn(api, "cancelActiveRun").mockReturnValue(response.promise);
    const command = runCommand(stopRun(makeStopPorts(client, "a")));
    const failed = expect(command).rejects.toThrow("late");
    await vi.waitFor(() => expect(api.cancelActiveRun).toHaveBeenCalled());
    const newer = client.setQueryData(queryKeys.sessionSnapshot("a"), {
      ...snapshot(),
      messages: [{ role: "assistant", content: "newer" }],
      active_run: undefined,
    });
    response.reject(new Error("late"));
    await failed;
    expect(client.getQueryData(queryKeys.sessionSnapshot("a"))).toBe(newer);
  });
});
