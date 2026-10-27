/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import SubagentTranscriptCard, { SubagentCardStatus } from "./index";

afterEach(cleanup);

it.each([
  ["orchestrator", null, "NAC orchestrator"],
  ["direct", null, "Direct coding agent"],
  ["direct-with-orchestrator", null, "Direct + NAC orchestration"],
  ["direct-with-orchestrator", "traditional-child", "Coding agent"],
  ["direct", "managed-orchestrator", "NAC orchestrator"],
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
  expect(screen.getByText(", Direct coding agent")).toBeTruthy();
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
