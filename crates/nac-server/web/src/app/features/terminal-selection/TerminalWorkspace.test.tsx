/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeContext } from "@/app/runtime/RuntimeContext";
import { createNativeRuntime, type NativeRuntime } from "@/app/runtime/nativeRuntime";
import { createNacClient } from "@/app/services/nacClient";
import { queryKeys } from "@/app/services/queries/keys";
import { TerminalWorkspace } from "./TerminalWorkspace";

const review = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("./useSelectionReview", () => ({
  useSelectionReview: () => ({ controller: review, state: {} }),
}));
vi.mock("@/app/features/terminal/TerminalPane", () => ({
  TerminalPane: ({ onReviewSelection }: { onReviewSelection: (capture: unknown) => void }) => (
    <button onClick={() => onReviewSelection({ selectedText: "explicit capture" })}>
      Review rendered capture
    </button>
  ),
}));

const owners: NativeRuntime[] = [];
function fixture(cached?: { active_run: { run_id: string } | null; shell_commands: unknown[] }) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    throw new Error("Viewing executions must not fetch a session snapshot");
  });
  const endpoint = "https://passive.example/nac";
  const runtime = createNativeRuntime({
    scope: {
      owner: "owner",
      profile: "profile",
      organization: "org",
      host: "host",
      incarnation: "incarnation",
      endpoint,
      release: "test",
    },
    client: createNacClient({ endpoint, credentials: "omit", fetch }),
    storage: { getItem: () => null, setItem: vi.fn() },
  });
  owners.push(runtime);
  runtime.stores.runtimeStore.resetRuntime("session");
  if (cached) runtime.queryClient.setQueryData(queryKeys.sessionSnapshot("session"), cached);
  render(
    <RuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={runtime.queryClient}>
        <TerminalWorkspace sessionId="session" />
      </QueryClientProvider>
    </RuntimeContext.Provider>,
  );
  return { runtime, fetch };
}
afterEach(() => {
  cleanup();
  for (const owner of owners.splice(0)) owner.close();
  vi.clearAllMocks();
});

describe("passive terminal workspace availability", () => {
  it("keeps unknown availability conservative without fetching on mount or invalidation", async () => {
    const { runtime, fetch } = fixture();
    fireEvent.click(screen.getByRole("button", { name: "Review rendered capture" }));
    expect(review.capture).toHaveBeenCalledWith(
      { selectedText: "explicit capture" },
      { delivery: "queue" },
    );
    await act(async () => {
      await runtime.queryClient.invalidateQueries({ queryKey: queryKeys.sessionRoot("session") });
      await runtime.queryClient.refetchQueries({ queryKey: queryKeys.sessionSnapshot("session") });
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reacts to its existing cache without changing send or busy queue choices", async () => {
    const { runtime, fetch } = fixture({ active_run: null, shell_commands: [] });
    const capture = screen.getByRole("button", { name: "Review rendered capture" });
    fireEvent.click(capture);
    expect(review.capture).toHaveBeenLastCalledWith(
      { selectedText: "explicit capture" },
      { delivery: "send" },
    );
    await act(async () => {
      runtime.queryClient.setQueryData(queryKeys.sessionSnapshot("session"), {
        active_run: { run_id: "active-run" },
        shell_commands: [],
      });
    });
    await waitFor(() => {
      fireEvent.click(capture);
      expect(review.capture).toHaveBeenLastCalledWith(
        { selectedText: "explicit capture" },
        { delivery: "queue" },
      );
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
