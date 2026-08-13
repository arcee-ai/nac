/** @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TranscriptRecoveryNotice } from "@/app/components/inspector/Transcript";

describe("TranscriptRecoveryNotice", () => {
  it("renders a non-fatal recovery status only when supplied", () => {
    const warning =
      "Recovered this session to its last valid message because transcript index 7 was missing.";
    const view = render(<TranscriptRecoveryNotice warning={warning} />);

    const status = view.getByRole("status");
    expect(status.textContent).toContain("Session recovered");
    expect(status.textContent).toContain(warning);

    view.rerender(<TranscriptRecoveryNotice warning={null} />);
    expect(view.queryByRole("status")).toBeNull();
  });
});
