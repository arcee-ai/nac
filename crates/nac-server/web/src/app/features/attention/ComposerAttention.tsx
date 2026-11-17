import { useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";

import {
  BottomSheet,
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
} from "@/app/atoms";
import {
  usePermissionQueue,
  type PermissionQueueEntry,
} from "@/app/features/permissions/usePermissionQueue";
import { QuestionForm } from "@/app/features/questions/QuestionControls";
import { useQuestionAttention } from "@/app/features/questions/useQuestionAttention";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import type { PermissionReply, QuestionRecord } from "@/app/types/api";

import { PermissionDecision } from "./PermissionDecision";
import { presentPermission } from "./permissionModel";
import { useAttentionKeys } from "./useAttentionKeys";
import { usePermissionReply } from "./usePermissionReply";

type AttentionItem =
  | { kind: "permission"; key: string; at: number; entry: PermissionQueueEntry }
  | { kind: "question"; key: string; at: number; question: QuestionRecord }
  | { kind: "notice"; key: string; at: number; tone: "status" | "alert"; text: string };

const LAST = Number.MAX_SAFE_INTEGER;

function timeOf(value: number | string): number {
  const at = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(at) ? at : LAST;
}

export interface ComposerAttentionProps {
  sessionId: string;
  /** Read this session's permission broker (direct behaviors only). */
  permissions: boolean;
  /** Read this session's task questions. */
  questions: boolean;
  requesterLabel?: string;
  /** Hoist owned child agents' requests into this card. */
  includeChildren?: boolean;
  /** A child's retries go through its owning primary. */
  parentSessionId?: string;
  poll?: boolean;
  /** The permission sheet is open and presents the same requests. */
  hidden?: boolean;
  /** Opens the full permission sheet on this request. */
  onReviewAll?: (requestKey: string | null) => void;
  /** The last request was denied: hand the keyboard back to the composer. */
  onDenied?: () => void;
}

/**
 * The single stacked card above the composer: whatever needs the user, one at
 * a time and oldest first — permission requests (a child's included), then
 * agent questions as they arrive. Approvals cannot be dismissed, only
 * answered; the replies are the broker's own and stay fail-closed.
 */
export function ComposerAttention({
  sessionId,
  permissions,
  questions: questionsEnabled,
  requesterLabel,
  includeChildren = true,
  parentSessionId,
  poll = true,
  hidden = false,
  onReviewAll,
  onDenied,
}: ComposerAttentionProps) {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const queue = usePermissionQueue(sessionId, permissions, requesterLabel, {
    poll,
    includeChildren,
    parentSessionId,
  });
  const { reply, replying } = usePermissionReply();
  const { questions, notice } = useQuestionAttention(sessionId, questionsEnabled);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [consumedLink, setConsumedLink] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // An exact link (a notification's) shows that request alone and never
  // falls back to another one, until it is answered or put aside.
  const requested = searchParams.get("permission_request");
  const linkKey = requested ? `${sessionId}:${location.key}:${requested}` : null;
  const exactLink = permissions && linkKey !== null && consumedLink !== linkKey;
  const requests = exactLink
    ? queue.requests.filter(
        (entry) => entry.scope.sessionId === sessionId && entry.request.id === requested,
      )
    : searchParams.has("question_request") || searchParams.has("review_request")
      ? []
      : queue.requests;
  const brokersSettled = queue.scopes.every((scope) => !scope.query.isPending);

  const items: AttentionItem[] = [
    ...requests.map((entry): AttentionItem => ({
      kind: "permission",
      key: `permission:${entry.key}`,
      at: timeOf(entry.request.created_at_epoch_ms),
      entry,
    })),
    ...(exactLink || searchParams.has("review_request") ? [] : questions).map(
      (question): AttentionItem => ({
        kind: "question",
        key: `question:${question.request.request_id}:${question.revision}`,
        at: timeOf(question.created_at),
        question,
      }),
    ),
  ].sort((left, right) => left.at - right.at);
  if (exactLink && requests.length === 0 && brokersSettled) {
    items.unshift({
      kind: "notice",
      key: `notice:permission:${linkKey}`,
      at: 0,
      tone: "status",
      text: "This permission request is no longer pending or is unavailable. Refresh the task to inspect its current state.",
    });
  }
  if (notice) {
    items.push({ kind: "notice", key: "notice:question", at: LAST, ...notice });
  }

  const index = Math.max(
    0,
    items.findIndex((item) => item.key === currentKey),
  );
  const current = items[index] ?? null;
  const permission = current?.kind === "permission" ? current.entry : null;
  const visible = current !== null && !hidden;
  const collapsed = isMobile && !sheetOpen;

  const answer = async (choice: PermissionReply) => {
    if (!permission) return;
    const last = items.filter((item) => item.kind !== "notice").length === 1;
    const answered = await reply(permission, choice);
    if (!answered) return;
    if (exactLink && linkKey) setConsumedLink(linkKey);
    if (last) setSheetOpen(false);
    if (choice === "reject" && last) onDenied?.();
  };

  useAttentionKeys(visible && !collapsed && permission !== null && replying === null, (key) => {
    if (key === "Enter") {
      void answer("once");
      return true;
    }
    if (key === "d" || key === "D") {
      void answer("reject");
      return true;
    }
    return false;
  });

  // The card takes the keyboard when it appears, unless something is being
  // written: an empty composer is not writing, a draft is.
  const permissionKey = permission ? current?.key : null;
  useEffect(() => {
    if (!permissionKey || isMobile || hidden) return;
    const active = document.activeElement;
    const idle =
      !active ||
      active === document.body ||
      (active instanceof HTMLTextAreaElement &&
        active.hasAttribute("data-nac-retained-draft") &&
        active.value === "");
    if (idle) cardRef.current?.focus({ preventScroll: true });
  }, [permissionKey, isMobile, hidden]);

  if (!visible) return null;

  const count = items.length;
  const heading =
    current.kind === "permission"
      ? "Approval needed"
      : current.kind === "question"
        ? "Question"
        : "Attention";
  const summary =
    current.kind === "permission"
      ? presentPermission(current.entry.request).title
      : current.kind === "question"
        ? current.question.request.text
        : current.text;

  const body = (touch: boolean) => (
    <AttentionBody
      item={current}
      sessionId={sessionId}
      requesterLabel={requesterLabel}
      replying={replying}
      onReply={(choice) => void answer(choice)}
      onDismissNotice={() => {
        if (current.kind === "notice" && current.key.startsWith("notice:permission") && linkKey) {
          setConsumedLink(linkKey);
        }
      }}
      touch={touch}
    />
  );

  const card = (touch: boolean) => (
    <div
      ref={touch ? undefined : cardRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-label={
        current.kind === "permission"
          ? "Permission required"
          : current.kind === "question"
            ? "Question from the agent"
            : "Attention"
      }
      className={cn(
        "relative min-w-0 overflow-hidden bg-elevation-level-1 outline-none",
        touch ? "" : "fade-down rounded-card border border-[var(--f-amber-line)] shadow-lg",
        "motion-reduce:animate-none",
      )}
    >
      {touch ? null : (
        <>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[var(--f-amber-wash)] opacity-40"
          />
          <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-[var(--f-amber)]" />
        </>
      )}
      <div className={cn("relative flex min-w-0 flex-col gap-3", touch ? "px-4 pb-2" : "p-4 pl-5")}>
        <div className="flex min-h-6 items-center gap-2">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--f-amber)]" />
          <span className="type-meta-strong whitespace-nowrap text-[var(--f-amber-text)]">
            {heading}
          </span>
          {count > 1 ? (
            <span
              className="type-meta tabular whitespace-nowrap text-basic-tertiary"
              aria-live="polite"
            >
              {index + 1} of {count}
            </span>
          ) : null}
          <span className="flex-1" />
          {count > 1 ? (
            <span className="flex items-center">
              <Button
                size={touch ? ButtonSize.Large : ButtonSize.Small}
                variant={ButtonVariant.Ghost}
                content={ButtonContent.Icon}
                aria-label="Previous request"
                disabled={index === 0}
                onClick={() => setCurrentKey(items[index - 1]?.key ?? null)}
              >
                <Icon iconName={IconName.Left} size={16} />
              </Button>
              <Button
                size={touch ? ButtonSize.Large : ButtonSize.Small}
                variant={ButtonVariant.Ghost}
                content={ButtonContent.Icon}
                aria-label="Next request"
                disabled={index === count - 1}
                onClick={() => setCurrentKey(items[index + 1]?.key ?? null)}
              >
                <Icon iconName={IconName.Right} size={16} />
              </Button>
            </span>
          ) : null}
          {permission && onReviewAll ? (
            <Button
              size={touch ? ButtonSize.Large : ButtonSize.Small}
              variant={ButtonVariant.Ghost}
              onClick={() => {
                setSheetOpen(false);
                onReviewAll(permission?.key ?? null);
              }}
            >
              Review all
            </Button>
          ) : null}
        </div>
        {body(touch)}
      </div>
    </div>
  );

  if (!isMobile) return card(false);

  return (
    <>
      <button
        type="button"
        aria-expanded={sheetOpen}
        aria-haspopup="dialog"
        onClick={() => setSheetOpen(true)}
        className="fade-down flex min-h-11 w-full min-w-0 items-center gap-2 rounded-pill border border-[var(--f-amber-line)] bg-elevation-level-1 px-4 text-left shadow-md motion-reduce:animate-none"
      >
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--f-amber)]" />
        <span className="type-label shrink-0 text-[var(--f-amber-text)]">{heading}</span>
        <span aria-hidden className="text-basic-muted">
          ·
        </span>
        <span className="type-body-chrome min-w-0 flex-1 truncate text-basic-primary">
          {summary}
        </span>
        {count > 1 ? (
          <span className="type-meta tabular shrink-0 text-basic-tertiary">
            {index + 1} of {count}
          </span>
        ) : null}
        <Icon iconName={IconName.Top} size={16} className="shrink-0 text-basic-tertiary" />
      </button>
      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} className="!max-h-[88dvh]">
        {card(true)}
      </BottomSheet>
    </>
  );
}

function AttentionBody({
  item,
  sessionId,
  requesterLabel,
  replying,
  onReply,
  onDismissNotice,
  touch,
}: {
  item: AttentionItem;
  sessionId: string;
  requesterLabel?: string;
  replying: ReturnType<typeof usePermissionReply>["replying"];
  onReply: (choice: PermissionReply) => void;
  onDismissNotice: () => void;
  touch: boolean;
}) {
  if (item.kind === "permission") {
    return (
      <PermissionDecision
        key={item.key}
        entry={item.entry}
        requester={item.entry.scope.label ?? requesterLabel ?? "this session"}
        replying={replying}
        onReply={onReply}
        showKeys={!touch}
        touch={touch}
      />
    );
  }
  if (item.kind === "question") {
    return (
      <QuestionForm
        key={item.key}
        sessionId={sessionId}
        question={item.question}
        shortcuts={!touch}
        touch={touch}
        bare
      />
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p
        role={item.tone}
        className={cn(
          "type-body-chrome min-w-0 flex-1",
          item.tone === "alert" ? "text-error-primary" : "text-basic-secondary",
        )}
      >
        {item.text}
      </p>
      {item.key.startsWith("notice:permission") ? (
        <Button size={ButtonSize.Small} variant={ButtonVariant.Ghost} onClick={onDismissNotice}>
          Dismiss
        </Button>
      ) : null}
    </div>
  );
}
