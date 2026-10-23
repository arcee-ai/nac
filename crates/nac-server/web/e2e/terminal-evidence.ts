import { expect, type Locator, type Page } from "@playwright/test";

/** Select known ASCII evidence from the current public DOM renderer, once. */
export async function reviewTerminalEvidence(page: Page, pane: Locator, evidence: string) {
  expect(evidence.length).toBeGreaterThan(0);
  expect(
    /^[\x20-\x7e]+$/.test(evidence),
    "Evidence fixture must occupy one cell per character",
  ).toBe(true);
  // History loads independently of the live shell. Its empty-state paragraph
  // disappears when this source arrives, resizing the terminal and clearing a
  // selection. Settle that real layout prerequisite before measuring a drag.
  const source = await pane.getByRole("combobox", { name: "Shell", exact: true }).inputValue();
  await expect(
    pane
      .getByRole("combobox", { name: "Recent activity", exact: true })
      .locator(`option[value="${source}"]`),
  ).toHaveCount(1);
  const screen = pane.locator(".xterm-screen");
  await expect(screen).toBeVisible();
  await screen.scrollIntoViewIfNeeded();

  // Accessibility row positions can lag a resize. Use the rows users see.
  const lines = pane.locator(".xterm-rows > div");
  const rows = await lines.allTextContents();
  const matches = rows.flatMap((text, index) => (text.trimEnd() === evidence ? [index] : []));
  const grid = await screen.boundingBox();
  const diagnostic = JSON.stringify({
    evidence: evidence.slice(0, 120),
    grid,
    rowCount: rows.length,
    matchingRowCount: matches.length,
    matchingRows: matches.slice(0, 8),
    sample: rows.slice(0, 8).map((text) => text.slice(0, 120)),
  });
  expect(matches.length, `Expected one live painted evidence row: ${diagnostic}`).toBe(1);
  await expect(pane.locator(".xterm-accessibility")).toContainText(evidence);
  const row = lines.nth(matches[0]!);
  const bounds = await row.boundingBox();
  const firstSpan = row.locator("span").first();
  const spanBounds = await firstSpan.boundingBox();
  const spanText = (await firstSpan.textContent()) ?? "";
  expect(bounds, `Missing painted row bounds: ${diagnostic}`).not.toBeNull();
  expect(spanBounds, `Missing painted span bounds: ${diagnostic}`).not.toBeNull();
  expect(spanText.length, `Empty painted span: ${diagnostic}`).toBeGreaterThan(0);
  // DOM rendering may group several adjacent ASCII cells into one span.
  const cell = spanBounds!.width / spanText.length;
  const y = bounds!.y + bounds!.height / 2;
  const startX = bounds!.x + 0.25 * cell;
  const endX = bounds!.x + (evidence.length + 0.25) * cell;
  const viewport = page.viewportSize()!;
  expect(
    [cell, startX, endX, y].every(Number.isFinite) &&
      cell > 0 &&
      bounds!.height > 0 &&
      startX >= 0 &&
      endX < viewport.width &&
      y >= 0 &&
      y < viewport.height,
    `Invalid live selection geometry: ${JSON.stringify({ cell, startX, endX, y, viewport })}; ${diagnostic}`,
  ).toBe(true);
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 10 });
  await page.mouse.up();
  await pane.getByRole("button", { name: "Review selected text", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Review terminal selection" });
  await expect(dialog.getByLabel("Reviewed selected text")).toHaveText(evidence);
  return dialog;
}
