import { useCallback, useRef, useState } from "react";

import { Button, ButtonContent, ButtonVariant, Icon, IconName } from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { useSubmitRun } from "@/app/services/queries";
import { pushLocalEvent, useRunning } from "@/app/store/runtimeStore";

const MAX_HEIGHT_PX = 200;

export function PromptForm({ sessionId }: { sessionId: string }) {
  const [value, setValue] = useState("");
  const running = useRunning();
  const toast = useToast();
  const submitRun = useSubmitRun();
  const ref = useRef<HTMLTextAreaElement>(null);

  const busy = submitRun.isPending || running;

  const submit = useCallback(async () => {
    const prompt = value.trim();
    if (!prompt || busy) return;
    try {
      await submitRun.mutateAsync({ id: sessionId, prompt });
      pushLocalEvent("run", `▶ submitted: ${prompt.slice(0, 80)}`);
      setValue("");
      if (ref.current) ref.current.style.height = "auto";
    } catch (error) {
      const message = errorMessage(error);
      pushLocalEvent("error", `submit failed: ${message}`, true);
      toast.error(`Failed to send: ${message}`);
    }
  }, [value, busy, sessionId, submitRun, toast]);

  return (
    <form
      className="shrink-0 border-t border-primary p-3 flex items-end gap-2 bg-elevation-ground"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <textarea
        ref={ref}
        className={cn(
          "input rounded-[8px] px-3 py-2 resize-none flex-grow font-normal leading-relaxed",
          "min-h-[44px] max-h-[200px]",
        )}
        rows={1}
        placeholder={
          running ? "Run in progress…" : "Type a message…  (Cmd/Ctrl+Enter to send)"
        }
        spellCheck={false}
        value={value}
        disabled={busy}
        onChange={(e) => {
          setValue(e.target.value);
          const el = e.target;
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
        }}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter sends; plain Enter inserts a newline, as in the old UI.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <Button
        type="submit"
        variant={ButtonVariant.Primary}
        content={ButtonContent.Icon}
        loading={busy}
        disabled={!value.trim()}
        aria-label="Send"
      >
        <Icon iconName={IconName.ArrowRight} />
      </Button>
    </form>
  );
}
