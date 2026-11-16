import fs from "node:fs/promises";
import type { Locator, TestInfo } from "@playwright/test";

/** Inspect the actual controls, including disabled controls; never invoke an action. */
export async function auditSetupTargets(root: Locator, info: TestInfo, state: string) {
  // Wait for the actual open layer to stop moving, including its delayed entering frame.
  const settled = await root.evaluate(async (node) => {
    const document = node.ownerDocument;
    const window = document.defaultView!;
    await document.fonts.ready;
    let previous = "";
    let stableFrames = 0;
    for (let frame = 0; frame < 120; frame += 1) {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const box = node.getBoundingClientRect();
      const geometry = JSON.stringify([box.x, box.y, box.width, box.height]);
      const visible =
        Math.min(box.bottom, window.innerHeight) > Math.max(box.top, 0) &&
        Math.min(box.right, window.innerWidth) > Math.max(box.left, 0);
      const moving = node
        .getAnimations()
        .some((animation: { playState: string }) => animation.playState === "running");
      stableFrames = visible && !moving && geometry === previous ? stableFrames + 1 : 0;
      if (stableFrames >= 2) return { frames: frame + 1, geometry };
      previous = geometry;
    }
    throw new Error(`Open setup layer did not settle within 120 frames: ${previous}`);
  });
  await info.attach(`${state}-settled-layer.json`, {
    body: JSON.stringify(settled),
    contentType: "application/json",
  });
  const controls = root.locator("button, a[href], input:not([type=hidden]), textarea, summary");
  const measurements = [];
  const failures: string[] = [];
  for (let index = 0; index < (await controls.count()); index += 1) {
    const control = controls.nth(index);
    if (!(await control.isVisible())) continue;
    await control.evaluate((node) => node.scrollIntoView({ block: "center", inline: "nearest" }));
    const measured = await control.evaluate((node) => {
      const document = node.ownerDocument;
      const window = document.defaultView!;
      const box = node.getBoundingClientRect();
      const owner = node.closest('[data-slot="dialog-content"], [data-slot="sheet-content"]');
      const footer = owner?.querySelector("footer")?.getBoundingClientRect();
      const role = node.getAttribute("role");
      const pseudo = window.getComputedStyle(node, "::before");
      const inset = (value: string) =>
        Number.isFinite(Number.parseFloat(value)) ? Number.parseFloat(value) : 0;
      const padded = role === "switch" && pseudo.content !== "none";
      const target = padded
        ? {
            x: box.x + inset(pseudo.left),
            y: box.y + inset(pseudo.top),
            width: box.width - inset(pseudo.left) - inset(pseudo.right),
            height: box.height - inset(pseudo.top) - inset(pseudo.bottom),
          }
        : { x: box.x, y: box.y, width: box.width, height: box.height };
      const points = padded
        ? [
            [target.x + 2, box.y + box.height / 2],
            [target.x + target.width - 2, box.y + box.height / 2],
            [box.x + box.width / 2, target.y + 2],
            [box.x + box.width / 2, target.y + target.height - 2],
          ]
        : [[box.x + box.width / 2, box.y + box.height / 2]];
      const hits = points.map(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return hit === node || (hit !== null && node.contains(hit));
      });
      const overlaps = padded
        ? [
            ...(owner ?? document).querySelectorAll("button, a[href], input, textarea, summary"),
          ].filter((other) => {
            if (other === node || node.contains(other) || other.contains(node)) return false;
            const otherBox = other.getBoundingClientRect();
            return (
              otherBox.width > 0 &&
              otherBox.height > 0 &&
              Math.min(target.x + target.width, otherBox.right) -
                Math.max(target.x, otherBox.left) >
                0.5 &&
              Math.min(target.y + target.height, otherBox.bottom) -
                Math.max(target.y, otherBox.top) >
                0.5
            );
          }).length
        : 0;
      return {
        name:
          node.getAttribute("aria-label") ?? node.textContent?.trim().slice(0, 100) ?? node.tagName,
        role,
        disabled: node.hasAttribute("disabled"),
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
        target,
        hits,
        overlaps,
        belowFooter:
          !node.closest("footer") && footer !== undefined && box.bottom > footer.top + 0.5,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
    });
    measurements.push(measured);
    const prefix = `${state}: ${measured.name}`;
    if (measured.target.width < 43.5 || measured.target.height < 43.5)
      failures.push(`${prefix}: target below44 ${JSON.stringify(measured.target)}`);
    if (
      measured.target.x < -0.5 ||
      measured.target.x + measured.target.width > measured.viewport.width + 0.5
    )
      failures.push(`${prefix}: horizontal overflow`);
    if (measured.hits.some((hit) => !hit))
      failures.push(`${prefix}: hit point covered or outside viewport`);
    if (measured.overlaps) failures.push(`${prefix}: padded switch overlaps another control`);
    if (measured.belowFooter) failures.push(`${prefix}: control not fully reachable above footer`);
  }
  const geometry = await root.evaluate((node) => {
    const document = node.ownerDocument;
    const box = node.getBoundingClientRect();
    return {
      x: box.x,
      right: box.right,
      width: document.defaultView!.innerWidth,
      pageWidth: document.documentElement.scrollWidth,
    };
  });
  if (
    geometry.x < -0.5 ||
    geometry.right > geometry.width + 0.5 ||
    geometry.pageWidth > geometry.width + 0.5
  )
    failures.push(`${state}: dialog/page overflow ${JSON.stringify(geometry)}`);
  const evidence = info.outputPath(`${state}-actual-targets.json`);
  await fs.writeFile(
    evidence,
    JSON.stringify({ state, geometry, measurements, failures }, null, 2),
  );
  await info.attach(`${state}-actual-targets.json`, {
    path: evidence,
    contentType: "application/json",
  });
  return failures;
}
