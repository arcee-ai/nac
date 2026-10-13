import { TerminalProtocolError } from "./userTerminalConnection.js";
const path = (session, terminal) => `/sessions/${encodeURIComponent(session)}/user-terminals${terminal === undefined ? "" : `/${encodeURIComponent(terminal)}`}`;
const observerPath = (session, terminal, observer) => `${path(session, terminal)}/observers/${encodeURIComponent(observer)}`;
/** Uses exactly the consumer's immutable endpoint, credentials and request lifetime. */
export function createUserTerminalApi(client) {
    const request = client.transport.request.bind(client.transport);
    return {
        /** Explicit durable intent. Freeze admission_id and manually reconcile it
         * after uncertainty; this method never retries or creates a new identity. */
        submitUserTerminalSelection: async (session, terminal, body, signal) => {
            const response = await request("POST", `${path(session, terminal)}/selection-submissions`, { body, signal });
            if (response.protocol_version !== 1 ||
                response.admission_id !== body.admission_id.toLowerCase() ||
                response.accepted_intent.protocol_version !== 1 ||
                response.accepted_intent.source_kind !== "user_supplied_rendered_selection" ||
                response.accepted_intent.admission_id !== body.admission_id.toLowerCase() ||
                response.accepted_intent.owner_instance_id !==
                    body.expected_owner_instance_id.toLowerCase() ||
                response.accepted_intent.source_session_id !== session ||
                response.accepted_intent.terminal_id !== terminal ||
                response.accepted_intent.capture_id !== body.capture_id.toLowerCase() ||
                response.accepted_intent.client_capture_time_ms !==
                    (body.client_capture_time_ms?.replace(/^0+(?=\d)/, "") ?? null) ||
                response.accepted_intent.text !== body.expected_selection_text ||
                response.accepted_intent.user_text !== (body.expected_user_text ?? null) ||
                response.accepted_intent.initial_delivery !== body.delivery ||
                response.accepted_intent.initial_expected_run_id !==
                    (body.expected_run_id?.toLowerCase() ?? null)) {
                throw new TerminalProtocolError("Terminal selection admission identity/intent changed");
            }
            return response;
        },
        /** Preview only. Keep the frozen original beside this canonical text locally.
         * Submission normalizes the original again and compares the exact
         * expected preview, rather than assuming masking is idempotent or trusting
         * a client sanitization flag. This operation never sends agent input.
         */
        previewUserTerminalSelection: async (session, terminal, body, signal) => {
            const response = await request("POST", `${path(session, terminal)}/selection-preview`, { body, signal });
            if (response.protocol_version !== 1 ||
                response.source_kind !== "user_supplied_rendered_selection" ||
                response.source_session_id !== session ||
                response.terminal_id !== terminal ||
                response.capture_id !== body.capture_id.toLowerCase() ||
                response.truncated !== false) {
                throw new TerminalProtocolError("Terminal selection preview identity/version changed");
            }
            return response;
        },
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
