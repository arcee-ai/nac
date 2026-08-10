import { useState } from "react";

import {
  Button,
  ButtonSize,
  ButtonVariant,
  Popover,
  PopoverPlacement,
  PopoverSize,
  StickyButton,
  TextArea,
  TextAreaSize,
} from "@/app/atoms";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { useCommitWorkspace } from "@/app/services/queries";
import { useRunning } from "@/app/store/runtimeStore";
import type { ChangedFileStat } from "@/app/types/api";

/** Why committing is refused right now, or null when it is free to go. */
function blockedReason(
  running: boolean,
  revision: number | null,
  changedCount: number,
): string | null {
  if (revision != null) {
    return "A revision is open; go back to the working tree to commit.";
  }
  if (running) return "A run is in flight; wait for it to finish.";
  if (changedCount === 0)
    return "Nothing to commit: the checkout matches HEAD.";
  return null;
}

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * The Commit button in the Changes toolbar, opening a message field over the
 * file list. Everything in the checkout goes into the commit, because the panel
 * offers no way to pick a subset. The refusals below are advisory — the server
 * decides for real, since another session may be running in this same checkout.
 */
export function CommitPopover({
  sessionId,
  changed,
  revision,
}: {
  sessionId: string;
  changed: ChangedFileStat[];
  revision: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");

  const isMobile = useIsMobile();
  const running = useRunning();
  const toast = useToast();
  const commit = useCommitWorkspace(sessionId);

  const reason = blockedReason(running, revision, changed.length);
  const additions = changed.reduce(
    (sum, file) => sum + (file.additions ?? 0),
    0,
  );
  const deletions = changed.reduce(
    (sum, file) => sum + (file.deletions ?? 0),
    0,
  );

  const close = () => {
    setOpen(false);
    commit.reset();
  };

  const submit = () => {
    const text = message.trim();
    if (!text || reason || commit.isPending) return;
    commit.mutate(
      { message: text },
      {
        onSuccess: (outcome) => {
          toast.success(
            `Committed ${plural(outcome.files_changed, "file")} as ${outcome.sha.slice(0, 7)}.`,
          );
          setMessage("");
          close();
        },
      },
    );
  };

  return (
    <Popover
      open={open}
      onClose={close}
      // Portalled: the file list clips its overflow, which would cut the panel
      // off a few pixels below the toolbar.
      sticky
      placement={PopoverPlacement.BottomRight}
      size={PopoverSize.Medium}
      content={
        <>
          <TextArea
            autoFocus
            rows={3}
            textAreaSize={TextAreaSize.Small}
            placeholder="Commit message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              // Cmd/Ctrl+Enter commits; plain Enter is a newline, because a
              // commit message may well have several.
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submit();
              }
            }}
          />

          <div className="flex items-center gap-2 p-1 label-micro text-basic-muted">
            <span className="flex-1 min-w-0 truncate">
              Staging {plural(changed.length, "file")}
            </span>
            <span className="code code-small text-success-primary">
              +{additions}
            </span>
            <span className="code code-small text-error-primary">
              -{deletions}
            </span>
          </div>

          {commit.error ? (
            <div className="p-1 label-micro text-error-primary">
              {errorMessage(commit.error)}
            </div>
          ) : null}

          <Button
            size={ButtonSize.Medium}
            variant={ButtonVariant.Primary}
            disabled={!message.trim()}
            loading={commit.isPending}
            onClick={submit}
          >
            Commit
          </Button>
        </>
      }
    >
      {isMobile ? (
        // Floating over the file list on a phone, so it takes the design's
        // 40px pill rather than the toolbar's flat 24px button.
        <StickyButton
          className="shrink-0"
          variant={ButtonVariant.Primary}
          disabled={Boolean(reason)}
          aria-expanded={open}
          title={reason ?? "Commit every change in the checkout"}
          onClick={() => (open ? close() : setOpen(true))}
        >
          Commit
        </StickyButton>
      ) : (
        <Button
          className="max-w-[120px] shrink-0"
          size={ButtonSize.Small}
          variant={ButtonVariant.Primary}
          disabled={Boolean(reason)}
          aria-expanded={open}
          title={reason ?? "Commit every change in the checkout"}
          onClick={() => (open ? close() : setOpen(true))}
        >
          Commit
        </Button>
      )}
    </Popover>
  );
}
