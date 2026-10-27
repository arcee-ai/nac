import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const styles = readFileSync(new URL("../src/app/theme/atoms.css", import.meta.url), "utf8");

for (const variant of ["btn-tertiary", "btn-tertiary-accent", "btn-tertiary-destructive"]) {
  test(`${variant} preserves the small icon pointer target without painting a box`, async ({
    page,
  }) => {
    // Use the atom's public classes and real browser layout; jsdom has no hit testing.
    await page.setContent(`<style>button { background: transparent; } ${styles}</style>
      <button class="btn btn-small btn-icon ${variant}" aria-label="Close tab" onclick="this.dataset.clicked='true'">
        <span class="icon" style="width:16px;height:16px"></span>
      </button>`);
    const button = page.getByRole("button", { name: "Close tab" });
    const dimensions = await button.boundingBox();
    expect(dimensions?.width).toBeGreaterThanOrEqual(24);
    expect(dimensions?.height).toBeGreaterThanOrEqual(24);
    await expect(button).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    // Click the target's edge, outside the centered 16px glyph.
    await button.click({ position: { x: 1, y: 12 } });
    await expect(button).toHaveAttribute("data-clicked", "true");
  });
}
