import type React from "react";
interface LogoProps {
    height?: number;
    /** The standalone signet, for bars too narrow for the wordmark. */
    markOnly?: boolean;
    className?: string;
}
/**
 * NAC wordmark, or the standalone signet when `markOnly` is set. Both use
 * `currentColor` so they follow the surrounding text color (theme-aware),
 * unlike the source SVGs which hard-code a light fill.
 */
declare const Logo: React.FC<LogoProps>;
export default Logo;
