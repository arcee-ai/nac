/** Public native counters and revision tokens use exact unsigned decimal strings. */
const MAX_NATIVE_INTEGER = 18446744073709551615n;
const MIN_NATIVE_SORT_ORDER = -9223372036854775808n;
const MAX_NATIVE_SORT_ORDER = 9223372036854775807n;

export function publicNativeInteger(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value) || value.length > 20) {
    throw new Error("Invalid public native integer.");
  }
  const integer = BigInt(value);
  if (integer > MAX_NATIVE_INTEGER) throw new Error("Invalid public native integer.");
  return integer;
}

/** Ordering never rounds a revision or sort key through a JavaScript number. */
export function comparePublicNativeIntegers(left: string, right: string): number {
  const a = publicNativeInteger(left);
  const b = publicNativeInteger(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Numeric UI calculations may use only values they can represent exactly. */
export function publicNativeSafeNumber(value: string): number | null {
  const integer = publicNativeInteger(value);
  return integer <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(integer) : null;
}

/** Persisted native configuration/presentation revisions are nonnegative i64, not u64. */
export function publicNativeRevision(value: string): bigint {
  const integer = publicNativeInteger(value);
  if (integer > MAX_NATIVE_SORT_ORDER) throw new Error("Invalid public native revision.");
  return integer;
}

/** Native sort_order is signed; counters and revisions remain unsigned. */
export function publicNativeSortOrder(value: string): bigint {
  if (!/^(0|-?[1-9][0-9]*)$/.test(value) || value.length > 20) {
    throw new Error("Invalid public native sort order.");
  }
  const integer = BigInt(value);
  if (integer < MIN_NATIVE_SORT_ORDER || integer > MAX_NATIVE_SORT_ORDER) {
    throw new Error("Invalid public native sort order.");
  }
  return integer;
}
