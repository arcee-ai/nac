import { useEffect } from "react";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";

/** The human presentation acknowledges only sequences it has rendered/opened.
 * Retries contain metadata, never saved agent input or execution authority. */
export function HeartbeatAttentionController() {
  const { api, stores } = useNativeRuntime();
  const owner = stores.attentionStore;
  const pending = owner.attentionStore.useStore((state) => state.acknowledgements);
  useEffect(() => {
    let closed = false;
    const acknowledge = async () => {
      for (const [id, sequence] of Object.entries(pending)) {
        if (closed) return;
        try {
          await api.acknowledgeHeartbeats(id, sequence);
          if (!closed) owner.acknowledgeSucceeded(id, sequence);
        } catch {
          // Keep the local viewed state while disconnected. The same bounded
          // monotonic metadata is retried; new outcomes remain independently unseen.
        }
      }
    };
    void acknowledge();
    const timer = setInterval(() => void acknowledge(), 30000);
    return () => {
      closed = true;
      clearInterval(timer);
    };
  }, [api, owner, pending]);
  return null;
}
