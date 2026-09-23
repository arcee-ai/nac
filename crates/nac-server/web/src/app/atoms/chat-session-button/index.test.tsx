/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ChatSessionButton from ".";
import { IconName } from "../icon";

vi.mock("@/app/hooks/useMediaQuery", () => ({
  useIsMobile: () => false,
}));

afterEach(cleanup);

describe("ChatSessionButton navigation identity", () => {
  it("adds visual identity without changing the row's status and accessibility contracts", () => {
    const onOpen = vi.fn();
    render(
      <ChatSessionButton
        title="Release follow-up"
        active
        running
        unread
        forkedFromTitle="Release plan"
        behaviorIcon={IconName.PlaneAdd}
        behaviorLabel="Direct + NAC orchestration"
        originKind="managed-orchestrator"
        badge="Running"
        badgeLabel="Running"
        aria-label="Release follow-up, Running, updated since last viewed"
        onClick={onOpen}
        actions={<button type="button">Rename</button>}
      />,
    );

    const row = screen.getByRole("button", {
      name: "Release follow-up, Running, updated since last viewed",
    });
    expect(row.getAttribute("aria-current")).toBe("page");
    expect(row.getAttribute("title")).toBe("Release follow-up · Running");
    expect(row.className).toContain("focus-visible:outline");
    expect(row.querySelector('[data-session-behavior-icon="planeAdd"]')).toBeTruthy();
    expect(row.querySelector('[data-session-origin-kind="managed-orchestrator"]')).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText("Unread")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rename" })).toBeTruthy();

    row.click();
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
