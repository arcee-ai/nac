import { describe, expect, it } from "vitest";

import {
  dispatchThreadName,
  partitionThreadCalls,
} from "@/app/lib/transcript";
import type { ToolCall } from "@/app/types/api";

function threadCall(argumentsJson: string): ToolCall {
  return {
    id: "call",
    type: "function",
    function: { name: "thread", arguments: argumentsJson },
  };
}

describe("thread call decoding", () => {
  it("falls back when a decoded name is not a string", () => {
    const call = threadCall('{"name":{"toString":null},"action":"x"}');

    expect(dispatchThreadName(call)).toBe("thread");
  });

  it("ignores non-string dependency entries", () => {
    const first = threadCall('{"name":"first","action":"x"}');
    const second = threadCall(
      '{"name":"second","action":"y","threads":[{"toString":null}]}',
    );

    expect(partitionThreadCalls([first, second])).toEqual([[first, second]]);
  });
});
