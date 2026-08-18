import { describe, expect, it } from "vitest";

import { serializeExtraHeaders } from "@/app/lib/modelConfig";

describe("serializeExtraHeaders", () => {
  it("rejects object values with the field-specific validation error", () => {
    expect(() => serializeExtraHeaders('{"X-Test":{"toString":null}}', {})).toThrow(
      'Extra Headers value for "X-Test" must be a string',
    );
  });
});
