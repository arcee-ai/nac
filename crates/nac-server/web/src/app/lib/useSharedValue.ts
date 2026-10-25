import { replaceEqualDeep } from "@tanstack/react-query";
import { useState } from "react";

/**
 * The value kept from an earlier render for as long as `same` holds against
 * the new one. For a value rebuilt every render whose readers only care about
 * part of it, so a memoized reader skips the renders that part did not change.
 */
export function useSharedValue<T>(value: T, same: (kept: T, next: T) => boolean): T {
  const [kept, setKept] = useState(value);
  if (kept === value || same(kept, value)) return kept;
  setKept(value);
  return value;
}

/**
 * The new value with every part that deep-equals the previous one swapped for
 * the previous object, so a rebuilt tree keeps the identity of what it did not
 * change and memoized readers of those parts skip the render.
 */
export function useStructuralSharing<T>(value: T): T {
  const [kept, setKept] = useState({ value, shared: value });
  if (kept.value === value) return kept.shared;
  const shared = replaceEqualDeep(kept.shared, value);
  setKept({ value, shared });
  return shared;
}
