import { ApiError, type NacClient } from "./nacClient.js";
import type {
  ControlledTerminalInputRequest,
  InputControlStatus,
  InputDeliveryReceipt,
  TransferTerminalControlRequest,
} from "./types.js";
import type { UserTerminalApi } from "./userTerminalApi.js";
import {
  TerminalInputRejectedError,
  TerminalInputUncertainError,
  TerminalProtocolError,
} from "./userTerminalConnection.js";

export function createTerminalControlApi(client: NacClient) {
  const request = client.transport.request.bind(client.transport);
  const path = (session: string, id: string) =>
    `/sessions/${encodeURIComponent(session)}/executions/${encodeURIComponent(id)}`;
  return {
    getTerminalInputControl: (session: string, id: string, signal?: AbortSignal) =>
      request<InputControlStatus>("GET", `${path(session, id)}/input-control`, { signal }),
    transferTerminalInputControl: (
      session: string,
      id: string,
      body: TransferTerminalControlRequest,
      signal?: AbortSignal,
    ) =>
      request<InputControlStatus>("POST", `${path(session, id)}/input-control`, { body, signal }),
    inputControlledTerminal: (
      session: string,
      id: string,
      body: ControlledTerminalInputRequest,
      signal?: AbortSignal,
    ) => request<InputDeliveryReceipt>("POST", `${path(session, id)}/input`, { body, signal }),
  };
}

export type TerminalControlApi = ReturnType<typeof createTerminalControlApi>;

/** Bind one pump activation to one immutable revision. Discard the activation
 * when control changes; pending bytes cannot migrate to a later controller. */
export function controlledTerminalInput(
  api: Pick<TerminalControlApi, "inputControlledTerminal">,
  revision: string,
): UserTerminalApi["inputUserTerminal"] {
  if (!/^[1-9][0-9]*$/.test(revision) || BigInt(revision) > 18_446_744_073_709_551_615n)
    throw new TerminalProtocolError("Invalid terminal controller revision");
  return async (session, id, body, signal) => {
    try {
      const receipt = await api.inputControlledTerminal(
        session,
        id,
        { ...body, expected_revision: revision },
        signal,
      );
      if (receipt.outcome === "written") return;
      if (receipt.outcome === "rejected")
        throw new TerminalInputRejectedError(receipt.error ?? "Terminal input was not written");
      throw new TerminalInputUncertainError(receipt.error);
    } catch (error) {
      if (error instanceof ApiError && [400, 401, 403, 404, 409, 413].includes(error.status))
        throw new TerminalInputRejectedError("Terminal input was rejected before admission", error);
      throw error;
    }
  };
}
