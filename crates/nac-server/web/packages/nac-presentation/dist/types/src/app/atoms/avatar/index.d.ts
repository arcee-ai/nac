import React from "react";
export declare enum AvatarSize {
    Micro = "size-4 avatar-xs",
    Small = "size-5 avatar-sm",
    Medium = "size-6 avatar-md",
    Large = "size-8 avatar-xl",
    XLarge = "size-12 avatar-4xl",
    MediumLarge = "size-7 avatar-lg",
    X2Large = "size-9 avatar-2xl",
    X3Large = "size-10 avatar-3xl"
}
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
declare const Avatar: React.FC<AvatarProps> & {
    Size: typeof AvatarSize;
};
export default Avatar;
