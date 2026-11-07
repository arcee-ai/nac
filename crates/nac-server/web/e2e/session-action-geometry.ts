import { expect, type Locator, type TestInfo } from "@playwright/test";

/** Observe the actual packed cascade and hit target, including hidden ancestors. */
export async function recordSessionAction(control: Locator, info: TestInfo, name: string) {
  const geometry = await control.evaluate((button) => {
    const doc = button.ownerDocument;
    const view = doc.defaultView!;
    const describe = (element: typeof button) => {
      const rect = element.getBoundingClientRect();
      const style = view.getComputedStyle(element);
      return {
        tag: element.tagName,
        classes: element.className,
        label: element.getAttribute("aria-label"),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom,
        clipPath: style.clipPath,
        overflow: style.overflow,
        position: style.position,
        opacity: style.opacity,
        pointerEvents: style.pointerEvents,
        paddingRight: style.paddingRight,
      };
    };
    const target = describe(button);
    const center = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
    const hit = doc.elementFromPoint(center.x, center.y);
    const root = button.closest("[data-nac-runtime]")!;
    const ancestors = [];
    for (let node = button.parentElement; node; node = node.parentElement) {
      ancestors.push(describe(node));
      if (node === root) break;
    }
    return {
      media: Object.fromEntries(
        [
          "(hover: none)",
          "(hover: hover)",
          "(pointer: coarse)",
          "(pointer: fine)",
          "(any-hover: hover)",
          "(max-width: 767.98px)",
        ].map((query) => [query, view.matchMedia(query).matches]),
      ),
      viewport: { width: view.innerWidth, height: view.innerHeight, dpr: view.devicePixelRatio },
      target,
      center,
      centerHit: hit === button || (hit !== null && button.contains(hit)),
      hit: hit ? describe(hit) : null,
      ancestors,
      tabs: (Array.from(root.querySelectorAll(".chat-session-tab")) as (typeof button)[]).map(
        (tab) => ({
          tab: describe(tab),
          trigger: tab.querySelector(".session-name-tab-trigger")
            ? describe(tab.querySelector(".session-name-tab-trigger")!)
            : null,
          actions: tab.querySelector(".session-name-tab-actions")
            ? describe(tab.querySelector(".session-name-tab-actions")!)
            : null,
        }),
      ),
    };
  });
  await info.attach(name, {
    contentType: "application/json",
    body: JSON.stringify(geometry, null, 2),
  });
  return geometry;
}

export function expectExposedRowAction(geometry: Awaited<ReturnType<typeof recordSessionAction>>) {
  expect(geometry.media["(hover: none)"]).toBe(true);
  const wrapper = geometry.ancestors.find((node) =>
    node.classes.includes("session-name-row-actions"),
  );
  expect(wrapper).toBeDefined();
  expect(wrapper!.clipPath).toBe("none");
  expect(wrapper!.position).toBe("static");
  expect(wrapper!.overflow).toBe("visible");
  expect(wrapper!.width).toBeGreaterThan(1);
  expect(wrapper!.height).toBeGreaterThan(1);
  expect(geometry.centerHit).toBe(true);
}
