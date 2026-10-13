import { useEffect, useRef, useState, type RefObject } from "react";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { openTerminalObservation, type TerminalControls } from "./browserRuntime";
import { recoveryForRuntime, type TerminalInputRecoveryLease } from "./inputRecovery";

export function useTerminalController(
  sessionId: string,
  terminalId: string,
  element: RefObject<HTMLDivElement | null>,
) {
  const runtime = useNativeRuntime();
  const { api } = runtime;
  const current = useRef<TerminalControls | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState("Connecting");
  const [notice, setNotice] = useState("");
  const [inputFailure, setInputFailure] = useState(false);
  const recovery = useRef<TerminalInputRecoveryLease | null>(null);

  useEffect(() => {
    const host = element.current;
    if (!host) return;
    // Reserve recovery capacity before fresh input can be accepted. The exact
    // opaque execution handle already contains its process-owner incarnation.
    const lease = recoveryForRuntime(runtime).acquire(sessionId, terminalId);
    recovery.current = lease;
    const close = openTerminalObservation({
      api,
      sessionId,
      terminalId,
      host,
      reconnect: attempt !== 0,
      previousFailure: lease,
      controls: (value) => {
        current.current = value;
      },
      phase: setPhase,
      notice: setNotice,
      inputFailure: setInputFailure,
    });
    return () => {
      // Closing first records any active/unknown delivery before releasing the
      // view's seat. Unresolved facts survive its source switch/remount.
      close();
      lease.release();
      if (recovery.current === lease) recovery.current = null;
    };
  }, [runtime, api, sessionId, terminalId, attempt, element]);

  return {
    phase,
    notice,
    inputFailure,
    reconnect: () => setAttempt((value) => value + 1),
    selection: () => {
      const text = current.current?.adapter.terminal.getSelection() ?? "";
      if (!text) setNotice("Select text in the terminal before reviewing it.");
      return text;
    },
    focus: () => current.current?.adapter.terminal.focus(),
    acknowledgeInput: () => {
      const value = current.current;
      if (!value || value.pump.hasActiveInput || !recovery.current?.available) return;
      value.pump.acknowledgeFailure();
      recovery.current.acknowledge();
      const enabled = value.restoreFreshInput();
      setInputFailure(false);
      setNotice(
        enabled
          ? "Previous input will not be retried. Only fresh typing will be sent."
          : "Previous input will not be retried. This source has no connected live input.",
      );
      if (enabled) value.adapter.terminal.focus();
    },
  };
}
