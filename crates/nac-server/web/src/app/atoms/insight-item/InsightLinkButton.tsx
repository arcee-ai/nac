import type React from "react";

import { cn } from "../../lib/cn";
import { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import Icon, { IconName } from "../icon";

interface InsightLinkButtonProps {
  label: string;
  /** Renders a real link. Without it the control is a button. */
  href?: string;
  onClick?: (event: React.MouseEvent<HTMLElement>) => void;
  className?: string;
}

/**
 * "Session title >" link at the end of an `InsightItem` body. It wears the
 * small ghost button classes, so hover, press and focus match the tab buttons
 * around it; `.btn-small.btn-icon-right` sets height and padding in unlayered
 * CSS, which the 28px design overrides with `!`. It keeps its own width
 * inside the item's stretching column.
 */
const InsightLinkButton: React.FC<InsightLinkButtonProps> = ({
  label,
  href,
  onClick,
  className,
}) => {
  const classes = cn(
    "btn",
    ButtonSize.Small,
    ButtonVariant.Ghost,
    ButtonContent.IconRight,
    "!h-7 !p-1 max-w-full self-start",
    className,
  );
  const content = (
    <>
      <span className="min-w-0 truncate">{label}</span>
      <Icon iconName={IconName.Right} size={16} className="shrink-0" />
    </>
  );

  return href != null ? (
    <a href={href} onClick={onClick} className={classes}>
      {content}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={classes}>
      {content}
    </button>
  );
};

export default InsightLinkButton;
