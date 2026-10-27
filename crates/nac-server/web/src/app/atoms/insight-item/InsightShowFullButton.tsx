import type React from "react";

import { cn } from "../../lib/cn";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import Icon, { IconName } from "../icon";
import Loader, { LoaderSize } from "../loader";

interface InsightShowFullButtonProps {
  /** Reads "Hide" while the full content shows. */
  expanded: boolean;
  /** Spins in place of the chevron and ignores clicks. */
  loading?: boolean;
  /** Id of the element whose content the link swaps. */
  controls?: string;
  onClick?: () => void;
}

/**
 * The "Show full" and "Hide" link of the Insights items. It is one button
 * through every state, so focus stays on it while the content loads; it is
 * disabled with `aria-disabled` for that reason. It keeps its own width in a
 * stretching column.
 */
const InsightShowFullButton: React.FC<InsightShowFullButtonProps> = ({
  expanded,
  loading = false,
  controls,
  onClick,
}) => (
  <Button
    size={ButtonSize.Small}
    variant={ButtonVariant.Tertiary}
    content={ButtonContent.IconRight}
    aria-expanded={expanded}
    aria-controls={controls}
    aria-disabled={loading || undefined}
    className={cn("self-start", loading && "btn-disabled")}
    onClick={loading ? undefined : onClick}
  >
    <span className="underline">{expanded ? "Hide" : "Show full"}</span>
    {loading ? (
      <Loader size={LoaderSize.XSmall} aria-hidden />
    ) : (
      <Icon iconName={expanded ? IconName.Top : IconName.Down} size={16} aria-hidden />
    )}
  </Button>
);

export default InsightShowFullButton;
