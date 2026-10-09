import type { NacClient } from "./nacClient.js";
import type {
  OpenUserTerminalRequest,
  UserTerminalResponse,
  UserTerminalListResponse,
  AttachUserTerminalRequest,
  UserTerminalObserverResponse,
  PullUserTerminalRequest,
  UserTerminalFrameResponse,
  UserTerminalInputRequest,
  ResizeUserTerminalRequest,
} from "./types.js";

const path = (session: string, terminal?: string) =>
  `/sessions/${encodeURIComponent(session)}/user-terminals${terminal === undefined ? "" : `/${encodeURIComponent(terminal)}`}`;
const observerPath = (session: string, terminal: string, observer: string) =>
  `${path(session, terminal)}/observers/${encodeURIComponent(observer)}`;

/** Uses exactly the consumer's immutable endpoint, credentials and request lifetime. */
export function createUserTerminalApi(client: NacClient) {
  const request = client.transport.request.bind(client.transport);
  return {
    openUserTerminal: (session: string, body: OpenUserTerminalRequest, signal?: AbortSignal) =>
      request<UserTerminalResponse>("POST", path(session), { body, signal }),
    listUserTerminals: (session: string, signal?: AbortSignal) =>
      request<UserTerminalListResponse>("GET", path(session), { signal }),
    getUserTerminal: (session: string, terminal: string, signal?: AbortSignal) =>
      request<UserTerminalResponse>("GET", path(session, terminal), { signal }),
    attachUserTerminal: (
      session: string,
      terminal: string,
      body: AttachUserTerminalRequest,
      signal?: AbortSignal,
    ) =>
      request<UserTerminalObserverResponse>("POST", `${path(session, terminal)}/observers`, {
        body,
        signal,
      }),
    pullUserTerminal: (
      session: string,
      terminal: string,
      observer: string,
      body: PullUserTerminalRequest,
      signal?: AbortSignal,
    ) =>
      request<UserTerminalFrameResponse>(
        "POST",
        `${observerPath(session, terminal, observer)}/read`,
        { body, signal },
      ),
    detachUserTerminal: (
      session: string,
      terminal: string,
      observer: string,
      signal?: AbortSignal,
    ) => request<void>("DELETE", observerPath(session, terminal, observer), { signal }),
    inputUserTerminal: (
      session: string,
      terminal: string,
      body: UserTerminalInputRequest,
      signal?: AbortSignal,
    ) => request<void>("POST", `${path(session, terminal)}/input`, { body, signal }),
    resizeUserTerminal: (
      session: string,
      terminal: string,
      body: ResizeUserTerminalRequest,
      signal?: AbortSignal,
    ) => request<void>("POST", `${path(session, terminal)}/resize`, { body, signal }),
  };
}

export type UserTerminalApi = ReturnType<typeof createUserTerminalApi>;
