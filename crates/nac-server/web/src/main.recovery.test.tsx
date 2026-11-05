/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const entry = vi.hoisted(() => ({
  create: vi.fn(),
  openStorage: vi.fn(),
  render: vi.fn(),
  unmount: vi.fn(),
}));
vi.mock("./app/runtime/nativeRuntime", () => ({ createNativeRuntime: entry.create }));
vi.mock("react-dom/client", () => ({
  createRoot: () => ({ render: entry.render, unmount: entry.unmount }),
}));
vi.mock("./app/features/desktop-storage/adapter", () => ({
  openDesktopStorage: entry.openStorage,
  safeStorage: () => undefined,
}));
vi.mock("./app/runtime/NativePresentationRoot", () => ({ NativePresentationRoot: () => null }));
vi.mock("./app/features/desktop-storage/StorageNotice", () => ({ StorageNotice: () => null }));
vi.mock("./app/providers/ThemeProvider", () => ({ ThemeProvider: () => null }));
vi.mock("@locator/runtime", () => ({ default: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  entry.create.mockReset();
  entry.openStorage.mockReset();
  entry.render.mockReset();
  entry.unmount.mockReset();
  document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => {
  vi.unstubAllGlobals();
});

it.each([
  { native: true, recovery: true, expected: true },
  { native: true, recovery: false, expected: false }, // Initial/new-engine startup.
  { native: false, recovery: true, expected: false }, // Browser cannot opt in via an ambient fact alone.
  { native: false, recovery: false, expected: false },
])(
  "binds recovered input at async bootstrap: $native/$recovery",
  async ({ native, recovery, expected }) => {
    const hydrated = Promise.withResolvers<null>();
    entry.openStorage.mockReturnValueOnce(hydrated.promise);
    entry.create.mockReturnValue({ close: vi.fn() });
    vi.stubGlobal(
      "__nacDesktop",
      native
        ? {
            connect() {
              return () => {};
            },
          }
        : undefined,
    );
    vi.stubGlobal("__nacRequireTerminalAcknowledgement", recovery ? true : undefined);
    await import("./main");
    expect(entry.openStorage).toHaveBeenCalledOnce();
    expect(entry.create).not.toHaveBeenCalled();
    hydrated.resolve(null);
    await vi.waitFor(() => expect(entry.create).toHaveBeenCalledOnce());
    expect(entry.create.mock.calls[0][0].requireTerminalAcknowledgement).toBe(expected);
    expect(entry.render).toHaveBeenCalledOnce();
  },
);

it("keeps hydrated storage bindings and closes storage before runtime and React", async () => {
  const trace: string[] = [];
  let retire: (() => void) | undefined;
  const storage = {
    preferences: {},
    drafts: {},
    binding: { fixture: true },
    close: () => trace.push("storage"),
  };
  entry.openStorage.mockResolvedValueOnce(storage);
  entry.create.mockReturnValue({ close: () => trace.push("runtime") });
  entry.unmount.mockImplementation(() => trace.push("react"));
  vi.stubGlobal("__nacDesktop", {
    connect() {
      return () => {};
    },
    connectLifetime(close: () => void) {
      retire = close;
      return () => {};
    },
  });
  vi.stubGlobal("__nacRequireTerminalAcknowledgement", true);
  await import("./main");
  await vi.waitFor(() => expect(entry.render).toHaveBeenCalledOnce());
  expect(entry.create.mock.calls[0][0].storage).toBe(storage.preferences);
  retire?.();
  expect(trace).toEqual(["storage", "runtime", "react"]);
});

it("injects the actual immutable main-frame document-start fact without old JS retirement acknowledgement", async () => {
  // Evaluate the exact fixed native script in a new document-shaped object.
  // This verifies JS semantics only; no WK object/process or OS claim is made.
  const { readFileSync } = await vi.importActual<{
    readFileSync(path: string, encoding: "utf8"): string;
  }>("node:fs");
  const swift = readFileSync("../../../desktop/macos/PreviewApp.swift", "utf8");
  const replacement = swift.slice(swift.indexOf("    func replaceWorkspace("));
  expect(replacement).toContain("requireTerminalAcknowledgement: Bool = false");
  const match = replacement.match(
    /if requireTerminalAcknowledgement \{[\s\S]*?WKUserScript\(source: """([\s\S]*?)""", injectionTime: \.atDocumentStart, forMainFrameOnly: true\)/,
  );
  expect(match).not.toBeNull();
  const freshDocument = {};
  new Function("window", match![1])(freshDocument);
  expect(
    Object.getOwnPropertyDescriptor(freshDocument, "__nacRequireTerminalAcknowledgement"),
  ).toMatchObject({ value: true, writable: false, configurable: false });
  expect(Reflect.set(freshDocument, "__nacRequireTerminalAcknowledgement", false)).toBe(false);
  expect(Reflect.deleteProperty(freshDocument, "__nacRequireTerminalAcknowledgement")).toBe(false);
});
