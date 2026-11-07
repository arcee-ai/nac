/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import ActionListButton, { ActionListButtonSize, ActionListButtonStatus } from ".";
import { IconName } from "../icon";
import {
  InsightsTurnSection,
  type InsightsRowController,
} from "@/app/features/insights/presentation/InsightsTurnSection";

vi.mock("@/app/hooks/useMediaQuery", () => ({ useIsMobile: () => false }));
afterEach(cleanup);

it("styles the actual Insights metadata consumer while the neighboring compact atom stays unchanged", () => {
  const click = vi.fn();
  const view = () => ({
    icon: IconName.ReadFile,
    label: "Inspect source",
    meta: "Read",
    status: ActionListButtonStatus.Ready,
  });
  const controller: InsightsRowController = {
    expanded: new Set(),
    entryView: view,
    segmentView: view,
    entrySelected: () => true,
    segmentSelected: () => false,
    entryShown: () => true,
    segmentShown: () => false,
    entryAction: () => click,
    segmentAction: () => null,
  };
  render(
    <>
      <ActionListButton
        label="Compact neighbor"
        icon={IconName.Info}
        meta="Check"
        selected
        onClick={click}
      />
      <InsightsTurnSection
        section={{
          key: "turn",
          ordinal: 1,
          promptPreview: "Inspection",
          createdAt: null,
          entries: [
            {
              kind: "group",
              id: "group",
              group: { id: "group", segments: [], durationMs: null, status: "ready" },
            },
          ],
        }}
        fallbackPrompt="Inspection"
        controller={controller}
        size={ActionListButtonSize.Small}
      />
    </>,
  );
  const compact = screen.getByText("Check");
  expect(compact.className).toContain("text-[10px]");
  expect(compact.className).toContain("text-basic-muted");
  const readable = screen.getByText("Read");
  expect(readable.className).toContain("text-xs");
  expect(readable.className).toContain("leading-4");
  expect(readable.className).toContain("text-basic-tertiary");
  expect(readable.className).not.toContain("text-[10px]");
  for (const name of ["Compact neighbor, Check", "Inspect source, Read"]) {
    const button = screen.getByRole("button", { name });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
  }
  expect(click).toHaveBeenCalledTimes(2);
});
