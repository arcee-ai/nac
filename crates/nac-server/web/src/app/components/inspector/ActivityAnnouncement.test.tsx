import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActivityAnnouncement } from "@/app/components/inspector/ActivityAnnouncement";

afterEach(() => vi.useRealTimers());

describe("ActivityAnnouncement", () => {
  it("uses one polite region and coalesces rapid transitions", () => {
    vi.useFakeTimers();
    const { rerender } = render(<ActivityAnnouncement summary="Thread impl: running" />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("Thread impl: running");

    rerender(<ActivityAnnouncement summary="Thread impl: completed" />);
    rerender(<ActivityAnnouncement summary="Thread impl: completed, result available" />);
    expect(region).toHaveTextContent("Thread impl: running");
    act(() => vi.advanceTimersByTime(500));
    expect(region).toHaveTextContent("Thread impl: completed, result available");
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});
