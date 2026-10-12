const path = (session, terminal) => `/sessions/${encodeURIComponent(session)}/user-terminals${terminal === undefined ? "" : `/${encodeURIComponent(terminal)}`}`;
const observerPath = (session, terminal, observer) => `${path(session, terminal)}/observers/${encodeURIComponent(observer)}`;
/** Uses exactly the consumer's immutable endpoint, credentials and request lifetime. */
export function createUserTerminalApi(client) {
    const request = client.transport.request.bind(client.transport);
    return {
        openUserTerminal: (session, body, signal) => request("POST", path(session), { body, signal }),
        listUserTerminals: (session, signal) => request("GET", path(session), { signal }),
        getUserTerminal: (session, terminal, signal) => request("GET", path(session, terminal), { signal }),
        attachUserTerminal: (session, terminal, body, signal) => request("POST", `${path(session, terminal)}/observers`, {
            body,
            signal,
        }),
        pullUserTerminal: (session, terminal, observer, body, signal) => request("POST", `${observerPath(session, terminal, observer)}/read`, { body, signal }),
        detachUserTerminal: (session, terminal, observer, signal) => request("DELETE", observerPath(session, terminal, observer), { signal }),
        inputUserTerminal: (session, terminal, body, signal) => request("POST", `${path(session, terminal)}/input`, { body, signal }),
        resizeUserTerminal: (session, terminal, body, signal) => request("POST", `${path(session, terminal)}/resize`, { body, signal }),
    };
}
