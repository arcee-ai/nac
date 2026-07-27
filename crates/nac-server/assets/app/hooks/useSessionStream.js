import { React } from "../lib/html.js";
import { loadSnapshot, connectStream, disconnectStream } from "../store/sessionsStore.js";
import { resetRuntime, applyEnvelope, setStreamStatus } from "../store/runtimeStore.js";

const { useEffect, useRef } = React;

// Connects the SSE stream for `id`: loads the initial snapshot, resets live
// runtime, and on each envelope updates the runtime store and (debounced)
// re-fetches the canonical snapshot when a whole message / run boundary lands.
export function useSessionStream(id) {
  const reloadTimer = useRef(null);

  useEffect(() => {
    if (!id) {
      disconnectStream();
      return undefined;
    }
    resetRuntime(id);
    loadSnapshot(id);

    const scheduleReload = () => {
      if (reloadTimer.current) return;
      reloadTimer.current = setTimeout(() => {
        reloadTimer.current = null;
        loadSnapshot(id);
      }, 250);
    };

    connectStream(
      id,
      (env) => {
        const needsReload = applyEnvelope(env);
        if (needsReload) scheduleReload();
      },
      setStreamStatus,
    );

    return () => {
      disconnectStream();
      if (reloadTimer.current) {
        clearTimeout(reloadTimer.current);
        reloadTimer.current = null;
      }
    };
  }, [id]);
}
