import { execFileSync } from "node:child_process";

// Controller-only adaptation for the normal packaged executable. Playwright
// adds debugger argv but does not install its unpackaged Electron loader.
// Pause before application code, remove only those exact controller switches,
// and resume. Nothing is shipped or injected into the renderer/preload bridge.
export async function preparePackagedInspector(
  executable: string,
  workspace: string,
): Promise<void> {
  const deadline = Date.now() + 12000;
  let pid = 0;
  while (Date.now() < deadline && !pid) {
    const rows = execFileSync("/bin/ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" });
    const owned = rows
      .split("\n")
      .map((row) => row.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/))
      .filter(
        (row) =>
          row &&
          Number(row[2]) === process.pid &&
          row[3].startsWith(executable + " ") &&
          row[3].includes(workspace),
      );
    if (owned.length > 1) throw Error("Ambiguous packaged fixture child; no debugger attachment");
    if (owned.length === 1) pid = Number(owned[0]![1]);
    else await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (!pid) throw Error("Packaged fixture child was not observed under its test controller");
  let address: string | undefined;
  while (Date.now() < deadline && !address) {
    let listeners = "";
    try {
      listeners = execFileSync(
        "/usr/sbin/lsof",
        ["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
    } catch {
      /* A not-yet-listening child is unknown, never another target. */
    }
    for (const match of listeners.matchAll(/127\.0\.0\.1:(\d+) \(LISTEN\)/g)) {
      const entries = await fetch(`http://127.0.0.1:${match[1]}/json/list`, {
        signal: AbortSignal.timeout(1000),
      })
        .then((r) => r.json())
        .catch(() => []);
      const target = entries.find((entry: any) => entry.type === "node");
      if (target) {
        address = target.webSocketDebuggerUrl;
        break;
      }
    }
    if (!address) await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (!address) throw Error("Owned packaged fixture inspector was unavailable");
  const socket = new WebSocket(address);
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(Error("Owned fixture debugger connection failed"));
  });
  let sequence = 0;
  const pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >();
  let pausedResolve!: (value: any) => void, pausedReject!: (error: Error) => void;
  const paused = new Promise<any>((resolve, reject) => {
    pausedResolve = resolve;
    pausedReject = reject;
  });
  const command = (method: string, params = {}) =>
    new Promise<any>((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === "Debugger.paused") pausedResolve(message.params);
    const receiver = pending.get(message.id);
    if (receiver) {
      pending.delete(message.id);
      message.error
        ? receiver.reject(Error(message.error.message))
        : receiver.resolve(message.result);
    }
  };
  const timer = setTimeout(() => {
    const error = Error("Owned fixture debugger exceeded its bound");
    pausedReject(error);
    for (const receiver of pending.values()) receiver.reject(error);
    socket.close();
  }, 10000);
  try {
    await command("Debugger.enable");
    await command("Runtime.runIfWaitingForDebugger");
    const stopped = await paused;
    const response = await command("Debugger.evaluateOnCallFrame", {
      callFrameId: stopped.callFrames[0].callFrameId,
      expression:
        'process.argv = process.argv.filter(value => !["--inspect=0", "--inspect-brk=0", "--remote-debugging-port=0"].includes(value)); "prepared"',
      returnByValue: true,
    });
    if (response.exceptionDetails || response.result?.value !== "prepared")
      throw Error("Could not prepare packaged fixture arguments at " + stopped.callFrames[0].url);
    await command("Debugger.resume");
    await command("Debugger.disable");
  } finally {
    clearTimeout(timer);
    socket.close();
  }
}
