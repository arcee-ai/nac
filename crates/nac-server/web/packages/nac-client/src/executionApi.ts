import type { NacClient } from "./nacClient.js";
import type {
  AttachUserTerminalRequest,
  PullUserTerminalRequest,
  UserTerminalObserverResponse,
  ExecutionFrameResponse,
  ExecutionListResponse,
  ExecutionHistoryResponse,
  ExecutionStatus,
  InputControlStatus,
} from "./types.js";
import {
  UserTerminalConnection,
  TerminalInputRejectedError,
  type UserTerminalRenderer,
  type UserTerminalConnectionOptions,
} from "./userTerminalConnection.js";
import type { UserTerminalApi } from "./userTerminalApi.js";
import { controlledTerminalInput, type TerminalControlApi } from "./terminalControlApi.js";

export function createExecutionApi(client: NacClient) {
  const request = client.transport.request.bind(client.transport);
  const path = (session: string, id?: string) =>
    `/sessions/${encodeURIComponent(session)}/executions${id ? `/${encodeURIComponent(id)}` : ""}`;
  const observerPath = (session: string, id: string, observer: string) =>
    `${path(session, id)}/observers/${encodeURIComponent(observer)}`;
  return {
    listExecutions: (session: string, signal?: AbortSignal) =>
      request<ExecutionListResponse>("GET", path(session), { signal }),
    listExecutionHistory: (session: string, signal?: AbortSignal) =>
      request<ExecutionHistoryResponse>("GET", `${path(session)}/history`, { signal }),
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

/** One ACK/reset/cancellation owner for every source. A shared input activation
 * binds one immutable controller revision; replacing it discards pending bytes.
 * Explicit readonly history mode suppresses input and resize even for a live ID. */
export function createExecutionConnection(
  api: ExecutionApi &
    Pick<UserTerminalApi, "inputUserTerminal" | "resizeUserTerminal"> &
    Partial<Pick<TerminalControlApi, "inputControlledTerminal">>,
  session: string,
  source: ExecutionStatus,
  renderer: UserTerminalRenderer,
  options: UserTerminalConnectionOptions & { readonly?: boolean } = {},
  control?: Pick<InputControlStatus, "controller" | "revision" | "frozen"> | null,
) {
  const rejected = () =>
    Promise.reject(new TerminalInputRejectedError("This execution is read-only"));
  const input = bindExecutionInput(api, source, control, options.readonly);
  return new UserTerminalConnection(
    {
      attachUserTerminal: api.attachExecution,
      pullUserTerminal: api.pullExecution,
      detachUserTerminal: api.detachExecution,
      inputUserTerminal: input,
      resizeUserTerminal:
        !options.readonly && source.origin === "human" && source.resize
          ? api.resizeUserTerminal
          : rejected,
    },
    session,
    source.id,
    renderer,
    options,
  );
}

/** Each sender captures one revision. Rebinding never replays earlier bytes. */
export function bindExecutionInput(
  api: Pick<UserTerminalApi, "inputUserTerminal"> &
    Partial<Pick<TerminalControlApi, "inputControlledTerminal">>,
  source: ExecutionStatus,
  control?: Pick<InputControlStatus, "controller" | "revision" | "frozen"> | null,
  readonly = false,
): UserTerminalApi["inputUserTerminal"] {
  const rejected = () =>
    Promise.reject(new TerminalInputRejectedError("This execution is read-only"));
  let input =
    !readonly && source.origin === "human" && source.input ? api.inputUserTerminal : rejected;
  if (control !== undefined && !readonly) {
    input = rejected;
    const eligibleKind =
      source.representation === "pty" &&
      source.backend === "local" &&
      (source.origin === "human" || (source.origin === "agent" && source.retained));
    // Current controller authority comes from the separate scoped control
    // operation, never from a pending output frame's immutable alive field.
    if (
      eligibleKind &&
      control &&
      control.controller === "human" &&
      !control.frozen &&
      api.inputControlledTerminal
    ) {
      input = controlledTerminalInput(
        { inputControlledTerminal: api.inputControlledTerminal },
        control.revision,
      );
    }
  }
  return input;
}
