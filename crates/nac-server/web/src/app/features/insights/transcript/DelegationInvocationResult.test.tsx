/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { DelegationInvocationResult } from "./DelegationInvocationResult";
import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries/keys";
import type { ToolPresentation } from "@/app/lib/toolPresentation";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each([
  [
    "child_session_id",
    "completed",
    {
      report: "First generation report",
      change_summary: "Two files",
      verification_summary: "Tests passed",
    },
  ],
  ["child_session_id", "failed", { failure: "Unable to finish" }],
  ["child_session_id", "running", {}],
] as const)(
  "renders native %s %s outcomes without exposing JSON",
  async (idField, status, fields) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(api, "getToolCallContent").mockResolvedValue({
      call_id: "call",
      arguments: "{}",
      arguments_truncated: false,
      output: JSON.stringify({
        [idField]: "child",
        generation: 2,
        status,
        ...fields,
        retained_extra: "kept",
      }),
      output_truncated: false,
    });
    const tool: ToolPresentation = {
      callId: "call",
      occurrence: "log:parent:store:1:digest:2",
      name: "subagent",
      label: "Subagent",
      summary: null,
      resultPreview: null,
      status: "success",
      statusLabel: "Succeeded",
    };
    render(
      <QueryClientProvider client={client}>
        <DelegationInvocationResult sessionId="parent" blockKey="one" tool={tool} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText("Invocation result"));
    await screen.findByText(
      `Response reports Generation 2 · ${status === "completed" ? "Completed" : status === "failed" ? "Failed" : "Running"}`,
    );
    for (const value of Object.values(fields))
      expect(screen.getByText(value, { exact: false })).toBeTruthy();
    if (status === "running")
      expect(
        screen.getByText(
          "The response reports background work; completion may be delivered separately.",
        ),
      ).toBeTruthy();
    expect(screen.queryByText(/child_session_id/)).toBeNull();
    fireEvent.click(screen.getByText("Show retained result"));
    expect((await screen.findByText(/retained_extra/)).textContent).toContain('"kept"');
    client.clear();
  },
);

it("keeps unrecognized structured output behind an explicit disclosure", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(api, "getToolCallContent").mockResolvedValue({
    call_id: "call",
    arguments: "{}",
    arguments_truncated: false,
    output: '{"unexpected":"kept"}',
    output_truncated: true,
  });
  const tool: ToolPresentation = {
    callId: "call",
    occurrence: "log:parent:store:1:digest:2",
    name: "subagent",
    label: "Subagent",
    summary: null,
    resultPreview: null,
    status: "success",
    statusLabel: "Succeeded",
  };
  render(
    <QueryClientProvider client={client}>
      <DelegationInvocationResult sessionId="parent" blockKey="one" tool={tool} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText("Invocation result"));
  await screen.findByText("Result details could not be displayed in this format.");
  expect(screen.getByText("Result truncated at 256 KiB.")).toBeTruthy();
  expect(screen.queryByText('{"unexpected":"kept"}')).toBeNull();
  fireEvent.click(screen.getByText("Show retained result"));
  expect((await screen.findByText('{"unexpected":"kept"}')).closest("details")?.open).toBe(true);
  client.clear();
});

it("checks once more when the owning batch settles before the next poll", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const pending = {
    call_id: "call",
    arguments: "{}",
    arguments_truncated: false,
    output: null,
    output_truncated: false,
  };
  const request = vi
    .spyOn(api, "getToolCallContent")
    .mockResolvedValueOnce(pending)
    .mockResolvedValue({ ...pending, output: "settled result" });
  const tool: ToolPresentation = {
    callId: "call",
    occurrence: "log:parent:store:1:digest:2",
    name: "subagent",
    label: "Subagent",
    summary: null,
    resultPreview: null,
    status: "success",
    statusLabel: "Succeeded",
    resultMayBePending: true,
  };
  const view = render(
    <QueryClientProvider client={client}>
      <DelegationInvocationResult sessionId="parent" blockKey="tool-1-call" tool={tool} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText("Invocation result"));
  await waitFor(() =>
    expect(
      client.getQueryData(
        queryKeys.toolCallContent("parent", "call", "tool-1-call", "log:parent:store:1:digest:2"),
      ),
    ).toBeDefined(),
  );
  view.rerender(
    <QueryClientProvider client={client}>
      <DelegationInvocationResult
        sessionId="parent"
        blockKey="tool-1-call"
        tool={{ ...tool, resultMayBePending: false }}
      />
    </QueryClientProvider>,
  );
  await screen.findByText("settled result");
  expect(request).toHaveBeenCalledTimes(2);
  client.clear();
});

it("reports an absent result once an interrupted run is settled", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(api, "getToolCallContent").mockResolvedValue({
    call_id: "call",
    arguments: "{}",
    arguments_truncated: false,
    output: null,
    output_truncated: false,
  });
  const tool: ToolPresentation = {
    callId: "call",
    occurrence: "log:parent:store:1:digest:2",
    name: "subagent",
    label: "Subagent",
    summary: null,
    resultPreview: null,
    status: "interrupted",
    statusLabel: "Interrupted",
    resultMayBePending: false,
  };
  render(
    <QueryClientProvider client={client}>
      <DelegationInvocationResult sessionId="parent" blockKey="tool-1-call" tool={tool} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText("Invocation result"));
  await screen.findByText("No invocation result was recorded.");
  client.clear();
});

it("refreshes after an in-flight pre-settlement read returns empty", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const pending = {
    call_id: "call",
    arguments: "{}",
    arguments_truncated: false,
    output: null,
    output_truncated: false,
  };
  const first = Promise.withResolvers<typeof pending>();
  const request = vi
    .spyOn(api, "getToolCallContent")
    .mockReturnValueOnce(first.promise)
    .mockResolvedValue({ ...pending, output: "settled result" });
  const tool: ToolPresentation = {
    callId: "call",
    occurrence: "log:parent:store:1:digest:2",
    name: "subagent",
    label: "Subagent",
    summary: null,
    resultPreview: null,
    status: "success",
    statusLabel: "Succeeded",
    resultMayBePending: true,
  };
  const view = render(
    <QueryClientProvider client={client}>
      <DelegationInvocationResult sessionId="parent" blockKey="tool-1-call" tool={tool} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText("Invocation result"));
  await waitFor(() => expect(request).toHaveBeenCalledOnce());
  view.rerender(
    <QueryClientProvider client={client}>
      <DelegationInvocationResult
        sessionId="parent"
        blockKey="tool-1-call"
        tool={{ ...tool, resultMayBePending: false }}
      />
    </QueryClientProvider>,
  );
  first.resolve(pending);
  await screen.findByText("settled result");
  expect(request).toHaveBeenCalledTimes(2);
  client.clear();
});

it("does not automatically retry a failed read after settlement", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const first = Promise.withResolvers<Awaited<ReturnType<typeof api.getToolCallContent>>>();
  const request = vi.spyOn(api, "getToolCallContent").mockReturnValueOnce(first.promise);
  const tool: ToolPresentation = {
    callId: "call",
    occurrence: "log:parent:store:1:digest:2",
    name: "subagent",
    label: "Subagent",
    summary: null,
    resultPreview: null,
    status: "success",
    statusLabel: "Succeeded",
    resultMayBePending: true,
  };
  const view = render(
    <QueryClientProvider client={client}>
      <DelegationInvocationResult sessionId="parent" blockKey="tool-1-call" tool={tool} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText("Invocation result"));
  await waitFor(() => expect(request).toHaveBeenCalledOnce());
  view.rerender(
    <QueryClientProvider client={client}>
      <DelegationInvocationResult
        sessionId="parent"
        blockKey="tool-1-call"
        tool={{ ...tool, resultMayBePending: false }}
      />
    </QueryClientProvider>,
  );
  first.reject(new Error("redaction unavailable"));
  await screen.findByRole("alert");
  expect(request).toHaveBeenCalledOnce();
  client.clear();
});

it("never performs ID-only lookup for a pending or stale delegation", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const request = vi.spyOn(api, "getToolCallContent");
  const tool: ToolPresentation = {
    callId: "reused",
    name: "subagent",
    label: "Subagent",
    summary: null,
    resultPreview: null,
    status: "unknown",
    statusLabel: "Outcome unavailable",
    resultMayBePending: true,
  };
  const view = render(
    <QueryClientProvider client={client}>
      <DelegationInvocationResult sessionId="parent" blockKey="new" tool={tool} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText("Invocation result"));
  await screen.findByText("Invocation result unavailable without a retained occurrence.");
  expect(request).not.toHaveBeenCalled();
  view.rerender(
    <QueryClientProvider client={client}>
      <DelegationInvocationResult
        sessionId="parent"
        blockKey="new"
        tool={{ ...tool, resultMayBePending: false }}
      />
    </QueryClientProvider>,
  );
  expect(
    screen.getByText("Invocation result unavailable without a retained occurrence."),
  ).toBeTruthy();
  expect(request).not.toHaveBeenCalled();
  client.clear();
});

it("hides a cached result if its occurrence binding disappears", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const request = vi.spyOn(api, "getToolCallContent").mockResolvedValue({
    call_id: "reused",
    arguments: "{}",
    arguments_truncated: false,
    output: "original result",
    output_truncated: false,
  });
  const tool: ToolPresentation = {
    callId: "reused",
    occurrence: "log:parent:store:1:digest:2",
    name: "subagent",
    label: "Subagent",
    summary: null,
    resultPreview: null,
    status: "unknown",
    statusLabel: "Outcome unavailable",
  };
  const view = render(
    <QueryClientProvider client={client}>
      <DelegationInvocationResult sessionId="parent" blockKey="old" tool={tool} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText("Invocation result"));
  await screen.findByText("original result");
  view.rerender(
    <QueryClientProvider client={client}>
      <DelegationInvocationResult
        sessionId="parent"
        blockKey="old"
        tool={{ ...tool, occurrence: undefined }}
      />
    </QueryClientProvider>,
  );
  expect(screen.queryByText("original result")).toBeNull();
  expect(
    screen.getByText("Invocation result unavailable without a retained occurrence."),
  ).toBeTruthy();
  expect(request).toHaveBeenCalledTimes(1);
  client.clear();
});
