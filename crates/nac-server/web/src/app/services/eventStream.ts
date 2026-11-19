// Standalone NAC keeps its performance marks while all transport, replay, and
// backpressure behavior comes from the consumable ALL-121 package.

import { perfEpoch, perfMark } from "@/app/lib/perfDebug";
import {
  subscribeToSessionEvents as subscribeToSharedSessionEvents,
  type SessionStreamHandlers,
  type SessionStreamOptions,
} from "../../../packages/nac-client/src/eventStream.js";

export * from "../../../packages/nac-client/src/eventStream.js";

export function subscribeToSessionEvents(
  sessionId: string,
  handlers: SessionStreamHandlers,
  options: SessionStreamOptions = {},
): () => void {
  const instrumentation = options.instrumentation;
  return subscribeToSharedSessionEvents(sessionId, handlers, {
    ...options,
    instrumentation: {
      onSessionEvent: (envelope) => {
        perfMark("sse:session_event", {
          fields: { type: envelope.event.type },
          throttleMs: 0,
        });
        instrumentation?.onSessionEvent?.(envelope);
      },
      onAssistantDelta: (delta) => {
        perfEpoch();
        perfMark("sse:assistant_delta", {
          fields: {
            chars: (delta.text?.length ?? 0) + (delta.reasoning?.length ?? 0),
          },
          throttleMs: 1000,
        });
        instrumentation?.onAssistantDelta?.(delta);
      },
    },
  });
}
