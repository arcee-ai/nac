/** @vitest-environment jsdom */
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PermissionControls } from "./PermissionControls";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries";
import type { PermissionStateResponse, TraditionalChildRecord } from "@/app/types/api";

const streams = vi.hoisted(() => ({ calls: vi.fn(), disposed: vi.fn() }));
vi.mock("@/app/hooks/useSessionStream", async () => {
  const { useEffect } = await import("react");
  return {
    useDelegatedPermissionStream: (id: string, enabled: boolean) => {
      useEffect(() => {
        if (!enabled) return;
        streams.calls(id);
        return () => streams.disposed(id);
      }, [id, enabled]);
    },
  };
});
const states = new Map<string, PermissionStateResponse>();
const failed = new Set<string>();
const replies = vi.spyOn(api, "replyPermission");
const deletes = vi.spyOn(api, "deletePermissionGrant");
const modes = vi.spyOn(api, "setPermissionApprovalMode");
const authorizeParent = vi.spyOn(api, "authorizePermissionReviewRetry");
const authorizeChild = vi.spyOn(api, "authorizeChildPermissionReviewRetry");
const childrenApi = vi.spyOn(api, "listTraditionalChildren");
vi.spyOn(api, "getPermissions").mockImplementation(async (id) => {
  if (failed.has(id)) throw new Error("offline");
  return structuredClone(states.get(id)!);
});
function state(id: string, pending = true): PermissionStateResponse {
  return {
    approval_mode: "manual",
    requests: pending
      ? [
          {
            id: "same-request-id",
            session_id: id,
            call_id: "call",
            tool: `read-${id}`,
            created_at_epoch_ms: 1,
            resources: [
              {
                action: "read",
                resource: `/outside/${id}`,
                display: `/outside/${id}`,
                save_resource: `/outside/${id}`,
              },
            ],
          },
        ]
      : [],
    grants: [
      {
        id: "same-grant-id",
        session_id: id,
        action: "read",
        resource: `/remembered/${id}`,
        backend: "local",
        session_config_version: 1,
        created_at: "2026-10-16",
      },
    ],
  };
}
function reviewed(id: string): PermissionStateResponse {
  return {
    ...state(id, false),
    grants: [],
    approval_mode: "review",
    reviews: [
      {
        id: "same-review-id",
        session_id: id,
        tool: `exec-${id}`,
        backend: "local",
        resources: [{ action: "execute", resource: `command:[${id}]`, display: `run ${id}` }],
        user_authorized_retry: false,
        outcome: "rejected",
        code: "review_rejected",
        reviewer: "test",
        created_at_epoch_ms: 1,
      },
    ],
    authorizable_review_ids: ["same-review-id"],
  };
}

function child(id: string, status = "running"): TraditionalChildRecord {
  return {
    child_session_id: id,
    parent_session_id: "parent",
    description: id,
    status,
  } as TraditionalChildRecord;
}
function mount(records = [child("first"), child("second")], seed = true, search = "") {
  childrenApi.mockResolvedValue(records);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  if (seed) client.setQueryData(queryKeys.traditionalChildren("parent"), records);
  for (const id of ["parent", ...records.map((c) => c.child_session_id)]) {
    if (!states.has(id)) states.set(id, state(id));
    if (seed)
      client.setQueryData(queryKeys.sessionPermissions(id), structuredClone(states.get(id)));
  }
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/session/parent/insights${search}`]}>
        <ToastProvider>
          <PermissionControls sessionId="parent" behavior="direct" />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client };
}
beforeEach(() => {
  states.clear();
  failed.clear();
  streams.calls.mockClear();
  streams.disposed.mockClear();
  replies.mockReset().mockImplementation(async (id) => {
    states.get(id)!.requests = [];
  });
  deletes.mockReset().mockImplementation(async (id) => {
    states.get(id)!.grants = [];
  });
  modes.mockReset().mockResolvedValue(undefined);
  authorizeParent.mockReset().mockImplementation(async (id) => {
    states.get(id)!.authorizable_review_ids = [];
    return states.get(id)!.reviews![0];
  });
  authorizeChild.mockReset().mockImplementation(async (_parent, id) => {
    states.get(id)!.authorizable_review_ids = [];
    return states.get(id)!.reviews![0];
  });
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("parent permission queue", () => {
  it("shows loading until broker and child discovery finish", async () => {
    states.set("parent", { ...state("parent", false), grants: [] });
    mount([], false);
    fireEvent.click(screen.getByRole("button", { name: "Permissions" }));
    expect(screen.getAllByRole("status")).toHaveLength(2);
    expect(screen.getByRole("radio", { name: "Approve for me" }).hasAttribute("disabled")).toBe(
      true,
    );
    await waitFor(() => expect(screen.queryAllByRole("status")).toHaveLength(0));
    expect(screen.getByText("No pending permission requests.")).toBeTruthy();
    expect(screen.getByText("No remembered permissions.")).toBeTruthy();
  });
  it("retries failed child discovery while retaining known child brokers", async () => {
    const { client } = mount();
    childrenApi.mockRejectedValue(new Error("offline"));
    await client.invalidateQueries({ queryKey: queryKeys.traditionalChildren("parent") });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Child request discovery"),
    );
    expect(
      screen.getByRole("button", { name: "child agent “first” (first): read-first" }),
    ).toBeTruthy();
    childrenApi.mockResolvedValue([child("first"), child("second")]);
    fireEvent.click(screen.getByRole("button", { name: "Retry Child request discovery" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
  it.each([0, 1, 3])("renders one mode control with %i children", async (count) => {
    mount(Array.from({ length: count }, (_, i) => child(`child-${i}`)));
    expect(screen.getAllByRole("button", { name: /^Permissions/ })).toHaveLength(1);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getAllByRole("radiogroup", { name: "Approval mode" })).toHaveLength(1);
    expect(screen.getByText(`(${count + 1} pending)`)).toBeTruthy();
    await waitFor(() => expect(streams.calls).toHaveBeenCalledTimes(count));
  });
  it.each(["once", "always", "reject"] as const)(
    "routes %s only to the selected session even with identical request IDs",
    async (reply) => {
      mount();
      fireEvent.click(
        screen.getByRole("button", { name: "child agent “second” (second): read-second" }),
      );
      expect(screen.getByRole("region", { name: "Requested access" }).textContent).toContain(
        "Requested by child agent “second” (second)",
      );
      expect(screen.getByRole("dialog").textContent).toContain(
        "read-second requested by child agent “second” is paused before execution.",
      );
      expect(screen.getByRole("region", { name: "Requested access" }).textContent).toContain(
        "/outside/second",
      );
      fireEvent.click(
        screen.getByRole("button", {
          name: { once: "Allow once", always: "Always allow", reject: "Reject" }[reply],
        }),
      );
      await waitFor(() =>
        expect(replies).toHaveBeenCalledExactlyOnceWith("second", "same-request-id", reply),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: "child agent “second” (second): read-second" }),
        ).toBeNull(),
      );
      expect(states.get("parent")!.requests).toHaveLength(1);
      expect(states.get("first")!.requests).toHaveLength(1);
    },
  );
  it("keeps completed child grants inspectable and deletes only their original scope", async () => {
    mount([child("first", "completed"), child("second")]);
    const scope = screen.getByRole("region", { name: "Remembered for child agent “first”" });
    expect(scope.textContent).toContain("(first)");
    fireEvent.click(within(scope).getByRole("button", { name: "Forget read permission" }));
    await waitFor(() => expect(deletes).toHaveBeenCalledExactlyOnceWith("first", "same-grant-id"));
    await waitFor(() => expect(scope.textContent).toContain("No remembered permissions"));
    expect(states.get("parent")!.grants).toHaveLength(1);
    expect(states.get("second")!.grants).toHaveLength(1);
    expect(streams.calls).not.toHaveBeenCalledWith("first");
  });
  it("keeps streams while closed, disconnects on completion, and restores requests after remount", async () => {
    const first = mount();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(streams.disposed).not.toHaveBeenCalled();
    first.unmount();
    expect(streams.disposed).toHaveBeenCalledWith("first");
    mount([child("first", "completed"), child("second")]);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "child agent “first” (first): read-first" }),
    ).toBeTruthy();
  });
  it("keeps a completing child's cached request and stops only its live stream", async () => {
    const { client } = mount();
    await waitFor(() => expect(streams.calls).toHaveBeenCalledWith("first"));
    const completed = [child("first", "completed"), child("second")];
    childrenApi.mockResolvedValue(completed);
    client.setQueryData(queryKeys.traditionalChildren("parent"), completed);
    await waitFor(() => expect(streams.disposed).toHaveBeenCalledWith("first"));
    expect(streams.disposed).not.toHaveBeenCalledWith("second");
    expect(
      screen.getByRole("button", { name: "child agent “first” (first): read-first" }),
    ).toBeTruthy();
  });
  it("shows empty and inherited mode states with one parent toggle", async () => {
    for (const id of ["parent", "first", "second"]) {
      states.set(id, { ...state(id, false), approval_mode: "auto_approve" });
    }
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Auto-approve on — open permissions" }));
    expect(screen.getByText("No pending permission requests.")).toBeTruthy();
    expect(screen.getAllByText("Auto-approve inherited from parent.")).toHaveLength(2);
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    fireEvent.click(screen.getByRole("radio", { name: "Manual" }));
    await waitFor(() => expect(modes).toHaveBeenCalledExactlyOnceWith("parent", "manual"));
  });
  it("fails closed for a selected broker refresh error and retries without losing other scopes", async () => {
    failed.add("second");
    mount();
    fireEvent.click(
      screen.getByRole("button", { name: "child agent “second” (second): read-second" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Allow once" }).hasAttribute("disabled")).toBe(
        true,
      ),
    );
    expect(screen.getByRole("alert").textContent).toContain("child agent “second”");
    failed.delete("second");
    fireEvent.click(screen.getByRole("button", { name: "Retry child agent “second”" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Allow once" }).hasAttribute("disabled")).toBe(
        false,
      ),
    );
    expect(replies).not.toHaveBeenCalled();
  });
  it("preserves actionable reply errors and keeps parent mode mutations on the parent", async () => {
    replies.mockRejectedValueOnce(new Error("offline"));
    mount();
    fireEvent.click(
      screen.getByRole("button", { name: "child agent “first” (first): read-first" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    await waitFor(() =>
      expect(screen.getByText(/Unable to answer permission request/)).toBeTruthy(),
    );
    expect(screen.getByRole("region", { name: "Requested access" }).textContent).toContain(
      "(first)",
    );
    fireEvent.click(screen.getByRole("radio", { name: "Approve all" }));
    await waitFor(() => expect(modes).toHaveBeenCalledExactlyOnceWith("parent", "auto_approve"));
    expect(states.get("first")!.grants[0].session_id).toBe("first");
  });
  it.each(["running", "completed", "cancelled", "failed"])(
    "retains %s child reviews and routes retry through the actual parent despite matching review IDs",
    async (status) => {
      for (const id of ["parent", "first", "second"]) states.set(id, reviewed(id));
      mount([child("first", status), child("second")]);
      fireEvent.click(screen.getByRole("button", { name: /^Approve for me enabled/ }));
      const scope = screen.getByRole("region", { name: "Review for child agent “first”" });
      expect(within(scope).getByText("run first")).toBeTruthy();
      fireEvent.click(within(scope).getByRole("button", { name: "Authorize retry" }));
      await waitFor(() =>
        expect(authorizeChild).toHaveBeenCalledExactlyOnceWith("parent", "first", "same-review-id"),
      );
      await waitFor(() =>
        expect(within(scope).queryByRole("button", { name: "Authorize retry" })).toBeNull(),
      );
      expect(authorizeParent).not.toHaveBeenCalled();
      expect(states.get("parent")!.authorizable_review_ids).toHaveLength(1);
      expect(states.get("second")!.authorizable_review_ids).toHaveLength(1);
      expect(screen.getAllByRole("radiogroup")).toHaveLength(1);
      expect(modes).not.toHaveBeenCalled();
      if (status !== "running") expect(streams.calls).not.toHaveBeenCalledWith("first");
    },
  );
  it("keeps parent retry primary-only and each broker's authorizable IDs separate", async () => {
    for (const id of ["parent", "first", "second"]) states.set(id, reviewed(id));
    states.get("first")!.authorizable_review_ids = [];
    mount();
    fireEvent.click(screen.getByRole("button", { name: /^Approve for me enabled/ }));
    expect(
      within(screen.getByRole("region", { name: "Review for child agent “first”" })).queryByRole(
        "button",
        { name: "Authorize retry" },
      ),
    ).toBeNull();
    fireEvent.click(
      within(screen.getByRole("region", { name: "Review for this session" })).getByRole("button", {
        name: "Authorize retry",
      }),
    );
    await waitFor(() =>
      expect(authorizeParent).toHaveBeenCalledExactlyOnceWith("parent", "same-review-id"),
    );
    expect(authorizeChild).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "Manual" }));
    await waitFor(() => expect(modes).toHaveBeenCalledExactlyOnceWith("parent", "manual"));
  });
  it("disables a child's cached retry after refresh failure and retains its scope through recovery", async () => {
    for (const id of ["parent", "first", "second"]) states.set(id, reviewed(id));
    failed.add("second");
    mount();
    fireEvent.click(screen.getByRole("button", { name: /^Approve for me enabled/ }));
    const scope = screen.getByRole("region", { name: "Review for child agent “second”" });
    await waitFor(() =>
      expect(
        within(scope).getByRole("button", { name: "Authorize retry" }).hasAttribute("disabled"),
      ).toBe(true),
    );
    failed.delete("second");
    fireEvent.click(screen.getByRole("button", { name: "Retry child agent “second”" }));
    await waitFor(() =>
      expect(
        within(scope).getByRole("button", { name: "Authorize retry" }).hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.click(within(scope).getByRole("button", { name: "Authorize retry" }));
    await waitFor(() =>
      expect(authorizeChild).toHaveBeenCalledExactlyOnceWith("parent", "second", "same-review-id"),
    );
  });
});

it("opens only the exact requested approval and never falls back to another request", async () => {
  const parent = state("parent");
  parent.requests = [
    { ...parent.requests[0]!, id: "earlier", tool: "earlier-tool" },
    { ...parent.requests[0]!, id: "exact", tool: "exact-tool" },
  ];
  states.set("parent", parent);
  mount([], true, "?permission_request=exact");
  expect(screen.getByText(/exact-tool requested by/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
  await waitFor(() => expect(replies).toHaveBeenCalledWith("parent", "exact", "once"));
});

it("shows a stale exact approval without selecting an unrelated pending request", async () => {
  states.set("parent", state("parent"));
  mount([], true, "?permission_request=expired");
  expect(screen.getByText(/This permission request is no longer pending/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Allow once" })).toBeNull();
});
