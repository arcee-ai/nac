import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { UserMessage } from "@/app/components/inspector/UserMessage";

describe("UserMessage fork action", () => {
  it("appears only with a server token and stays available during other actions", async () => {
    const onFork = vi.fn();
    const { rerender } = render(<UserMessage text="Prompt" onFork={onFork} />);
    expect(screen.queryByRole("button", { name: /fork conversation/i })).toBeNull();

    rerender(
      <UserMessage
        text="Prompt"
        forkBoundaryToken="opaque-token"
        onFork={onFork}
        actionsDisabled
      />,
    );
    const button = screen.getByRole("button", { name: /fork conversation/i });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(onFork).toHaveBeenCalledWith("opaque-token");
  });
});
