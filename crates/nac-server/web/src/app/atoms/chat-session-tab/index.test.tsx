/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ChatSessionTab, { ChatSessionTabSkeleton } from ".";

afterEach(cleanup);

describe("chat session tab", () => {
  it("stacks behavior below a discoverable title without weakening the accessible name", () => {
    const dismiss = vi.fn();
    render(
      <ChatSessionTab
        title="Coordinate release readiness review"
        badge="Direct + NAC"
        badgeLabel="Direct + NAC orchestration"
        active
        onDismiss={dismiss}
      />,
    );

    const tab = screen.getByRole("button", {
      name: "Coordinate release readiness review, Direct + NAC orchestration",
    });
    expect(tab.getAttribute("aria-current")).toBe("page");
    expect(tab.getAttribute("title")).toBe(
      "Coordinate release readiness review · Direct + NAC orchestration",
    );

    const title = screen.getByText("Coordinate release readiness review");
    const behavior = screen.getByText("Direct + NAC");
    expect(title.getAttribute("title")).toBe("Coordinate release readiness review");
    expect(behavior.getAttribute("title")).toBe("Direct + NAC orchestration");
    expect(title.parentElement?.nextElementSibling).toBe(behavior);
    expect(title.parentElement?.className).toContain("group-hover:pr-4");

    fireEvent.click(
      screen.getByRole("button", { name: "Close Coordinate release readiness review" }),
    );
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it("keeps the loading stand-in at the same two-line height", () => {
    const { container } = render(<ChatSessionTabSkeleton />);
    expect(container.firstElementChild?.className).toContain("h-12");
  });
});
