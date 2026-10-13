import { useEffect, useRef, useState, type RefObject } from "react";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { openTerminalObservation, type TerminalControls } from "./browserRuntime";

export function useTerminalController(
  sessionId: string,
  terminalId: string,
  element: RefObject<HTMLDivElement | null>,
) {
  const { api } = useNativeRuntime();
  const current = useRef<TerminalControls | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState("Connecting");
  const [notice, setNotice] = useState("");
  const [inputFailure, setInputFailure] = useState(false);
  const previousFailure = useRef(false);

  useEffect(() => {
    const host = element.current;
    if (!host) return;
    return openTerminalObservation({
      api,
      sessionId,
      terminalId,
      host,
      reconnect: attempt !== 0,
      previousFailure,
      controls: (value) => {
        current.current = value;
      },
      phase: setPhase,
      notice: setNotice,
      inputFailure: setInputFailure,
    });
  }, [api, sessionId, terminalId, attempt, element]);

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
      if (!value || value.pump.hasActiveInput || phase !== "Connected") return;
      value.pump.acknowledgeFailure();
      value.adapter.terminal.options.disableStdin = false;
      previousFailure.current = false;
      setInputFailure(false);
      setNotice("Previous input will not be retried. Only fresh typing will be sent.");
      value.adapter.terminal.focus();
    },
  };
}
