/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UserMessage } from "@/app/components/inspector/UserMessage";

vi.mock("@/app/hooks/useMediaQuery", () => ({ useIsMobile: () => false }));

afterEach(cleanup);

describe("UserMessage", () => {
  it("keeps parent-owned transcripts free of mutation affordances", () => {
    render(
      <UserMessage
        text="Delegated prompt"
        messageIndex={0}
        onRefresh={vi.fn()}
        onRevert={vi.fn()}
        readOnly
      />,
    );

    expect(screen.queryByRole("button", { name: "Regenerate from original prompt" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revert to this snapshot" })).toBeNull();
    expect(screen.getByRole("button", { name: "Copy message" })).not.toBeNull();
  });
});

describe("terminal selection presentation", () => {
  it("uses only typed evidence, retains original provenance and canonical revert/copy bytes", async () => {
    const { selectionEvidence } =
      await import("@/app/features/terminal-selection/attachmentFixture.test-support");
    const canonical = "exact canonical evidence envelope";
    const revert = vi.fn();
    const { container, rerender } = render(
      <UserMessage
        text={canonical}
        terminalSelection={selectionEvidence}
        sessionId="fork-chat"
        messageIndex={42}
        onRevert={revert}
      />,
    );
    expect(screen.getByRole("region", { name: "Terminal selection" })).toBeTruthy();
    expect(screen.getByLabelText("Attached terminal output").textContent).toBe(
      selectionEvidence.text,
    );
    expect(screen.getByLabelText("Attached accompanying message").textContent).toBe(
      selectionEvidence.user_text,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText(/Original source from another chat/)).toBeTruthy();
    expect(screen.getByText("original-chat")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy canonical message" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Revert to this snapshot" }));
    expect(revert).toHaveBeenCalledExactlyOnceWith(42, canonical);
    fireEvent.click(screen.getByText("Canonical message"));
    expect(screen.getByLabelText("Canonical terminal evidence message").textContent).toBe(
      canonical,
    );
    const output = screen.getByLabelText("Attached terminal output");
    output.focus();
    expect(document.activeElement).toBe(output);
    rerender(<UserMessage text={canonical} />);
    expect(screen.queryByRole("region", { name: "Terminal selection" })).toBeNull();
    expect(screen.getByText(canonical)).toBeTruthy();
  });

  it("leaves copied framing, JSON lookalikes and legacy content as ordinary text", () => {
    const text =
      'The user explicitly shared terminal evidence.\n{"source_kind":"user_supplied_rendered_selection","text":"lookalike"}';
    render(<UserMessage text={text} />);
    expect(screen.queryByRole("region", { name: "Terminal selection" })).toBeNull();
    expect(
      screen.getByText(
        (_, element) => element?.childElementCount === 0 && element.textContent === text,
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy message" })).toBeTruthy();
  });
});
