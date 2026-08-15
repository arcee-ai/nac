// How a git status code reads in the UI. Shared so the chips in the chat and
// the rows in the files panel cannot drift apart on what a colour means.

import { cn } from "@/app/lib/cn";

// Modified is yellow and anything newly appearing is blue, the way an editor
// tints its explorer; a file matching HEAD keeps the ordinary row colour.
interface StatusColorMap {
  [code: string]: string;
}

const STATUS_COLOR: StatusColorMap = {
  M: "text-danger-primary",
  A: "text-info-primary",
  "?": "text-info-primary",
  R: "text-info-primary",
  C: "text-info-primary",
  D: "text-error-primary",
  U: "text-error-primary",
};

export const statusColor = (status: string | null) =>
  status ? (STATUS_COLOR[status.trim()[0]] ?? "text-basic-primary") : null;

/** A deleted file is gone from the checkout, so its name is struck through. */
export const statusLabelClass = (status: string | null) =>
  cn(statusColor(status), status?.trim()[0] === "D" && "line-through") ||
  undefined;
