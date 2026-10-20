/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { McpServerForm } from "@/app/components/modals/MCPServersModal/McpServerForm";
import { ToastProvider } from "@/app/providers/ToastProvider";
import type { McpServerView } from "@/app/types/api";

const fakes = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  test: vi.fn(),
}));

vi.mock("@/app/components/modals/MCPServersModal/McpOAuthPanel", () => ({
  McpOAuthPanel: () => null,
}));
vi.mock("@/app/services/queries", () => {
  const mutation = (mutateAsync: unknown) => ({ mutateAsync, isPending: false });
  return {
    useCreateMcpServer: () => mutation(fakes.create),
    useUpdateMcpServer: () => mutation(fakes.update),
    useTestMcpServer: () => mutation(fakes.test),
    useDeleteMcpServer: () => mutation(vi.fn()),
    useMcpRuntimeAction: () => mutation(vi.fn()),
    useMcpRuntimeStatus: () => ({ data: undefined }),
  };
});

const ALLOWLIST = "linear_add_comment,linear_read_issue,linear_update_issue";

function stdioRecord(args: string[]): McpServerView {
  return {
    name: "linear",
    enabled: true,
    required: false,
    protocol: "legacy",
    transport: "stdio",
    command: "agentic-mcp",
    args,
    cwd: null,
    env: {},
    env_vars: ["HOME"],
    env_headers: {},
    headers: {},
    approval: "ask",
    denied_tools: [],
    tool_approvals: {},
  };
}

function httpRecord(helperArgs: string[]): McpServerView {
  return {
    ...stdioRecord([]),
    transport: "streamable_http",
    command: null,
    url: "https://mcp.example.test/mcp",
    header_helper: {
      command: "./refresh-headers",
      args: helperArgs,
      cwd: null,
      env: {},
      env_vars: ["TOKEN_HOME"],
      timeout_ms: null,
    },
  };
}

function Form({ record }: { record: McpServerView | null }) {
  const [footer, setFooter] = useState<ReactNode>(null);
  return (
    <ToastProvider>
      <McpServerForm
        record={record}
        template={null}
        libraryEntry={null}
        onClose={() => {}}
        onSaved={() => {}}
        onDeleted={() => {}}
        setFooter={setFooter}
      />
      {footer}
    </ToastProvider>
  );
}

function argument(n: number, item = "Argument") {
  return screen.getByRole("textbox", { name: `${item} ${n}` }) as HTMLInputElement;
}

function type(field: HTMLInputElement, value: string) {
  fireEvent.change(field, { target: { value } });
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  fakes.create.mockReset().mockResolvedValue({ name: "linear" });
  fakes.update.mockReset().mockResolvedValue({ name: "linear" });
  fakes.test.mockReset().mockResolvedValue({ connected: true, tools: [], error: null });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("stdio arguments", () => {
  it("sends each field as one argument, in order, from Test connection and create", async () => {
    render(<Form record={null} />);
    type(screen.getByPlaceholderText("my_server"), "linear");
    fireEvent.click(screen.getByRole("button", { name: "Stdio" }));
    type(screen.getByPlaceholderText("npx"), "agentic-mcp");

    expect(screen.getByText("No arguments.")).toBeTruthy();
    expect(
      screen.getByText("Each field is one argument. Values are passed in this order."),
    ).toBeTruthy();
    for (const value of ["--allow", ALLOWLIST, "", ' --label="two words" ', "--allow"]) {
      fireEvent.click(screen.getByRole("button", { name: "Add argument" }));
      type(document.activeElement as HTMLInputElement, value);
    }
    expect(argument(2).value).toBe(ALLOWLIST);

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Trimming and dropping a blank field are the policy of the one-per-line field this replaced.
    const sent = ["--allow", ALLOWLIST, '--label="two words"', "--allow"];
    await waitFor(() => expect(fakes.create).toHaveBeenCalledOnce());
    expect(fakes.test.mock.calls[0][0].args).toEqual(sent);
    expect(fakes.create.mock.calls[0][0].args).toEqual(sent);
  });

  it("shows the agentic-mcp example as two fields and sends exactly those two", async () => {
    render(<Form record={stdioRecord(["--allow", ALLOWLIST])} />);
    expect(screen.getAllByRole("textbox", { name: /^Argument \d+$/ })).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fakes.update).toHaveBeenCalledOnce());
    expect(fakes.test.mock.calls[0][0].args).toEqual(["--allow", ALLOWLIST]);
    expect(fakes.update.mock.calls[0][0].payload.args).toEqual(["--allow", ALLOWLIST]);
  });

  it("reopens a saved configuration in order and updates it after a removal", async () => {
    render(<Form record={stdioRecord(["--allow", ALLOWLIST, "--verbose"])} />);
    expect([1, 2, 3].map((n) => argument(n).value)).toEqual(["--allow", ALLOWLIST, "--verbose"]);

    fireEvent.click(screen.getByRole("button", { name: "Remove argument 1" }));
    type(argument(2), "--quiet");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fakes.update).toHaveBeenCalledOnce());
    expect(fakes.update.mock.calls[0][0].payload).toMatchObject({
      args: [ALLOWLIST, "--quiet"],
      env_vars: ["HOME"],
    });
  });

  it("saves a configuration with every argument removed as no arguments", async () => {
    render(<Form record={stdioRecord(["--allow", ALLOWLIST])} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove argument 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove argument 1" }));
    expect(screen.getByText("No arguments.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fakes.update).toHaveBeenCalledOnce());
    expect(fakes.update.mock.calls[0][0].payload.args).toEqual([]);
  });

  it("moves focus to the new field, then to a neighbour or Add argument on removal", () => {
    render(<Form record={stdioRecord(["one", "two", "three"])} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove argument 2" }));
    expect(document.activeElement).toBe(argument(2));
    expect(argument(2).value).toBe("three");

    fireEvent.click(screen.getByRole("button", { name: "Remove argument 2" }));
    expect(document.activeElement).toBe(argument(1));

    fireEvent.click(screen.getByRole("button", { name: "Remove argument 1" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add argument" }));

    fireEvent.click(screen.getByRole("button", { name: "Add argument" }));
    expect(document.activeElement).toBe(argument(1));
  });

  it("splits a pasted one-per-line list into fields and keeps a single-line paste whole", async () => {
    render(<Form record={stdioRecord(["--allow", "--verbose"])} />);
    const paste = (field: HTMLInputElement, text: string) =>
      fireEvent.paste(field, { clipboardData: { getData: () => text } });

    argument(2).setSelectionRange(2, 9);
    paste(argument(2), "quiet\r\n-y\n\nsome-mcp-server\n");
    expect(document.activeElement).toBe(argument(4));
    paste(argument(1), ALLOWLIST);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fakes.update).toHaveBeenCalledOnce());
    // A paste without newlines is left to the input, so only the multi-line paste changed rows.
    expect(fakes.update.mock.calls[0][0].payload.args).toEqual([
      "--allow",
      "--quiet",
      "-y",
      "some-mcp-server",
    ]);
  });

  it("never submits a surrounding form from its buttons", () => {
    render(<Form record={stdioRecord(["one"])} />);

    for (const name of ["Add argument", "Remove argument 1"]) {
      expect(screen.getByRole("button", { name }).getAttribute("type")).toBe("button");
    }
  });
});

describe("header helper arguments", () => {
  it("sends the added rows when creating a server", async () => {
    render(<Form record={null} />);
    type(screen.getByPlaceholderText("my_server"), "linear");
    type(screen.getByPlaceholderText("https://example.com/mcp"), "https://mcp.example.test/mcp");
    type(screen.getByPlaceholderText("./refresh-mcp-headers"), "./refresh-headers");
    for (const value of ["--profile", "a b"]) {
      fireEvent.click(screen.getByRole("button", { name: "Add argument" }));
      type(document.activeElement as HTMLInputElement, value);
    }
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fakes.create).toHaveBeenCalledOnce());
    expect(fakes.create.mock.calls[0][0].header_helper.args).toEqual(["--profile", "a b"]);
  });

  it("uses the same rows and serialization for update and Test connection", async () => {
    render(<Form record={httpRecord(["--profile", "a b"])} />);
    const item = "Header helper argument";
    expect([1, 2].map((n) => argument(n, item).value)).toEqual(["--profile", "a b"]);

    fireEvent.click(screen.getByRole("button", { name: "Add argument" }));
    type(argument(3, item), "key=value,other");
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const sent = ["--profile", "a b", "key=value,other"];
    await waitFor(() => expect(fakes.update).toHaveBeenCalledOnce());
    expect(fakes.test.mock.calls[0][0].header_helper).toMatchObject({
      args: sent,
      env_vars: ["TOKEN_HOME"],
    });
    expect(fakes.update.mock.calls[0][0].payload.header_helper).toMatchObject({
      args: sent,
      env_vars: ["TOKEN_HOME"],
    });
  });
});
