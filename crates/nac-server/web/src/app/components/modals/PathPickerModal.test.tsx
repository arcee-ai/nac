/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PathPickerModal } from "@/app/components/modals/PathPickerModal";
import { api, ApiError } from "@/app/services/api";
import type { BrowseKind } from "@/app/services/queries";
import type { BrowseListing, SshTarget } from "@/app/types/api";

const OLD = "/work/old";
const SPACED = "/work/my folder ü";

function listing(path: string, entries: BrowseListing["entries"] = []): BrowseListing {
  return { path, parent: "/work", home: "/home/me", entries, truncated: false };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** What the local server answers, keyed by the exact path the picker sent. */
const localAnswers = new Map<string, () => Promise<BrowseListing>>();

function answerLocal(path: string, answer: BrowseListing | (() => Promise<BrowseListing>)) {
  localAnswers.set(path, typeof answer === "function" ? answer : async () => answer);
}

function refuse(status: number, detail: string) {
  return () => Promise.reject(new ApiError(status, "GET", "/fs/browse", detail, "req-1"));
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
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
  localAnswers.clear();
  answerLocal(OLD, listing(OLD, [{ name: "nested", path: `${OLD}/nested`, is_directory: true }]));
  answerLocal(SPACED, listing(SPACED));
  answerLocal(`${SPACED}/`, listing(SPACED));
  answerLocal("~/proj", listing("/home/me/proj"));
  answerLocal("/work/missing", refuse(404, "path '/work/missing' does not exist"));
  answerLocal("/work/notes.txt", refuse(400, "path '/work/notes.txt' is not a directory"));
  answerLocal(
    "/work/locked",
    refuse(403, "could not read directory '/work/locked': Permission denied"),
  );
  vi.spyOn(api, "browsePath").mockImplementation((path) => {
    const answer = localAnswers.get(path ?? "");
    return answer
      ? answer()
      : Promise.reject(new ApiError(404, "GET", "/fs/browse", `unexpected ${path}`, "req-x"));
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

interface PickerProps {
  open?: boolean;
  kind?: BrowseKind;
  initialPath?: string;
  ssh?: SshTarget | null;
  onSelect: (path: string) => void;
  onClose?: () => void;
}

function Picker({
  open = true,
  kind = "directory",
  initialPath = OLD,
  ssh = null,
  onSelect,
  onClose = () => {},
}: PickerProps) {
  return (
    <PathPickerModal
      open={open}
      kind={kind}
      initialPath={initialPath}
      ssh={ssh}
      onClose={onClose}
      onSelect={onSelect}
    />
  );
}

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (node: ReactNode) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(wrap(ui));
  return { ...view, rerender: (node: ReactNode) => view.rerender(wrap(node)) };
}

function pathInput(placeholder = "/path/to/directory") {
  return screen.getByPlaceholderText(placeholder) as HTMLInputElement;
}

function selectButton() {
  return screen.getByRole("button", { name: "Select" });
}

async function listed(text: string) {
  await screen.findByText(text);
}

it.each([
  ["a path with spaces and Unicode", SPACED, SPACED],
  ["a trailing slash, resolved by the server", `${SPACED}/`, SPACED],
  ["a home-relative path, expanded by the server", "~/proj", "/home/me/proj"],
  ["surrounding whitespace", `  ${SPACED}  `, SPACED],
])("Select applies the typed folder for %s without pressing Enter", async (_, typed, expected) => {
  const onSelect = vi.fn();
  renderWithClient(<Picker onSelect={onSelect} />);
  await listed("nested");

  fireEvent.change(pathInput(), { target: { value: typed } });
  fireEvent.click(selectButton());

  await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
  expect(onSelect).toHaveBeenCalledWith(expected);
  expect(onSelect).not.toHaveBeenCalledWith(OLD);
});

it("Enter and Select resolve a typed path the same way", async () => {
  const onSelect = vi.fn();
  renderWithClient(<Picker onSelect={onSelect} />);
  await listed("nested");

  fireEvent.change(pathInput(), { target: { value: "~/proj" } });
  fireEvent.keyDown(pathInput(), { key: "Enter" });
  await waitFor(() => expect(screen.queryByText("nested")).toBeNull());
  fireEvent.click(selectButton());

  await waitFor(() => expect(onSelect).toHaveBeenCalledWith("/home/me/proj"));
  expect(onSelect).toHaveBeenCalledTimes(1);
});

it("a listed folder clicked into is still what Select applies", async () => {
  answerLocal(`${OLD}/nested`, listing(`${OLD}/nested`));
  const onSelect = vi.fn();
  renderWithClient(<Picker onSelect={onSelect} />);

  fireEvent.click(await screen.findByRole("button", { name: "nested" }));
  fireEvent.click(selectButton());

  await waitFor(() => expect(onSelect).toHaveBeenCalledWith(`${OLD}/nested`));
});

it.each([
  ["missing", "/work/missing", "does not exist"],
  ["not a directory", "/work/notes.txt", "is not a directory"],
  ["unreadable", "/work/locked", "Permission denied"],
])(
  "a %s typed path keeps the picker and draft open with the server's reason",
  async (_, typed, reason) => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithClient(<Picker onSelect={onSelect} onClose={onClose} />);
    await listed("nested");

    fireEvent.change(pathInput(), { target: { value: typed } });
    fireEvent.click(selectButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Cannot select this folder: ");
    expect(alert.textContent).toContain(typed);
    expect(alert.textContent).toContain(reason);
    expect(alert.textContent).toContain("Check the path");
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(pathInput().value).toBe(typed);
    // The listing the user came from is still there to pick from instead.
    expect(screen.getByRole("button", { name: "nested" })).toBeTruthy();

    // Correcting the draft clears the complaint, and the corrected path applies.
    fireEvent.change(pathInput(), { target: { value: SPACED } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(selectButton());
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(SPACED));
  },
);

it("a slow check blocks a second Select and is dropped once the draft changes", async () => {
  const slow = deferred<BrowseListing>();
  answerLocal("/work/slow", () => slow.promise);
  const onSelect = vi.fn();
  renderWithClient(<Picker onSelect={onSelect} />);
  await listed("nested");

  fireEvent.change(pathInput(), { target: { value: "/work/slow" } });
  fireEvent.click(selectButton());
  fireEvent.click(selectButton());

  expect(selectButton()).toHaveProperty("disabled", true);
  expect(screen.getByText("Checking /work/slow…")).toBeTruthy();
  expect(
    vi.mocked(api.browsePath).mock.calls.filter(([path]) => path === "/work/slow"),
  ).toHaveLength(1);
  expect(onSelect).not.toHaveBeenCalled();

  fireEvent.change(pathInput(), { target: { value: SPACED } });
  await act(async () => slow.resolve(listing("/work/slow")));
  expect(onSelect).not.toHaveBeenCalled();

  fireEvent.click(selectButton());
  await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
  expect(onSelect).toHaveBeenCalledWith(SPACED);
});

it("a double-clicked slow Select applies its folder exactly once", async () => {
  const slow = deferred<BrowseListing>();
  answerLocal("/work/slow", () => slow.promise);
  const onSelect = vi.fn();
  renderWithClient(<Picker onSelect={onSelect} />);
  await listed("nested");

  fireEvent.change(pathInput(), { target: { value: "/work/slow" } });
  fireEvent.click(selectButton());
  fireEvent.click(selectButton());
  await act(async () => slow.resolve(listing("/work/slow")));

  await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
  expect(onSelect).toHaveBeenCalledWith("/work/slow");
});

it("closing the picker drops a pending check, and reopening starts afresh", async () => {
  const slow = deferred<BrowseListing>();
  answerLocal("/work/slow", () => slow.promise);
  const onSelect = vi.fn();
  const { rerender } = renderWithClient(<Picker onSelect={onSelect} />);
  await listed("nested");

  fireEvent.change(pathInput(), { target: { value: "/work/slow" } });
  fireEvent.click(selectButton());
  rerender(<Picker open={false} onSelect={onSelect} />);
  await act(async () => slow.resolve(listing("/work/slow")));
  expect(onSelect).not.toHaveBeenCalled();

  // Reopened before the exit transition finishes: a fresh draft, not a stuck Select.
  rerender(<Picker open onSelect={onSelect} initialPath={SPACED} />);
  expect(pathInput().value).toBe(SPACED);
  expect(selectButton()).toHaveProperty("disabled", false);
  fireEvent.click(selectButton());
  await waitFor(() => expect(onSelect).toHaveBeenCalledWith(SPACED));
  expect(onSelect).toHaveBeenCalledTimes(1);
});

it("two pickers open at once each apply only their own answer", async () => {
  const first = deferred<BrowseListing>();
  const second = deferred<BrowseListing>();
  answerLocal("/work/first", () => first.promise);
  answerLocal("/work/second", () => second.promise);
  const onFirst = vi.fn();
  const onSecond = vi.fn();
  renderWithClient(
    <>
      <Picker onSelect={onFirst} />
      <Picker onSelect={onSecond} />
    </>,
  );
  await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(2));
  const [one, two] = screen.getAllByRole("dialog");

  fireEvent.change(within(one).getByPlaceholderText("/path/to/directory"), {
    target: { value: "/work/first" },
  });
  fireEvent.change(within(two).getByPlaceholderText("/path/to/directory"), {
    target: { value: "/work/second" },
  });
  fireEvent.click(within(one).getByRole("button", { name: "Select" }));
  fireEvent.click(within(two).getByRole("button", { name: "Select" }));
  await act(async () => second.resolve(listing("/work/second")));
  await act(async () => first.resolve(listing("/work/first")));

  await waitFor(() => expect(onFirst).toHaveBeenCalledTimes(1));
  expect(onFirst).toHaveBeenCalledWith("/work/first");
  expect(onSecond).toHaveBeenCalledTimes(1);
  expect(onSecond).toHaveBeenCalledWith("/work/second");
});

const HOST_A: SshTarget = { ssh_host: "build-a.example" };
const HOST_B: SshTarget = { ssh_host: "build-b.example" };

it("an SSH picker resolves the typed path on that host", async () => {
  const browseSsh = vi.spyOn(api, "browseSshPath").mockImplementation(async (_target, path) => {
    if (path === null) return listing("/home/dev");
    if (path === "~/src/app") return listing("/home/dev/src/app");
    throw new ApiError(404, "POST", "/ssh/browse", `path '${path}' does not exist`, "req-s");
  });
  const onSelect = vi.fn();
  renderWithClient(<Picker ssh={HOST_A} initialPath="" onSelect={onSelect} />);
  await listed("Selected: /home/dev");

  fireEvent.change(pathInput("~/path/on/the/host"), { target: { value: "~/src/app" } });
  fireEvent.click(selectButton());

  await waitFor(() => expect(onSelect).toHaveBeenCalledWith("/home/dev/src/app"));
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(browseSsh).toHaveBeenCalledWith(HOST_A, "~/src/app", false, expect.anything());
  expect(api.browsePath).not.toHaveBeenCalled();

  fireEvent.change(pathInput("~/path/on/the/host"), { target: { value: "~/gone" } });
  fireEvent.click(selectButton());
  expect((await screen.findByRole("alert")).textContent).toContain("does not exist");
  expect(onSelect).toHaveBeenCalledTimes(1);
});

it("switching SSH host drops a pending check made against the old one", async () => {
  const slow = deferred<BrowseListing>();
  vi.spyOn(api, "browseSshPath").mockImplementation(async (target, path) => {
    if (target.ssh_host === HOST_A.ssh_host && path === "~/src") return slow.promise;
    return listing(path ? `/home/${target.ssh_host}/${path.slice(2)}` : "/home/dev");
  });
  const onSelect = vi.fn();
  const { rerender } = renderWithClient(<Picker ssh={HOST_A} initialPath="" onSelect={onSelect} />);
  await listed("Selected: /home/dev");

  fireEvent.change(pathInput("~/path/on/the/host"), { target: { value: "~/src" } });
  fireEvent.click(selectButton());
  rerender(<Picker ssh={HOST_B} initialPath="" onSelect={onSelect} />);
  await act(async () => slow.resolve(listing("/home/a/src")));
  expect(onSelect).not.toHaveBeenCalled();

  // Switching back does not revive the old check either; Select works afresh.
  rerender(<Picker ssh={HOST_A} initialPath="" onSelect={onSelect} />);
  expect(selectButton()).toHaveProperty("disabled", false);
  fireEvent.change(pathInput("~/path/on/the/host"), { target: { value: "~/other" } });
  fireEvent.click(selectButton());
  await waitFor(() => expect(onSelect).toHaveBeenCalledWith("/home/build-a.example/other"));
  expect(onSelect).toHaveBeenCalledTimes(1);
});

it("file pickers still apply the listed file, not the typed directory", async () => {
  answerLocal(
    "/keys",
    listing("/keys", [{ name: "id_ed25519", path: "/keys/id_ed25519", is_directory: false }]),
  );
  answerLocal("/elsewhere", listing("/elsewhere"));
  const onSelect = vi.fn();
  renderWithClient(<Picker kind="file" initialPath="/keys" onSelect={onSelect} />);

  const key = await screen.findByRole("button", { name: "id_ed25519" });
  expect(selectButton()).toHaveProperty("disabled", true);
  fireEvent.change(pathInput(), { target: { value: "/elsewhere" } });
  expect(selectButton()).toHaveProperty("disabled", true);

  fireEvent.click(key);
  fireEvent.click(selectButton());
  expect(onSelect).toHaveBeenCalledWith("/keys/id_ed25519");
  expect(vi.mocked(api.browsePath).mock.calls.every(([, kind]) => kind === "file")).toBe(true);
});
