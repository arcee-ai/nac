/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UserMessage } from "@/app/components/inspector/UserMessage";

const media = vi.hoisted(() => ({ isMobile: false }));
vi.mock("@/app/hooks/useMediaQuery", () => ({ useIsMobile: () => media.isMobile }));

afterEach(() => {
  media.isMobile = false;
  cleanup();
});

describe("UserMessage", () => {
  it("preserves the action set, tooltip text, and callback arguments", () => {
    const onRefresh = vi.fn();
    const onRevert = vi.fn();
    render(
      <UserMessage text="Ship the UI" messageIndex={7} onRefresh={onRefresh} onRevert={onRevert} />,
    );

    const regenerate = screen.getByRole("button", {
      name: "Regenerate from original prompt",
    });
    const revert = screen.getByRole("button", { name: "Revert to this snapshot" });
    const copy = screen.getByRole("button", { name: "Copy message" });
    expect(screen.getAllByRole("button")).toEqual([regenerate, revert, copy]);
    expect(
      screen.getByText(
        "Regenerate from the original prompt (rewinds later transcript and workspace changes)",
      ),
    ).not.toBeNull();
    expect(screen.getByText("Revert to this snapshot")).not.toBeNull();

    fireEvent.click(regenerate);
    fireEvent.click(revert);
    expect(onRefresh).toHaveBeenCalledWith(7);
    expect(onRevert).toHaveBeenCalledWith(7, "Ship the UI");
  });

  it("keeps mutation actions disabled without disabling copy", () => {
    const onRefresh = vi.fn();
    const onRevert = vi.fn();
    render(
      <UserMessage
        text="Busy prompt"
        messageIndex={2}
        onRefresh={onRefresh}
        onRevert={onRevert}
        actionsDisabled
      />,
    );

    const regenerate = screen.getByRole("button", {
      name: "Regenerate from original prompt",
    });
    const revert = screen.getByRole("button", { name: "Revert to this snapshot" });
    expect(regenerate.hasAttribute("disabled")).toBe(true);
    expect(revert.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Copy message" }).hasAttribute("disabled")).toBe(
      false,
    );
    fireEvent.click(regenerate);
    fireEvent.click(revert);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(onRevert).not.toHaveBeenCalled();
  });

  it("explains why an unstored message cannot be reverted", () => {
    render(<UserMessage text="Pending persistence" onRefresh={vi.fn()} onRevert={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Regenerate from original prompt" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Revert to this snapshot" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByText("This message is not in the transcript yet")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Copy message" })).not.toBeNull();
  });

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

  it("keeps mobile actions visible-sized without changing their set", () => {
    media.isMobile = true;
    render(
      <UserMessage text="Mobile prompt" messageIndex={1} onRefresh={vi.fn()} onRevert={vi.fn()} />,
    );

    for (const button of screen.getAllByRole("button")) {
      expect(button.classList.contains("btn-medium")).toBe(true);
      expect(button.classList.contains("btn-ghost")).toBe(true);
    }
  });

  it("hides every action while the optimistic message is pending", () => {
    render(
      <UserMessage
        text="Optimistic prompt"
        pending
        messageIndex={1}
        onRefresh={vi.fn()}
        onRevert={vi.fn()}
      />,
    );

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
