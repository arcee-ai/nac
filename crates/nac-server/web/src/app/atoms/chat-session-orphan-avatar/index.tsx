import type React from "react";

import { cn } from "../../lib/cn";
import Icon, { IconName } from "../icon";

/**
 * The tile scales as a unit: Figma draws a 40px box with a 28px glyph and a 4px
 * corner, and a 24px box with a 16px glyph and a 2px corner. The glyph is 70% of
 * the box, snapped to the 4px grid the icon set is drawn on.
 */
const glyphSize = (box: number) => Math.round((box * 0.7) / 4) * 4;
const cornerRadius = (box: number) => Math.round(box / 10);

interface ChatSessionOrphanAvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: number;
  /** Pulses the glyph while the chat has a run going. */
  isRunning?: boolean;
}

/**
 * Stand-in avatar for a chat that belongs to no project. Projects and assigned
 * chats get an identicon seeded from their id; an unassigned chat has nothing to
 * seed one from that would mean anything, so it gets a neutral chat glyph in a
 * tile of the same footprint.
 */
const ChatSessionOrphanAvatar: React.FC<ChatSessionOrphanAvatarProps> = ({
  size = 40,
  isRunning = false,
  className = "",
  ...props
}) => (
  <div
    className={cn(
      "flex items-center justify-center shrink-0",
      "border border-muted bg-elevation-sublevel-variant-B",
      className,
    )}
    style={{ width: size, height: size, borderRadius: cornerRadius(size) }}
    aria-hidden="true"
    {...props}
  >
    <Icon
      iconName={IconName.Chat}
      size={glyphSize(size)}
      className={cn("text-basic-secondary", isRunning && "pulse-dim")}
    />
  </div>
);

export default ChatSessionOrphanAvatar;
