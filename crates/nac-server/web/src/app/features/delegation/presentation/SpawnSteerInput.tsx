import { useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
} from "@/app/atoms";
import { cn } from "@/app/lib/cn";

const PLACEHOLDER = "Send a message";

/**
 * Compact composer on a spawned-session preview. Matches the Figma
 * ChatInputBox in the Spawned detail: one field, send on the right.
 *
 * A running child is steered; an idle child is continued. Both go through
 * the parent spawn API.
 */
export function SpawnSteerInput({
  disabled = false,
  sending = false,
  onSend,
}: {
  disabled?: boolean;
  sending?: boolean;
  onSend: (prompt: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState("");
  const text = value.trim();
  const canSend = Boolean(text) && !disabled && !sending;

  const submit = async () => {
    if (!canSend) return;
    if (await onSend(text)) setValue("");
  };

  return (
    <form
      className="shrink-0 p-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="rounded-[8px] bg-elevation-level-1 p-3 shadow-2xl">
        <div className="flex items-end overflow-clip rounded-[4px] bg-input shadow-concave">
          <textarea
            className={cn(
              "min-h-[36px] max-h-20 min-w-0 flex-1 resize-none border-none bg-transparent",
              "px-3 py-2 text-medium text-input outline-none placeholder:text-input-placeholder",
            )}
            rows={1}
            aria-label={PLACEHOLDER}
            placeholder={PLACEHOLDER}
            disabled={disabled || sending}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key !== "Enter" || event.shiftKey) return;
              event.preventDefault();
              void submit();
            }}
          />
          <Button
            className="shrink-0"
            size={ButtonSize.Medium}
            variant={ButtonVariant.Primary}
            content={ButtonContent.Icon}
            type="submit"
            disabled={!canSend}
            loading={sending}
            aria-label="Send a message"
          >
            <Icon iconName={IconName.ArrowTop} size={20} />
          </Button>
        </div>
      </div>
    </form>
  );
}
