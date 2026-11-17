/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import SubagentTranscriptCard, { SubagentCardStatus } from "./index";

afterEach(cleanup);

it.each([
  ["orchestrator", null, "Orchestrator"],
  ["direct", null, "Agent"],
  ["direct-with-orchestrator", null, "Agent + Orchestrator"],
  ["direct-with-orchestrator", "traditional-child", "Subagent"],
  ["direct", "managed-orchestrator", "Managed orchestrator"],
] as const)("names the displayed %s / %s glyph", (behavior, lineage, label) => {
  render(
    <SubagentTranscriptCard
      title="Child"
      status={SubagentCardStatus.Ready}
      behavior={behavior}
      lineage={lineage}
      showBehaviorIcon
      onOpen={() => {}}
    />,
  );
  expect(screen.getByRole("button", { name: `Open Child in Subagents, ${label}` })).toBeTruthy();
});

it("keeps the type in a static card's accessible text", () => {
  render(
    <SubagentTranscriptCard
      title="Child"
      status={SubagentCardStatus.Ready}
      behavior="direct"
      showBehaviorIcon
    />,
  );
  expect(screen.getByText("Agent · Ready")).toBeTruthy();
});

it("does not announce a hidden behavior glyph", () => {
  render(
    <SubagentTranscriptCard
      title="Child"
      status={SubagentCardStatus.Ready}
      behavior="direct"
      showBehaviorIcon={false}
      onOpen={() => {}}
    />,
  );
  expect(screen.getByRole("button", { name: "Open Child in Subagents" })).toBeTruthy();
});
