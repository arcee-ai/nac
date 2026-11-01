import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Locator, Page, TestInfo } from "@playwright/test";

import type { EmbeddedHarness } from "./harness";

/** Opt-in passive evidence at existing assertions; never drives the product. */
export async function captureCurrentSuppliers(
  page: Page,
  input: Locator,
  harness: EmbeddedHarness,
  info: TestInfo,
  checkpoint: string,
): Promise<void> {
  if (process.env.NAC_E2E_CURRENT_SUPPLIERS_VISUALS !== "1") return;
  const source = process.env.NAC_E2E_VISUAL_SOURCE_REF;
  const tree = process.env.NAC_E2E_VISUAL_SOURCE_TREE;
  const expectedBinary = process.env.NAC_E2E_VISUAL_BINARY_SHA256;
  if (!/^[a-f0-9]{40}$/.test(source ?? "") || !/^[a-f0-9]{40}$/.test(tree ?? "")) {
    throw new Error("Visual evidence requires the admitted source commit and tree");
  }
  const binary = createHash("sha256")
    .update(await readFile(harness.binaryPath))
    .digest("hex");
  if (!/^[a-f0-9]{64}$/.test(expectedBinary ?? "") || binary !== expectedBinary) {
    throw new Error("Visual evidence binary differs from the admitted private producer");
  }
  const observe = async () => ({
    url: page.url(),
    viewport: page.viewportSize(),
    text: await input.inputValue(),
    visible: await input.isVisible(),
    enabled: await input.isEnabled(),
    editable: await input.isEditable(),
  });
  const before = await observe();
  const image = info.outputPath(`current-suppliers-${checkpoint}.png`);
  const started = Date.now();
  await page.screenshot({ path: image, animations: "allow", caret: "initial", timeout: 5_000 });
  const after = await observe();
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error("Visual checkpoint changed during capture");
  }
  await info.attach(`current-suppliers-${checkpoint}`, {
    body: Buffer.from(
      JSON.stringify({
        source,
        tree,
        binary,
        binaryPath: harness.binaryPath,
        checkpoint,
        title: info.title,
        started,
        finished: Date.now(),
        image,
        before,
        after,
      }),
    ),
    contentType: "application/json",
  });
}
