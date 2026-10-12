import { useEffect, useRef, useState, type RefObject } from "react";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import {
  UserTerminalConnection,
  UserTerminalInputPump,
} from "../../../../packages/nac-client/src/index";
import { createTerminalRenderer } from "./xtermAdapter";

export function useTerminalController(
  sessionId: string,
  terminalId: string,
  element: RefObject<HTMLDivElement | null>,
  newlyOpened: boolean,
) {
  const { api } = useNativeRuntime();
  const current = useRef<{
    adapter: Awaited<ReturnType<typeof createTerminalRenderer>>;
    pump: UserTerminalInputPump;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState("Connecting");
  const [notice, setNotice] = useState("");
  const [inputFailure, setInputFailure] = useState(false);
  const [needsInputEnable, setNeedsInputEnable] = useState(false);
  const initialTyping = useRef(newlyOpened);
  const previousFailure = useRef(false);

  useEffect(() => {
    const host = element.current;
    if (!host) return;
    const abort = new AbortController();
    let release: (() => void) | undefined;
    const active = () => !abort.signal.aborted;
    const fail = (error: unknown) => {
      if (!active()) return;
      setPhase("Disconnected");
      setNotice(error instanceof Error ? error.message : "Terminal observation failed");
      if (current.current) current.current.adapter.terminal.options.disableStdin = true;
    };
    void (async () => {
      const adapter = await createTerminalRenderer(host);
      if (!active()) {
        adapter.dispose();
        return;
      }
      const connection = new UserTerminalConnection(api, sessionId, terminalId, adapter.renderer, {
        pageLimit: 32_768,
      });
      const pump = new UserTerminalInputPump(connection, abort.signal);
      current.current = { adapter, pump };
      let resizeRunning = false;
      let latestGeometry: { cols: number; rows: number } | null = null;
      let connected = false;
      let processAlive = false;
      const resize = async () => {
        const geometry = adapter.fit();
        if (geometry) latestGeometry = geometry;
        if (resizeRunning || !connected || !processAlive) return;
        resizeRunning = true;
        try {
          while (latestGeometry && active() && processAlive) {
            const next = latestGeometry;
            latestGeometry = null;
            await connection.resize(next.cols, next.rows, abort.signal);
          }
        } catch (error) {
          // Process control can fail after exit while retained replay is healthy.
          if (active())
            setNotice(
              `Terminal resize failed: ${error instanceof Error ? error.message : "geometry control unavailable"}`,
            );
        } finally {
          resizeRunning = false;
        }
      };
      const send = (bytes: Uint8Array) => {
        if (!connected || adapter.terminal.options.disableStdin) return;
        void pump.send(bytes).catch((error: unknown) => {
          if (!active()) return;
          setNotice(error instanceof Error ? error.message : "Terminal input failed");
          if (pump.needsAcknowledgement) {
            previousFailure.current = true;
            adapter.terminal.options.disableStdin = true;
            setInputFailure(true);
          }
        });
      };
      const keyboard = adapter.terminal.onData((data) => send(new TextEncoder().encode(data)));
      const binary = adapter.terminal.onBinary((data) =>
        send(Uint8Array.from(data, (character) => character.charCodeAt(0))),
      );
      const observer = new ResizeObserver(() => {
        void resize();
      });
      observer.observe(host);
      if (adapter.terminal.element) observer.observe(adapter.terminal.element);
      release = () => {
        if (pump.hasActiveInput || pump.needsAcknowledgement) previousFailure.current = true;
        connected = false;
        current.current = null;
        observer.disconnect();
        keyboard.dispose();
        binary.dispose();
        pump.dispose();
        // Leaving the pane releases only observation, never the shell or agent.
        void connection.detach().catch(() => {});
        adapter.dispose();
      };
      setPhase("Connecting");
      setNotice("");
      setInputFailure(previousFailure.current);
      const status = await connection.attach(abort.signal, attempt ? "reconnect" : "attach");
      if (!active()) return;
      connected = true;
      processAlive = status.alive;
      // Reattaching never silently resumes input after a lost consumer or
      // receipt. Only a newly opened shell can start typing immediately.
      const enable =
        status.alive && initialTyping.current && attempt === 0 && !previousFailure.current;
      adapter.terminal.options.disableStdin = !enable;
      setNeedsInputEnable(status.alive && !enable);
      if (previousFailure.current)
        setNotice("Input delivery was not confirmed. Check the shell before enabling fresh input.");
      setPhase(status.alive ? "Connected" : "Retained output");
      await resize();
      // Font loading may change measured columns after the first visible frame.
      void document.fonts.ready.then(() => {
        if (active()) void resize();
      });
      await connection.run(abort.signal, (frame) => {
        processAlive = frame.terminal.alive;
        if (!processAlive) latestGeometry = null;
        if (frame.gap && active())
          setNotice(
            "Earlier output was discarded. The display was reset before retained output was replayed.",
          );
      });
      if (active()) {
        adapter.terminal.options.disableStdin = true;
        setPhase("Output complete");
      }
    })().catch(fail);
    return () => {
      abort.abort();
      release?.();
    };
  }, [api, sessionId, terminalId, attempt, element]);

  return {
    phase,
    notice,
    inputFailure,
    needsInputEnable,
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
      setNeedsInputEnable(false);
      setNotice("Previous input will not be retried. Only fresh typing will be sent.");
      value.adapter.terminal.focus();
    },
  };
}
