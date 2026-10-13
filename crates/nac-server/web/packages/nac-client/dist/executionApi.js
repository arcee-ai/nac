import { UserTerminalConnection, TerminalProtocolError, } from "./userTerminalConnection.js";
export function createExecutionApi(client) {
    const request = client.transport.request.bind(client.transport);
    const path = (session, id) => `/sessions/${encodeURIComponent(session)}/executions${id ? `/${encodeURIComponent(id)}` : ""}`;
    const observerPath = (session, id, observer) => `${path(session, id)}/observers/${encodeURIComponent(observer)}`;
    return {
        listExecutions: (session, signal) => request("GET", path(session), { signal }),
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
/** One ACK/reset/cancellation owner for every source. Pipes and agent PTYs have
 * no human input route; only a real human shell uses its existing input API. */
export function createExecutionConnection(api, session, source, renderer, options = {}) {
    const rejected = () => Promise.reject(new TerminalProtocolError("This execution is read-only"));
    return new UserTerminalConnection({
        attachUserTerminal: api.attachExecution,
        pullUserTerminal: api.pullExecution,
        detachUserTerminal: api.detachExecution,
        inputUserTerminal: source.origin === "human" && source.input ? api.inputUserTerminal : rejected,
        resizeUserTerminal: source.origin === "human" && source.resize ? api.resizeUserTerminal : rejected,
    }, session, source.id, renderer, options);
}
