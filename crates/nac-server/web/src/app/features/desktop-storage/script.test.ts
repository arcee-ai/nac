/// <reference types="node" />
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

const swift = readFileSync(
  new URL("../../../../../../../desktop/macos/WorkspaceStorageScript.swift", import.meta.url),
  "utf8",
);
const source = swift.split('static let source = #"""')[1].split('"""#')[0];
function page() {
  const postMessage = vi.fn();
  const window: Record<string, unknown> = {
    webkit: { messageHandlers: { nacPresentationStorage: { postMessage } } },
  };
  window.top = window;
  runInNewContext(source, { window });
  const port = window.__nacDesktopStorage as {
    open(): Promise<unknown>;
    activate(value: unknown): boolean;
    write(value: unknown): boolean;
    settled(binding: unknown, sequence: number, durable: boolean): boolean;
    retire(binding: unknown): boolean;
    close(): void;
    subscribe(callback: (value: unknown) => void): () => void;
  };
  return { port, postMessage };
}
const document = { launch: "launch", view: "view", document: "document" };

it("the actual native-injected script gates checkpoint posting and acknowledgements by document", async () => {
  const { port, postMessage } = page();
  const callback = vi.fn();
  port.subscribe(callback);
  expect(port.write({ ...document, kind: "write" })).toBe(false);
  const bootstrap = { document, version: 1 };
  expect(port.activate(bootstrap)).toBe(true);
  expect(await port.open()).toBe(bootstrap);
  expect(port.activate(bootstrap)).toBe(false);
  expect(port.write({ ...document, document: "old" })).toBe(false);
  expect(
    port.write({
      ...document,
      kind: "write",
      namespace: "preferences",
      key: "nac.chatTabs",
      value: null,
    }),
  ).toBe(true);
  expect(JSON.parse(postMessage.mock.calls[0][0]).value).toBeNull();
  expect(port.settled({ ...document, view: "old" }, 1, true)).toBe(false);
  expect(callback).not.toHaveBeenCalled();
  expect(port.settled(document, 1, true)).toBe(true);
  expect(callback).toHaveBeenCalledOnce();
  expect(port.retire(document)).toBe(true);
  expect(port.write(document)).toBe(false);
  expect(port.settled(document, 2, true)).toBe(false);
  expect(postMessage).toHaveBeenCalledOnce();
});

it("closing the adapter's native port fences subsequent old-page writes", () => {
  const { port, postMessage } = page();
  port.activate({ document });
  port.close();
  expect(port.write(document)).toBe(false);
  expect(postMessage).not.toHaveBeenCalled();
});
