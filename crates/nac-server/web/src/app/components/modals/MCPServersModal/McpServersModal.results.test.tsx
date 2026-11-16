/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PresentationBoundary } from "@/app/providers/PresentationBoundary";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries/keys";
import type { McpLibraryEntry, McpServerView, TestMcpServerResponse } from "@/app/types/api";
import { McpServersModal } from "./McpServersModal";

vi.mock("@/app/hooks/useMediaQuery", () => ({ useIsMobile: () => true }));

const entry: McpLibraryEntry = {
  id: "phone-fixture",
  name: "Phone fixture",
  description: "A controlled template",
  category: "Testing",
  tags: [],
  auth: "none",
  transport: "stdio",
  url: "",
  docs_url: "https://example.test/docs",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function savedServer(): McpServerView {
  return {
    name: "current_server",
    enabled: true,
    required: false,
    protocol: "legacy",
    transport: "stdio",
    command: "fixture-command",
    args: ["--keep"],
    env: {},
    env_vars: [],
    env_headers: {},
    headers: {},
    approval: "ask",
    denied_tools: [],
    tool_approvals: {},
  };
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

for (const origin of ["custom", "template"] as const) {
  for (const outcome of [
    "save rejection",
    "test rejection",
    "test refusal",
    "test success",
  ] as const) {
    it(`owns local ${outcome} across the actual phone ${origin} exit/reopen`, async () => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      vi.spyOn(api, "getMcpLibrary").mockResolvedValue({ entries: [entry] });
      const reads = vi.spyOn(api, "listMcpServers").mockResolvedValue({ servers: [] });
      vi.spyOn(api, "listMcpRuntimeStatus").mockResolvedValue({ servers: [] });
      const save = deferred<McpServerView>();
      const probe = deferred<TestMcpServerResponse>();
      const create = vi.spyOn(api, "createMcpServer").mockResolvedValue(savedServer());
      const test = vi.spyOn(api, "testMcpServer");
      const invalidation = vi.spyOn(client, "invalidateQueries");
      const saving = outcome === "save rejection";
      if (saving) create.mockReturnValueOnce(save.promise);
      else test.mockReturnValueOnce(probe.promise);
      try {
        const tree = (open: boolean) => (
          <MemoryRouter>
            <QueryClientProvider client={client}>
              <PresentationBoundary>
                <ToastProvider>
                  <McpServersModal open={open} onClose={() => {}} />
                </ToastProvider>
              </PresentationBoundary>
            </QueryClientProvider>
          </MemoryRouter>
        );
        const view = render(tree(true));
        fireEvent.click(await screen.findByRole("button", { name: "Add server" }));
        const picker = await screen.findByRole("dialog", { name: "Add server" });
        const choose = () =>
          fireEvent.click(
            within(picker).getByRole("button", {
              name: origin === "custom" ? "Custom" : /Phone fixture/,
            }),
          );
        await waitFor(() =>
          expect(within(picker).getByRole("button", { name: /Phone fixture/ })).toBeTruthy(),
        );
        choose();
        const title = origin === "custom" ? "Custom server" : entry.name;
        const form = await screen.findByRole("dialog", { name: title });
        fireEvent.click(within(form).getByRole("button", { name: "Stdio" }));
        const name = within(form).getByLabelText("Server name") as HTMLInputElement;
        fireEvent.change(name, { target: { value: "prior_server" } });
        fireEvent.change(within(form).getByLabelText("Command"), {
          target: { value: "fixture-command" },
        });
        fireEvent.click(within(form).getByRole("button", { name: "Add argument" }));
        fireEvent.change(within(form).getByRole("textbox", { name: "Argument 1" }), {
          target: { value: "--keep" },
        });
        fireEvent.click(
          within(form).getByRole("button", {
            name: saving ? "Save" : "Test connection",
          }),
        );
        await waitFor(() => expect(saving ? create : test).toHaveBeenCalledOnce());
        await waitFor(() =>
          expect(
            (
              within(form).getByRole("button", {
                name: saving ? "Saving…" : "Save",
              }) as HTMLButtonElement
            ).disabled,
          ).toBe(true),
        );
        if (origin === "custom")
          fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
        else view.rerender(tree(false));
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 80));
        });
        expect(name.isConnected).toBe(true);
        if (origin === "custom") choose();
        else view.rerender(tree(true));
        expect(within(form).getByLabelText("Server name")).toBe(name);
        expect(name.value).toBe("prior_server");
        expect(
          (
            within(form).getByRole("textbox", {
              name: "Argument 1",
            }) as HTMLInputElement
          ).value,
        ).toBe("--keep");
        expect(
          (
            within(form).getByRole("button", {
              name: saving ? "Saving…" : "Save",
            }) as HTMLButtonElement
          ).disabled,
        ).toBe(true);
        await act(async () => {
          if (saving) save.reject(new Error("Prior draft failure."));
          else if (outcome === "test rejection") probe.reject(new Error("Prior draft failure."));
          else
            probe.resolve({
              auth_required: false,
              connected: outcome === "test success",
              tools: [{ name: "prior_tool" }],
              error: "Prior draft failure.",
            });
        });
        await waitFor(() =>
          expect(
            (within(form).getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled,
          ).toBe(false),
        );
        expect(within(form).queryByRole("alert")).toBeNull();
        expect(within(form).queryByText("prior_tool")).toBeNull();
        expect(within(form).queryByText("1 tool found")).toBeNull();
        const message =
          outcome === "test success"
            ? "Connection succeeded: 1 tool found."
            : `${saving ? "Save" : "Test"} failed: Prior draft failure.`;
        expect(screen.getByText(message)).toBeTruthy();
        expect(invalidation).not.toHaveBeenCalled();
        fireEvent.change(name, { target: { value: "current_server" } });
        const current = deferred<TestMcpServerResponse>();
        test.mockReturnValueOnce(current.promise);
        fireEvent.click(within(form).getByRole("button", { name: "Test connection" }));
        await waitFor(() => expect(test).toHaveBeenCalledTimes(saving ? 1 : 2));
        await waitFor(() =>
          expect(
            (within(form).getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled,
          ).toBe(true),
        );
        expect(test.mock.calls.at(-1)?.[0]).toMatchObject({
          name: "current_server",
          args: ["--keep"],
        });
        await act(async () =>
          current.resolve({
            auth_required: false,
            connected: true,
            tools: [{ name: "current_tool" }],
          }),
        );
        await waitFor(() => expect(within(form).getByText("current_tool")).toBeTruthy());
        await waitFor(() =>
          expect(
            (within(form).getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled,
          ).toBe(false),
        );
        fireEvent.click(within(form).getByRole("button", { name: "Save" }));
        await waitFor(() => expect(create).toHaveBeenCalledTimes(saving ? 2 : 1));
        await waitFor(() => expect(invalidation).toHaveBeenCalledTimes(2));
        expect(invalidation).toHaveBeenCalledWith({ queryKey: queryKeys.mcpServers });
        expect(invalidation).toHaveBeenCalledWith({ queryKey: queryKeys.mcpRuntime });
        expect(create.mock.calls.at(-1)?.[0]).toMatchObject({
          name: "current_server",
          args: ["--keep"],
        });
        await waitFor(() => expect(screen.queryByRole("dialog", { name: title })).toBeNull());
        expect(await screen.findByRole("dialog", { name: "MCP servers" })).toBeTruthy();
        await waitFor(() => expect(reads.mock.calls.length).toBeGreaterThan(1));
      } finally {
        cleanup();
        client.clear();
      }
    });
  }
}
