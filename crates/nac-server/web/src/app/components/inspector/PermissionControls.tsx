import { useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Drawer,
  Icon,
  IconName,
  Radio,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { MODE_OPTIONS, modeName } from "@/app/features/attention/permissionModel";
import { PermissionDecision } from "@/app/features/attention/PermissionDecision";
import { usePermissionReply } from "@/app/features/attention/usePermissionReply";
import { cn } from "@/app/lib/cn";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { toRunError } from "@/app/lib/providerError";
import {
  useAuthorizePermissionReviewRetry,
  useDeletePermissionGrant,
  useSetPermissionApprovalMode,
} from "@/app/services/queries";
import type {
  PermissionApprovalMode,
  PermissionGrantRecord,
  PermissionReply,
  SessionBehavior,
} from "@/app/types/api";

import { useDelegatedPermissionStream } from "@/app/hooks/useSessionStream";
import {
  usePermissionQueue,
  type PermissionReviewEntry,
} from "@/app/features/permissions/usePermissionQueue";

import { PermissionReviewRow, PermissionReviewStatus } from "./PermissionReviews";

interface PermissionControlsProps {
  sessionId: string;
  behavior: SessionBehavior | null;
  label?: string;
  autoApprovalAvailable?: boolean;
  requesterLabel?: string;
  /** Child retries use its owning primary; mode remains inherited. */
  retryParentSessionId?: string;
  poll?: boolean;
  /** The trigger drops its mode label but keeps any pending count; its accessible name stays. */
  compact?: boolean;
  /** Controlled sheet visibility, for a host whose attention card opens it too. */
  sheetOpen?: boolean;
  onSheetOpenChange?: (open: boolean) => void;
  /** The request a host's "Review all" asked the sheet to show first. */
  focusRequestKey?: string | null;
}

/** Subscription lifetime is independent of sheet visibility and request selection. */
function ChildPermissionBridge({ sessionId, running }: { sessionId: string; running: boolean }) {
  useDelegatedPermissionStream(sessionId, running);
  return null;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="type-meta-strong mb-2 text-basic-secondary">{children}</div>;
}

function GrantRow({
  grant,
  deleting,
  disabled,
  onDelete,
}: {
  grant: PermissionGrantRecord;
  deleting: boolean;
  disabled: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-muted px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="type-tag text-basic-secondary">{grant.action}</span>
          <span className="type-tag text-basic-tertiary">{grant.backend}</span>
        </div>
        <div className="code mt-1 break-all text-[12.5px] text-basic-primary">{grant.resource}</div>
      </div>
      <Button
        size={ButtonSize.Small}
        variant={ButtonVariant.GhostDestructive}
        content={ButtonContent.Icon}
        aria-label={`Forget ${grant.action} permission`}
        loading={deleting}
        disabled={disabled}
        onClick={onDelete}
      >
        <Icon iconName={IconName.Trash} size={16} />
      </Button>
    </div>
  );
}

/**
 * The quiet permission-mode chip under the composer and the sheet it opens:
 * pending requests with their full decision, approval mode, automatic
 * reviews, and remembered grants. The sheet never opens by itself; requests
 * surface in the attention card above the composer instead.
 */
export function PermissionControls({
  sessionId,
  behavior,
  label = "Permissions",
  autoApprovalAvailable = true,
  requesterLabel,
  retryParentSessionId,
  poll = true,
  compact = false,
  sheetOpen,
  onSheetOpenChange,
  focusRequestKey = null,
}: PermissionControlsProps) {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const requestedPermission = searchParams.get("permission_request");
  const requestedReview = searchParams.get("review_request");
  const [dismissedReview, setDismissedReview] = useState<string | null>(null);
  const reviewLink = requestedReview ? `${sessionId}:${location.key}:${requestedReview}` : null;
  const exactReviewLink = reviewLink !== null && dismissedReview !== reviewLink;
  const direct = behavior === "direct";
  const queue = usePermissionQueue(sessionId, direct, requesterLabel, {
    poll,
    includeChildren: autoApprovalAvailable,
    parentSessionId: retryParentSessionId,
  });
  const permissions = queue.parent;
  const setApprovalMode = useSetPermissionApprovalMode();
  const deleteGrant = useDeletePermissionGrant();
  const authorizeRetry = useAuthorizePermissionReviewRetry();
  const { reply, replying } = usePermissionReply();
  const toast = useToast();
  const requests = exactReviewLink ? [] : queue.requests;
  const grants = queue.scopes.flatMap((scope) => scope.query.data?.grants ?? []);
  const reviews = exactReviewLink
    ? queue.reviews.filter(
        (entry) => entry.scope.sessionId === sessionId && entry.review.id === requestedReview,
      )
    : queue.reviews;
  const authorizableCount = reviews.filter((entry) => entry.authorizable).length;
  const approvalMode = permissions.data?.approval_mode ?? "manual";
  const autoApprove = approvalMode === "auto_approve";
  const reviewMode = approvalMode === "review";
  const latestReview = reviews[0]?.review;
  const reviewAvailability = !latestReview
    ? "Not checked"
    : latestReview.outcome === "unavailable"
      ? "Unavailable"
      : !latestReview.outcome
        ? "Reviewing"
        : null;
  const inheritedAutoApproval = approvalMode !== "manual" && !autoApprovalAvailable;
  const [ownOpen, setOwnOpen] = useState(false);
  const open = exactReviewLink || (sheetOpen ?? ownOpen);
  const setOpen = (next: boolean) => {
    if (!next && exactReviewLink) setDismissedReview(reviewLink);
    setOwnOpen(next);
    onSheetOpenChange?.(next);
  };
  const [deletingGrant, setDeletingGrant] = useState<string | null>(null);
  const [authorizingReview, setAuthorizingReview] = useState<string | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<{ scope: string; key: string } | null>(
    null,
  );
  const selectionScope = `${sessionId}:${location.key}`;

  if (!direct) return null;

  // A chosen row wins; then the host's "Review all" request; then an exact
  // link, which never falls back to another request; then the oldest.
  const selected =
    requests.find(
      (entry) => selectedRequest?.scope === selectionScope && entry.key === selectedRequest.key,
    ) ??
    requests.find((entry) => entry.key === focusRequestKey) ??
    (requestedPermission
      ? requests.find(
          (entry) =>
            entry.scope.sessionId === sessionId && entry.request.id === requestedPermission,
        )
      : requests[0]) ??
    null;
  const active = selected?.request ?? null;
  const requester = selected?.scope.label ?? requesterLabel ?? "this session";
  const busy = replying !== null;

  const answer = async (choice: PermissionReply) => {
    if (!selected) return;
    const answered = await reply(selected, choice);
    if (answered && requests.length === 1) setOpen(false);
  };

  const forget = async (scopeId: string, grant: PermissionGrantRecord) => {
    if (deletingGrant) return;
    setDeletingGrant(JSON.stringify([scopeId, grant.id]));
    try {
      await deleteGrant.mutateAsync({ sessionId: scopeId, grantId: grant.id });
    } catch (error) {
      toast.error(`Unable to forget permission: ${errorMessage(toRunError(error))}`);
    } finally {
      setDeletingGrant(null);
    }
  };

  const changeApprovalMode = async (mode: PermissionApprovalMode) => {
    if (mode === approvalMode) return;
    try {
      await setApprovalMode.mutateAsync({ sessionId, mode });
    } catch (error) {
      toast.error(`Unable to change approval mode: ${errorMessage(toRunError(error))}`);
    }
  };

  const authorize = async (entry: PermissionReviewEntry) => {
    if (authorizingReview || entry.scope.query.isError || entry.scope.query.isPending) return;
    setAuthorizingReview(entry.key);
    try {
      await authorizeRetry.mutateAsync({
        sessionId: entry.scope.sessionId,
        reviewId: entry.review.id,
        parentSessionId: entry.scope.parentSessionId,
      });
      toast.success("Retry authorized. The agent will retry it, and it is reviewed again.");
    } catch (error) {
      toast.error(`Unable to authorize retry: ${errorMessage(toRunError(error))}`);
    } finally {
      setAuthorizingReview(null);
    }
  };

  const badge = requests.length
    ? ` (${requests.length})`
    : authorizableCount
      ? ` (${authorizableCount})`
      : grants.length
        ? ` (${grants.length})`
        : "";
  const currentModeName = modeName(approvalMode);
  const modeDescription = inheritedAutoApproval
    ? `This child agent inherits ${currentModeName} from the parent session. Change the mode on the parent.`
    : (MODE_OPTIONS.find((option) => option.mode === approvalMode)?.description ??
      MODE_OPTIONS[0].description);

  return (
    <>
      {queue.records.map((child) => (
        <ChildPermissionBridge
          key={child.child_session_id}
          sessionId={child.child_session_id}
          running={child.status === "running"}
        />
      ))}
      <Tooltip
        title={`Permission: ${currentModeName}`}
        description={modeDescription}
        position={TooltipPosition.TopCenter}
      >
        <Button
          size={ButtonSize.Small}
          variant={ButtonVariant.Ghost}
          content={compact && !requests.length ? ButtonContent.Icon : ButtonContent.IconLeft}
          className={cn("!gap-1.5", compact && "!size-auto !min-h-11 !min-w-11")}
          aria-label={
            inheritedAutoApproval
              ? `${label} — ${autoApprove ? "auto-approve" : currentModeName} inherited; open permissions`
              : autoApprove
                ? "Auto-approve on — open permissions"
                : reviewMode
                  ? `Approve for me enabled${badge} — open permissions`
                  : `${label}${badge}`
          }
          onClick={() => setOpen(true)}
        >
          <Icon iconName={IconName.Private} size={16} />
          {compact ? null : (
            <>
              <span className="type-meta">{currentModeName}</span>
              {reviewMode && reviewAvailability ? (
                <span className="type-meta text-basic-tertiary">{reviewAvailability}</span>
              ) : null}
            </>
          )}
          {requests.length ? (
            <span className="type-meta-strong tabular text-[var(--f-amber-text)]">
              {requests.length} pending
            </span>
          ) : null}
        </Button>
      </Tooltip>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={active ? "Permission required" : "Permissions"}
        bodyClassName="gap-6 px-4 py-4 sm:px-5"
      >
        {active ? null : (
          <p className="type-body-chrome text-basic-secondary">
            {inheritedAutoApproval
              ? autoApprove
                ? "Automatic approval is inherited from the parent session; change it from the parent."
                : `${currentModeName} is inherited from the parent session; change it from the parent.`
              : autoApprove
                ? "Automatic approval is active for this session and its owned child agents."
                : reviewMode
                  ? "Approve for me is enabled for this session and its owned child agents. This setting does not guarantee that the review service is available."
                  : "Remembered access for this session."}
          </p>
        )}
        {[
          ...(queue.includeChildren
            ? [{ sessionId: "discovery", label: "Child request discovery", query: queue.children }]
            : []),
          ...queue.scopes,
        ].map(({ sessionId: scopeId, label: scopeLabel, query }) =>
          query.isError ? (
            <div
              key={scopeId}
              role="alert"
              className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--f-red-line)] bg-[var(--f-red-wash)] p-3 type-body-chrome text-error-primary"
            >
              <span className="min-w-0 flex-1">
                Permissions could not be loaded for {scopeLabel}. The run remains fail-closed.
              </span>
              <Button
                size={ButtonSize.Small}
                variant={ButtonVariant.Secondary}
                onClick={() => void query.refetch()}
              >
                Retry {scopeLabel}
              </Button>
            </div>
          ) : query.isPending ? (
            <div key={scopeId} role="status" className="type-body-chrome text-basic-secondary">
              Loading permissions for {scopeLabel}…
            </div>
          ) : null,
        )}
        {requestedPermission && !selected && (
          <p role="status" className="type-body-chrome text-basic-secondary">
            This permission request is no longer pending or is unavailable. Refresh the task to
            inspect its current state.
          </p>
        )}
        {requests.length ? (
          <section aria-label="Pending permission requests" className="flex flex-col gap-1">
            <SectionLabel>Pending requests ({requests.length})</SectionLabel>
            {requests.map((entry) => (
              <Button
                key={entry.key}
                variant={
                  entry.key === selected?.key
                    ? ButtonVariant.SecondaryHighlighted
                    : ButtonVariant.Ghost
                }
                className="!h-auto min-h-9 min-w-0 !justify-start !rounded-md !py-2"
                aria-pressed={entry.key === selected?.key}
                disabled={busy}
                onClick={() => setSelectedRequest({ scope: selectionScope, key: entry.key })}
              >
                <span className="min-w-0 flex-1 whitespace-normal text-left [overflow-wrap:anywhere]">
                  {entry.scope.label} ({entry.scope.sessionId}): {entry.request.tool}
                </span>
              </Button>
            ))}
          </section>
        ) : (
          <div className="type-body-chrome text-basic-secondary">
            No pending permission requests.
          </div>
        )}

        {selected ? (
          <div className="rounded-card border border-[var(--f-amber-line)] p-4">
            <PermissionDecision
              key={selected.key}
              entry={selected}
              requester={requester}
              replying={replying}
              onReply={(choice) => void answer(choice)}
              context={
                <p className="type-meta text-basic-secondary">
                  Requested by {requester} ({selected.request.session_id}).{" "}
                  {selected.scope.query.data?.approval_mode === "review"
                    ? "This request is not eligible for automatic review, so it needs your decision. Eligibility also depends on the available human intent and redaction checks."
                    : "Manual approval is effective because automatic approval is off for this session and its owned child agents."}
                  {requests.length > 1
                    ? ` ${requests.length - 1} more request${requests.length === 2 ? "" : "s"} waiting.`
                    : ""}
                </p>
              }
            />
          </div>
        ) : null}

        {autoApprovalAvailable && !exactReviewLink ? (
          <section aria-label="Approval mode" role="radiogroup" className="flex flex-col gap-3">
            <SectionLabel>Approval mode</SectionLabel>
            {MODE_OPTIONS.map((option) => (
              <Radio
                key={option.mode}
                name={`approval-mode-${sessionId}`}
                aria-label={option.name}
                checked={approvalMode === option.mode}
                disabled={setApprovalMode.isPending || permissions.isError || permissions.isPending}
                onChange={(checked) => {
                  if (checked) void changeApprovalMode(option.mode);
                }}
              >
                <div>
                  <div className="type-label text-basic-primary">{option.name}</div>
                  <div className="type-meta mt-0.5 text-basic-secondary">{option.description}</div>
                </div>
              </Radio>
            ))}
            <div className="type-meta text-basic-tertiary">
              The mode governs this session and all existing or future owned child agents, stays
              saved across restarts and never creates remembered permissions.
            </div>
          </section>
        ) : null}

        {reviewMode ? (
          <PermissionReviewStatus reviews={reviews.map((entry) => entry.review)} />
        ) : null}
        {exactReviewLink && reviews.length === 0 ? (
          <p role="status" className="type-body-chrome text-basic-secondary">
            This automatic review is no longer available. Refresh the task to inspect its current
            state.
          </p>
        ) : null}
        {reviewMode || reviews.length ? (
          <section aria-label="Automatic reviews">
            <SectionLabel>Automatic reviews</SectionLabel>
            <div className="type-meta mb-2 text-basic-secondary">
              Blocked actions were returned to the agent unexecuted. Authorizing a retry asks the
              agent to try exactly that action again; it passes policy and a fresh review.
            </div>
            <div className="type-meta mb-2 text-basic-tertiary">
              Review history, blocked actions and retry authorizations are temporary. They are lost
              when the server restarts or an idle session is unloaded, including after all clients
              disconnect. The selected mode and recorded human intent remain saved.
            </div>
            {reviews.length === 0 ? (
              <div className="type-body-chrome text-basic-secondary">
                No reviews are retained for this session.
              </div>
            ) : null}
            <div className="flex flex-col gap-2">
              {reviews.map((entry) => {
                const retryUnavailable =
                  entry.scope.parentSessionId || autoApprovalAvailable
                    ? undefined
                    : "Open the child's parent to authorize a retry or switch the parent to Manual.";
                return (
                  <section key={entry.key} aria-label={`Review for ${entry.scope.label}`}>
                    <div className="type-meta mb-1 break-all text-basic-secondary">
                      {entry.scope.label} ({entry.scope.sessionId})
                    </div>
                    <PermissionReviewRow
                      review={entry.review}
                      authorizable={entry.authorizable}
                      authorizing={authorizingReview === entry.key}
                      disabled={
                        authorizingReview !== null ||
                        entry.scope.query.data?.approval_mode !== "review" ||
                        entry.scope.query.isError ||
                        entry.scope.query.isPending ||
                        Boolean(retryUnavailable)
                      }
                      disabledReason={retryUnavailable}
                      onAuthorize={() => void authorize(entry)}
                    />
                  </section>
                );
              })}
            </div>
            {reviewMode && autoApprovalAvailable ? (
              <div className="mt-2 flex justify-end">
                <Button
                  size={ButtonSize.Small}
                  variant={ButtonVariant.Ghost}
                  disabled={
                    setApprovalMode.isPending || permissions.isError || permissions.isPending
                  }
                  onClick={() => void changeApprovalMode("manual")}
                >
                  Switch to Manual
                </Button>
              </div>
            ) : null}
          </section>
        ) : null}

        {inheritedAutoApproval ? (
          <section
            aria-label="Inherited automatic approval mode"
            className="rounded-md border border-tertiary p-3"
          >
            <div className="type-label text-basic-primary">
              {autoApprove ? "Auto-approve" : currentModeName} inherited
            </div>
            <div className="type-meta mt-1 text-basic-secondary">
              {autoApprove
                ? "Ordinary requests from this child agent inherit automatic approval from the parent session."
                : `Ordinary requests from this child agent follow the parent session’s ${currentModeName} mode.`}{" "}
              Change this mode from the parent session; hard and configured denials still apply.
            </div>
          </section>
        ) : null}

        <section aria-label="Remembered permissions">
          <SectionLabel>Remembered permissions by session</SectionLabel>
          <div className="type-meta mb-3 text-basic-secondary">
            Each grant stays in its original session. A child’s grants never apply to the parent or
            siblings.
          </div>
          {queue.scopes.map((scope) => (
            <section
              key={scope.sessionId}
              aria-label={`Remembered for ${scope.label}`}
              className="mb-4"
            >
              <div className="type-meta mb-2 break-all text-basic-secondary">
                Remembered for {scope.label} ({scope.sessionId})
              </div>
              <div className="flex flex-col gap-2">
                {scope.sessionId !== sessionId &&
                scope.query.data?.approval_mode === "auto_approve" ? (
                  <div className="type-body-chrome text-basic-secondary">
                    Auto-approve inherited from parent.
                  </div>
                ) : null}
                {scope.sessionId !== sessionId && scope.query.data?.approval_mode === "review" ? (
                  <div className="type-body-chrome text-basic-secondary">
                    Approve for me inherited from parent.
                  </div>
                ) : null}
                {(scope.query.data?.grants ?? []).map((grant) => (
                  <GrantRow
                    key={grant.id}
                    grant={grant}
                    deleting={deletingGrant === JSON.stringify([scope.sessionId, grant.id])}
                    disabled={
                      deletingGrant !== null || scope.query.isError || scope.query.isPending
                    }
                    onDelete={() => void forget(scope.sessionId, grant)}
                  />
                ))}
              </div>
              {!scope.query.isPending &&
              !scope.query.isError &&
              !scope.query.data?.grants.length ? (
                <div className="type-body-chrome text-basic-secondary">
                  No remembered permissions.
                </div>
              ) : null}
            </section>
          ))}
        </section>
      </Drawer>
    </>
  );
}
