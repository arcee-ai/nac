/** @vitest-environment jsdom */
/// <reference types="node" />
import { createHash } from "node:crypto";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RuntimeContext } from "@/app/runtime/RuntimeContext";
import { createNativeRuntime } from "@/app/runtime/nativeRuntime";
import { createNacClient } from "@/app/services/nacClient";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { SubagentComposer, type SubagentTarget } from "./SubagentComposer";

const scope = {
  owner: "owner",
  profile: "profile",
  organization: "org",
  host: "host",
  incarnation: "incarnation",
  endpoint: "/api",
  release: "release",
};
const binding = {
  owner: "desktop",
  profile: "private",
  organization: "local",
  host: "local",
  store: "selected",
  track: "dev",
};
const key = `nac:prompt-drafts:v2:${JSON.stringify(Object.values(binding))}`;
const coldText = "A".repeat(1_000_000);
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const runtimes: ReturnType<typeof createNativeRuntime>[] = [];
afterEach(() => {
  cleanup();
  for (const runtime of runtimes.splice(0)) runtime.close();
});

function fixture(fetch: typeof globalThis.fetch, cold = true, unavailable = false) {
  const values = new Map([
    [
      key,
      JSON.stringify({
        version: 2,
        binding: Object.values(binding),
        drafts: cold ? [["cold-A", coldText]] : [],
      }),
    ],
  ]);
  const original = values.get(key)!;
  const runtime = createNativeRuntime({
    scope,
    client: createNacClient({ endpoint: "/api", fetch }),
    draftPersistenceBinding: binding,
    draftStorage: {
      coldImports: true,
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        if (unavailable) throw new Error("storage unavailable");
        values.set(key, value);
      },
      removeItem: (key) => {
        if (unavailable) throw new Error("storage unavailable");
        values.delete(key);
      },
    },
  });
  runtimes.push(runtime);
  expect(runtime.stores.promptDraftStore.get("cold-A").text).toBe("");
  if (cold)
    expect(hash(runtime.stores.promptDraftStore.getUnreviewed("cold-A")[0].text)).toBe(
      hash(coldText),
    );
  return { runtime, values, original };
}

function mount(
  runtime: ReturnType<typeof createNativeRuntime>,
  mode: SubagentTarget["mode"],
  status: SubagentTarget["status"] = "running",
  id = "target",
) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
      addEventListener() {},
      removeEventListener() {},
    }) as MediaQueryList;
  const element = (nextStatus: SubagentTarget["status"]) => (
    <RuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={runtime.queryClient}>
        <ToastProvider>
          <SubagentComposer
            parentSessionId="parent"
            permissionSessionId={id}
            permissionBehavior={mode === "child" ? "direct" : "orchestrator"}
            showPermissions={false}
            target={{
              mode,
              id,
              description: "Review permissions",
              status: nextStatus,
              background: false,
            }}
          />
        </ToastProvider>
      </QueryClientProvider>
    </RuntimeContext.Provider>
  );
  const view = render(element(status));
  return {
    view,
    field: view.getByRole("textbox") as HTMLTextAreaElement,
    status: (next: SubagentTarget["status"]) => view.rerender(element(next)),
  };
}

function accepted() {
  return Response.json({
    child_session_id: "target",
    orchestrator_session_id: "target",
    parent_session_id: "parent",
    root_session_id: "parent",
    profile: "general",
    description: "Review permissions",
    nesting_depth: 1,
    status: "completed",
    generation: 1,
    version: 1,
    run_id: "run",
    execution_mode: "foreground",
    report: "done",
    failure: null,
    change_summary: null,
    verification_summary: null,
    completion_inbox_id: null,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  });
}

function expectRequest(
  fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>,
  mode: SubagentTarget["mode"],
  prompt: string,
  index = 0,
) {
  const [url, init] = fetch.mock.calls[index];
  expect(url).toBe(`/api/sessions/parent/${mode === "child" ? "children" : "orchestrators"}`);
  expect(init?.method).toBe("POST");
  expect(JSON.parse(init?.body as string)).toEqual({
    description: "Review permissions",
    prompt,
    background: false,
    ...(mode === "child"
      ? { profile: "general", child_session_id: "target" }
      : { orchestrator_session_id: "target" }),
  });
}

it.each(["child", "orchestrator"] as const)(
  "R1 exact cold boundary still dispatches one fresh %s request",
  async (mode) => {
    const response = Promise.withResolvers<Response>();
    const fetch = vi.fn<typeof globalThis.fetch>(() => response.promise);
    const { runtime, values, original } = fixture(fetch);
    const { field } = mount(runtime, mode);
    fireEvent.change(field, { target: { value: "fresh" } });
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expectRequest(fetch, mode, "fresh");
    expect(field.value).toBe("fresh");
    expect(hash(values.get(key)!)).toBe(hash(original));
    await act(async () => response.resolve(accepted()));
    await waitFor(() => expect(field.value).toBe(""));
    expect(fetch).toHaveBeenCalledOnce();
    expect(hash(runtime.stores.promptDraftStore.getUnreviewed("cold-A")[0].text)).toBe(
      hash(coldText),
    );
  },
);

it.each(["child", "orchestrator"] as const)(
  "suppresses the same %s revision across repeated events and a view remount",
  async (mode) => {
    const response = Promise.withResolvers<Response>();
    const fetch = vi.fn<typeof globalThis.fetch>(() => response.promise);
    const { runtime } = fixture(fetch);
    const first = mount(runtime, mode);
    fireEvent.change(first.field, { target: { value: "same" } });
    const steer = screen.getByRole("button", { name: "Steer" });
    fireEvent.click(steer);
    fireEvent.click(steer);
    fireEvent.keyDown(first.field, { key: "Enter" });
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    first.view.unmount();
    const next = mount(runtime, mode);
    expect(next.field.value).toBe("same");
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    await act(async () => {});
    expect(fetch).toHaveBeenCalledOnce();
    await act(async () => response.resolve(accepted()));
    await waitFor(() => expect(next.field.value).toBe(""));
  },
);

it.each(["child", "orchestrator"] as const)(
  "permits fresh %s steering before an older foreground request settles",
  async (mode) => {
    const a = Promise.withResolvers<Response>();
    const b = Promise.withResolvers<Response>();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise);
    const { runtime } = fixture(fetch);
    const { field } = mount(runtime, mode);
    fireEvent.change(field, { target: { value: "first" } });
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    fireEvent.change(field, { target: { value: "second" } });
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expectRequest(fetch, mode, "first");
    expectRequest(fetch, mode, "second", 1);
    await act(async () => a.resolve(accepted()));
    expect(field.value).toBe("second");
    expect(runtime.stores.promptDraftStore.isSubmitting("target")).toBe(true);
    await act(async () => b.resolve(accepted()));
    await waitFor(() => expect(field.value).toBe(""));
    expect(runtime.stores.promptDraftStore.isSubmitting("target")).toBe(false);
  },
);

it.each(["child", "orchestrator"] as const)(
  "preserves a newer identical %s edit on acknowledgement",
  async (mode) => {
    const response = Promise.withResolvers<Response>();
    const fetch = vi.fn<typeof globalThis.fetch>(() => response.promise);
    const { runtime } = fixture(fetch);
    const { field } = mount(runtime, mode);
    fireEvent.change(field, { target: { value: "same" } });
    const old = runtime.stores.promptDraftStore.get("target");
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    fireEvent.change(field, { target: { value: "different" } });
    fireEvent.change(field, { target: { value: "same" } });
    const newer = runtime.stores.promptDraftStore.get("target");
    expect(newer.revision).toBeGreaterThan(old.revision);
    await act(async () => response.resolve(accepted()));
    expect(runtime.stores.promptDraftStore.get("target")).toBe(newer);
    expect(field.value).toBe("same");
    expect(fetch).toHaveBeenCalledOnce();
  },
);

for (const mode of ["child", "orchestrator"] as const) {
  it.each(["unchanged", "newer", "http409"] as const)(
    `keeps ${mode} uncertainty visible without replay (%s)`,
    async (edit) => {
      const response = Promise.withResolvers<Response>();
      const fetch = vi.fn<typeof globalThis.fetch>(() => response.promise);
      const { runtime } = fixture(fetch);
      const first = mount(runtime, mode);
      fireEvent.change(first.field, { target: { value: "submitted" } });
      fireEvent.click(screen.getByRole("button", { name: "Steer" }));
      await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      if (edit === "newer") fireEvent.change(first.field, { target: { value: "newer" } });
      await act(async () => {
        if (edit === "http409")
          response.resolve(new Response("busy after admission", { status: 409 }));
        else response.reject(new TypeError("response lost after admission"));
      });
      expect(await screen.findByText(/Submitted text was not saved for recovery/)).toBeTruthy();
      const expected = edit === "newer" ? "newer" : "submitted";
      expect(first.field.value).toBe(expected);
      expect(runtime.stores.promptDraftStore.getRecoveries("target")).toEqual([]);
      first.view.unmount();
      const next = mount(runtime, mode);
      expect(next.field.value).toBe(expected);
      expect(screen.getByText(/Submitted text was not saved for recovery/)).toBeTruthy();
      expect(fetch).toHaveBeenCalledOnce();
      fireEvent.click(screen.getByRole("button", { name: "Acknowledge delivery uncertainty" }));
      expect(screen.queryByText(/Submitted text was not saved for recovery/)).toBeNull();
      expect(next.field.value).toBe(expected);
      expect(fetch).toHaveBeenCalledOnce();
      expect(hash(runtime.stores.promptDraftStore.getUnreviewed("cold-A")[0].text)).toBe(
        hash(coldText),
      );
    },
  );
}

it.each(["child", "orchestrator"] as const)(
  "keeps one %s start but allows fresh steering after the target becomes running",
  async (mode) => {
    const a = Promise.withResolvers<Response>();
    const b = Promise.withResolvers<Response>();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise);
    const { runtime } = fixture(fetch);
    const view = mount(runtime, mode, "completed");
    fireEvent.change(view.field, { target: { value: "start" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    fireEvent.change(view.field, { target: { value: "steer" } });
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty("disabled", true);
    view.status("running");
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await act(async () => {
      a.resolve(accepted());
      b.resolve(accepted());
    });
  },
);

it.each(["child", "orchestrator"] as const)(
  "keeps a claimed %s draft while another target is edited",
  async (mode) => {
    const response = Promise.withResolvers<Response>();
    const fetch = vi.fn<typeof globalThis.fetch>(() => response.promise);
    const { runtime } = fixture(fetch);
    const first = mount(runtime, mode);
    fireEvent.change(first.field, { target: { value: "pending" } });
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    first.view.unmount();
    const other = mount(runtime, mode, "running", "other");
    fireEvent.change(other.field, { target: { value: "other target" } });
    other.view.unmount();
    const next = mount(runtime, mode);
    expect(next.field.value).toBe("pending");
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    expect(fetch).toHaveBeenCalledOnce();
    await act(async () => response.resolve(accepted()));
  },
);

it.each(["child", "orchestrator"] as const)(
  "distinguishes an in-memory %s recovery from unavailable durable storage",
  async (mode) => {
    const response = Promise.withResolvers<Response>();
    const fetch = vi.fn<typeof globalThis.fetch>(() => response.promise);
    const { runtime } = fixture(fetch, false, true);
    const { field } = mount(runtime, mode);
    fireEvent.change(field, { target: { value: "memory recovery" } });
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(field.value).toBe("");
    expect(runtime.stores.promptDraftStore.isRetentionLimited()).toBe(true);
    expect(screen.getByText("Sending message…")).toBeTruthy();
    await act(async () => response.reject(new TypeError("lost")));
    expect(await screen.findByText(/Message delivery is unconfirmed/)).toBeTruthy();
    expect(runtime.stores.promptDraftStore.getRecoveries("target")[0].text).toBe("memory recovery");
    expect(screen.queryByText(/Submitted text was not saved for recovery/)).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
  },
);

for (const mode of ["child", "orchestrator"] as const) {
  it.each(["accepted", "lost"] as const)(
    `fences a purged ${mode} request's late %s result`,
    async (outcome) => {
      const response = Promise.withResolvers<Response>();
      const fetch = vi.fn<typeof globalThis.fetch>(() => response.promise);
      const { runtime } = fixture(fetch);
      const { field } = mount(runtime, mode);
      fireEvent.change(field, { target: { value: "old" } });
      fireEvent.click(screen.getByRole("button", { name: "Steer" }));
      await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      act(() => {
        runtime.stores.promptDraftStore.purgeSessions(["target"]);
        runtime.stores.promptDraftStore.update("target", "new lifetime");
      });
      const newer = runtime.stores.promptDraftStore.get("target");
      await act(async () => {
        if (outcome === "accepted") response.resolve(accepted());
        else response.reject(new TypeError("late lost reply"));
      });
      expect(runtime.stores.promptDraftStore.get("target")).toBe(newer);
      expect(field.value).toBe("new lifetime");
      expect(screen.queryByText(/Submitted text was not saved for recovery/)).toBeNull();
      expect(fetch).toHaveBeenCalledOnce();
    },
  );
}

it.each(["child", "orchestrator"] as const)(
  "fences closed %s runtime results from a replacement runtime",
  async (mode) => {
    const response = Promise.withResolvers<Response>();
    const fetch = vi.fn<typeof globalThis.fetch>(() => response.promise);
    const old = fixture(fetch);
    const first = mount(old.runtime, mode);
    fireEvent.change(first.field, { target: { value: "old" } });
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    first.view.unmount();
    act(() => old.runtime.close());
    const nextFetch = vi.fn<typeof globalThis.fetch>();
    const next = fixture(nextFetch);
    const view = mount(next.runtime, mode);
    fireEvent.change(view.field, { target: { value: "replacement" } });
    const newer = next.runtime.stores.promptDraftStore.get("target");
    await act(async () => response.reject(new TypeError("old response lost")));
    expect(next.runtime.stores.promptDraftStore.get("target")).toBe(newer);
    expect(next.runtime.stores.promptDraftStore.getUnretainedSubmission("target")).toBeUndefined();
    expect(nextFetch).not.toHaveBeenCalled();
  },
);
