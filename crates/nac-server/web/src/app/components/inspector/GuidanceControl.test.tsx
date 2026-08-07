import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { GuidanceControl } from "@/app/components/inspector/GuidanceControl";

describe("GuidanceControl", () => {
  it("keeps guidance secondary, explains its boundary, and submits its own draft", async () => {
    const user = userEvent.setup();
    const submit = vi.fn().mockResolvedValue(true);
    render(
      <GuidanceControl
        active
        pending={false}
        status={null}
        onSubmit={submit}
      />,
    );

    const toggle = screen.getByRole("button", { name: "Guide current run" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);

    expect(
      screen.getByText("Applied after the current model call or tool batch."),
    ).toBeInTheDocument();
    const input = screen.getByLabelText("Guidance for the active run");
    expect(input).toHaveFocus();
    await user.type(input, "Avoid changing the public API");
    await user.click(screen.getByRole("button", { name: "Apply guidance" }));

    expect(submit).toHaveBeenCalledWith("Avoid changing the public API");
    expect(screen.queryByLabelText("Guidance for the active run")).toBeNull();
  });

  it("reports lifecycle state without exposing the action after the run ends", () => {
    render(
      <GuidanceControl
        active={false}
        pending={false}
        status={{ steeringId: 7, runId: "run-1", status: "expired" }}
        onSubmit={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Guide current run" }),
    ).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Guidance expired before delivery",
    );
  });
});
