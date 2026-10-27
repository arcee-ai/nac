/**
 * The value kept from an earlier render for as long as `same` holds against
 * the new one. For a value rebuilt every render whose readers only care about
 * part of it, so a memoized reader skips the renders that part did not change.
 */
export declare function useSharedValue<T>(value: T, same: (kept: T, next: T) => boolean): T;
/**
 * The new value with every part that deep-equals the previous one swapped for
 * the previous object, so a rebuilt tree keeps the identity of what it did not
 * change and memoized readers of those parts skip the render.
 */
export declare function useStructuralSharing<T>(value: T): T;
