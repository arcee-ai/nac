import { useState } from "react";

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
  useSessionPermissions,
} from "@/app/services/queries";
import type {
  PermissionApprovalMode,
  PermissionGrantRecord,
  PermissionReply,
  PermissionRequest,
  PermissionReview,
  SessionBehavior,
} from "@/app/types/api";

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
}

function requestIdentity(requests: PermissionRequest[]): string {
  return requests.map((request) => request.id).join(":");
}

function GrantRow({
  grant,
  deleting,
  onDelete,
}: {
  grant: PermissionGrantRecord;
  deleting: boolean;
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
}: PermissionControlsProps) {
  const direct = behavior === "direct" || behavior === "direct-with-orchestrator";
  const permissions = useSessionPermissions(sessionId, direct);
  const replyPermission = useReplyPermission();
  const setApprovalMode = useSetPermissionApprovalMode();
  const deleteGrant = useDeletePermissionGrant();
  const authorizeRetry = useAuthorizePermissionReviewRetry();
  const toast = useToast();
  const requests = permissions.data?.requests ?? [];
  const grants = permissions.data?.grants ?? [];
  const reviews = permissions.data?.reviews ?? [];
  const authorizableReviews = new Set(permissions.data?.authorizable_review_ids ?? []);
  // Retries are delivered through the primary session's own inbox; a child
  // agent's blocked action cannot be retried from here.
  const retryUnavailable = autoApprovalAvailable
    ? undefined
    : "Retry is available only in the primary session. Switch the parent to Manual to approve this child's actions.";
  const approvalMode = permissions.data?.approval_mode ?? "manual";
  const autoApprove = approvalMode === "auto_approve";
  const reviewMode = approvalMode === "review";
  const reviewAvailability = !reviews.length
    ? "Not checked"
    : reviews[0].outcome === "unavailable"
      ? "Unavailable"
      : !reviews[0].outcome
        ? "Reviewing"
        : null;
  const inheritedAutoApproval = approvalMode !== "manual" && !autoApprovalAvailable;
  const [manuallyOpen, setManuallyOpen] = useState(false);
  const [dismissedRequests, setDismissedRequests] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [deletingGrant, setDeletingGrant] = useState<string | null>(null);
  const [authorizingReview, setAuthorizingReview] = useState<string | null>(null);
  const identity = requestIdentity(requests);
  // Each newly observed ask gets one automatic presentation. Closing the
  // dialog records that exact request set; a later request changes the
  // identity and opens it again without effect-driven state synchronization.
  const open = manuallyOpen || Boolean(identity && identity !== dismissedRequests);
  const close = () => {
    setDismissedRequests(identity);
    setManuallyOpen(false);
  };

  if (!direct) return null;

  const active = requests[0] ?? null;
  const rememberable = active?.resources.some((resource) => resource.save_resource) ?? false;

  const reply = async (choice: PermissionReply) => {
    if (!active || replyingTo) return;
    setReplyingTo(active.id);
    try {
      await replyPermission.mutateAsync({
        sessionId,
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

  const forget = async (grant: PermissionGrantRecord) => {
    if (deletingGrant) return;
    setDeletingGrant(grant.id);
    try {
      await deleteGrant.mutateAsync({ sessionId, grantId: grant.id });
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
      await setApprovalMode.mutateAsync({ sessionId, mode });
    } catch (error) {
      // A failed selection leaves the previous mode in place; the server
      // explains why, for example a missing Arcee sign-in or API key.
      toast.error(`Unable to change approval mode: ${errorMessage(toRunError(error))}`);
    }
  };

  const authorize = async (review: PermissionReview) => {
    if (authorizingReview) return;
    setAuthorizingReview(review.id);
    try {
      await authorizeRetry.mutateAsync({ sessionId, reviewId: review.id });
      toast.success("Retry authorized. The agent will retry it, and it is reviewed again.");
    } catch (error) {
      toast.error(`Unable to authorize retry: ${errorMessage(toRunError(error))}`);
    } finally {
      setAuthorizingReview(null);
    }
  };

  const badge = requests.length
    ? ` (${requests.length})`
    : authorizableReviews.size
      ? ` (${authorizableReviews.size})`
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
      <Tooltip
        title={`Permission: ${currentModeName}`}
        description={modeDescription}
        position={TooltipPosition.TopCenter}
      >
        <Button
          size={ButtonSize.Small}
          variant={
            requests.length || authorizableReviews.size
              ? ButtonVariant.GhostHighlightedAccent
              : ButtonVariant.Ghost
          }
          content={ButtonContent.IconLeft}
          className="pr-3"
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
          <span className="label-micro">{currentModeName}</span>
          {reviewMode && reviewAvailability ? (
            <span className="label-micro text-basic-tertiary">{reviewAvailability}</span>
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
            ? `${active.tool} requested by ${requesterLabel ?? "this session"} is paused before execution.`
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
                loading={replyingTo === active.id && replyPermission.variables?.reply === "reject"}
                disabled={replyingTo !== null}
                onClick={() => void reply("reject")}
              >
                Reject
              </Button>
              <Button
                variant={ButtonVariant.Secondary}
                loading={replyingTo === active.id && replyPermission.variables?.reply === "once"}
                disabled={replyingTo !== null}
                onClick={() => void reply("once")}
              >
                Allow once
              </Button>
              <Button
                variant={ButtonVariant.Primary}
                loading={replyingTo === active.id && replyPermission.variables?.reply === "always"}
                disabled={replyingTo !== null || !rememberable}
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
        {permissions.isPending ? (
          <div className="py-6 text-center text-small text-basic-secondary">
            Loading permissions…
          </div>
        ) : permissions.isError ? (
          <div className="rounded-[4px] bg-error-secondary p-3 text-small text-error-primary">
            Permissions could not be loaded. The run remains fail-closed.
          </div>
        ) : (
          <div className="flex flex-col gap-5">
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
                    disabled={setApprovalMode.isPending}
                    onChange={(checked) => {
                      if (checked) void changeApprovalMode(option.mode);
                    }}
                  >
                    <div>
                      <div className="text-small font-medium text-basic-primary">{option.name}</div>
                      <div className="mt-1 text-small text-basic-secondary">
                        {option.description}
                      </div>
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

            {reviewMode ? <PermissionReviewStatus reviews={reviews} /> : null}

            {reviewMode || reviews.length ? (
              <section aria-label="Automatic reviews">
                <div className="mb-2 tag-label uppercase text-basic-tertiary">
                  Automatic reviews
                </div>
                <div className="mb-2 text-small text-basic-secondary">
                  Blocked actions were returned to the agent unexecuted. Authorizing a retry asks
                  the agent to try exactly that action again; it passes policy and a fresh review.
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
                  {reviews.map((review) => (
                    <PermissionReviewRow
                      key={review.id}
                      review={review}
                      authorizable={authorizableReviews.has(review.id)}
                      authorizing={authorizingReview === review.id}
                      disabled={
                        authorizingReview !== null || !reviewMode || Boolean(retryUnavailable)
                      }
                      disabledReason={retryUnavailable}
                      onAuthorize={() => void authorize(review)}
                    />
                  ))}
                </div>
                {reviewMode && autoApprovalAvailable ? (
                  <div className="mt-2 flex justify-end">
                    <Button
                      size={ButtonSize.Small}
                      variant={ButtonVariant.Ghost}
                      disabled={setApprovalMode.isPending}
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
                  Requested by {requesterLabel ?? "this session"} ({active.session_id}).{" "}
                  {reviewMode
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
                    {requests.length - 1} more request
                    {requests.length === 2 ? "" : "s"} waiting.
                  </div>
                ) : null}
              </section>
            ) : null}

            <section aria-label="Remembered permissions">
              <div className="mb-2 tag-label uppercase text-basic-tertiary">
                Remembered for this session
              </div>
              {grants.length ? (
                <div className="flex flex-col gap-2">
                  {grants.map((grant) => (
                    <GrantRow
                      key={grant.id}
                      grant={grant}
                      deleting={deletingGrant === grant.id}
                      onDelete={() => void forget(grant)}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-small text-basic-secondary">No remembered permissions.</div>
              )}
            </section>
          </div>
        )}
      </Modal>
    </>
  );
}
