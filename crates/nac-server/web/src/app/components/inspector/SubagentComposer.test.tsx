/** @vitest-environment jsdom */
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RuntimeContext } from "@/app/runtime/RuntimeContext";
import { createNativeRuntime, type NativeRuntimeScope } from "@/app/runtime/nativeRuntime";
import { createNacClient } from "@/app/services/nacClient";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { SubagentComposer } from "./SubagentComposer";

const permissionControl = vi.hoisted(() => vi.fn());
vi.mock("./PermissionControls", () => ({
  PermissionControls: (props: unknown) => {
    permissionControl(props);
    return null;
  },
}));

const scope: NativeRuntimeScope = {
  owner: "owner",
  profile: "profile",
  organization: "org",
  host: "host",
  incarnation: "incarnation",
  endpoint: "/api",
  release: "release",
};
const runtimes: ReturnType<typeof createNativeRuntime>[] = [];
afterEach(() => {
  cleanup();
  permissionControl.mockClear();
  for (const runtime of runtimes.splice(0)) runtime.close();
});

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

function mount(
  mode: "child" | "orchestrator",
  fetch: typeof globalThis.fetch,
  draftStorage = storage(),
  binding = scope,
  showPermissions = false,
  status: "running" | "completed" = "running",
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
  const runtime = createNativeRuntime({
    scope: binding,
    client: createNacClient({ endpoint: "/api", fetch }),
    draftStorage,
  });
  runtimes.push(runtime);
  const view = render(
    <RuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={runtime.queryClient}>
        <ToastProvider>
          <SubagentComposer
            parentSessionId="parent"
            permissionSessionId="target"
            permissionBehavior="direct"
            showPermissions={showPermissions}
            target={{
              mode,
              id: "target",
              description: "Review permissions",
              status,
              background: false,
            }}
          />
        </ToastProvider>
      </QueryClientProvider>
    </RuntimeContext.Provider>,
  );
  return { runtime, view, field: screen.getByRole("textbox") as HTMLTextAreaElement };
}

it.each(["child", "orchestrator"] as const)(
  "recovers %s pending text on reload without replay or overwriting the next draft",
  async (mode) => {
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    const draftStorage = storage();
    const first = mount(mode, fetch, draftStorage);
    fireEvent.change(first.field, { target: { value: "  exact\nsubmitted message  " } });
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    fireEvent.change(first.field, { target: { value: "newer draft" } });
    expect(screen.getByText("Sending message…")).toBeTruthy();
    first.view.unmount();
    await act(async () => first.runtime.close());
    const next = mount(mode, fetch, draftStorage);
    expect(next.field.value).toBe("newer draft");
    expect(screen.getByText(/Message delivery is unconfirmed/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Restore to composer" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(fetch).toHaveBeenCalledOnce();
    fireEvent.change(next.field, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Restore to composer" }));
    expect(next.field.value).toBe("  exact\nsubmitted message  ");
    expect(fetch).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("Subagent message delivery")).toBeNull();
  },
);

it("does not treat an HTTP foreground failure as proof that the message was never admitted", async () => {
  const fetch = vi.fn(async () => new Response("session is busy", { status: 409 }));
  const { field } = mount("child", fetch);
  fireEvent.change(field, { target: { value: "Check permissions" } });
  fireEvent.click(screen.getByRole("button", { name: "Steer" }));
  expect(await screen.findByText(/Message delivery is unconfirmed/)).toBeTruthy();
  expect(field.value).toBe("");
  expect(screen.queryByText("Message was not sent.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByLabelText("Subagent message delivery")).toBeNull();
  expect(fetch).toHaveBeenCalledOnce();
});

it.each(["running", "completed"] as const)(
  "keeps owning-parent retry routing for a %s child's permission control",
  (status) => {
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    mount("child", fetch, storage(), scope, true, status);
    expect(permissionControl).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sessionId: "target",
        autoApprovalAvailable: false,
        retryParentSessionId: "parent",
        poll: status === "running",
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
  },
);
