/** @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CircularLoader, LoaderSize } from "@/app/atoms";

afterEach(cleanup);

describe("CircularLoader", () => {
  it("accepts exact pixel sizes without changing the existing size enum contract", () => {
    const { container } = render(<CircularLoader size={18} />);
    const svg = container.querySelector("svg");

    expect(svg?.getAttribute("width")).toBe("16");
    expect(svg?.getAttribute("height")).toBe("16");
    expect(CircularLoader.Size).toBe(LoaderSize);
  });
});
