/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PermissionControls } from "@/app/components/inspector/PermissionControls";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries";
import type { PermissionStateResponse } from "@/app/types/api";

const SESSION_ID = "direct-session";

const fakes = {
  authorizeChildPermissionReviewRetry: vi.fn(),
  authorizePermissionReviewRetry: vi.fn(),
  getPermissions: vi.fn(),
  replyPermission: vi.fn(),
  setPermissionApprovalMode: vi.fn(),
  deletePermissionGrant: vi.fn(),
};

vi.spyOn(api, "getPermissions").mockImplementation((...args) => fakes.getPermissions(...args));
vi.spyOn(api, "replyPermission").mockImplementation((...args) => fakes.replyPermission(...args));
vi.spyOn(api, "setPermissionApprovalMode").mockImplementation((...args) =>
  fakes.setPermissionApprovalMode(...args),
);
vi.spyOn(api, "deletePermissionGrant").mockImplementation((...args) =>
  fakes.deletePermissionGrant(...args),
);
vi.spyOn(api, "authorizePermissionReviewRetry").mockImplementation((...args) =>
  fakes.authorizePermissionReviewRetry(...args),
);

vi.spyOn(api, "authorizeChildPermissionReviewRetry").mockImplementation((...args) =>
  fakes.authorizeChildPermissionReviewRetry(...args),
);

function pendingState(): PermissionStateResponse {
  return {
    approval_mode: "manual",
    requests: [
      {
        id: "request-1",
        session_id: SESSION_ID,
        call_id: "call-1",
        tool: "exec_command",
        created_at_epoch_ms: 1,
        resources: [
          {
            action: "execute",
            resource: "command:[cargo][test]",
            display: "cargo test",
            save_resource: "command:[cargo][test]*",
          },
        ],
      },
    ],
    grants: [],
  };
}

function mount(state: PermissionStateResponse, requesterLabel?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(queryKeys.sessionPermissions(SESSION_ID), state);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <PermissionControls
            sessionId={SESSION_ID}
            behavior="direct"
            requesterLabel={requesterLabel}
          />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fakes.authorizeChildPermissionReviewRetry.mockReset().mockResolvedValue(undefined);
  fakes.getPermissions.mockReset().mockResolvedValue({ requests: [], grants: [] });
  fakes.replyPermission.mockReset().mockResolvedValue(undefined);
  fakes.setPermissionApprovalMode.mockReset().mockResolvedValue(undefined);
  fakes.deletePermissionGrant.mockReset().mockResolvedValue(undefined);
  fakes.authorizePermissionReviewRetry.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    media: "",
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("direct permission controls", () => {
  it("keeps a large remembered-grant list in the bounded scrolling modal body", () => {
    const state = pendingState();
    state.grants = Array.from({ length: 20 }, (_, index) => ({
      id: `grant-${index}`,
      session_id: SESSION_ID,
      action: "read",
      resource: `/outside/workspace/dependency-${index}/a-long-resource-name.rs`,
      backend: "local",
      session_config_version: 1,
      created_at: `2026-09-08T00:00:${String(index).padStart(2, "0")}Z`,
    }));
    mount(state);

    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("max-h-[calc(100vh-2rem)]");
    expect(dialog.className).toContain("overflow-hidden");
    const scrollingBody = Array.from(dialog.children).find((element) =>
      element.className.includes("overflow-auto"),
    );
    expect(scrollingBody).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Allow once" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Always allow" })).toBeTruthy();
  });

  it("opens a new request and sends the explicit always reply", async () => {
    mount(pendingState());

    expect(screen.getByRole("dialog").textContent).toContain("cargo test");
    expect(screen.getByRole("button", { name: "Always allow" }).hasAttribute("disabled")).toBe(
      false,
    );
    fireEvent.click(screen.getByRole("button", { name: "Always allow" }));

    await waitFor(() =>
      expect(fakes.replyPermission).toHaveBeenCalledWith(SESSION_ID, "request-1", "always"),
    );
  });

  it("makes session-wide automatic approval discoverable and drains the pending request", async () => {
    mount(pendingState());

    const toggle = screen.getByRole("radio", { name: "Approve all" });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("radio", { name: "Manual" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("dialog").textContent).toContain(
      "The mode governs this session and all existing or future owned child agents",
    );
    expect(screen.getByRole("dialog").textContent).toContain(
      "Separately managed orchestrators are not included",
    );
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(fakes.setPermissionApprovalMode).toHaveBeenCalledWith(SESSION_ID, "auto_approve"),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Auto-approve on — open permissions",
        }),
      ).toBeTruthy(),
    );
    expect(screen.getByRole("dialog").textContent).toContain(
      "Automatic approval is active for this session and its owned child agents.",
    );
    expect(screen.queryByRole("button", { name: "Allow once" })).toBeNull();
  });

  it("identifies a child requester and explains why manual approval applies", () => {
    const state = pendingState();
    state.requests[0].session_id = "child-session";
    mount(state, "child agent “Review persistence”");

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain(
      "exec_command requested by child agent “Review persistence” is paused before execution.",
    );
    expect(dialog.textContent).toContain(
      "Requested by child agent “Review persistence” (child-session)",
    );
    expect(dialog.textContent).toContain(
      "automatic approval is off for this session and its owned child agents",
    );
  });

  it("keeps the active mode conspicuous and provides an immediate disable control", async () => {
    const state = pendingState();
    state.approval_mode = "auto_approve";
    state.requests = [];
    mount(state);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Auto-approve on — open permissions",
      }),
    );
    expect((screen.getByRole("radio", { name: "Approve all" }) as HTMLInputElement).checked).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Manual" }));

    await waitFor(() =>
      expect(fakes.setPermissionApprovalMode).toHaveBeenCalledWith(SESSION_ID, "manual"),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Permissions" })).toBeTruthy());
  });

  it("identifies each child control and explains inherited automatic approval", () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const automatic = {
      ...pendingState(),
      approval_mode: "auto_approve" as const,
      requests: [],
    };
    client.setQueryData(queryKeys.sessionPermissions("child-review"), automatic);
    client.setQueryData(queryKeys.sessionPermissions("child-tests"), automatic);

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ToastProvider>
            <PermissionControls
              sessionId="child-review"
              behavior="direct"
              label="Permissions for Review persistence"
              autoApprovalAvailable={false}
              requesterLabel="child agent “Review persistence”"
            />
            <PermissionControls
              sessionId="child-tests"
              behavior="direct"
              label="Permissions for Run tests"
              autoApprovalAvailable={false}
              requesterLabel="child agent “Run tests”"
            />
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const reviewControl = screen.getByRole("button", {
      name: "Permissions for Review persistence — auto-approve inherited; open permissions",
    });
    expect(
      screen.getByRole("button", {
        name: "Permissions for Run tests — auto-approve inherited; open permissions",
      }),
    ).toBeTruthy();

    fireEvent.click(reviewControl);
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain(
      "Automatic approval is inherited from the parent session; change it from the parent.",
    );
    expect(dialog.textContent).toContain(
      "Ordinary requests from this child agent inherit automatic approval from the parent session.",
    );
    expect(screen.queryByRole("radio", { name: "Approve all" })).toBeNull();
  });

  it("offers exactly three modes and selects Approve for me in the same control", async () => {
    const state = pendingState();
    state.requests = [];
    mount(state);
    fireEvent.click(screen.getByRole("button", { name: "Permissions" }));

    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "Manual",
      "Approve all",
      "Approve for me",
    ]);
    expect(
      radios.filter((radio) => radio.checked).map((radio) => radio.getAttribute("aria-label")),
    ).toEqual(["Manual"]);
    fireEvent.click(screen.getByRole("radio", { name: "Approve for me" }));

    await waitFor(() =>
      expect(fakes.setPermissionApprovalMode).toHaveBeenCalledWith(SESSION_ID, "review"),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Approve for me enabled — open permissions",
        }),
      ).toBeTruthy(),
    );
  });

  it("keeps the previous mode and shows the credential guidance when review cannot be enabled", async () => {
    const message =
      "Sign in to Arcee or configure an Arcee API key in NAC before enabling Approve for me.";
    fakes.setPermissionApprovalMode.mockRejectedValue(new Error(message));
    const state = pendingState();
    state.requests = [];
    mount(state);
    fireEvent.click(screen.getByRole("button", { name: "Permissions" }));

    fireEvent.click(screen.getByRole("radio", { name: "Approve for me" }));

    await waitFor(() => expect(document.body.textContent).toContain(message));
    expect((screen.getByRole("radio", { name: "Manual" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: "Permissions" })).toBeTruthy();
  });

  it("explains eligibility, availability and temporary history before the first review", () => {
    const state: PermissionStateResponse = {
      approval_mode: "review",
      requests: [],
      grants: [],
      reviews: [],
      authorizable_review_ids: [],
    };
    fakes.getPermissions.mockResolvedValue(state);
    mount(state);
    fireEvent.click(
      screen.getByRole("button", { name: "Approve for me enabled — open permissions" }),
    );
    expect(screen.getByRole("status").textContent).toContain("Service availability not checked");
    expect(document.body.textContent).toContain("Ineligible requests still ask you");
    expect(document.body.textContent).toContain("it does not open a manual prompt");
    const history = screen.getByRole("region", { name: "Automatic reviews" });
    expect(history.textContent).toContain("No reviews are retained");
    expect(history.textContent).toContain("idle session is unloaded");
    expect(history.textContent).toContain("mode and recorded human intent remain saved");
    expect(screen.getByRole("button", { name: "Switch to Manual" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/jev/i);
  });

  it("lists blocked reviews and authorizes one retry or switches to Manual", async () => {
    const state: PermissionStateResponse = {
      approval_mode: "review",
      requests: [],
      grants: [],
      reviews: [
        {
          id: "review-1",
          session_id: SESSION_ID,
          call_id: "call-9",
          tool: "exec_command",
          backend: "local",
          resources: [
            {
              action: "execute",
              resource: "command:[git][push]",
              display: "git push",
            },
          ],
          user_authorized_retry: false,
          outcome: "rejected",
          code: "review_rejected",
          category: "out_of_scope",
          duration_ms: 812,
          reviewer: "jev:typesafe/jev-1.13",
          created_at_epoch_ms: 1,
        },
        {
          id: "review-2",
          session_id: SESSION_ID,
          call_id: "call-10",
          tool: "exec_command",
          backend: "podman_with_host_mounts",
          resources: [{ action: "execute", resource: "command:[ls]", display: "ls" }],
          user_authorized_retry: false,
          reviewer: "jev:typesafe/jev-1.13",
          created_at_epoch_ms: 2,
        },
        {
          id: "review-3",
          session_id: SESSION_ID,
          call_id: "call-11",
          tool: "exec_command",
          backend: "local",
          resources: [{ action: "execute", resource: "command:[pwd]", display: "pwd" }],
          user_authorized_retry: false,
          outcome: "unavailable",
          code: "review_unavailable",
          reviewer: "jev:typesafe/jev-1.13",
          created_at_epoch_ms: 3,
        },
      ],
      authorizable_review_ids: ["review-1"],
    };
    fakes.getPermissions.mockResolvedValue(state);
    mount(state);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Approve for me enabled (1) — open permissions",
      }),
    );

    const blocked = screen.getByRole("region", { name: "Automatic reviews" });
    expect(blocked.textContent).toContain("git push");
    expect(blocked.textContent).toContain("Blocked: out of scope");
    expect(blocked.textContent).toContain("unsandboxed host");
    expect(blocked.textContent).toContain("container with writable host mounts");
    expect(blocked.textContent?.match(/unsandboxed host/g)).toHaveLength(2);
    expect(blocked.textContent).toContain("Reviewing");
    expect(blocked.textContent).toContain("Review service unavailable");
    expect(screen.getAllByRole("button", { name: "Authorize retry" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Authorize retry" }));
    await waitFor(() =>
      expect(fakes.authorizePermissionReviewRetry).toHaveBeenCalledWith(SESSION_ID, "review-1"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Switch to Manual" }));
    await waitFor(() =>
      expect(fakes.setPermissionApprovalMode).toHaveBeenCalledWith(SESSION_ID, "manual"),
    );
  });

  it.each([undefined, "parent-session"])(
    "routes child retries through its parent when available (%s)",
    async (parentSessionId) => {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      client.setQueryData(queryKeys.sessionPermissions("child-review"), {
        approval_mode: "review",
        requests: [],
        grants: [],
        reviews: [
          {
            id: "child-block",
            session_id: "child-review",
            tool: "exec_command",
            backend: "local",
            resources: [
              { action: "execute", resource: "command:[git][push]", display: "git push" },
            ],
            user_authorized_retry: false,
            outcome: "rejected",
            code: "review_rejected",
            reviewer: "jev:typesafe/jev-1.13",
            created_at_epoch_ms: 1,
          },
        ],
        authorizable_review_ids: ["child-block"],
      } satisfies PermissionStateResponse);
      render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <ToastProvider>
              <PermissionControls
                sessionId="child-review"
                retryParentSessionId={parentSessionId}
                behavior="direct"
                label="Permissions for Review persistence"
                autoApprovalAvailable={false}
              />
            </ToastProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      );
      fireEvent.click(
        screen.getByRole("button", {
          name: "Permissions for Review persistence — Approve for me inherited; open permissions",
        }),
      );
      const retry = screen.getByRole("button", { name: "Authorize retry" }) as HTMLButtonElement;
      expect(retry.disabled).toBe(!parentSessionId);
      if (parentSessionId) {
        fireEvent.click(retry);
        await waitFor(() =>
          expect(fakes.authorizeChildPermissionReviewRetry).toHaveBeenCalledWith(
            parentSessionId,
            "child-review",
            "child-block",
          ),
        );
        expect(fakes.authorizePermissionReviewRetry).not.toHaveBeenCalled();
      } else {
        expect(document.body.textContent).toContain("Open the child's parent to authorize a retry");
      }
      expect(screen.queryByRole("button", { name: "Switch to Manual" })).toBeNull();
      expect(fakes.setPermissionApprovalMode).not.toHaveBeenCalled();
    },
  );

  it("reconciles a mode change made through another server process", async () => {
    const manual = pendingState();
    manual.requests = [];
    const automatic = { ...manual, approval_mode: "auto_approve" as const };
    fakes.getPermissions.mockResolvedValueOnce(manual).mockResolvedValue(automatic);
    mount(manual);

    expect(screen.getByRole("button", { name: "Permissions" })).toBeTruthy();
    await waitFor(
      () =>
        expect(
          screen.getByRole("button", {
            name: "Auto-approve on — open permissions",
          }),
        ).toBeTruthy(),
      { timeout: 2_500 },
    );
    expect(fakes.getPermissions.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps always unavailable when the harness cannot derive a safe grant", () => {
    const state = pendingState();
    delete state.requests[0].resources[0].save_resource;
    mount(state);

    expect(screen.getByRole("button", { name: "Always allow" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(screen.getByRole("button", { name: "Allow once" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Reject" }).hasAttribute("disabled")).toBe(false);
  });

  it("renders the exact escaped terminal input and keeps it once-only", () => {
    const state = pendingState();
    state.requests[0].tool = "write_stdin";
    state.requests[0].resources = [
      {
        action: "terminal_input",
        resource: "shell-owner-1",
        display:
          "send exact input \"rm -rf important<RET>\" to terminal handle 'shell-owner-1' on the local backend; the running process may interpret these bytes as commands",
      },
    ];
    mount(state);

    expect(screen.getByRole("dialog").textContent).toContain('"rm -rf important<RET>"');
    expect(screen.getByRole("button", { name: "Always allow" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("does not fetch or render controls for orchestrator sessions", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ToastProvider>
            <PermissionControls sessionId={SESSION_ID} behavior="orchestrator" />
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.queryByRole("button", { name: /^Permissions/ })).toBeNull();
    expect(fakes.getPermissions).not.toHaveBeenCalled();
  });
});
