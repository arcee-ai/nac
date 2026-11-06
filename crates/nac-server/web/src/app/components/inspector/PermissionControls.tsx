import { useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Modal,
  ModalSize,
  Radio,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { toRunError } from "@/app/lib/providerError";
import {
  useAuthorizePermissionReviewRetry,
  useDeletePermissionGrant,
  useReplyPermission,
  useSetPermissionApprovalMode,
} from "@/app/services/queries";
import type {
  PermissionApprovalMode,
  PermissionGrantRecord,
  PermissionReply,
  SessionBehavior,
} from "@/app/types/api";

import { useDelegatedPermissionStream } from "@/app/hooks/useSessionStream";
import { usePermissionQueue } from "@/app/features/permissions/usePermissionQueue";

import { PermissionReviewRow, PermissionReviewStatus } from "./PermissionReviews";

const MODE_OPTIONS: {
  mode: PermissionApprovalMode;
  name: string;
  description: string;
}[] = [
  {
    mode: "manual",
    name: "Manual",
    description: "Each request pauses until you approve or deny it.",
  },
  {
    mode: "auto_approve",
    name: "Approve all",
    description:
      "Automatically allows ordinary requests after they reach the permission broker. Hard and configured denials still apply.",
  },
  {
    mode: "review",
    name: "Approve for me",
    description:
      "Eligible requests are reviewed automatically, and routine ones are allowed once. Ineligible requests still ask you. A rejected, uncertain or unavailable review leaves the action unexecuted and returns it to the agent; it does not open a manual prompt. You can switch to Manual to decide requests yourself. Uses your Arcee sign-in or Arcee API key.",
  },
];

function modeName(mode: PermissionApprovalMode | undefined): string {
  return MODE_OPTIONS.find((option) => option.mode === mode)?.name ?? "Manual";
}

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
}

/** Subscription lifetime is independent of dialog visibility and request selection. */
function ChildPermissionBridge({ sessionId, running }: { sessionId: string; running: boolean }) {
  useDelegatedPermissionStream(sessionId, running);
  return null;
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
    <div className="flex items-start gap-3 rounded-[4px] bg-elevation-level-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="tag-label uppercase text-basic-secondary">{grant.action}</span>
          <span className="tag-label uppercase text-basic-tertiary">{grant.backend}</span>
        </div>
        <div className="mt-1 break-all code code-small text-basic-primary">{grant.resource}</div>
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

/** Direct-session permission prompt and remembered-grant manager. */
export function PermissionControls({
  sessionId,
  behavior,
  label = "Permissions",
  autoApprovalAvailable = true,
  requesterLabel,
  retryParentSessionId,
  poll = true,
  compact = false,
}: PermissionControlsProps) {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const requestedPermission = searchParams.get("permission_request");
  const direct = behavior === "direct" || behavior === "direct-with-orchestrator";
  const queue = usePermissionQueue(sessionId, direct, requesterLabel, {
    poll,
    includeChildren: autoApprovalAvailable,
    parentSessionId: retryParentSessionId,
  });
  const permissions = queue.parent;
  const replyPermission = useReplyPermission();
  const setApprovalMode = useSetPermissionApprovalMode();
  const deleteGrant = useDeletePermissionGrant();
  const authorizeRetry = useAuthorizePermissionReviewRetry();
  const toast = useToast();
  const requests = queue.requests;
  const grants = queue.scopes.flatMap((scope) => scope.query.data?.grants ?? []);
  const reviews = queue.reviews;
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
  const [manuallyOpen, setManuallyOpen] = useState(false);
  const [dismissedRequests, setDismissedRequests] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [deletingGrant, setDeletingGrant] = useState<string | null>(null);
  const [authorizingReview, setAuthorizingReview] = useState<string | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<{ scope: string; key: string } | null>(
    null,
  );
  const selectionScope = `${sessionId}:${location.key}`;
  const identity = JSON.stringify(requests.map((entry) => entry.key));
  // Each newly observed ask gets one automatic presentation. Closing the
  // dialog records that exact request set; a later request changes the
  // identity and opens it again without effect-driven state synchronization.
  const exactRequestKey = requestedPermission
    ? `request:${selectionScope}:${requestedPermission}`
    : null;
  const open =
    manuallyOpen ||
    (exactRequestKey
      ? dismissedRequests !== exactRequestKey
      : Boolean(requests.length && identity !== dismissedRequests));
  const close = () => {
    setDismissedRequests(exactRequestKey ?? identity);
    setManuallyOpen(false);
  };

  if (!direct) return null;

  const selected =
    requests.find(
      (entry) => selectedRequest?.scope === selectionScope && entry.key === selectedRequest.key,
    ) ??
    (requestedPermission
      ? requests.find(
          (entry) =>
            entry.scope.sessionId === sessionId && entry.request.id === requestedPermission,
        )
      : requests[0]) ??
    null;
  const active = selected?.request ?? null;
  const requester = selected?.scope.label ?? requesterLabel ?? "this session";
  const requestUnavailable = selected?.scope.query.isError || selected?.scope.query.isPending;
  const busy = replyingTo !== null;
  const rememberable = active?.resources.some((resource) => resource.save_resource) ?? false;

  const reply = async (choice: PermissionReply) => {
    if (!active || !selected || busy || requestUnavailable) return;
    setReplyingTo(selected.key);
    try {
      await replyPermission.mutateAsync({
        sessionId: selected.scope.sessionId,
        requestId: active.id,
        reply: choice,
      });
      if (requests.length === 1) close();
    } catch (error) {
      toast.error(`Unable to answer permission request: ${errorMessage(toRunError(error))}`);
    } finally {
      setReplyingTo(null);
    }
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
    setManuallyOpen(true);
    if (mode === approvalMode) return;
    try {
      await setApprovalMode.mutateAsync({
        sessionId,
        mode,
      });
    } catch (error) {
      toast.error(`Unable to change approval mode: ${errorMessage(toRunError(error))}`);
    }
  };

  const authorize = async (entry: (typeof reviews)[number]) => {
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
          variant={
            requests.length || authorizableCount
              ? ButtonVariant.GhostHighlightedAccent
              : ButtonVariant.Ghost
          }
          content={compact && !requests.length ? ButtonContent.Icon : ButtonContent.IconLeft}
          aria-label={
            inheritedAutoApproval
              ? `${label} — ${autoApprove ? "auto-approve" : currentModeName} inherited; open permissions`
              : autoApprove
                ? "Auto-approve on — open permissions"
                : reviewMode
                  ? `Approve for me enabled${badge} — open permissions`
                  : `${label}${badge}`
          }
          onClick={() => setManuallyOpen(true)}
        >
          <Icon iconName={IconName.Private} size={16} />
          {compact ? null : (
            <>
              <span className="label-micro">{currentModeName}</span>
              {reviewMode && reviewAvailability ? (
                <span className="label-micro text-basic-tertiary">{reviewAvailability}</span>
              ) : null}
            </>
          )}
          {requests.length ? (
            <span className="label-micro">({requests.length} pending)</span>
          ) : null}
        </Button>
      </Tooltip>

      <Modal
        open={open}
        onClose={close}
        size={ModalSize.Wide}
        flush
        title={active ? "Permission required" : "Permissions"}
        subheader={
          active
            ? `${active.tool} requested by ${requester} is paused before execution.`
            : inheritedAutoApproval
              ? autoApprove
                ? "Automatic approval is inherited from the parent session; change it from the parent."
                : `${currentModeName} is inherited from the parent session; change it from the parent.`
              : autoApprove
                ? "Automatic approval is active for this session and its owned child agents."
                : reviewMode
                  ? "Approve for me is enabled for this session and its owned child agents. This setting does not guarantee that the review service is available."
                  : "Remembered access for this session."
        }
        footer={
          active ? (
            <div className="flex w-full flex-wrap justify-end gap-2">
              <Button
                variant={ButtonVariant.SecondaryDestructive}
                loading={
                  replyingTo === selected?.key && replyPermission.variables?.reply === "reject"
                }
                disabled={busy || requestUnavailable}
                onClick={() => void reply("reject")}
              >
                Reject
              </Button>
              <Button
                variant={ButtonVariant.Secondary}
                loading={
                  replyingTo === selected?.key && replyPermission.variables?.reply === "once"
                }
                disabled={busy || requestUnavailable}
                onClick={() => void reply("once")}
              >
                Allow once
              </Button>
              <Button
                variant={ButtonVariant.Primary}
                loading={
                  replyingTo === selected?.key && replyPermission.variables?.reply === "always"
                }
                disabled={busy || requestUnavailable || !rememberable}
                title={
                  rememberable
                    ? "Remember the server-derived narrow access pattern"
                    : "This operation has no safe reusable permission pattern"
                }
                onClick={() => void reply("always")}
              >
                Always allow
              </Button>
            </div>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-5">
          {[
            ...(queue.includeChildren
              ? [
                  {
                    sessionId: "discovery",
                    label: "Child request discovery",
                    query: queue.children,
                  },
                ]
              : []),
            ...queue.scopes,
          ].map(({ sessionId: scopeId, label: scopeLabel, query }) =>
            query.isError ? (
              <div
                key={scopeId}
                role="alert"
                className="rounded-[4px] bg-error-secondary p-3 text-small text-error-primary"
              >
                Permissions could not be loaded for {scopeLabel}. The run remains fail-closed.
                <Button
                  size={ButtonSize.Small}
                  variant={ButtonVariant.Secondary}
                  onClick={() => void query.refetch()}
                >
                  Retry {scopeLabel}
                </Button>
              </div>
            ) : query.isPending ? (
              <div key={scopeId} role="status" className="text-small text-basic-secondary">
                Loading permissions for {scopeLabel}…
              </div>
            ) : null,
          )}
          {requestedPermission && !selected && (
            <p role="status" className="text-small text-basic-secondary">
              This permission request is no longer pending or is unavailable. Refresh the task to
              inspect its current state.
            </p>
          )}
          {requests.length ? (
            <section aria-label="Pending permission requests" className="flex flex-col gap-2">
              <div className="tag-label uppercase text-basic-tertiary">
                Pending requests ({requests.length})
              </div>
              {requests.map((entry) => (
                <Button
                  key={entry.key}
                  variant={
                    entry.key === selected?.key ? ButtonVariant.Secondary : ButtonVariant.Ghost
                  }
                  className="!h-auto min-h-9 min-w-0 !py-2"
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
            <div className="text-small text-basic-secondary">No pending permission requests.</div>
          )}
          {autoApprovalAvailable ? (
            <section
              aria-label="Approval mode"
              role="radiogroup"
              className="flex flex-col gap-3 rounded-[6px] bg-elevation-level-2 p-3"
            >
              {MODE_OPTIONS.map((option) => (
                <Radio
                  key={option.mode}
                  name={`approval-mode-${sessionId}`}
                  aria-label={option.name}
                  checked={approvalMode === option.mode}
                  disabled={
                    setApprovalMode.isPending || permissions.isError || permissions.isPending
                  }
                  onChange={(checked) => {
                    if (checked) void changeApprovalMode(option.mode);
                  }}
                >
                  <div>
                    <div className="text-small font-medium text-basic-primary">{option.name}</div>
                    <div className="mt-1 text-small text-basic-secondary">{option.description}</div>
                  </div>
                </Radio>
              ))}
              <div className="text-small text-basic-tertiary">
                The mode governs this session and all existing or future owned child agents, stays
                saved across restarts and never creates remembered permissions. Separately managed
                orchestrators are not included.
              </div>
            </section>
          ) : null}

          {reviewMode ? (
            <PermissionReviewStatus reviews={reviews.map((entry) => entry.review)} />
          ) : null}
          {reviewMode || reviews.length ? (
            <section aria-label="Automatic reviews">
              <div className="mb-2 tag-label uppercase text-basic-tertiary">Automatic reviews</div>
              <div className="mb-2 text-small text-basic-secondary">
                Blocked actions were returned to the agent unexecuted. Authorizing a retry asks the
                agent to try exactly that action again; it passes policy and a fresh review.
              </div>
              <div className="mb-2 text-small text-basic-tertiary">
                Review history, blocked actions and retry authorizations are temporary. They are
                lost when the server restarts or an idle session is unloaded, including after all
                clients disconnect. The selected mode and recorded human intent remain saved.
              </div>
              {reviews.length === 0 ? (
                <div className="text-small text-basic-secondary">
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
                      <div className="mb-1 break-all text-small text-basic-secondary">
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
              className="rounded-[6px] border border-accent-primary bg-elevation-level-2 p-3"
            >
              <div className="text-small font-medium text-basic-primary">
                {autoApprove ? "Auto-approve" : currentModeName} inherited
              </div>
              <div className="mt-1 text-small text-basic-secondary">
                {autoApprove
                  ? "Ordinary requests from this child agent inherit automatic approval from the parent session."
                  : `Ordinary requests from this child agent follow the parent session’s ${currentModeName} mode.`}{" "}
                Change this mode from the parent session; hard and configured denials still apply.
              </div>
            </section>
          ) : null}

          {active ? (
            <section aria-label="Requested access">
              <div className="mb-2 text-small text-basic-secondary">
                Requested by {requester} ({active.session_id}).{" "}
                {selected?.scope.query.data?.approval_mode === "review"
                  ? "This request is not eligible for automatic review, so it needs your decision. Eligibility also depends on the available human intent and redaction checks."
                  : "Manual approval is effective because automatic approval is off for this session and its owned child agents."}
              </div>
              <div className="mb-2 tag-label uppercase text-basic-tertiary">Requested access</div>
              <div className="flex flex-col gap-2">
                {active.resources.map((resource, index) => (
                  <div
                    key={`${resource.action}:${resource.resource}:${index}`}
                    className="rounded-[4px] bg-elevation-level-2 px-3 py-2"
                  >
                    <div className="tag-label uppercase text-basic-secondary">
                      {resource.action}
                    </div>
                    <div className="mt-1 break-words text-small text-basic-primary">
                      {resource.display}
                    </div>
                    {resource.save_resource ? (
                      <div className="mt-2 break-all code code-small text-basic-tertiary">
                        Always: {resource.save_resource}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
              {requests.length > 1 ? (
                <div className="mt-2 text-small text-basic-secondary">
                  {requests.length - 1} more request{requests.length === 2 ? "" : "s"} waiting.
                </div>
              ) : null}
            </section>
          ) : null}

          <section aria-label="Remembered permissions">
            <div className="mb-2 tag-label uppercase text-basic-tertiary">
              Remembered permissions by session
            </div>
            <div className="mb-3 text-small text-basic-secondary">
              Each grant stays in its original session. A child’s grants never apply to the parent
              or siblings.
            </div>
            {queue.scopes.map((scope) => (
              <section
                key={scope.sessionId}
                aria-label={`Remembered for ${scope.label}`}
                className="mb-4"
              >
                <div className="mb-2 break-all text-small text-basic-secondary">
                  Remembered for {scope.label} ({scope.sessionId})
                </div>
                <div className="flex flex-col gap-2">
                  {scope.sessionId !== sessionId &&
                  scope.query.data?.approval_mode === "auto_approve" ? (
                    <div className="text-small text-basic-secondary">
                      Auto-approve inherited from parent.
                    </div>
                  ) : null}
                  {scope.sessionId !== sessionId && scope.query.data?.approval_mode === "review" ? (
                    <div className="text-small text-basic-secondary">
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
                  <div className="text-small text-basic-secondary">No remembered permissions.</div>
                ) : null}
              </section>
            ))}
          </section>
        </div>
      </Modal>
    </>
  );
}
