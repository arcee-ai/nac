export declare function useMediaQuery(query: string): boolean;
/** Wide enough for the side-by-side board and inspector layout. */
export declare const useIsDesktop: () => boolean;
/**
 * Narrow enough that overlays should take over the screen instead of floating.
 * The bound is exclusive: at exactly 768px the design still shows the tablet
 * layout, with the filters rail and the side box beside the chat.
 */
export declare const useIsMobile: () => boolean;
/**
 * The design's middle tier, between the phone and the full desktop bar. The
 * header drops the wordmark for the signet and tightens its padding here.
 */
export declare const useIsTablet: () => boolean;
