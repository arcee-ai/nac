import type { Page } from "@playwright/test";
import { finishPresentation } from "./presentation-lifetime";

/** The prepared page is not a packed document until its navigation commits. */
export function ownPackedCapturePage(
  origin: string,
  closeRuntime: (page: Page, name: "Left" | "Right") => Promise<void>,
  assertClosed: (page: Page) => Promise<void>,
) {
  let prepared: Page | undefined;
  return {
    retain(page: Page) {
      prepared = page;
    },
    async dispose() {
      const page = prepared;
      prepared = undefined;
      // Preparation/goto can fail while this is still the harness document or
      // about:blank. Never apply packed cleanup to that unrelated document.
      if (!page || new URL(page.url()).origin !== new URL(origin).origin) return;
      const failures: unknown[] = [];
      for (const name of ["Left", "Right"] as const) {
        try {
          await closeRuntime(page, name);
        } catch (error) {
          failures.push(error);
        }
      }
      try {
        await assertClosed(page);
      } catch (error) {
        failures.push(error);
      }
      if (failures.length)
        throw new AggregateError(failures, "Packed runtime cleanup failed; all errors retained");
    },
  };
}

/** Stop packed producers before terminally releasing their composed route boundary. */
export function ownComposedCleanup(
  boundary: () => { unlock(): void; release(): Promise<void> } | undefined,
  packedPage: ReturnType<typeof ownPackedCapturePage>,
  disposeServing: () => Promise<void> = async () => {},
) {
  let disposal: Promise<void> | undefined;
  let reportedByZoom = false;
  const dispose = () =>
    (disposal ??= finishPresentation(
      [],
      [
        () => boundary()?.unlock(),
        () => packedPage.dispose(),
        () => boundary()?.release(),
        disposeServing,
      ],
    ));
  return {
    // openNameZoom retains this failure alongside its primary and context-close
    // errors. Outer finally must await completion without reporting it twice.
    async beforeContextClose() {
      try {
        await dispose();
      } catch (error) {
        reportedByZoom = true;
        throw error;
      }
    },
    async dispose() {
      if (!reportedByZoom) await dispose();
    },
  };
}
