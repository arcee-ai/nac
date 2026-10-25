import { segmentTitle, segmentTypeLabel } from "@/app/features/insights/model/labels";
import { segmentStatus } from "@/app/features/insights/model/status";
import type { ActionKind } from "@/app/features/insights/model/types";
import { FileChange } from "@/app/features/insights/presentation/items/FileChange";
import {
  isDefault,
  type ItemContent,
  type ItemContext,
  type ToolSegment,
} from "@/app/features/insights/presentation/items/itemContent";
import { ItemFileButton } from "@/app/features/insights/presentation/items/ItemFileButton";

/** Only a write that went through has created its file. */
const NAMED_TITLES: Partial<Record<ActionKind, (file: string, done: boolean) => string>> = {
  "write-file": (file, done) => `${done ? "Created" : "Create"} ${file}`,
  "edit-file": (file) => `Edit ${file}`,
};

/**
 * Read, create and edit show the file as a button that opens it in Files. A
 * create or edit also shows its own diff, which its result carries.
 */
export function fileContent(segment: ToolSegment, context: ItemContext): ItemContent {
  const path = segment.presentation?.summary || null;
  // The row label of a file call is the file's base name.
  const file = path ? segmentTitle(segment) : null;
  const done = segmentStatus(segment) === "ready";
  const named = file ? NAMED_TITLES[segment.action]?.(file, done) : undefined;
  const changeCallId = segment.action === "read-file" ? null : segment.presentation?.callId || null;
  return {
    title: segment.action === "read-file" ? "File Read" : (named ?? segmentTypeLabel(segment)),
    body: (state) => {
      if (!isDefault(state)) return null;
      if (changeCallId) return <FileChange path={path} callId={changeCallId} context={context} />;
      return path ? <ItemFileButton path={path} context={context} /> : null;
    },
  };
}
