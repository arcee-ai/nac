/** @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TranscriptRecoveryNotice } from "@/app/components/inspector/Transcript";

describe("TranscriptRecoveryNotice", () => {
  it("renders a warning status only when supplied", () => {
    const view = render(<TranscriptRecoveryNotice warning="Recovered" />);

    expect(view.getByRole("status").textContent).toContain("Recovered");
    view.rerender(<TranscriptRecoveryNotice warning={null} />);
    expect(view.queryByRole("status")).toBeNull();
  });
});
