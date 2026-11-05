/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PromptRecoveryMessage } from "./PromptRecoveryMessage";

afterEach(cleanup);

it("labels imported text as potentially stale and exposes explicit review without an automatic restore", () => {
  const restore = vi.fn();
  const dismiss = vi.fn();
  const review = {
    id: "checkpoint",
    text: "  old\ntext 雪  ",
    status: "uncertain" as const,
    source: "checkpoint" as const,
  };
  const view = render(
    <PromptRecoveryMessage
      recovery={review}
      hasDraft={false}
      onRestore={restore}
      onDismiss={dismiss}
    />,
  );
  expect(screen.getByRole("status").textContent).toContain("may be stale or already sent");
  expect(restore).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Restore to composer" }));
  expect(restore).toHaveBeenCalledOnce();
  view.rerender(
    <PromptRecoveryMessage recovery={review} hasDraft onRestore={restore} onDismiss={dismiss} />,
  );
  expect(
    (screen.getByRole("button", { name: "Restore to composer" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByText(/Your current draft is preserved/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(dismiss).toHaveBeenCalledOnce();
});
