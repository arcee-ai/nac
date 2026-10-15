import { describe, expect, it } from "vitest";
import {
  comparePublicNativeIntegers,
  publicNativeInteger,
  publicNativeSafeNumber,
  publicNativeRevision,
  publicNativeSortOrder,
} from "./publicNativeInteger.js";

describe("public native integers", () => {
  it("keeps adjacent revisions above the safe number range distinct", () => {
    expect(comparePublicNativeIntegers("9007199254740992", "9007199254740993")).toBe(-1);
    expect(publicNativeSafeNumber("9007199254740993")).toBeNull();
    expect(publicNativeSafeNumber("9007199254740991")).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("accepts the entire native unsigned 64-bit range", () => {
    expect(publicNativeInteger("0")).toBe(0n);
    expect(publicNativeInteger("18446744073709551615")).toBe(18446744073709551615n);
    expect(comparePublicNativeIntegers("18446744073709551615", "18446744073709551615")).toBe(0);
  });

  it.each(["", "00", "01", "-1", "+1", "1.0", "1e3", " 1", "1\n", "18446744073709551616"])(
    "rejects noncanonical or out-of-range value %j",
    (value) => expect(() => publicNativeInteger(value)).toThrow("Invalid public native integer."),
  );

  it("preserves signed sort order without admitting negative revisions", () => {
    expect(publicNativeSortOrder("-9223372036854775808")).toBe(-9223372036854775808n);
    expect(publicNativeSortOrder("9223372036854775807")).toBe(9223372036854775807n);
    for (const value of ["-0", "-01", "-9223372036854775809", "9223372036854775808"]) {
      expect(() => publicNativeSortOrder(value)).toThrow("Invalid public native sort order.");
    }
    expect(() => publicNativeInteger("-1")).toThrow();
  });

  it("bounds persisted revisions to the nonnegative native i64 range", () => {
    expect(publicNativeRevision("0")).toBe(0n);
    expect(publicNativeRevision("9223372036854775807")).toBe(9223372036854775807n);
    expect(() => publicNativeRevision("9223372036854775808")).toThrow(
      "Invalid public native revision.",
    );
    expect(() => publicNativeRevision("18446744073709551615")).toThrow(
      "Invalid public native revision.",
    );
    expect(() => publicNativeRevision("-1")).toThrow();
  });
});
