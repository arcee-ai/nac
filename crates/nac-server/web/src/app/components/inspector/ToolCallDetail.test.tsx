/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ToolCallDetail } from "@/app/components/inspector/ToolCallDetail";
import type { ToolPresentation } from "@/app/lib/toolPresentation";

afterEach(cleanup);

function tool(overrides: Partial<ToolPresentation> = {}): ToolPresentation {
  return {
    callId: "call-1",
    name: "exec_command",
    label: "Run command",
    summary: "cargo test --locked -p nac-core",
    resultPreview: "test result: ok. 12 passed",
    status: "success",
    statusLabel: "Succeeded",
    ...overrides,
  };
}

describe("primary transcript tool detail", () => {
  it("renders accessible name, summary, result, and non-colour status text", () => {
    render(<ToolCallDetail tool={tool()} />);
    expect(screen.getByText("Run command")).toBeTruthy();
    expect(screen.getByText("cargo test --locked -p nac-core")).toBeTruthy();
    expect(screen.getByText("test result: ok. 12 passed")).toBeTruthy();
    expect(screen.getByText("Succeeded")).toBeTruthy();
    expect(screen.getByLabelText("Run command status: Succeeded")).toBeTruthy();
  });

  it.each([
    ["pending", "Pending"],
    ["running", "Running"],
    ["success", "Succeeded"],
    ["error", "Failed"],
    ["timed-out", "Timed out"],
    ["cancelled", "Cancelled"],
    ["interrupted", "Interrupted"],
  ] as const)("renders the %s status as accessible text", (status, statusLabel) => {
    render(<ToolCallDetail tool={tool({ status, statusLabel })} />);
    expect(screen.getByText(statusLabel)).toBeTruthy();
    expect(screen.getByLabelText(`Run command status: ${statusLabel}`)).toBeTruthy();
  });

  it("wraps bounded long content without exposing hidden payloads", () => {
    const { container } = render(
      <ToolCallDetail
        tool={tool({
          summary: `src/${"nested/".repeat(20)}file.rs`,
          resultPreview: "bounded result only",
          status: "timed-out",
          statusLabel: "Timed out",
        })}
      />,
    );
    expect(container.querySelector(".break-all")).toBeTruthy();
    expect(screen.getByText("Timed out")).toBeTruthy();
    expect(container.textContent).not.toContain("RAW_SECRET");
  });
});
