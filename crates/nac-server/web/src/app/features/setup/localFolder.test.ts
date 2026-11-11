import { expect, it, vi } from "vitest";
import {
  bindNativeDirectoryPort,
  localDirectoryCapability,
  readNativeDirectoryPort,
  selectLocalFolder,
} from "./localFolder";

const callbacks = () => ({ selected: vi.fn(), cancelled: vi.fn(), failed: vi.fn() });

it("fences and aborts an in-flight panel on runtime retirement before React detaches", async () => {
  const lifetime = new AbortController();
  const pending = Promise.withResolvers<string | null>();
  let nativeSignal!: AbortSignal;
  const port = bindNativeDirectoryPort(
    {
      chooseDirectory: async (_path, signal) => {
        nativeSignal = signal;
        return pending.promise;
      },
    },
    lifetime.signal,
  )!;
  const result = port.chooseDirectory("/old", new AbortController().signal);
  lifetime.abort();
  expect(nativeSignal.aborted).toBe(true);
  pending.resolve("/stale");
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
  await expect(port.chooseDirectory("/new", new AbortController().signal)).rejects.toMatchObject({
    name: "AbortError",
  });
});

it("keeps browser composition optional", () => {
  for (const value of [undefined, null, {}, { chooseDirectory: "shell" }])
    expect(readNativeDirectoryPort(value)).toBeUndefined();
  const port = { chooseDirectory: async () => null };
  expect(readNativeDirectoryPort(port)).toBe(port);
});

it("requires explicit Local directory authority and a native capability", () => {
  const port = { chooseDirectory: vi.fn(async () => null) };
  expect(localDirectoryCapability(port, true, "directory", null)).toBe(port);
  for (const [local, kind, ssh] of [
    [false, "directory", null], // Podman/server paths are not host authority.
    [true, "directory", { ssh_host: "remote" }],
    [true, "toml", null],
    [true, "file", null],
  ] as const)
    expect(localDirectoryCapability(port, local, kind, ssh)).toBeUndefined();
  expect(localDirectoryCapability(undefined, true, "directory", null)).toBeUndefined();
  expect(port.chooseDirectory).not.toHaveBeenCalled();
});

it.each(["/tmp/Project with spaces", "/tmp/日本語/🦀", "/tmp/trailing space "])(
  "returns the exact selected path as form data: %s",
  async (path) => {
    const outcome = callbacks();
    const port = { chooseDirectory: vi.fn(async () => path) };
    await selectLocalFolder(port, "/initial", outcome).settled;
    expect(port.chooseDirectory).toHaveBeenCalledOnce();
    expect(outcome.selected).toHaveBeenCalledWith(path);
    expect(outcome.cancelled).not.toHaveBeenCalled();
  },
);

it("cancels without clearing a form's current path", async () => {
  const outcome = callbacks();
  await selectLocalFolder({ chooseDirectory: async () => null }, "/keep", outcome).settled;
  expect(outcome.cancelled).toHaveBeenCalledOnce();
  expect(outcome.selected).not.toHaveBeenCalled();
});

it("aborts the panel and ignores late results from a superseded form", async () => {
  const first = Promise.withResolvers<string | null>();
  const old = callbacks();
  let signal!: AbortSignal;
  const opened = Promise.withResolvers<void>();
  const oldSelection = selectLocalFolder(
    {
      chooseDirectory: async (_path, next) => {
        signal = next;
        opened.resolve();
        return first.promise;
      },
    },
    "/old",
    old,
  );
  await opened.promise;
  oldSelection.cancel();
  expect(signal.aborted).toBe(true);
  const current = callbacks();
  const newSelection = selectLocalFolder({ chooseDirectory: async () => "/new" }, "", current);
  first.resolve("/old result");
  await Promise.all([oldSelection.settled, newSelection.settled]);
  expect(old.selected).not.toHaveBeenCalled();
  expect(old.cancelled).not.toHaveBeenCalled();
  expect(current.selected).toHaveBeenCalledWith("/new");
});

it("does not open a panel after synchronous presentation retirement", async () => {
  const port = { chooseDirectory: vi.fn(async () => "/late") };
  const outcome = callbacks();
  const request = selectLocalFolder(port, "", outcome);
  request.cancel();
  await request.settled;
  expect(port.chooseDirectory).not.toHaveBeenCalled();
  expect(outcome.selected).not.toHaveBeenCalled();
});

it("surfaces a single adapter failure without fallback, retries or mutations", async () => {
  const outcome = callbacks();
  const error = new Error("view replaced");
  const port = {
    chooseDirectory: vi.fn(async () => {
      throw error;
    }),
  };
  await selectLocalFolder(port, "", outcome).settled;
  expect(outcome.failed).toHaveBeenCalledWith(error);
  expect(port.chooseDirectory).toHaveBeenCalledOnce();
  expect(outcome.selected).not.toHaveBeenCalled();
});

it.each([
  ["relative", "relative"],
  ["file URL", "file:///tmp/a"],
  ["NUL", "/tmp/\0bad"],
  ["oversize", "/" + "a".repeat(16_384)],
])("rejects a malformed adapter result: %s", async (_label, path) => {
  const outcome = callbacks();
  await selectLocalFolder({ chooseDirectory: async () => path }, "", outcome).settled;
  expect(outcome.failed).toHaveBeenCalledOnce();
  expect(outcome.selected).not.toHaveBeenCalled();
});
