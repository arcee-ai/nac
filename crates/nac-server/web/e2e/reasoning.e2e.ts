import fs from "node:fs/promises";
import path from "node:path";

import { createDirectSession, expect, test, waitForRunIdle } from "./harness";
import { ScriptGate } from "./scripted-provider";

import { REASONING, ANSWER, PROMPT, serveReasoningBaseline } from "./reasoning-fixture";

test.use({ orchestration: "0" });

for (const width of [1440, 768, 390]) {
  test(`reasoning canary preserves reading choice at ${width}px`, async ({
    harness,
    page,
    request,
    context,
  }, info) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: width === 768 ? 1024 : 900 });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const baseline = process.env.NAC_REASONING_BASELINE_DIST;
    await serveReasoningBaseline(page, harness.baseUrl);
    const capture = async (state: string) => {
      await page.evaluate(() =>
        (
          globalThis as unknown as { document: { fonts: { ready: Promise<unknown> } } }
        ).document.fonts.ready.then(() => undefined),
      );
      const name = `${baseline ? "before" : "after"}-${width}-${state}.png`;
      const file = info.outputPath(name);
      await page.screenshot({ path: file, animations: "disabled", caret: "hide" });
      await info.attach(name, { path: file, contentType: "image/png" });
      if (process.env.NAC_REASONING_CAPTURE_DIR) {
        await fs.mkdir(process.env.NAC_REASONING_CAPTURE_DIR, { recursive: true });
        await fs.copyFile(file, path.join(process.env.NAC_REASONING_CAPTURE_DIR, name));
      }
    };
    const gate = new ScriptGate();
    harness.provider.enqueue(
      "reasoning-canary",
      { token: PROMPT },
      { kind: "text", reasoning: REASONING, text: ANSWER, stream: true },
      gate,
    );
    const id = await createDirectSession(request, harness);
    await page.goto(`${harness.baseUrl}/#/session/${id}/files`);
    const composer = page.getByRole("combobox", { name: "Message" });
    await composer.fill(PROMPT);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await gate.accepted;
    try {
      const activity = page.getByRole("button", { name: "Thinking…", exact: true }).first();
      await expect(activity).toBeVisible();
      await activity.click();
      const detail = page.getByRole("region", { name: "Insights detail" });
      await expect(detail.getByText(REASONING.split("\n\n")[0], { exact: true })).toBeVisible();
      await capture("live");
      if (!baseline) {
        const disclosure = detail.getByRole("button", { name: "Thinking…", exact: true });
        await expect(disclosure).toHaveAttribute("aria-expanded", "true");
        await disclosure.focus();
        await page.keyboard.press("Enter");
        await expect(disclosure).toHaveAttribute("aria-expanded", "false");
      }
      gate.release();
      await waitForRunIdle(request, harness, id);
      const settled = detail.getByRole("button", { name: /^Reasoning/ });
      if (!baseline) await expect(settled).toHaveAttribute("aria-expanded", "false");
      await capture("settled-default");
      if (!baseline) {
        await settled.focus();
        await page.keyboard.press("Space");
        await expect(settled).toHaveAttribute("aria-expanded", "true");
        await expect(settled).toBeFocused();
        await expect(detail.getByText(REASONING.split("\n\n")[0], { exact: true })).toBeVisible();
        const copy = detail.getByRole("button", { name: /^Copy Reasoning/ });
        await copy.click();
        await expect
          .poll(() =>
            page.evaluate(() =>
              (
                globalThis as unknown as {
                  navigator: { clipboard: { readText: () => Promise<string> } };
                }
              ).navigator.clipboard.readText(),
            ),
          )
          .toBe(REASONING);
        const box = await copy.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
      }
      await page.mouse.move(5, 5);
      if (!baseline) {
        const hint = page.getByRole("tooltip");
        if (await hint.isVisible()) await page.keyboard.press("Escape");
      }
      await capture("expanded");
      await info.attach("reasoning accessibility tree", {
        body: await detail.ariaSnapshot(),
        contentType: "text/plain",
      });
      await page.emulateMedia({ reducedMotion: "reduce" });
      if (!baseline) {
        const animations = await detail.evaluate(
          (element) =>
            element
              .getAnimations({ subtree: true })
              .filter((animation: { playState: string }) => animation.playState === "running")
              .length,
        );
        expect(animations).toBe(0);
      }
      await capture("reduced-motion");
      await page.goto(`${harness.baseUrl}/#/session/${id}/files`);
      await expect(page.getByText(ANSWER, { exact: true })).toBeVisible();
      const filesDialog = page.getByRole("dialog", { name: "Files", exact: true });
      if (await filesDialog.isVisible())
        await filesDialog.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("button", { name: "Copy message", exact: true }).last().click();
      await expect
        .poll(() =>
          page.evaluate(() =>
            (
              globalThis as unknown as {
                navigator: { clipboard: { readText: () => Promise<string> } };
              }
            ).navigator.clipboard.readText(),
          ),
        )
        .toBe(ANSWER);
      await capture("answer");
      await page.reload();
      await page
        .getByRole("button", { name: /^Total activity:/ })
        .first()
        .click();
      if (!baseline)
        await expect(
          page
            .getByRole("region", { name: "Insights detail" })
            .getByRole("button", { name: /^Reasoning/ }),
        ).toHaveAttribute("aria-expanded", "false");
      expect(
        await page.evaluate(() => {
          const scope = globalThis as unknown as {
            document: { documentElement: { scrollWidth: number } };
            innerWidth: number;
          };
          return scope.document.documentElement.scrollWidth <= scope.innerWidth;
        }),
      ).toBe(true);
    } finally {
      gate.release();
    }
    harness.provider.assertConsumed();
  });
}

for (const outcome of ["cancel", "failure"] as const) {
  test(`partial reasoning retains ${outcome} semantics`, async ({ harness, page, request }) => {
    const gate = new ScriptGate();
    const prompt = `Partial reasoning ${outcome}`;
    harness.provider.enqueue(
      `partial-${outcome}`,
      { token: prompt },
      {
        kind: "text",
        text: "",
        reasoning: REASONING,
        stream: true,
        failAfterReasoning: outcome === "failure",
      },
      gate,
    );
    const id = await createDirectSession(request, harness);
    await page.goto(`${harness.baseUrl}/#/session/${id}/files`);
    await page.getByRole("combobox", { name: "Message" }).fill(prompt);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await gate.accepted;
    try {
      await expect(page.getByRole("button", { name: "Thinking…", exact: true })).toBeVisible();
      if (outcome === "cancel")
        await page.getByRole("button", { name: "Stop run", exact: true }).first().click();
      gate.release();
      await waitForRunIdle(request, harness, id);
      if (outcome === "cancel") {
        await expect(page.getByText("Run cancelled by user", { exact: true })).toBeVisible();
      } else {
        const alert = page.getByRole("alert");
        await expect(alert).toContainText("The run stopped before it completed.");
        await alert.getByText("Diagnostics", { exact: true }).click();
        await expect(alert.getByText(/Fixture stream interrupted/)).toBeVisible();
      }
      await expect(page.getByText(ANSWER, { exact: true })).toHaveCount(0);
    } finally {
      gate.release();
    }
  });
}

for (const reading of ["open", "focus", "selection"] as const) {
  test(`settlement preserves the reader's ${reading}`, async ({ harness, page, request }) => {
    test.skip(!!process.env.NAC_REASONING_BASELINE_DIST, "Characterizes the new reading contract");
    const gate = new ScriptGate();
    const prompt = `Preserve reading ${reading}`;
    const text = `${REASONING}\n\n[Cache notes](https://example.test/cache)`;
    harness.provider.enqueue(
      `reading-${reading}`,
      { token: prompt },
      { kind: "text", text: ANSWER, reasoning: text, stream: true },
      gate,
    );
    const id = await createDirectSession(request, harness);
    await page.goto(`${harness.baseUrl}/#/session/${id}/files`);
    await page.getByRole("combobox", { name: "Message" }).fill(prompt);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await gate.accepted;
    try {
      await page.getByRole("button", { name: "Thinking…", exact: true }).click();
      const detail = page.getByRole("region", { name: "Insights detail" });
      const toggle = detail.getByRole("button", { name: "Thinking…", exact: true });
      const link = detail.getByRole("link", { name: "Cache notes" });
      await expect(link).toBeVisible();
      if (reading === "open") {
        await toggle.click();
        await toggle.click();
      }
      if (reading === "focus") {
        await toggle.focus();
        await page.keyboard.press("Tab");
        await expect(link).toBeFocused();
      }
      if (reading === "selection") {
        await detail
          .getByText(REASONING.split("\n\n")[0], { exact: true })
          .click({ clickCount: 3 });
        await expect
          .poll(() =>
            page.evaluate(() =>
              (globalThis as unknown as { getSelection: () => { toString: () => string } })
                .getSelection()
                .toString(),
            ),
          )
          .toContain("The build spends");
      }
      gate.release();
      await waitForRunIdle(request, harness, id);
      await expect(detail.getByRole("button", { name: /^Reasoning/ })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      if (reading === "focus") await expect(link).toBeFocused();
      if (reading === "selection")
        await expect
          .poll(() =>
            page.evaluate(() =>
              (globalThis as unknown as { getSelection: () => { toString: () => string } })
                .getSelection()
                .toString(),
            ),
          )
          .toContain("The build spends");
    } finally {
      gate.release();
    }
  });
}
