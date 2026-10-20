import React from "react";
import { cn } from "../../lib/cn";

export enum AvatarSize {
  Micro = "size-4 avatar-xs",
  Small = "size-5 avatar-sm",
  Medium = "size-6 avatar-md",
  Large = "size-8 avatar-xl",
  XLarge = "size-12 avatar-4xl",
  MediumLarge = "size-7 avatar-lg",
  X2Large = "size-9 avatar-2xl",
  X3Large = "size-10 avatar-3xl",
}

const DEFAULT_COLOR = "var(--color-bg-elevation-ground-inverse)";

interface AvatarProps {
  /** Falls back to the initial of `name` when absent or when the image fails. */
  imageUrl?: string | null;
  name?: string | null;
  size?: AvatarSize;
  /** Background behind a glyph, or an override of the letter fill. Ignored once an image is shown. */
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
  color = DEFAULT_COLOR,
  glyph = false,
  className = "",
}) => {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [imageUrl]);

  const trimmed = name?.trim() ?? "";
  const initial = glyph ? trimmed : (trimmed[0]?.toUpperCase() ?? "?");
  const showImage = Boolean(imageUrl) && !failed;
  const customColor = color !== DEFAULT_COLOR;

  return (
    <div
      className={cn(
        "avatar inline-flex items-center justify-center shrink-0 overflow-hidden rounded-full",
        size,
        showImage
          ? "border-tertiary bg-elevation-level-3"
          : cn(
              "border-secondary-inversed",
              glyph || customColor ? "text-primary-inverse" : "text-tertiary-inverse",
            ),
        className,
      )}
      style={showImage ? undefined : { background: color }}
    >
      {showImage ? (
        <img
          src={imageUrl ?? undefined}
          alt={trimmed}
          className="size-full rounded-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        initial
      )}
    </div>
  );
};

Avatar.Size = AvatarSize;

export default Avatar;
