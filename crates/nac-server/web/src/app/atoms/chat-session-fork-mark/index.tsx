import type React from "react";

import { cn } from "../../lib/cn";
import Icon, { IconName } from "../icon";
import Loader, { LoaderSize, LoaderVariant } from "../loader";
import Tooltip from "../tooltip";

interface ChatSessionLeadingMarkProps {
  /** Display title of the chat this session was forked from. */
  forkedFromTitle?: string | null;
  running?: boolean;
  /** Text color tokens, matching the title beside the mark. */
  className?: string;
}

/**
 * Leading slot on a tab or list row: a fork glyph with a desktop tooltip, or
 * the run loader in the same place. Running always wins — the spinner replaces
 * the fork icon, matching the Figma `isFork` / `Running` matrix.
 */
const ChatSessionLeadingMark: React.FC<ChatSessionLeadingMarkProps> = ({
  forkedFromTitle,
  running = false,
  className = "",
}) => {
  if (running) {
    return <Loader size={LoaderSize.Micro} variant={LoaderVariant.Neutral} className="shrink-0" />;
  }
  const sourceTitle = forkedFromTitle?.trim();
  if (!sourceTitle) return null;
  const label = `Fork of ${sourceTitle}`;
  return (
    <Tooltip title={label} sticky className="shrink-0">
      <span className="inline-flex shrink-0" aria-label={label}>
        <Icon iconName={IconName.Scheme} size={16} className={cn("shrink-0", className)} />
      </span>
    </Tooltip>
  );
};

export default ChatSessionLeadingMark;
