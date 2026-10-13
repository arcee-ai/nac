import type { NacClient } from "./nacClient.js";
import type {
  AttachUserTerminalRequest,
  PullUserTerminalRequest,
  UserTerminalObserverResponse,
  ExecutionFrameResponse,
  ExecutionListResponse,
  ExecutionStatus,
} from "./types.js";
import {
  UserTerminalConnection,
  TerminalProtocolError,
  type UserTerminalRenderer,
  type UserTerminalConnectionOptions,
} from "./userTerminalConnection.js";
import type { UserTerminalApi } from "./userTerminalApi.js";

export function createExecutionApi(client: NacClient) {
  const request = client.transport.request.bind(client.transport);
  const path = (session: string, id?: string) =>
    `/sessions/${encodeURIComponent(session)}/executions${id ? `/${encodeURIComponent(id)}` : ""}`;
  const observerPath = (session: string, id: string, observer: string) =>
    `${path(session, id)}/observers/${encodeURIComponent(observer)}`;
  return {
    listExecutions: (session: string, signal?: AbortSignal) =>
      request<ExecutionListResponse>("GET", path(session), { signal }),
    attachExecution: (
      session: string,
      id: string,
      body: AttachUserTerminalRequest,
      signal?: AbortSignal,
    ) =>
      request<UserTerminalObserverResponse>("POST", `${path(session, id)}/observers`, {
        body,
        signal,
      }),
    pullExecution: (
      session: string,
      id: string,
      observer: string,
      body: PullUserTerminalRequest,
      signal?: AbortSignal,
    ) =>
      request<ExecutionFrameResponse>("POST", `${observerPath(session, id, observer)}/read`, {
        body,
        signal,
      }),
    detachExecution: (session: string, id: string, observer: string, signal?: AbortSignal) =>
      request<void>("DELETE", observerPath(session, id, observer), { signal }),
    stopExecution: (session: string, id: string) =>
      request<void>("POST", `${path(session, id)}/stop`),
  };
}

export type ExecutionApi = ReturnType<typeof createExecutionApi>;

/** One ACK/reset/cancellation owner for every source. Pipes and agent PTYs have
 * no human input route; only a real human shell uses its existing input API. */
export function createExecutionConnection(
  api: ExecutionApi & Pick<UserTerminalApi, "inputUserTerminal" | "resizeUserTerminal">,
  session: string,
  source: ExecutionStatus,
  renderer: UserTerminalRenderer,
  options: UserTerminalConnectionOptions = {},
) {
  const rejected = () => Promise.reject(new TerminalProtocolError("This execution is read-only"));
  return new UserTerminalConnection(
    {
      attachUserTerminal: api.attachExecution,
      pullUserTerminal: api.pullExecution,
      detachUserTerminal: api.detachExecution,
      inputUserTerminal:
        source.origin === "human" && source.input ? api.inputUserTerminal : rejected,
      resizeUserTerminal:
        source.origin === "human" && source.resize ? api.resizeUserTerminal : rejected,
    },
    session,
    source.id,
    renderer,
    options,
  );
}
