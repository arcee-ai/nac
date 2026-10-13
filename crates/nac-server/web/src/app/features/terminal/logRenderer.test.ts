/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { createLogRenderer } from "./logRenderer";

describe("safe pipe log rendering", () => {
  it("reports only actual display loss and keeps the bounded latest tail", async () => {
    const host = document.createElement("pre");
    const changes: boolean[] = [];
    const view = createLogRenderer(host, (truncated) => changes.push(truncated));
    const signal = new AbortController().signal;
    await view.renderer.write(new TextEncoder().encode("x".repeat(65_536)), signal);
    expect(view.displayTruncated).toBe(false);
    expect(changes).toEqual([]);
    await view.renderer.write(new TextEncoder().encode("yz"), signal);
    expect(view.displayTruncated).toBe(true);
    expect(host.textContent).toBe("x".repeat(65_534) + "yz");
    await view.renderer.write(new TextEncoder().encode("tail"), signal);
    expect(host.textContent?.length).toBe(65_536);
    expect(host.textContent?.endsWith("yztail")).toBe(true);
    expect(changes).toEqual([true]);
  });

  it.each(["gap", "reconnect"] as const)("clears display loss on a %s reset", async (reason) => {
    const host = document.createElement("pre");
    const changes: boolean[] = [];
    const view = createLogRenderer(host, (truncated) => changes.push(truncated));
    const signal = new AbortController().signal;
    await view.renderer.write(new TextEncoder().encode("x".repeat(65_537)), signal);
    await view.renderer.reset(reason, signal);
    expect(view.displayTruncated).toBe(false);
    expect(host.textContent).toBe("");
    await view.renderer.write(new TextEncoder().encode("latest"), signal);
    expect(host.textContent).toBe("latest");
    expect(changes).toEqual([true, false]);
  });

  it("counts literal control expansion and EOF decoding toward display loss", async () => {
    const host = document.createElement("pre");
    const view = createLogRenderer(host);
    const signal = new AbortController().signal;
    await view.renderer.write(new TextEncoder().encode("x".repeat(65_532)), signal);
    await view.renderer.write(Uint8Array.of(0x1b), signal);
    expect(host.textContent?.endsWith("\\x1b")).toBe(true);
    expect(view.displayTruncated).toBe(false);
    await view.renderer.write(Uint8Array.of(0xe4), signal);
    expect(view.displayTruncated).toBe(false);
    view.finish();
    expect(view.displayTruncated).toBe(true);
    expect(host.textContent?.length).toBe(65_536);
    expect(host.textContent?.endsWith("\\x1b�")).toBe(true);
  });

  it("keeps split Unicode and literal controls, HTML and invalid EOF bytes inert", async () => {
    const host = document.createElement("pre");
    const view = createLogRenderer(host);
    const signal = new AbortController().signal;
    for (const byte of new TextEncoder().encode("中🙂\x1b[2J<a href='https://bad'>raw</a>\r\n")) {
      await view.renderer.write(Uint8Array.of(byte), signal);
    }
    await view.renderer.write(Uint8Array.of(0xe4), signal);
    view.finish();
    expect(host.textContent).toBe("中🙂\\x1b[2J<a href='https://bad'>raw</a>\\x0d\n�");
    expect(host.querySelector("a")).toBeNull();
  });
  it("bounds replay memory and resets before a retention gap", async () => {
    const host = document.createElement("pre");
    const view = createLogRenderer(host);
    const signal = new AbortController().signal;
    await view.renderer.write(new TextEncoder().encode("x".repeat(100_000)), signal);
    expect(host.textContent?.length).toBe(65_536);
    await view.renderer.reset("gap", signal);
    await view.renderer.write(new TextEncoder().encode("tail"), signal);
    expect(host.textContent).toBe("tail");
    view.dispose();
    await expect(view.renderer.write(Uint8Array.of(1), signal)).rejects.toThrow("closed");
  });
});
