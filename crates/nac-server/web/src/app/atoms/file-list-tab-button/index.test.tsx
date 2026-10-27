/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { GIT_STATUS_TONE } from "../git-status-label";
import FileListTabButton, { FileListTabButtonVariant } from "./index";

afterEach(cleanup);

for (const variant of [FileListTabButtonVariant.File, FileListTabButtonVariant.Folder]) {
  it.each(Object.keys(GIT_STATUS_TONE) as (keyof typeof GIT_STATUS_TONE)[])(
    `names %s git status on a ${variant} row`,
    (status) => {
      render(<FileListTabButton name="source" status={status} variant={variant} />);
      expect(
        screen.getByRole("button", {
          name: new RegExp(`^source\\s*, ${GIT_STATUS_TONE[status].title}$`),
        }),
      ).toBeTruthy();
    },
  );
}
