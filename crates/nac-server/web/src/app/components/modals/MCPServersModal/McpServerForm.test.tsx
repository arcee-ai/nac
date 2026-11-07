/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { McpServerForm } from "@/app/components/modals/MCPServersModal/McpServerForm";
import { ToastProvider } from "@/app/providers/ToastProvider";
import type { McpServerView } from "@/app/types/api";

const fakes = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  test: vi.fn(),
  updatePending: false,
  runtime: undefined as { servers: { name: string; sessions_blocked: boolean }[] } | undefined,
}));

vi.mock("@/app/components/modals/MCPServersModal/McpOAuthPanel", () => ({
  McpOAuthPanel: () => null,
}));
vi.mock("@/app/services/queries", () => {
  const mutation = (mutateAsync: unknown) => ({ mutateAsync, isPending: false });
  return {
    useCreateMcpServer: () => mutation(fakes.create),
    useUpdateMcpServer: () => ({ ...mutation(fakes.update), isPending: fakes.updatePending }),
    useTestMcpServer: () => mutation(fakes.test),
    useDeleteMcpServer: () => mutation(vi.fn()),
    useMcpRuntimeAction: () => mutation(vi.fn()),
    useMcpRuntimeStatus: () => ({ data: fakes.runtime }),
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

function Form({
  record,
  onSaved = () => {},
  isCurrent,
}: {
  record: McpServerView | null;
  onSaved?: (name: string) => void;
  isCurrent?: () => boolean;
}) {
  const [footer, setFooter] = useState<ReactNode>(null);
  return (
    <ToastProvider>
      <McpServerForm
        record={record}
        template={null}
        libraryEntry={null}
        onClose={() => {}}
        onSaved={onSaved}
        onDeleted={() => {}}
        isCurrent={isCurrent}
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

/** Dispatches a paste over `selection`; returns false when the editor took it over. */
function paste(field: HTMLInputElement, text: string, selection: [number, number]) {
  field.setSelectionRange(...selection);
  return fireEvent.paste(field, { clipboardData: { getData: () => text } });
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
  fakes.runtime = undefined;
  fakes.updatePending = false;
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

  it("creates the agentic-mcp example from two fields and sends exactly those two", async () => {
    render(<Form record={null} />);
    type(screen.getByPlaceholderText("my_server"), "linear");
    fireEvent.click(screen.getByRole("button", { name: "Stdio" }));
    type(screen.getByPlaceholderText("npx"), "agentic-mcp");
    for (const value of ["--allow", ALLOWLIST]) {
      fireEvent.click(screen.getByRole("button", { name: "Add argument" }));
      type(document.activeElement as HTMLInputElement, value);
    }
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fakes.create).toHaveBeenCalledOnce());
    expect(fakes.test.mock.calls[0][0].args).toEqual(["--allow", ALLOWLIST]);
    expect(fakes.create.mock.calls[0][0].args).toEqual(["--allow", ALLOWLIST]);
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

  it("splits a multi-line paste at the selection, keeping the text around it and later rows", async () => {
    render(<Form record={stdioRecord(["--allow", "--verbose", "--last"])} />);

    // Replace "verbose" in "--verbose"; mixed CRLF/LF and blank lines.
    paste(argument(2), "quiet\r\n-y\n\nsome-mcp-server\n", [2, 9]);
    expect(document.activeElement).toBe(argument(4));
    expect([1, 2, 3, 4, 5].map((n) => argument(n).value)).toEqual([
      "--allow",
      "--quiet",
      "-y",
      "some-mcp-server",
      "--last",
    ]);
    // A partial selection keeps its prefix on the first line and its suffix on the last.
    paste(argument(1), "x\ny", [3, 5]);
    expect([1, 2].map((n) => argument(n).value)).toEqual(["--ax", "yow"]);
    expect(document.activeElement).toBe(argument(2));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fakes.update).toHaveBeenCalledOnce());
    expect(fakes.update.mock.calls[0][0].payload.args).toEqual([
      "--ax",
      "yow",
      "--quiet",
      "-y",
      "some-mcp-server",
      "--last",
    ]);
  });

  it("empties a fully selected argument pasted over with only blank lines", async () => {
    render(<Form record={stdioRecord(["--first", "--keep-me", "--last"])} />);

    paste(argument(2), "\n  \r\n\n", [0, "--keep-me".length]);
    expect(argument(2).value).toBe("");
    expect(document.activeElement).toBe(argument(2));
    expect(screen.getAllByRole("textbox", { name: /^Argument \d+$/ })).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fakes.update).toHaveBeenCalledOnce());
    expect(fakes.test.mock.calls[0][0].args).toEqual(["--first", "--last"]);
    expect(fakes.update.mock.calls[0][0].payload.args).toEqual(["--first", "--last"]);
  });

  it("fills an empty row from a multi-line paste and leaves it empty for a blank one", () => {
    render(<Form record={stdioRecord([])} />);
    fireEvent.click(screen.getByRole("button", { name: "Add argument" }));

    paste(argument(1), "\r\n\n", [0, 0]);
    expect(screen.getAllByRole("textbox", { name: /^Argument \d+$/ })).toHaveLength(1);
    expect(argument(1).value).toBe("");

    paste(argument(1), "--one\r\n--two", [0, 0]);
    expect([1, 2].map((n) => argument(n).value)).toEqual(["--one", "--two"]);
  });

  it("does not intercept a paste without line breaks", () => {
    render(<Form record={stdioRecord(["--allow"])} />);
    // jsdom does not insert pasted text, so this only shows the input keeps its native paste.
    expect(paste(argument(1), ALLOWLIST, [0, 7])).toBe(true);
    expect(argument(1).value).toBe("--allow");
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

  it("applies the same paste handling to header helper arguments on Test and save", async () => {
    render(<Form record={httpRecord(["--profile", "--keep-me", "a b"])} />);
    const item = "Header helper argument";

    paste(argument(2, item), "\n\n", [0, "--keep-me".length]);
    expect(argument(2, item).value).toBe("");
    paste(argument(3, item), "-x\r\ny", [1, 1]);
    expect([3, 4].map((n) => argument(n, item).value)).toEqual(["a-x", "y b"]);
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const sent = ["--profile", "a-x", "y b"];
    await waitFor(() => expect(fakes.update).toHaveBeenCalledOnce());
    expect(fakes.test.mock.calls[0][0].header_helper.args).toEqual(sent);
    expect(fakes.update.mock.calls[0][0].payload.header_helper.args).toEqual(sent);
  });
});

describe("runtime connection", () => {
  it("keeps both phone transport drafts and masked values without writing on selection", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    render(
      <MemoryRouter>
        <Form record={httpRecord(["--keep-helper"])} />
      </MemoryRouter>,
    );
    const http = screen.getByRole("button", { name: "Streamable HTTP" });
    const stdio = screen.getByRole("button", { name: "Stdio" });
    type(screen.getByLabelText("URL"), "https://mcp.example.test/keep");
    type(screen.getByLabelText("Bearer token environment variable"), "KEEP_TOKEN");
    fireEvent.click(stdio);
    expect(stdio.getAttribute("aria-pressed")).toBe("true");
    type(screen.getByLabelText("Command"), "keep-command");
    fireEvent.click(screen.getByRole("button", { name: "Add argument" }));
    type(argument(1), "--keep-stdio");
    fireEvent.click(screen.getByRole("button", { name: "Add entry" }));
    type(screen.getByLabelText("Environment key 1"), "KEEP_ENV");
    type(screen.getByLabelText("Environment value 1"), "${KEEP_ENV}");
    fireEvent.click(http);
    expect(http.getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByLabelText("URL") as HTMLInputElement).value).toBe(
      "https://mcp.example.test/keep",
    );
    expect(argument(1, "Header helper argument").value).toBe("--keep-helper");
    fireEvent.click(stdio);
    expect((screen.getByLabelText("Command") as HTMLInputElement).value).toBe("keep-command");
    expect(argument(1).value).toBe("--keep-stdio");
    const secret = screen.getByLabelText("Environment value 1") as HTMLInputElement;
    expect(secret.type).toBe("password");
    expect(secret.value).toBe("${KEEP_ENV}");
    expect(fakes.create).not.toHaveBeenCalled();
    expect(fakes.update).not.toHaveBeenCalled();
    expect(fakes.test).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(fakes.test).toHaveBeenCalledOnce());
    expect(fakes.test.mock.calls[0][0]).toMatchObject({
      transport: "stdio",
      command: "keep-command",
      args: ["--keep-stdio"],
      env: { KEEP_ENV: "${KEEP_ENV}" },
    });
    fireEvent.click(http);
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(fakes.test).toHaveBeenCalledTimes(2));
    expect(fakes.test.mock.calls[1][0]).toMatchObject({
      transport: "streamable_http",
      url: "https://mcp.example.test/keep",
      bearer_token_env_var: "KEEP_TOKEN",
      header_helper: { args: ["--keep-helper"] },
    });
    expect(fakes.create).not.toHaveBeenCalled();
    expect(fakes.update).not.toHaveBeenCalled();
  });

  it("says sessions will not use a server the user disconnected", () => {
    fakes.runtime = { servers: [{ name: "linear", sessions_blocked: true }] };
    render(<Form record={stdioRecord([])} />);
    expect(
      screen.getByText("Disconnected. Sessions won't use this server until you connect it."),
    ).toBeTruthy();
  });
});

describe("native form admission", () => {
  it("keeps every editing control inside the pending native fieldset without replacing its draft", async () => {
    const record = stdioRecord(["--keep"]);
    const view = render(<Form record={record} />);
    const name = screen.getByLabelText("Server name") as HTMLInputElement;
    type(name, "kept draft");
    const fieldset = name.closest("fieldset")!;
    const controls = Array.from(fieldset.querySelectorAll("input,button,select,textarea"));
    const disabledBefore = controls.map((control) => control.matches(":disabled"));
    expect(controls.every((control) => control.closest("fieldset") === fieldset)).toBe(true);

    fakes.updatePending = true;
    view.rerender(<Form record={record} />);
    expect(fieldset.disabled).toBe(true);
    expect(controls.every((control) => control.matches(":disabled"))).toBe(true);
    (screen.getByRole("button", { name: "Add argument" }) as HTMLButtonElement).click();
    (screen.getByRole("button", { name: "Test connection" }) as HTMLButtonElement).click();
    expect(fakes.test).not.toHaveBeenCalled();
    expect(fakes.update).not.toHaveBeenCalled();
    expect(screen.getAllByRole("textbox", { name: /^Argument \d+$/ })).toHaveLength(1);
    expect(screen.getByLabelText("Server name")).toBe(name);
    expect(name.value).toBe("kept draft");
    expect(Array.from(fieldset.querySelectorAll("input,button,select,textarea"))).toEqual(controls);

    fakes.updatePending = false;
    view.rerender(<Form record={record} />);
    expect(fieldset.disabled).toBe(false);
    expect(controls.map((control) => control.matches(":disabled"))).toEqual(disabledBefore);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fakes.update).toHaveBeenCalledOnce());
    expect(fakes.update.mock.calls[0][0].payload).toMatchObject({
      name: "kept draft",
      args: ["--keep"],
    });
  });
});

describe("form result ownership", () => {
  it("does not select an old server after its submitted form is replaced", async () => {
    let finish!: (value: { name: string }) => void;
    fakes.update.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const oldSaved = vi.fn();
    const newerSaved = vi.fn();
    const view = render(<Form key="old" record={stdioRecord([])} onSaved={oldSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fakes.update).toHaveBeenCalledOnce());
    view.rerender(<Form key="new" record={null} onSaved={newerSaved} />);
    type(screen.getByLabelText("Server name"), "newer draft");
    await act(async () => {
      finish({ name: "linear" });
    });
    expect(oldSaved).not.toHaveBeenCalled();
    expect(newerSaved).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Server name") as HTMLInputElement).value).toBe("newer draft");
  });

  it("keeps a rejected draft visible with an adjacent error and allows retry", async () => {
    fakes.update.mockRejectedValueOnce(new Error("Configured Deny prevents this operation."));
    render(<Form record={stdioRecord(["--keep"])} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("alert")
          .some((alert) => alert.textContent?.includes("Configured Deny")),
      ).toBe(true),
    );
    expect(argument(1).value).toBe("--keep");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fakes.update).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByText("Save failed: Configured Deny prevents this operation.", {
        selector: "p",
      }),
    ).toBeNull();
  });
});

for (const outcome of [
  "save rejection",
  "test rejection",
  "test refusal",
  "test success",
] as const) {
  it(`keeps late ${outcome} out of a newer opening of the same mounted form`, async () => {
    let currentOpening = 0;
    let finish!: (value: {
      connected: boolean;
      tools: { name: string; description: string }[];
      error: string | null;
    }) => void;
    let fail!: (error: Error) => void;
    const pending = new Promise<Parameters<typeof finish>[0]>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    const saving = outcome === "save rejection";
    const mutation = saving ? fakes.update : fakes.test;
    mutation.mockReturnValueOnce(pending);
    const owns = (opening: number) => () => currentOpening === opening;
    const record = stdioRecord(["--keep"]);
    const view = render(<Form record={record} isCurrent={owns(0)} />);
    fireEvent.click(screen.getByRole("button", { name: saving ? "Save" : "Test connection" }));
    await waitFor(() => expect(mutation).toHaveBeenCalledOnce());
    const field = screen.getByLabelText("Server name");
    currentOpening += 1;
    view.rerender(<Form record={record} isCurrent={owns(1)} />);
    expect(screen.getByLabelText("Server name")).toBe(field);
    type(field as HTMLInputElement, "newer draft");
    await act(async () => {
      if (outcome.endsWith("rejection")) fail(new Error("Prior draft failure."));
      else
        finish({
          connected: outcome === "test success",
          tools: [{ name: "prior_tool", description: "Prior draft only" }],
          error: outcome === "test refusal" ? "Prior draft failure." : null,
        });
    });
    expect((screen.getByLabelText("Server name") as HTMLInputElement).value).toBe("newer draft");
    expect(argument(1).value).toBe("--keep");
    expect(screen.queryByText(/Prior draft failure\./, { selector: "p" })).toBeNull();
    expect(screen.queryByText("prior_tool")).toBeNull();
    expect(screen.queryByText("1 tool found")).toBeNull();
    // The original operation still reports its outcome through the unchanged toast.
    const message =
      outcome === "test success"
        ? "Connection succeeded: 1 tool found."
        : `${saving ? "Save" : "Test"} failed: Prior draft failure.`;
    expect(screen.getByText(message)).toBeTruthy();
    fakes.test.mockResolvedValueOnce({
      connected: true,
      tools: [{ name: "current_tool", description: "Current opening" }],
      error: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(screen.getByText("current_tool")).toBeTruthy());
    expect(screen.getByText("1 tool found")).toBeTruthy();
  });
}
