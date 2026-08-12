import type React from "react";
import { cn } from "../../lib/cn";

export enum AvatarSize {
  Small = "w-5 h-5 text-xs",
  Medium = "w-6 h-6 text-xs",
  Large = "w-8 h-8 text-sm",
  XLarge = "w-12 h-12 text-lg",
}

interface AvatarProps {
  /** Falls back to the initial of `name` when absent or when the image fails. */
  imageUrl?: string | null;
  name?: string | null;
  size?: AvatarSize;
  /** Background behind the initial. Ignored once an image is shown. */
  color?: string;
  /** Render `name` as-is instead of taking its first letter, e.g. an emoji. */
  glyph?: boolean;
  className?: string;
}

/**
 * Round identity badge. `SessionAvatar` stays the right choice for sessions —
 * this one is for people and providers, which have a name and maybe a picture.
 */
const Avatar: React.FC<AvatarProps> & { Size: typeof AvatarSize } = ({
  imageUrl,
  name,
  size = AvatarSize.Medium,
  color = "var(--color-bg-accent-primary)",
  glyph = false,
  className = "",
}) => {
  const trimmed = name?.trim() ?? "";
  const initial = glyph ? trimmed : (trimmed[0]?.toUpperCase() ?? "?");

  return (
    <div
      className={cn(
        "flex items-center justify-center shrink-0 rounded-full overflow-hidden",
        "font-semibold text-basic-primary-inverse shadow-convex",
        size,
        className,
      )}
      style={{ background: imageUrl ? undefined : color }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={trimmed}
          className="w-full h-full object-cover"
        />
      ) : (
        initial
      )}
    </div>
  );
};

Avatar.Size = AvatarSize;

export default Avatar;
