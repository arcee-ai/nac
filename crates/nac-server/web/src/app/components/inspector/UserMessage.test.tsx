/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
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

    expect(screen.queryByRole("button", { name: "Resend" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revert to this snapshot" })).toBeNull();
    expect(screen.getByRole("button", { name: "Copy message" })).not.toBeNull();
  });
});
