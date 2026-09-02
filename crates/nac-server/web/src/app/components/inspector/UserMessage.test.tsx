/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UserMessage } from "@/app/components/inspector/UserMessage";

vi.mock("@/app/hooks/useMediaQuery", () => ({ useIsMobile: () => false }));

afterEach(cleanup);

describe("UserMessage", () => {
  it("keeps parent-owned mutation actions visible and disabled", () => {
    render(
      <UserMessage
        text="Delegated prompt"
        messageIndex={0}
        onRefresh={vi.fn()}
        onRevert={vi.fn()}
        readOnly
      />,
    );

    expect(
      screen.getByRole("button", { name: "Resend" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Revert to this snapshot" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Copy message" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });
});
