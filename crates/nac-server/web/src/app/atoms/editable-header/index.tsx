import React, { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";

export enum EditableHeaderSize {
  Micro = "header-micro",
  Small = "header-small",
  Medium = "header-medium",
}

interface EditableHeaderProps {
  value: string;
  onCommit: (value: string) => void;
  size?: EditableHeaderSize;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Heading that turns into a field on click. Enter and blur commit, Escape puts
 * the previous text back; nothing is reported unless the text actually changed.
 */
const EditableHeader: React.FC<EditableHeaderProps> & {
  Size: typeof EditableHeaderSize;
} = ({
  value,
  onCommit,
  size = EditableHeaderSize.Small,
  placeholder = "Untitled",
  disabled = false,
  className = "",
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // A rename that lands from elsewhere replaces the text, unless the user is
  // in the middle of typing their own.
  const [lastValue, setLastValue] = useState(value);
  if (lastValue !== value) {
    setLastValue(value);
    if (!editing) setDraft(value);
  }

  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    input?.focus();
    input?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
    else setDraft(value);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(value);
      setEditing(false);
    }
  };

  return (
    <div className={cn("flex items-center min-w-0 h-8", size, className)}>
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          placeholder={placeholder}
          className={cn(
            "w-full min-w-0 bg-btn-secondary-hovered text-basic-primary font-normal",
            "rounded-t-[4px] border-b border-primary outline-none px-1",
            size,
          )}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
      ) : (
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "min-w-0 truncate text-left text-basic-primary px-1",
            disabled ? "cursor-default" : "cursor-text",
            size,
          )}
          onClick={() => !disabled && setEditing(true)}
        >
          {value || placeholder}
        </button>
      )}
    </div>
  );
};

EditableHeader.Size = EditableHeaderSize;

export default EditableHeader;
