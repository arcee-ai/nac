/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PathPickerModal } from "@/app/components/modals/PathPickerModal";
import { api, ApiError } from "@/app/services/api";
import type { BrowseKind } from "@/app/services/queries";
import type { BrowseListing, CreatedFolder, SshTarget } from "@/app/types/api";

const PARENT = "/work/projects";
const CREATED = `${PARENT}/my project ü`;

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

function refusal(status: number, detail: string, path = "/fs/folders") {
  return new ApiError(status, "POST", path, detail, "req-1");
}

/** What the server lists, keyed by the exact path the picker asked for. */
const listings = new Map<string, () => Promise<BrowseListing>>();

function answer(path: string, value: BrowseListing | (() => Promise<BrowseListing>)) {
  listings.set(path, typeof value === "function" ? value : async () => value);
}

function missing(path: string) {
  answer(path, () =>
    Promise.reject(new ApiError(404, "GET", "/fs/browse", `path '${path}' does not exist`, "r")),
  );
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
  listings.clear();
  answer(PARENT, listing(PARENT, [{ name: "taken", path: `${PARENT}/taken`, is_directory: true }]));
  answer("/work", listing("/work", [{ name: "projects", path: PARENT, is_directory: true }]));
  answer(CREATED, listing(CREATED));
  vi.spyOn(api, "browsePath").mockImplementation((path) => {
    const value = listings.get(path ?? "");
    return value
      ? value()
      : Promise.reject(new ApiError(404, "GET", "/fs/browse", `unexpected ${path}`, "r"));
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPicker({
  kind = "directory",
  ssh = null,
  onSelect = vi.fn(),
}: {
  kind?: BrowseKind;
  ssh?: SshTarget | null;
  onSelect?: (path: string) => void;
} = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrap = (node: ReactNode) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  );
  render(
    wrap(
      <PathPickerModal
        open
        kind={kind}
        initialPath={PARENT}
        ssh={ssh}
        onClose={() => {}}
        onSelect={onSelect}
      />,
    ),
  );
  return { onSelect };
}

async function openForm() {
  await screen.findByRole("button", { name: "taken" });
  fireEvent.click(screen.getByRole("button", { name: "New folder" }));
  return screen.getByRole("group", { name: "New folder" });
}

function nameInput() {
  return screen.getByLabelText("New folder name") as HTMLInputElement;
}

function draft() {
  return screen.getByLabelText("Folder path") as HTMLInputElement;
}

function createIn(form: HTMLElement, name: string) {
  fireEvent.change(nameInput(), { target: { value: name } });
  fireEvent.click(within(form).getByRole("button", { name: "Create" }));
}

it("creates one folder, browses into it and leaves it for Select to apply", async () => {
  const create = vi
    .spyOn(api, "createFolder")
    .mockResolvedValue({ path: CREATED } satisfies CreatedFolder);
  const { onSelect } = renderPicker();
  const form = await openForm();

  createIn(form, "my project ü");

  await waitFor(() => expect(draft().value).toBe(CREATED));
  expect(create).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledWith(PARENT, "my project ü");
  expect(screen.queryByRole("group", { name: "New folder" })).toBeNull();
  await screen.findByText("No subdirectories here.", { exact: false });
  // Creating is not selecting: the parent form changes only through Select.
  expect(onSelect).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  await waitFor(() => expect(onSelect).toHaveBeenCalledWith(CREATED));
});

it.each([
  ["an existing name", 409, `'${PARENT}/taken' already exists`, "taken"],
  ["an invalid name", 400, "'.' and '..' are not folder names", ".."],
  ["a denied path", 403, "configured permission rules deny creating this folder", "secret"],
])("%s keeps the form open with the server's reason", async (_, status, detail, name) => {
  const create = vi.spyOn(api, "createFolder").mockRejectedValue(refusal(status, detail));
  renderPicker();
  const form = await openForm();

  createIn(form, name);

  const alert = await within(form).findByRole("alert");
  expect(alert.textContent).toContain(`Could not create “${name}”`);
  expect(alert.textContent).toContain(detail);
  expect(nameInput().value).toBe(name);
  expect(draft().value).toBe(PARENT);
  expect(create).toHaveBeenCalledTimes(1);
  // A definite refusal is not looked up again.
  expect(api.browsePath).not.toHaveBeenCalledWith(
    `${PARENT}/${name}`,
    "directory",
    false,
    expect.anything(),
  );
});

it("a lost answer is reconciled before anything is offered, and never replayed", async () => {
  const create = vi.spyOn(api, "createFolder").mockRejectedValue(new TypeError("Failed to fetch"));
  renderPicker();
  const form = await openForm();

  createIn(form, "my project ü");

  const alert = await within(form).findByRole("alert");
  expect(alert.textContent).toContain("“my project ü” exists now");
  expect(alert.textContent).toContain("may have created it");
  expect(create).toHaveBeenCalledTimes(1);
  expect(draft().value).toBe(PARENT);

  fireEvent.click(within(form).getByRole("button", { name: "Open “my project ü”" }));
  await waitFor(() => expect(draft().value).toBe(CREATED));
  expect(create).toHaveBeenCalledTimes(1);
});

it("a retry after reconciliation reports an existing folder truthfully", async () => {
  const create = vi
    .spyOn(api, "createFolder")
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockRejectedValueOnce(refusal(409, `'${CREATED}' already exists`));
  renderPicker();
  const form = await openForm();

  createIn(form, "my project ü");
  await within(form).findByText(/exists now/);
  fireEvent.click(within(form).getByRole("button", { name: "Create" }));

  const alert = await within(form).findByText(/Could not create/);
  expect(alert.textContent).toContain("already exists");
  expect(create).toHaveBeenCalledTimes(2);
  expect(draft().value).toBe(PARENT);
});

it("a lost answer for a folder that was not made offers the retry", async () => {
  missing(`${PARENT}/fresh`);
  const create = vi
    .spyOn(api, "createFolder")
    .mockRejectedValueOnce(refusal(502, "cannot reach ssh host"))
    .mockResolvedValueOnce({ path: `${PARENT}/fresh` });
  answer(`${PARENT}/fresh`, listing(`${PARENT}/fresh`));
  missing(`${PARENT}/fresh`);
  renderPicker();
  const form = await openForm();

  createIn(form, "fresh");

  const alert = await within(form).findByRole("alert");
  expect(alert.textContent).toContain("“fresh” was not created");
  expect(alert.textContent).toContain("You can try again");
  expect(create).toHaveBeenCalledTimes(1);

  answer(`${PARENT}/fresh`, listing(`${PARENT}/fresh`));
  fireEvent.click(within(form).getByRole("button", { name: "Create" }));
  await waitFor(() => expect(draft().value).toBe(`${PARENT}/fresh`));
  expect(create).toHaveBeenCalledTimes(2);
});

it("an outcome that cannot be checked withholds Create until it is checked again", async () => {
  vi.spyOn(api, "createFolder").mockRejectedValue(new TypeError("Failed to fetch"));
  answer(`${PARENT}/fresh`, () => Promise.reject(new TypeError("Failed to fetch")));
  renderPicker();
  const form = await openForm();

  createIn(form, "fresh");

  const alert = await within(form).findByText(/Could not tell whether “fresh” was created/);
  expect(alert).toBeTruthy();
  const createButton = within(form).getByRole("button", { name: "Create" });
  expect(createButton).toHaveProperty("disabled", true);
  fireEvent.click(createButton);
  expect(api.createFolder).toHaveBeenCalledTimes(1);

  missing(`${PARENT}/fresh`);
  fireEvent.click(within(form).getByRole("button", { name: "Check again" }));
  await within(form).findByText(/“fresh” was not created/);
  expect(within(form).getByRole("button", { name: "Create" })).toHaveProperty("disabled", false);
  expect(api.createFolder).toHaveBeenCalledTimes(1);
});

it("a second Create while one is out sends nothing more", async () => {
  const slow = deferred<CreatedFolder>();
  const create = vi.spyOn(api, "createFolder").mockReturnValue(slow.promise);
  renderPicker();
  const form = await openForm();

  createIn(form, "my project ü");
  fireEvent.keyDown(nameInput(), { key: "Enter" });
  fireEvent.click(within(form).getByRole("button", { name: "Creating…" }));

  expect(create).toHaveBeenCalledTimes(1);
  await act(async () => slow.resolve({ path: CREATED }));
  await waitFor(() => expect(draft().value).toBe(CREATED));
});

it("leaving the directory drops a late answer instead of navigating", async () => {
  const slow = deferred<CreatedFolder>();
  vi.spyOn(api, "createFolder").mockReturnValue(slow.promise);
  renderPicker();
  const form = await openForm();
  createIn(form, "my project ü");

  fireEvent.click(screen.getByRole("button", { name: "Parent directory" }));
  await screen.findByRole("button", { name: "projects" });
  await act(async () => slow.resolve({ path: CREATED }));

  expect(draft().value).toBe("/work");
  expect(screen.queryByRole("group", { name: "New folder" })).toBeNull();
});

it("typing or entering a path never creates anything", async () => {
  const create = vi.spyOn(api, "createFolder");
  const { onSelect } = renderPicker();
  await screen.findByRole("button", { name: "taken" });
  missing(`${PARENT}/brand new`);

  fireEvent.change(draft(), { target: { value: `${PARENT}/brand new` } });
  fireEvent.keyDown(draft(), { key: "Enter" });
  fireEvent.click(screen.getByRole("button", { name: "Select" }));

  await screen.findByText(/Cannot select this folder/);
  expect(create).not.toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();
});

it("is offered only when picking a working folder", async () => {
  answer(PARENT, listing(PARENT, [{ name: "taken", path: `${PARENT}/taken`, is_directory: true }]));
  renderPicker({ kind: "toml" });
  await screen.findByRole("button", { name: "taken" });
  expect(screen.queryByRole("button", { name: "New folder" })).toBeNull();
});

it("creates on the SSH host being browsed, never locally", async () => {
  const target: SshTarget = { ssh_host: "build-box", ssh_port: 2222 };
  vi.spyOn(api, "browseSshPath").mockImplementation(async (_target, path) =>
    path === PARENT
      ? listing(PARENT, [{ name: "taken", path: `${PARENT}/taken`, is_directory: true }])
      : listing(path ?? "/home/me"),
  );
  const local = vi.spyOn(api, "createFolder");
  const remote = vi.spyOn(api, "createSshFolder").mockResolvedValue({ path: CREATED });
  renderPicker({ ssh: target });
  const form = await openForm();

  createIn(form, "my project ü");

  await waitFor(() => expect(draft().value).toBe(CREATED));
  expect(remote).toHaveBeenCalledWith(target, PARENT, "my project ü");
  expect(local).not.toHaveBeenCalled();
});

it("a second picker instance keeps its own draft and form", async () => {
  vi.spyOn(api, "createFolder").mockResolvedValue({ path: CREATED });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const first = vi.fn();
  const second = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PathPickerModal
          open
          kind="directory"
          initialPath={PARENT}
          onClose={() => {}}
          onSelect={first}
        />
        <PathPickerModal
          open
          kind="directory"
          initialPath="/work"
          onClose={() => {}}
          onSelect={second}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "taken" });
  await screen.findByRole("button", { name: "projects" });
  const [one, two] = screen.getAllByRole("dialog");
  const draftOf = (dialog: HTMLElement) =>
    within(dialog).getByLabelText("Folder path") as HTMLInputElement;
  fireEvent.click(within(two).getByRole("button", { name: "New folder" }));
  fireEvent.change(within(two).getByLabelText("New folder name"), {
    target: { value: "half typed" },
  });

  fireEvent.click(within(one).getByRole("button", { name: "New folder" }));
  fireEvent.change(within(one).getByLabelText("New folder name"), {
    target: { value: "my project ü" },
  });
  fireEvent.click(within(one).getByRole("button", { name: "Create" }));

  await waitFor(() => expect(draftOf(one).value).toBe(CREATED));
  expect(draftOf(two).value).toBe("/work");
  expect((within(two).getByLabelText("New folder name") as HTMLInputElement).value).toBe(
    "half typed",
  );
  expect(api.createFolder).toHaveBeenCalledTimes(1);
  expect(first).not.toHaveBeenCalled();
  expect(second).not.toHaveBeenCalled();
});
