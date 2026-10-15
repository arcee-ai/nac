import { Button, ButtonSize, ButtonVariant } from "@/app/atoms";
import type { PermissionReview } from "@/app/types/api";

const FAILURE_MESSAGES: Record<NonNullable<PermissionReview["failure_reason"]>, string> = {
  authentication:
    "The review service could not authenticate. Sign in to Arcee again or check the configured Arcee API key.",
  access_denied:
    "The selected Arcee workspace cannot access the review service. Ask an administrator to check its access settings.",
  model_unavailable:
    "The review model or endpoint is unavailable in the selected Arcee environment. Ask an administrator to check model registration, API availability and workspace access.",
  insufficient_credits:
    "The selected Arcee workspace has insufficient credits for review. Check its balance or use Manual approval.",
  rate_limited: "The review service is rate limited. Try again later or use Manual approval.",
  timeout: "The review service did not answer in time. Try again later or use Manual approval.",
  invalid_response:
    "The review service returned an invalid response. Try again later or contact an administrator.",
  service_unavailable:
    "The review service could not be reached or could not complete the request. Try again later or check server diagnostics.",
  cancelled: "The review was cancelled before a verdict was used.",
};

function reviewFailureMessage(review: PermissionReview): string {
  return (
    (review.failure_reason && FAILURE_MESSAGES[review.failure_reason]) ||
    "The review service could not complete this request. Try again later or check server diagnostics."
  );
}

/** Availability reflects the last retained review, never a continuing health guarantee. */
export function PermissionReviewStatus({ reviews }: { reviews: PermissionReview[] }) {
  const latest = reviews[0];
  const title = !latest
    ? "Service availability not checked"
    : !latest.outcome
      ? "Review in progress"
      : latest.outcome === "unavailable"
        ? "Last review unavailable"
        : "Last review completed";
  return (
    <section
      aria-label="Review service status"
      role="status"
      className="rounded-[6px] bg-elevation-level-2 p-3"
    >
      <div className="text-small font-medium text-basic-primary">{title}</div>
      <div className="mt-1 text-small text-basic-secondary">
        {!latest
          ? "Enabling this mode checks credentials only. Model access, credits and connectivity are checked when an eligible action is reviewed."
          : !latest.outcome
            ? "The requested action has not run."
            : latest.outcome === "unavailable"
              ? `${reviewFailureMessage(latest)} That action was not executed. Eligible actions will still require a new review; you can switch to Manual to decide requests yourself.`
              : "The last request reached the review service. Service availability can change before the next request."}
      </div>
    </section>
  );
}

function reviewOutcomeLabel(review: PermissionReview): string {
  switch (review.outcome) {
    case "rejected":
      return review.category ? `Blocked: ${review.category.replace(/_/g, " ")}` : "Blocked";
    case "uncertain":
      return "Blocked: review was not confident";
    case "unavailable":
      return "Review service unavailable";
    case "approved":
      return "Allowed by reviewer";
    default:
      return "Reviewing";
  }
}

export function PermissionReviewRow({
  review,
  authorizable,
  authorizing,
  disabled,
  disabledReason,
  onAuthorize,
}: {
  review: PermissionReview;
  authorizable: boolean;
  authorizing: boolean;
  disabled: boolean;
  disabledReason?: string;
  onAuthorize: () => void;
}) {
  const tone =
    review.outcome === "approved"
      ? "text-basic-secondary"
      : review.outcome === undefined || review.outcome === null
        ? "text-accent-primary"
        : "text-error-primary";
  return (
    <div className="rounded-[4px] bg-elevation-level-2 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="tag-label uppercase text-basic-secondary">{review.tool}</span>
        <span className="tag-label uppercase text-basic-tertiary">{review.backend}</span>
        {review.backend === "local" || review.backend === "ssh" ? (
          <span className="tag-label uppercase text-basic-tertiary">unsandboxed host</span>
        ) : review.backend === "podman_with_host_mounts" ? (
          <span className="tag-label uppercase text-basic-tertiary">
            container with writable host mounts
          </span>
        ) : null}
        <span className={`text-small ${tone}`}>{reviewOutcomeLabel(review)}</span>
      </div>
      {review.resources.map((resource, index) => (
        <div
          key={`${resource.action}:${resource.resource}:${index}`}
          className="mt-1 break-words text-small text-basic-primary"
        >
          <span className="tag-label uppercase text-basic-secondary">{resource.action}</span>{" "}
          {resource.display || resource.resource}
        </div>
      ))}
      {review.outcome === "unavailable" ? (
        <div className="mt-2 text-small text-basic-secondary">
          {reviewFailureMessage(review)} This action was not executed.
        </div>
      ) : null}
      {authorizable ? (
        <div className="mt-2 flex items-center justify-end gap-2">
          {disabledReason ? (
            <span className="text-small text-basic-tertiary">{disabledReason}</span>
          ) : null}
          <Button
            size={ButtonSize.Small}
            variant={ButtonVariant.Secondary}
            loading={authorizing}
            disabled={disabled}
            title="Ask the agent to retry exactly this action. The retry is reviewed again before it runs."
            onClick={onAuthorize}
          >
            Authorize retry
          </Button>
        </div>
      ) : null}
    </div>
  );
}
