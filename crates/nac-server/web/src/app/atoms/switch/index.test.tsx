import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import Switch from "@/app/atoms/switch";

describe("Switch", () => {
  it("exposes switch semantics and reports the next checked state", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Switch aria-label="Respond live" checked={false} onChange={onChange} />,
    );

    const toggle = screen.getByRole("switch", { name: "Respond live" });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("does not change while disabled", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Switch aria-label="Respond live" disabled onChange={onChange} />,
    );

    await user.click(screen.getByRole("switch", { name: "Respond live" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
