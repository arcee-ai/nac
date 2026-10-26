import type React from "react";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";

import { cn } from "../../lib/cn";
import Button, { ButtonSize, ButtonVariant } from "../button";
import FileButton, { FileButtonSize } from "./index";

export interface FileButtonsListFile {
  path: string;
  /** Defaults to the path's base name. */
  label?: string;
  additions?: number | null;
  deletions?: number | null;
  active?: boolean;
  disabled?: boolean;
}

interface FileButtonsListProps {
  files: FileButtonsListFile[];
  size?: FileButtonSize;
  onOpen: (path: string) => void;
  /**
   * Most rows drawn before the rest is asked for, "+N more" included: a
   * longer list shows `limit - 1` files and the button.
   */
  limit?: number;
  "aria-label"?: string;
  className?: string;
}

const MORE_BUTTON_SIZE: Record<FileButtonSize, ButtonSize> = {
  [FileButtonSize.Small]: ButtonSize.Small,
  [FileButtonSize.Medium]: ButtonSize.Medium,
  [FileButtonSize.Large]: ButtonSize.Large,
};

/**
 * Files stacked 4px apart, each button stretched to the list's width with its
 * content on the left. A long list stops at `limit` rows with a ghost
 * "+N more" button that reveals the rest in place and hands its focus to the
 * first revealed file that can take it, or to the list when none can.
 * Assistive technology hears a list of the files shown, followed by the button.
 */
const FileButtonsList: React.FC<FileButtonsListProps> = ({
  files,
  size = FileButtonSize.Small,
  onOpen,
  limit = 10,
  "aria-label": ariaLabel,
  className,
}) => {
  const [expanded, setExpanded] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const firstRevealed = useRef<HTMLButtonElement>(null);
  const collapsedCount = Math.max(0, limit - 1);
  const shown = !expanded && files.length > limit ? files.slice(0, collapsedCount) : files;
  const hiddenCount = files.length - shown.length;
  // A disabled button cannot take focus.
  const focusIndex = files.findIndex((file, index) => index >= collapsedCount && !file.disabled);

  const reveal = () => {
    flushSync(() => setExpanded(true));
    (firstRevealed.current ?? list.current)?.focus();
  };

  return (
    <div className={cn("flex flex-col items-start gap-1 [&>*]:shrink-0", className)}>
      {/* `list-style: none` costs a `ul` its list role in Safari unless it is explicit. */}
      <ul
        ref={list}
        role="list"
        aria-label={ariaLabel}
        tabIndex={-1}
        className="flex w-full flex-col gap-1 [&>*]:shrink-0"
      >
        {shown.map((file, index) => (
          <li key={`${index}:${file.path}`} className="flex">
            <FileButton
              ref={index === focusIndex ? firstRevealed : undefined}
              path={file.path}
              label={file.label}
              size={size}
              active={file.active}
              disabled={file.disabled}
              additions={file.additions}
              deletions={file.deletions}
              onClick={() => onOpen(file.path)}
              className="w-full"
            />
          </li>
        ))}
      </ul>
      {hiddenCount > 0 ? (
        <Button size={MORE_BUTTON_SIZE[size]} variant={ButtonVariant.Ghost} onClick={reveal}>
          +{hiddenCount} more
        </Button>
      ) : null}
    </div>
  );
};

export default FileButtonsList;
