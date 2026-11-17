/**
 * The one owner of the ⌘K palette and the ⌘/ sheet: binds both chords and
 * renders whichever surface the shared signal names. Mounted once per
 * presentation, inside every provider, so it is available on every route.
 */
export declare function CommandSurfaces(): import("react").JSX.Element;
