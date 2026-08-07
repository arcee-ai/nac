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
import type { QueuedRunRecord } from "@/app/types/api";

interface QueuedMessageProps {
  message: QueuedRunRecord;
  onEdit: (prompt: string, expectedVersion: number) => Promise<void>;
  onDelete: (expectedVersion: number) => Promise<void>;
}

/** A durable next turn. It is deliberately not a UserMessage/transcript turn. */
export function QueuedMessage({ message, onEdit, onDelete }: QueuedMessageProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(message.display_prompt);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const save = async () => {
    const prompt = value.trim();
    if (!prompt || busy) return;
    setBusy(true);
    try {
      await onEdit(prompt, message.version);
      setEditing(false);
    } catch {
      // The owner reports the API error; leave the editor open for retry.
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onDelete(message.version);
    } catch {
      // The owner reports the API error; the authoritative bubble remains.
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label="Next message"
      className="flex flex-col items-end w-full max-w-full pt-4 pb-8"
    >
      <div className="w-full max-w-[640px] rounded-[12px] border border-info-primary/30 bg-elevation-level-1 shadow-convex p-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <div className="label-small font-semibold text-info-primary">Next message</div>
            <div className="label-micro text-basic-tertiary">
              Sends after the current run finishes
            </div>
          </div>
          {message.state === "pending" ? (
            <div className="flex items-center gap-1">
              <Button
                size={ButtonSize.Small}
                variant={ButtonVariant.Tertiary}
                content={ButtonContent.Icon}
                aria-label={editing ? "Cancel editing next message" : "Edit next message"}
                disabled={busy}
                onClick={() => {
                  setValue(message.display_prompt);
                  setEditing((current) => !current);
                }}
              >
                <Icon iconName={editing ? IconName.Close : IconName.Edit} size={16} />
              </Button>
              <Button
                size={ButtonSize.Small}
                variant={ButtonVariant.Tertiary}
                content={ButtonContent.Icon}
                aria-label="Delete next message"
                disabled={busy}
                onClick={() => void remove()}
              >
                <Icon iconName={IconName.Trash} size={16} />
              </Button>
            </div>
          ) : null}
        </div>

        {editing ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <label className="sr-only" htmlFor={`queued-message-${message.queued_run_id}`}>
              Edit next message
            </label>
            <textarea
              ref={inputRef}
              id={`queued-message-${message.queued_run_id}`}
              className="w-full min-h-24 resize-y rounded-[4px] bg-input p-3 text-medium text-input outline-none shadow-concave"
              value={value}
              disabled={busy}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setValue(message.display_prompt);
                  setEditing(false);
                }
              }}
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button
                size={ButtonSize.Small}
                variant={ButtonVariant.Tertiary}
                disabled={busy}
                onClick={() => {
                  setValue(message.display_prompt);
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
              <Button
                size={ButtonSize.Small}
                variant={ButtonVariant.Primary}
                type="submit"
                disabled={!value.trim() || busy}
              >
                Save
              </Button>
            </div>
          </form>
        ) : (
          <p className={cn("label-small whitespace-pre-wrap break-words", busy && "opacity-60")}>
            {message.display_prompt}
          </p>
        )}
      </div>
    </section>
  );
}
