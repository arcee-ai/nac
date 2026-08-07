import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ChatBadge } from "@/app/components/inspector/ChatBadge";

describe("ChatBadge", () => {
  it("exposes and operates its reasoning disclosure", async () => {
    const user = userEvent.setup();
    render(<ChatBadge label="Reasoning" body="A careful plan" />);

    const disclosure = screen.getByRole("button", { name: "Reasoning" });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await user.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("A careful plan")).toBeVisible();
  });

  it("disables a non-interactive status badge", () => {
    render(<ChatBadge label="Snapshot saved" />);
    expect(
      screen.getByRole("button", { name: "Snapshot saved" }),
    ).toBeDisabled();
  });
});
