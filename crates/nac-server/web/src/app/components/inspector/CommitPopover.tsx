import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
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
  if (changedCount === 0) return "Nothing to commit: the checkout matches HEAD.";
  return null;
}

/** The commit chord as this platform spells it. */
const COMMIT_KEYS =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘↩" : "Ctrl+↩";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

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
  const { useRunning } = useNativeRuntime().stores.runtimeStore;

  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");

  const isMobile = useIsMobile();
  const running = useRunning(sessionId);
  const toast = useToast();
  const commit = useCommitWorkspace(sessionId);

  const reason = blockedReason(running, revision, changed.length);
  const additions = changed.reduce((sum, file) => sum + (file.additions ?? 0), 0);
  const deletions = changed.reduce((sum, file) => sum + (file.deletions ?? 0), 0);

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

  const summary = (
    <span className="flex min-w-0 items-center gap-2 type-meta text-basic-tertiary">
      <span className="min-w-0 truncate">{plural(changed.length, "file")}</span>
      <span aria-hidden className="tabular text-[var(--f-green-text)]">
        +{additions}
      </span>
      <span aria-hidden className="tabular text-[var(--f-red-text)]">
        −{deletions}
      </span>
      <span className="sr-only">
        {additions} additions, {deletions} deletions
      </span>
    </span>
  );

  return (
    <Popover
      open={open}
      onClose={close}
      // Portalled: the file list clips its overflow, which would cut the panel
      // off a few pixels below the toolbar.
      sticky
      placement={PopoverPlacement.BottomRight}
      size={PopoverSize.Medium}
      panelClassName="!gap-3 !p-3"
      sheetClassName="gap-3 px-4 pb-4"
      content={
        <>
          <div className="flex items-baseline justify-between gap-3 px-0.5">
            <span className="type-strong text-basic-primary">Commit all changes</span>
            {summary}
          </div>
          <TextArea
            autoFocus
            rows={3}
            textAreaSize={isMobile ? TextAreaSize.Medium : TextAreaSize.Small}
            textAreaClassName="!rounded-lg !p-2.5 type-body-chrome max-md:!text-base resize-none"
            aria-label="Commit message"
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

          {commit.error ? (
            <p role="alert" className="px-0.5 type-meta text-error-primary">
              {errorMessage(commit.error)}
            </p>
          ) : null}

          <div className="flex items-center gap-3 px-0.5">
            <span className="flex-1 min-w-0 truncate type-meta text-basic-muted">
              {isMobile ? "Stages every change in the checkout" : `${COMMIT_KEYS} to commit`}
            </span>
            <Button
              size={isMobile ? ButtonSize.Large : ButtonSize.Small}
              variant={ButtonVariant.Primary}
              className="shrink-0"
              disabled={!message.trim()}
              loading={commit.isPending}
              onClick={submit}
            >
              Commit
            </Button>
          </div>
        </>
      }
    >
      {isMobile ? (
        // A phone's list header draws it as a 44px primary pill beside the
        // listing pills.
        <StickyButton
          className="shrink-0 !h-11"
          buttonClassName="!h-11 !min-w-11"
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
