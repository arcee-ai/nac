import { ApiError } from "./nacClient.js";
import { TerminalInputRejectedError, TerminalInputUncertainError, TerminalProtocolError, } from "./userTerminalConnection.js";
export function createTerminalControlApi(client) {
    const request = client.transport.request.bind(client.transport);
    const path = (session, id) => `/sessions/${encodeURIComponent(session)}/executions/${encodeURIComponent(id)}`;
    return {
        getTerminalInputControl: (session, id, signal) => request("GET", `${path(session, id)}/input-control`, { signal }),
        transferTerminalInputControl: (session, id, body, signal) => request("POST", `${path(session, id)}/input-control`, { body, signal }),
        inputControlledTerminal: (session, id, body, signal) => request("POST", `${path(session, id)}/input`, { body, signal }),
    };
}
/** Bind one pump activation to one immutable revision. Discard the activation
 * when control changes; pending bytes cannot migrate to a later controller. */
export function controlledTerminalInput(api, revision) {
    if (!/^[1-9][0-9]*$/.test(revision) || BigInt(revision) > 18446744073709551615n)
        throw new TerminalProtocolError("Invalid terminal controller revision");
    return async (session, id, body, signal) => {
        try {
            const receipt = await api.inputControlledTerminal(session, id, { ...body, expected_revision: revision }, signal);
            if (receipt.outcome === "written")
                return;
            if (receipt.outcome === "rejected")
                throw new TerminalInputRejectedError(receipt.error ?? "Terminal input was not written");
            throw new TerminalInputUncertainError(receipt.error);
        }
        catch (error) {
            if (error instanceof ApiError && [400, 401, 403, 404, 409, 413].includes(error.status))
                throw new TerminalInputRejectedError("Terminal input was rejected before admission", error);
            throw error;
        }
    };
}
