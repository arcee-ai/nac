import { useEffect, useRef, useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
} from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import type { InboxItem } from "@/app/types/api";

export type QueueDropEdge = "before" | "after";

type QueuedItemProps = {
  item: InboxItem;
  disabled?: boolean;
  dragging?: boolean;
  dropEdge?: QueueDropEdge | null;
  onDragStart: (itemId: number) => void;
  onDragOver: (itemId: number, edge: QueueDropEdge) => void;
  onDrop: (itemId: number, edge: QueueDropEdge) => void;
  onDragEnd: () => void;
  onSteer: (item: InboxItem) => void;
  onDelete: (item: InboxItem) => void;
  onSavePrompt: (item: InboxItem, prompt: string) => Promise<void> | void;
};

function dropEdgeFromPointer(target: HTMLElement, clientY: number): QueueDropEdge {
  const rect = target.getBoundingClientRect();
  return clientY < rect.top + rect.height / 2 ? "before" : "after";
}

function DragHandle({ disabled }: { disabled?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute left-1 top-1/2 flex h-3 -translate-y-1/2 items-center gap-0.5",
        disabled ? "cursor-default" : "cursor-grab active:cursor-grabbing",
      )}
    >
      <span className="h-full w-px rounded-[2px] bg-divider-secondary" />
      <span className="h-full w-px rounded-[2px] bg-divider-secondary" />
    </span>
  );
}

export function QueuedItem({
  item,
  disabled = false,
  dragging = false,
  dropEdge = null,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onSteer,
  onDelete,
  onSavePrompt,
}: QueuedItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.prompt);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setDraft(item.prompt);
  }, [editing, item.prompt]);

  useEffect(() => {
    if (!editing) return;
    const node = textareaRef.current;
    if (!node) return;
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  }, [editing]);

  const closeEdit = () => {
    setDraft(item.prompt);
    setEditing(false);
  };

  const saveEdit = async () => {
    const prompt = draft.trim();
    if (!prompt || saving || disabled) return;
    if (prompt === item.prompt.trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSavePrompt(item, prompt);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const actionClass =
    "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100";

  if (editing) {
    return (
      <div className="flex items-end gap-1.5 rounded-[4px] bg-btn-ghost-highlighted p-1">
        <textarea
          ref={textareaRef}
          value={draft}
          disabled={saving || disabled}
          aria-label="Queued prompt"
          className="min-h-[40px] max-h-[88px] min-w-0 flex-1 resize-none bg-transparent text-micro text-basic-primary outline-none"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closeEdit();
            }
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void saveEdit();
            }
          }}
        />
        <div className="flex h-[88px] shrink-0 flex-col items-center justify-between">
          <Button
            type="button"
            size={ButtonSize.Small}
            variant={ButtonVariant.Ghost}
            content={ButtonContent.Icon}
            aria-label="Cancel edit"
            disabled={saving}
            onClick={closeEdit}
          >
            <Icon iconName={IconName.Close} size={16} />
          </Button>
          <Button
            type="button"
            size={ButtonSize.Small}
            variant={ButtonVariant.Primary}
            content={ButtonContent.Icon}
            aria-label="Save prompt"
            disabled={saving || disabled || !draft.trim()}
            loading={saving}
            onClick={() => void saveEdit()}
          >
            <Icon iconName={IconName.Right} size={16} />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group relative flex h-6 items-center gap-0.5 rounded-[4px] py-1 pl-4",
        "hover:bg-btn-ghost-hovered active:bg-btn-ghost-pressed",
        "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[-2px] has-[:focus-visible]:outline-[var(--blue-500)]",
        dragging && "opacity-40",
        disabled && "text-btn-secondary-disabled",
      )}
      onDragOver={(event) => {
        if (disabled) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        onDragOver(item.id, dropEdgeFromPointer(event.currentTarget, event.clientY));
      }}
      onDrop={(event) => {
        if (disabled) return;
        event.preventDefault();
        onDrop(item.id, dropEdgeFromPointer(event.currentTarget, event.clientY));
      }}
    >
      {dropEdge ? (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-accent-inverse",
            dropEdge === "before" ? "top-0" : "bottom-0",
          )}
        />
      ) : null}
      <button
        type="button"
        draggable={!disabled}
        aria-label="Drag to reorder"
        className="absolute inset-y-0 left-0 z-10 w-4 cursor-grab active:cursor-grabbing"
        disabled={disabled}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", String(item.id));
          onDragStart(item.id);
        }}
        onDragEnd={onDragEnd}
      >
        <DragHandle disabled={disabled} />
      </button>
      <p
        className={cn(
          "min-w-0 flex-1 truncate text-micro",
          disabled ? "text-btn-secondary-disabled" : "text-btn-secondary",
        )}
      >
        {item.prompt}
      </p>
      <Button
        type="button"
        className={actionClass}
        size={ButtonSize.Small}
        variant={ButtonVariant.Ghost}
        content={ButtonContent.Icon}
        aria-label="Edit queued message"
        disabled={disabled}
        onClick={() => setEditing(true)}
      >
        <Icon iconName={IconName.Edit} size={16} />
      </Button>
      <Button
        type="button"
        className={actionClass}
        size={ButtonSize.Small}
        variant={ButtonVariant.GhostDestructive}
        content={ButtonContent.Icon}
        aria-label="Remove from queue"
        disabled={disabled}
        onClick={() => onDelete(item)}
      >
        <Icon iconName={IconName.Trash} size={16} />
      </Button>
      <Button
        type="button"
        size={ButtonSize.Small}
        variant={ButtonVariant.Ghost}
        content={ButtonContent.Icon}
        aria-label="Steer now"
        disabled={disabled}
        onClick={() => onSteer(item)}
      >
        <Icon iconName={IconName.ArrowTop} size={16} />
      </Button>
    </div>
  );
}
