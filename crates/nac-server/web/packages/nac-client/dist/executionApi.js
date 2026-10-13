import { UserTerminalConnection, TerminalInputRejectedError, } from "./userTerminalConnection.js";
import { controlledTerminalInput } from "./terminalControlApi.js";
export function createExecutionApi(client) {
    const request = client.transport.request.bind(client.transport);
    const path = (session, id) => `/sessions/${encodeURIComponent(session)}/executions${id ? `/${encodeURIComponent(id)}` : ""}`;
    const observerPath = (session, id, observer) => `${path(session, id)}/observers/${encodeURIComponent(observer)}`;
    return {
        listExecutions: (session, signal) => request("GET", path(session), { signal }),
        listExecutionHistory: (session, signal) => request("GET", `${path(session)}/history`, { signal }),
        attachExecution: (session, id, body, signal) => request("POST", `${path(session, id)}/observers`, {
            body,
            signal,
        }),
        pullExecution: (session, id, observer, body, signal) => request("POST", `${observerPath(session, id, observer)}/read`, {
            body,
            signal,
        }),
        detachExecution: (session, id, observer, signal) => request("DELETE", observerPath(session, id, observer), { signal }),
        stopExecution: (session, id) => request("POST", `${path(session, id)}/stop`),
    };
}
/** One ACK/reset/cancellation owner for every source. A shared input activation
 * binds one immutable controller revision; replacing it discards pending bytes.
 * Explicit readonly history mode suppresses input and resize even for a live ID. */
export function createExecutionConnection(api, session, source, renderer, options = {}, control) {
    const rejected = () => Promise.reject(new TerminalInputRejectedError("This execution is read-only"));
    const input = bindExecutionInput(api, source, control, options.readonly);
    return new UserTerminalConnection({
        attachUserTerminal: api.attachExecution,
        pullUserTerminal: api.pullExecution,
        detachUserTerminal: api.detachExecution,
        inputUserTerminal: input,
        resizeUserTerminal: !options.readonly && source.origin === "human" && source.resize
            ? api.resizeUserTerminal
            : rejected,
    }, session, source.id, renderer, options);
}
/** Each sender captures one revision. Rebinding never replays earlier bytes. */
export function bindExecutionInput(api, source, control, readonly = false) {
    const rejected = () => Promise.reject(new TerminalInputRejectedError("This execution is read-only"));
    let input = !readonly && source.origin === "human" && source.input ? api.inputUserTerminal : rejected;
    if (control !== undefined && !readonly) {
        input = rejected;
        const eligibleKind = source.representation === "pty" &&
            source.backend === "local" &&
            (source.origin === "human" || (source.origin === "agent" && source.retained));
        // Current controller authority comes from the separate scoped control
        // operation, never from a pending output frame's immutable alive field.
        if (eligibleKind &&
            control &&
            control.controller === "human" &&
            !control.frozen &&
            api.inputControlledTerminal) {
            input = controlledTerminalInput({ inputControlledTerminal: api.inputControlledTerminal }, control.revision);
        }
    }
    return input;
}
