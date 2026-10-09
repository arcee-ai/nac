import type React from "react";
export declare enum AvatarSize {
    Micro = "w-4 h-4 text-[10px]",
    Small = "w-5 h-5 text-xs",
    Medium = "w-6 h-6 text-xs",
    Large = "w-8 h-8 text-sm",
    XLarge = "w-12 h-12 text-lg"
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
declare const Avatar: React.FC<AvatarProps> & {
    Size: typeof AvatarSize;
};
export default Avatar;
