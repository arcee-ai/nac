export declare function publicNativeInteger(value: string): bigint;
/** Ordering never rounds a revision or sort key through a JavaScript number. */
export declare function comparePublicNativeIntegers(left: string, right: string): number;
/** Numeric UI calculations may use only values they can represent exactly. */
export declare function publicNativeSafeNumber(value: string): number | null;
/** Persisted native configuration/presentation revisions are nonnegative i64, not u64. */
export declare function publicNativeRevision(value: string): bigint;
/** Native sort_order is signed; counters and revisions remain unsigned. */
export declare function publicNativeSortOrder(value: string): bigint;
