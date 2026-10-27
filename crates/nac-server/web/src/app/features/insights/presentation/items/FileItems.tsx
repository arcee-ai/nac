import { segmentTitle, segmentTypeLabel } from "@/app/features/insights/model/labels";
import { segmentStatus } from "@/app/features/insights/model/status";
import type { ActionKind } from "@/app/features/insights/model/types";
import {
  isDefault,
  type ItemContent,
  type ToolSegment,
} from "@/app/features/insights/presentation/items/itemContent";
import { FileChip } from "@/app/features/insights/presentation/items/ItemParts";

/** Only a write that went through has created its file. */
const NAMED_TITLES: Partial<Record<ActionKind, (file: string, done: boolean) => string>> = {
  "write-file": (file, done) => `${done ? "Created" : "Create"} ${file}`,
  "edit-file": (file) => `Edit ${file}`,
};

/** Read, create and edit show the file's chip; the calls carry no diff to show. */
export function fileContent(segment: ToolSegment): ItemContent {
  const path = segment.presentation?.summary || null;
  // The row label of a file call is the file's base name.
  const file = path ? segmentTitle(segment) : null;
  const done = segmentStatus(segment) === "ready";
  const named = file ? NAMED_TITLES[segment.action]?.(file, done) : undefined;
  return {
    title: segment.action === "read-file" ? "File Read" : (named ?? segmentTypeLabel(segment)),
    body: (state) =>
      isDefault(state) && path && file ? <FileChip path={path} name={file} /> : null,
  };
}
