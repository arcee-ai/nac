import { Button, ButtonContent, ButtonSize, ButtonVariant } from "@/app/atoms";
import { useLoadOlderMessages } from "@/app/services/queries";

/**
 * The snapshot carries only the newest messages, so the actions and threads of
 * earlier prompts join the list once their messages load, as in the chat.
 */
export function InsightsLoadOlder({ sessionId }: { sessionId: string }) {
  const older = useLoadOlderMessages(sessionId);
  const load = () => older.mutate();
  return (
    <div className="flex flex-col items-start gap-2 p-1">
      <Button
        variant={ButtonVariant.Ghost}
        size={ButtonSize.Small}
        content={ButtonContent.Text}
        disabled={older.isPending}
        onClick={load}
      >
        {older.isPending ? "Loading…" : "Load older actions"}
      </Button>
      {older.isError ? (
        <div role="alert" className="flex items-center gap-2 text-basic-muted label-small">
          <span>Couldn’t load older actions.</span>
          <Button
            variant={ButtonVariant.Ghost}
            size={ButtonSize.Small}
            content={ButtonContent.Text}
            onClick={load}
          >
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}
