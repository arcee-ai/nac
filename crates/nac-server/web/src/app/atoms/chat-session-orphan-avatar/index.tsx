import type React from "react";

import { cn } from "../../lib/cn";
import SessionTypeAvatar, { SessionOrigin, SessionType } from "../session-type-avatar";

/** Figma ChatSessionOrphanAvatar: 40px tile with the 28px session-type mark inside. */
const TILE = 40;

interface ChatSessionOrphanAvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: number;
  sessionType?: `${SessionType}`;
  origin?: `${SessionOrigin}`;
  /** Pulses the type mark while the chat has a run going. */
  running?: boolean;
  /** @deprecated Prefer `running`. */
  isRunning?: boolean;
}

/**
 * Avatar for a chat that belongs to no project. The 40px tile matches a
 * project's identicon footprint; inside it is SessionTypeAvatar (Figma
 * SessionAvatar), not a generic chat glyph.
 */
const ChatSessionOrphanAvatar: React.FC<ChatSessionOrphanAvatarProps> = ({
  size = TILE,
  sessionType = SessionType.Agent,
  origin = SessionOrigin.User,
  running = false,
  isRunning = false,
  className = "",
  ...props
}) => {
  const live = running || isRunning;
  const scale = size / TILE;

  return (
    <div
      className={cn("shrink-0 overflow-clip", className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
      {...props}
    >
      <div
        className="flex size-10 items-center justify-center rounded-[4px] border border-solid border-muted bg-elevation-sublevel-variant-B"
        style={
          scale === 1 ? undefined : { transform: `scale(${scale})`, transformOrigin: "top left" }
        }
      >
        <SessionTypeAvatar sessionType={sessionType} origin={origin} running={live} />
      </div>
    </div>
  );
};

export default ChatSessionOrphanAvatar;
