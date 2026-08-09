import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ThreadWave } from "@/app/components/inspector/ThreadWave";
import type { TranscriptThread } from "@/app/lib/transcript";

function thread(
  key: string,
  state: TranscriptThread["state"],
): TranscriptThread {
  return {
    key,
    name: "impl",
    action: `action ${key}`,
    summary: `summary ${key}`,
    log: [],
    state,
  };
}

describe("ThreadWave", () => {
  it("renders dependency pending and cancellation as distinct terminal state", () => {
    render(
      <ThreadWave
        rows={[
          [thread("pending-dispatch", "dependency_pending")],
          [thread("cancelling-dispatch", "cancelling")],
          [thread("cancelled-dispatch", "cancelled")],
        ]}
        selected={null}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getAllByText("Pending")[0]).toBeVisible();
    expect(screen.getByText("Cancelling…")).toBeVisible();
    expect(screen.getByText("summary cancelled-dispatch")).toBeVisible();
    expect(screen.queryAllByRole("status")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "impl: Pending" })).toBeVisible();
  });

  it("exposes completion delivery in one concise accessible card name", () => {
    const delivered = { ...thread("delivered", "completed"), delivery: "delivered" as const };
    render(<ThreadWave rows={[[delivered]]} selected={null} onSelect={() => undefined} />);
    expect(screen.getByRole("button", { name: "impl: Completed, Result delivered" })).toBeVisible();
    expect(screen.queryAllByRole("status")).toHaveLength(0);
  });

  it("selects reused-name cards by dispatch key", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <ThreadWave
        rows={[[thread("old-dispatch", "completed"), thread("new-dispatch", "running")]]}
        selected="old-dispatch"
        onSelect={onSelect}
      />,
    );
    const cards = screen.getAllByRole("button", { name: /impl/ });
    expect(cards[0]).toHaveAttribute("aria-pressed", "true");
    await user.click(cards[1]);
    expect(onSelect).toHaveBeenCalledWith("impl", "new-dispatch");
  });
});
