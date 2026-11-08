/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const entry = vi.hoisted(() => ({
  create: vi.fn(),
  render: vi.fn(),
  unmount: vi.fn(),
}));
vi.mock("./app/runtime/nativeRuntime", () => ({ createNativeRuntime: entry.create }));
vi.mock("react-dom/client", () => ({
  createRoot: () => ({ render: entry.render, unmount: entry.unmount }),
}));
vi.mock("./app/runtime/NativePresentationRoot", () => ({ NativePresentationRoot: () => null }));
vi.mock("./app/providers/ThemeProvider", () => ({ ThemeProvider: () => null }));
vi.mock("@locator/runtime", () => ({ default: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  entry.create.mockReset();
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
  "binds recovered input at bootstrap: $native/$recovery",
  async ({ native, recovery, expected }) => {
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
    await vi.waitFor(() => expect(entry.create).toHaveBeenCalledOnce());
    expect(entry.create.mock.calls[0][0].requireTerminalAcknowledgement).toBe(expected);
    expect(entry.render).toHaveBeenCalledOnce();
  },
);

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
