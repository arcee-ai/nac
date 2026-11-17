import { test, expect } from "./fixture";

// Explicit diagnostic, outside the default regression inventory. It attributes
// a measured frame gap without changing throttling, history or renderer policy.
if (process.env.NAC_ELECTRON_FRAME_DIAGNOSTIC === "1") {
  test("attribute frame cadence before and after the retained large transcript", async ({
    candidate: c,
  }, info) => {
    test.setTimeout(120000);
    await c.app.evaluate(({ app, BrowserWindow }) => {
      app.focus({ steal: true });
      const w = BrowserWindow.getAllWindows()[0];
      w.show();
      w.focus();
    });
    const session = await c.session();
    const navigate = async (id: string) => {
      await c.page.evaluate(() => {
        location.hash = "/";
      });
      await expect(c.page.getByRole("combobox", { name: "Message" })).toHaveCount(0);
      await c.page.evaluate((id) => {
        location.hash = `/session/${id}/files`;
      }, id);
      await expect(c.page.getByRole("combobox", { name: "Message" })).toBeVisible();
    };
    const observe = async () =>
      c.page.evaluate(async () => {
        const gaps: number[] = [],
          input: number[] = [],
          longTasks: number[] = [];
        const observer = new PerformanceObserver((entries) =>
          longTasks.push(...entries.getEntries().map((e) => e.duration)),
        );
        observer.observe({ type: "longtask", buffered: false });
        const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
        let prior = await frame();
        for (let i = 0; i < 60; i++) {
          const now = await frame();
          gaps.push(now - prior);
          prior = now;
        }
        const composer = document.querySelector(
          "[role=combobox][aria-label=Message]",
        ) as HTMLTextAreaElement;
        for (let i = 0; i < 40; i++) {
          const before = performance.now();
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
            composer,
            "cadence attribution " + i,
          );
          composer.dispatchEvent(new Event("input", { bubbles: true }));
          await frame();
          input.push(performance.now() - before);
        }
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
          composer,
          "",
        );
        composer.dispatchEvent(new Event("input", { bubbles: true }));
        observer.disconnect();
        return {
          gaps,
          input,
          longTasks,
          focus: document.hasFocus(),
          visibility: document.visibilityState,
          nodes: document.querySelectorAll("*").length,
          viewport: [innerWidth, innerHeight, devicePixelRatio],
        };
      });
    await navigate(session);
    const empty = await observe();
    c.provider.enqueue(
      "frame-history",
      { token: "FRAME_HISTORY" },
      {
        kind: "text",
        stream: true,
        text:
          Array.from(
            { length: 2048 },
            (_, i) => `History ${i}: ${"bounded transcript rendering ".repeat(5)}\n`,
          ).join("") + "\nFRAME_HISTORY_END",
      },
    );
    await c.page.getByRole("combobox", { name: "Message" }).fill("FRAME_HISTORY");
    await c.page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(c.page.getByText(/FRAME_HISTORY_END/)).toBeVisible({ timeout: 30000 });
    for (let i = 0; i < 5; i++) {
      await navigate(session);
      await expect(c.page.getByText(/FRAME_HISTORY_END/)).toBeVisible();
    }
    const history = await observe();
    const scroll = await c.page.evaluate(async () => {
      const scroller = [...document.querySelectorAll("*")]
        .filter(
          (element) =>
            element.scrollHeight > element.clientHeight + 100 &&
            element.clientHeight > 200 &&
            ["auto", "scroll"].includes(getComputedStyle(element).overflowY),
        )
        .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      const gaps: number[] = [];
      let prior = performance.now();
      for (let i = 0; i < 120; i++) {
        scroller.scrollTop = i % 2 ? scroller.scrollHeight : 0;
        await new Promise(requestAnimationFrame);
        const now = performance.now();
        gaps.push(now - prior);
        prior = now;
      }
      scroller.scrollTop = scroller.scrollHeight;
      return {
        gaps,
        tag: scroller.tagName,
        label: scroller.getAttribute("aria-label"),
        css: scroller.className,
        height: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
        behavior: getComputedStyle(scroller).scrollBehavior,
      };
    });
    const afterScroll = await observe();
    const second = await c.session();
    await navigate(second);
    const emptyAgain = await observe();
    const native = await c.app.evaluate(({ app, BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return {
        focused: w.isFocused(),
        visible: w.isVisible(),
        hidden: app.isHidden(),
        minimized: w.isMinimized(),
        throttle: w.webContents.getBackgroundThrottling(),
        bounds: w.getBounds(),
        displays: screen
          .getAllDisplays()
          .map((d) => ({
            id: d.id,
            bounds: d.bounds,
            scaleFactor: d.scaleFactor,
            frequency: d.displayFrequency,
            internal: d.internal,
          })),
        switches: [
          "disable-background-timer-throttling",
          "disable-renderer-backgrounding",
          "disable-frame-rate-limit",
        ].map((s) => [s, app.commandLine.hasSwitch(s)]),
      };
    });
    const result = { empty, history, scroll, afterScroll, emptyAgain, native };
    console.log("Frame attribution", JSON.stringify(result));
    await info.attach("frame-attribution", {
      body: JSON.stringify(result),
      contentType: "application/json",
    });
  });
}
