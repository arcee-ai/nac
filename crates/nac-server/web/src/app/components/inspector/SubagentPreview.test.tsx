/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import { IconName } from "@/app/atoms";
import { SubagentPreview } from "./SubagentPreview";
import {
  assistant,
  snapshot,
  toolCall,
  toolResult,
} from "@/app/features/insights/model/fixtures.test-support";
import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries";
import { fenceSessionSnapshot, sessionRefreshKey } from "@/app/services/sessionRefresh";
import type { MessagesPageResponse } from "@/app/types/api";

vi.mock("@/app/hooks/useMediaQuery", () => ({ useIsMobile: () => false }));
const stream = vi.hoisted(() => ({
  value: {
    running: false,
    settled: true,
    text: "",
    reasoning: "",
    toolEvents: [],
    startedAt: null as number | null,
    baselineEnd: null as number | null,
    runId: null as string | null,
    promptEnd: null as number | null,
    recovering: false,
  },
}));
vi.mock("@/app/hooks/useDelegatedPreviewStream", () => ({
  useDelegatedPreviewStream: () => stream.value,
}));
vi.mock("@/app/hooks/useTranscriptReveal", () => ({ useTranscriptReveal: () => true }));

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  stream.value = {
    running: false,
    settled: true,
    text: "",
    reasoning: "",
    toolEvents: [],
    startedAt: null,
    baselineEnd: null,
    runId: null,
    promptEnd: null,
    recovering: false,
  };
});

it("shows supplied live reasoning through settlement and reconciles the stored answer", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const data = snapshot([{ role: "user", content: "Inspect" }], "direct");
  data.metadata.session_id = "child";
  data.active_run = { run_id: "run", prompt_preview: "Inspect", started_at_epoch_ms: 1 };
  vi.spyOn(api, "getSession").mockResolvedValue(data);
  vi.spyOn(api, "getPermissions").mockResolvedValue({
    approval_mode: "manual",
    grants: [],
    requests: [],
  });
  stream.value = {
    running: true,
    settled: false,
    reasoning: "Checking the child workspace",
    text: "Child answer",
    toolEvents: [],
    startedAt: 1,
    baselineEnd: 0,
    runId: "run",
    promptEnd: 1,
    recovering: false,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const preview = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SubagentPreview
          sessionId="child"
          title="Child"
          fallbackText={null}
          icon={IconName.Chat}
          onOpen={() => {}}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const rendered = render(preview());
  await screen.findByText("Child answer");
  const fold = () => document.querySelector("[data-work-fold] button") as HTMLButtonElement;
  await waitFor(() => expect(fold()).toBeTruthy());
  fireEvent.click(fold());
  fireEvent.click(document.querySelector("[data-work-fold] li button") as HTMLButtonElement);
  expect(screen.getByText("Checking the child workspace")).toBeTruthy();
  stream.value = { ...stream.value, running: false, settled: true };
  rendered.rerender(preview());
  expect(screen.getByText("Checking the child workspace")).toBeTruthy();
  const stored = snapshot([...data.messages, assistant({ content: "Child answer" })], "direct");
  stored.metadata.session_id = "child";
  act(() => client.setQueryData(queryKeys.sessionSnapshot("child"), stored));
  await waitFor(() => expect(screen.queryByText("Checking the child workspace")).toBeNull());
  expect(screen.getAllByText("Child answer")).toHaveLength(1);
});

it.each([false, true])(
  "refreshes canonical child history after a gap when settlement has no event (cached %s)",
  async (cached) => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const old = snapshot(
      [{ role: "user", content: "First prompt" }, assistant({ content: "Same answer" })],
      "direct",
    );
    old.metadata.session_id = "child";
    const stored = snapshot(
      [
        ...old.messages,
        { role: "user", content: "Second prompt" },
        assistant({ content: "Same answer" }),
      ],
      "direct",
    );
    stored.metadata.session_id = "child";
    const get = vi.spyOn(api, "getSession").mockResolvedValue(old);
    vi.spyOn(api, "getPermissions").mockResolvedValue({
      approval_mode: "manual",
      grants: [],
      requests: [],
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(client);
    if (cached) client.setQueryData(queryKeys.sessionSnapshot("child"), old);
    const parent = snapshot([{ role: "user", content: "Parent" }], "direct");
    client.setQueryData(queryKeys.sessionSnapshot("parent"), parent);
    stream.value = { ...stream.value, recovering: true, runId: "run" };
    const preview = (status: string) => (
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SubagentPreview
            sessionId="child"
            title="Child"
            fallbackText={null}
            relationship={{ status, generation: 2, runId: "run" }}
            icon={IconName.Chat}
            onOpen={() => {}}
          />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const rendered = render(preview("running"));
    await screen.findByText("First prompt");
    await waitFor(() => expect(get).toHaveBeenCalled());
    get.mockResolvedValue(stored);
    rendered.rerender(preview("completed"));
    await screen.findByText("Second prompt");
    expect(screen.getAllByText("Same answer")).toHaveLength(2);
    expect(client.getQueryData(queryKeys.sessionSnapshot("parent"))).toBe(parent);
  },
);

it.each([
  [2, false],
  [null, false],
  [null, true],
] as const)(
  "keeps a fast new run separate before its prompt snapshot (boundary %s, identical %s)",
  async (baselineEnd, identical) => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const old = snapshot(
      [{ role: "user", content: "First prompt" }, assistant({ content: "First answer" })],
      "direct",
    );
    old.metadata.session_id = "child";
    vi.spyOn(api, "getSession").mockResolvedValue(old);
    vi.spyOn(api, "getPermissions").mockResolvedValue({
      approval_mode: "manual",
      grants: [],
      requests: [],
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(client);
    const preview = () => (
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SubagentPreview
            sessionId="child"
            title="Child"
            fallbackText={null}
            icon={IconName.Chat}
            onOpen={() => {}}
          />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const rendered = render(preview());
    await screen.findByText("First answer");
    const secondAnswer = identical ? "First answer" : "Second answer";
    stream.value = {
      running: true,
      settled: false,
      text: secondAnswer,
      reasoning: "New run reasoning",
      toolEvents: [],
      startedAt: 2,
      baselineEnd,
      runId: "run-two",
      promptEnd: null,
      recovering: false,
    };
    rendered.rerender(preview());
    const distinctTurns = () => {
      const first = screen.getAllByText("First answer")[0].closest("[data-turn]");
      const second = screen.getAllByText(secondAnswer).at(-1)?.closest("[data-turn]");
      expect(first).toBeTruthy();
      expect(second).toBeTruthy();
      expect(first).not.toBe(second);
    };
    distinctTurns();
    stream.value = { ...stream.value, running: false, settled: true };
    rendered.rerender(preview());
    distinctTurns();
    const stored = snapshot(
      [
        ...old.messages,
        { role: "user", content: "Second prompt" },
        assistant({ content: secondAnswer }),
      ],
      "direct",
    );
    stored.metadata.session_id = "child";
    stream.value = { ...stream.value, promptEnd: 3 };
    rendered.rerender(preview());
    act(() => client.setQueryData(queryKeys.sessionSnapshot("child"), stored));
    await screen.findByText("Second prompt");
    distinctTurns();
    expect(screen.getAllByText(secondAnswer)).toHaveLength(identical ? 2 : 1);
  },
);

it("retains an explicit activity fold choice as the child's run settles", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const call = toolCall("call", "exec_command", { cmd: "pwd" });
  const active = snapshot(
    [{ role: "user", content: "Inspect" }, assistant({ calls: [call] })],
    "direct",
  );
  active.metadata.session_id = "child";
  active.active_run = { run_id: "run", prompt_preview: "Inspect", started_at_epoch_ms: 1 };
  active.primary_tool_events = [
    { type: "tool_call_started", call_id: "call", name: "exec_command", args_preview: "pwd" },
  ];
  const settled = snapshot(
    [...active.messages, toolResult("call", "/workspace"), assistant({ content: "Done" })],
    "direct",
  );
  settled.metadata.session_id = "child";
  settled.primary_tool_events = [
    ...active.primary_tool_events,
    {
      type: "tool_call_finished",
      call_id: "call",
      name: "exec_command",
      content_preview: "/workspace",
      is_error: false,
    },
  ];
  vi.spyOn(api, "getSession").mockResolvedValue(active);
  vi.spyOn(api, "getPermissions").mockResolvedValue({
    approval_mode: "manual",
    grants: [],
    requests: [],
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SubagentPreview
          sessionId="child"
          title="Child"
          fallbackText={null}
          icon={IconName.Chat}
          onOpen={() => {}}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(document.querySelector("[data-work-fold] button")).toBeTruthy());
  const fold = () => document.querySelector("[data-work-fold] button") as HTMLButtonElement;
  expect(fold().getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(fold());
  expect(fold().getAttribute("aria-expanded")).toBe("true");
  act(() => client.setQueryData(queryKeys.sessionSnapshot("child"), settled));
  await screen.findByText("Done");
  expect(fold().getAttribute("aria-expanded")).toBe("true");
});

it("pins a child approval-wait step without presenting a second approval prompt", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const data = snapshot(
    [
      { role: "user", content: "Check the workspace" },
      assistant({ calls: [toolCall("child-call", "exec_command", { cmd: "pwd" })] }),
    ],
    "direct",
  );
  data.metadata.session_id = "child";
  data.active_run = {
    run_id: "child-run",
    prompt_preview: "Check the workspace",
    started_at_epoch_ms: 1,
  };
  data.primary_tool_events = [
    { type: "tool_call_started", call_id: "child-call", name: "exec_command", args_preview: "pwd" },
  ];
  vi.spyOn(api, "getSession").mockResolvedValue(data);
  vi.spyOn(api, "getPermissions").mockResolvedValue({
    approval_mode: "manual",
    grants: [],
    requests: [
      {
        id: "request",
        call_id: "child-call",
        session_id: "child",
        tool: "exec_command",
        created_at_epoch_ms: 1,
        resources: [],
      },
    ],
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const parent = snapshot([{ role: "user", content: "Parent stays separate" }], "direct");
  client.setQueryData(queryKeys.sessionSnapshot("parent"), parent);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SubagentPreview
          sessionId="child"
          title="Child"
          fallbackText={null}
          icon={IconName.Chat}
          onOpen={() => {}}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const attention = await screen.findByRole("list", { name: "Steps that need attention" });
  expect(within(attention).getByRole("button", { name: /Waiting for approval/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /approve/i })).toBeNull();
  expect(client.getQueryData(queryKeys.sessionSnapshot("parent"))).toBe(parent);
});

it("explains a failed child snapshot, retains Open and retries without changing its identity", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const data = snapshot([]);
  data.metadata.session_id = "child";
  const get = vi
    .spyOn(api, "getSession")
    .mockRejectedValueOnce(new Error("Controlled unavailable snapshot"))
    .mockResolvedValue(data);
  const open = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SubagentPreview
          sessionId="child"
          title="Audit history"
          fallbackText="Retained report"
          icon={IconName.Chat}
          onOpen={open}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Couldn’t load the child conversation.Try again",
  );
  expect(screen.getByText("Retained report")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(open).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(get).toHaveBeenCalledTimes(2);
  expect(get.mock.calls.every(([id]) => id === "child")).toBe(true);
});

it.each(["rejected", "generation-fenced"] as const)(
  "retains the child and explicitly recovers a %s older-history read",
  async (settlement) => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const latest = snapshot([
      { role: "user", content: "Latest child prompt" },
      { role: "assistant", content: "Latest child answer remains" },
    ]);
    latest.metadata.session_id = "child";
    latest.message_page = { start: 2, end: 4, total: 4, has_older: true };
    const earlier: MessagesPageResponse = {
      messages: [
        { role: "user", content: "Earlier child prompt" },
        { role: "assistant", content: "Earlier child answer recovered" },
      ],
      created_at: [null, null],
      page: { start: 0, end: 2, total: 4, has_older: false },
    };
    const delayed = Promise.withResolvers<MessagesPageResponse>();
    const get = vi.spyOn(api, "getSession").mockResolvedValue(latest);
    const history = vi
      .spyOn(api, "getMessages")
      .mockImplementationOnce(() =>
        settlement === "rejected"
          ? Promise.reject(new Error("Controlled unavailable history"))
          : delayed.promise,
      )
      .mockResolvedValue(earlier);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    clients.push(client);
    const parent = snapshot([]);
    parent.metadata.session_id = "parent";
    client.setQueryData(queryKeys.sessionSnapshot("parent"), parent);
    const open = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SubagentPreview
            sessionId="child"
            title="Audit history"
            fallbackText="Retained report"
            icon={IconName.Chat}
            onOpen={open}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(history).toHaveBeenCalledOnce());
    if (settlement === "generation-fenced") {
      // Use the real query generation fence; the transport still resolves its stale page.
      fenceSessionSnapshot(sessionRefreshKey(client, "child"));
      await act(async () => {
        delayed.resolve(earlier);
        await delayed.promise;
      });
      expect(history.mock.calls[0][1]?.signal?.aborted).toBe(true);
    }
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Couldn’t load older messages.Try again",
    );
    expect(screen.getByText("Latest child answer remains")).toBeTruthy();
    expect(screen.queryByText("Earlier child answer recovered")).toBeNull();
    expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
    await act(async () => undefined);
    expect(history).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByText("Earlier child answer recovered")).toBeTruthy();
    expect(screen.getByText("Latest child answer remains")).toBeTruthy();
    expect(history).toHaveBeenCalledTimes(2);
    expect(
      history.mock.calls.every(([id, options]) => id === "child" && options?.before === 2),
    ).toBe(true);
    expect(get).toHaveBeenCalledOnce();
    expect(client.getQueryData(queryKeys.sessionSnapshot("parent"))).toBe(parent);
    expect(open).not.toHaveBeenCalled();
  },
);
