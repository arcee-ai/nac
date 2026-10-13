/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { createLogRenderer } from "./logRenderer";

describe("safe pipe log rendering", () => {
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
