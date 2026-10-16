/** @vitest-environment jsdom */
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { RuntimeContext } from "../runtime/RuntimeContext";
import { createNativeRuntime } from "../runtime/nativeRuntime";
import { createNacClient } from "./nacClient";
import { useDeleteSession } from "./queries/session";
import { useDeleteProject } from "./queries/projects";

const opened: ReturnType<typeof createNativeRuntime>[] = [];
afterEach(() => {
  cleanup();
  for (const runtime of opened.splice(0)) runtime.close();
});
function fixture(response: () => Response) {
  const runtime = createNativeRuntime({
    scope: {
      owner: "owner",
      profile: "profile",
      organization: "org",
      host: "host",
      incarnation: "incarnation",
      endpoint: "/api",
      release: "release",
    },
    client: createNacClient({ endpoint: "/api", fetch: vi.fn(async () => response()) }),
  });
  opened.push(runtime);
  const drafts = runtime.stores.promptDraftStore;
  drafts.update("deleted", "remove");
  drafts.update("released", "keep");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={runtime.queryClient}>{children}</QueryClientProvider>
    </RuntimeContext.Provider>
  );
  return { runtime, drafts, wrapper };
}

it("purges a session only after its deletion succeeds", async () => {
  let succeeds = false;
  const { drafts, wrapper } = fixture(() =>
    succeeds ? new Response(null, { status: 204 }) : new Response("denied", { status: 403 }),
  );
  const { result } = renderHook(() => useDeleteSession(), { wrapper });
  await act(async () => {
    await expect(result.current.mutateAsync("deleted")).rejects.toBeDefined();
  });
  expect(drafts.get("deleted").text).toBe("remove");
  succeeds = true;
  await act(async () => {
    await result.current.mutateAsync("deleted");
  });
  expect(drafts.get("deleted").text).toBe("");
  expect(drafts.get("released").text).toBe("keep");
});

it("uses confirmed project deletion IDs and preserves released or unrelated drafts", async () => {
  const { drafts, wrapper } = fixture(() =>
    Response.json({ deleted_session_ids: ["deleted"], released_session_ids: ["released"] }),
  );
  const { result } = renderHook(() => useDeleteProject(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({ projectId: "project", sessions: "delete" });
  });
  expect(drafts.get("deleted").text).toBe("");
  expect(drafts.get("released").text).toBe("keep");
});
