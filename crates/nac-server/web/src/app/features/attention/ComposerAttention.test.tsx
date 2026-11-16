/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries";
import { questionKey } from "@/app/features/questions/queries";
import type {
  PermissionRequest,
  PermissionStateResponse,
  QuestionRecord,
  TraditionalChildRecord,
} from "@/app/types/api";

import { ComposerAttention, type ComposerAttentionProps } from "./ComposerAttention";

const replies = vi.spyOn(api, "replyPermission");
const answers = vi.spyOn(api, "answerTaskQuestion");
vi.spyOn(api, "getPermissions").mockImplementation(async (id) => structuredClone(states.get(id)!));
vi.spyOn(api, "listTraditionalChildren").mockImplementation(async () => children);
vi.spyOn(api, "taskQuestions").mockImplementation(async () => questions);

const states = new Map<string, PermissionStateResponse>();
let children: TraditionalChildRecord[] = [];
let questions: QuestionRecord[] = [];
let mobile = false;

function command(id: string, session: string, at: number, text = "cargo test"): PermissionRequest {
  return {
    id,
    session_id: session,
    call_id: `call-${id}`,
    tool: "exec_command",
    created_at_epoch_ms: at,
    resources: [
      {
        action: "execute",
        resource: "command:[cargo][test]",
        display: text,
        save_resource: "command:[cargo][test]*",
      },
      {
        action: "execute_cwd",
        resource: "/repo",
        display: "/repo",
        save_resource: "/repo",
      },
    ],
  };
}

function state(requests: PermissionRequest[]): PermissionStateResponse {
  return { approval_mode: "manual", requests, grants: [] };
}

function question(id: string, created: string, choices = ["CSV", "JSON"]): QuestionRecord {
  return {
    request: {
      session_id: "parent",
      request_id: id,
      run_id: "run",
      generation: "run",
      text: `Which format for ${id}?`,
      choices,
      responder_class: "human_decision",
    },
    revision: 1,
    status: "pending",
    goal_id: null,
    answer: null,
    continuation_state: null,
    created_at: created,
  };
}

function mount(props: Partial<ComposerAttentionProps> = {}, search = "") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  client.setQueryData(queryKeys.traditionalChildren("parent"), children);
  for (const [id, value] of states) {
    client.setQueryData(queryKeys.sessionPermissions(id), structuredClone(value));
  }
  client.setQueryData(questionKey("parent"), questions);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/session/parent/insights${search}`]}>
        <ToastProvider>
          <ComposerAttention sessionId="parent" permissions questions {...props} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  states.clear();
  children = [];
  questions = [];
  mobile = false;
  replies.mockReset().mockImplementation(async (id) => {
    states.get(id)!.requests = [];
  });
  answers.mockReset();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return mobile && query === "(max-width: 767.98px)";
    },
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("attention card", () => {
  it("asks the tool's own question and shows everything the reply authorizes", () => {
    states.set(
      "parent",
      state([command("A", "parent", 1, "cargo test --workspace -- --nocapture")]),
    );
    mount();
    const card = screen.getByRole("dialog", { name: "Permission required" });
    expect(within(card).getByRole("heading", { name: "Run this command?" })).toBeTruthy();
    const access = within(card).getByRole("region", { name: "Requested access" });
    expect(within(access).getByRole("group", { name: "Command" }).textContent).toBe(
      "cargo test --workspace -- --nocapture",
    );
    expect(access.textContent).toContain("Working directory");
    expect(access.textContent).toContain("/repo");
    // "Always allow" names the rules exactly as the broker stores them.
    const always = within(card).getByRole("button", { name: "Always allow" });
    expect(always.textContent).toBe("Always allow these 2 rules");
    const stored = document.getElementById(always.getAttribute("aria-describedby")!)!;
    expect(stored.textContent).toContain("command:[cargo][test]*");
    expect(stored.textContent).toContain("/repo");
    expect(within(card).queryByText(/of \d/)).toBeNull();
  });

  it("presents the oldest request first across the parent and its children and steps through them", async () => {
    children = [
      {
        child_session_id: "child",
        parent_session_id: "parent",
        description: "Run tests",
        status: "running",
      } as TraditionalChildRecord,
    ];
    states.set("parent", state([command("late", "parent", 20, "make late")]));
    states.set("child", state([command("early", "child", 10, "make early")]));
    mount();
    const card = screen.getByRole("dialog", { name: "Permission required" });
    expect(card.textContent).toContain("1 of 2");
    expect(card.textContent).toContain("make early");
    expect(card.textContent).toContain("requested by child agent “Run tests”");
    fireEvent.click(within(card).getByRole("button", { name: "Next request" }));
    expect(card.textContent).toContain("2 of 2");
    expect(card.textContent).toContain("make late");
    fireEvent.click(within(card).getByRole("button", { name: "Allow once" }));
    await waitFor(() => expect(replies).toHaveBeenCalledExactlyOnceWith("parent", "late", "once"));
  });

  it("answers with ⏎ and D only when nothing else has the keyboard", async () => {
    states.set("parent", state([command("A", "parent", 1)]));
    const onDenied = vi.fn();
    mount({ onDenied });
    const field = document.createElement("textarea");
    document.body.append(field);
    field.focus();
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.keyDown(field, { key: "d" });
    const allow = screen.getByRole("button", { name: "Allow once" });
    allow.focus();
    fireEvent.keyDown(allow, { key: "d" });
    expect(replies).not.toHaveBeenCalled();

    act(() => (document.activeElement as HTMLElement).blur());
    fireEvent.keyDown(document.body, { key: "d" });
    await waitFor(() => expect(replies).toHaveBeenCalledExactlyOnceWith("parent", "A", "reject"));
    await waitFor(() => expect(onDenied).toHaveBeenCalledOnce());
    field.remove();
  });

  it("takes the keyboard when it appears over an empty composer", () => {
    const composer = document.createElement("textarea");
    composer.setAttribute("data-nac-retained-draft", "");
    document.body.append(composer);
    composer.focus();
    states.set("parent", state([command("A", "parent", 1)]));
    mount();
    expect(document.activeElement).toBe(
      screen.getByRole("dialog", { name: "Permission required" }),
    );
    composer.remove();
  });

  it("leaves a draft's caret where it is", () => {
    const composer = document.createElement("textarea");
    composer.setAttribute("data-nac-retained-draft", "");
    composer.value = "half a thought";
    document.body.append(composer);
    composer.focus();
    states.set("parent", state([command("A", "parent", 1)]));
    mount();
    expect(document.activeElement).toBe(composer);
    composer.remove();
  });

  it("disables every choice when the request has no reusable pattern for always", () => {
    const request = command("A", "parent", 1);
    request.resources = request.resources.map((resource) => ({ ...resource, save_resource: null }));
    states.set("parent", state([request]));
    mount();
    expect(screen.getByRole("button", { name: "Always allow" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(screen.getByRole("button", { name: "Allow once" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Deny" }).hasAttribute("disabled")).toBe(false);
  });

  it("shows only an exact linked request and never falls back to another one", async () => {
    states.set("parent", state([command("other", "parent", 1, "make other")]));
    mount({}, "?permission_request=gone");
    expect(screen.getByText(/This permission request is no longer pending/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Allow once" })).toBeNull();
    expect(screen.queryByText("make other")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.getByText("make other")).toBeTruthy();
  });

  it("selects the exact linked request ahead of older ones", async () => {
    states.set(
      "parent",
      state([
        command("older", "parent", 1, "make older"),
        command("exact", "parent", 2, "make exact"),
      ]),
    );
    mount({}, "?permission_request=exact");
    expect(screen.getByText("make exact")).toBeTruthy();
    expect(screen.queryByText("make older")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    await waitFor(() => expect(replies).toHaveBeenCalledExactlyOnceWith("parent", "exact", "once"));
  });

  it("stacks agent questions in arrival order and picks an option with its number", () => {
    states.set("parent", state([command("A", "parent", Date.parse("2026-11-16T10:00:00Z"))]));
    questions = [question("Q", "2026-11-16T09:00:00Z")];
    mount();
    const card = screen.getByRole("dialog", { name: "Question from the agent" });
    expect(card.textContent).toContain("1 of 2");
    expect(within(card).getByRole("region", { name: "Task question" })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "2" });
    expect(
      (within(card).getByRole("textbox", { name: "Your answer" }) as HTMLTextAreaElement).value,
    ).toBe("JSON");
    expect(replies).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByRole("button", { name: "Next request" }));
    expect(screen.getByRole("dialog", { name: "Permission required" })).toBeTruthy();
  });

  it("hands the request to the full sheet and steps aside while it is open", () => {
    states.set("parent", state([command("A", "parent", 1)]));
    const onReviewAll = vi.fn();
    const view = mount({ onReviewAll });
    fireEvent.click(screen.getByRole("button", { name: "Review all" }));
    expect(onReviewAll).toHaveBeenCalledWith(JSON.stringify(["parent", "A"]));
    view.unmount();
    mount({ onReviewAll, hidden: true });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("collapses to a one-line bar on a phone and opens the full card from it", () => {
    mobile = true;
    states.set("parent", state([command("A", "parent", 1)]));
    mount();
    expect(screen.queryByRole("button", { name: "Allow once" })).toBeNull();
    const bar = screen.getByRole("button", { name: /Approval needed/ });
    expect(bar.textContent).toContain("Run this command?");
    fireEvent.click(bar);
    expect(screen.getByRole("button", { name: "Allow once" })).toBeTruthy();
  });

  it("renders nothing when nothing needs the user", () => {
    states.set("parent", state([]));
    mount();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
