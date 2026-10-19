import { useCallback } from "react";

import { useDeviceLogin } from "@/app/features/managed/controller/useDeviceLogin";
import { managedAuthProvider } from "@/app/lib/providers";
import { humanError, type ErrorFix, type RunError } from "@/app/lib/providerError";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
import { useManagedAuth } from "@/app/services/queries";

export interface ErrorNotice {
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

/**
 * Turns a failure into the notice the chat shows, with the offered fix wired to
 * whatever carries it out from here: the browser login, this session's
 * settings, the page on the platform that holds the account, or a retry the
 * caller supplies. A fix nothing here can perform is dropped, leaving the
 * wording to stand on its own. For a backend that signs in, the server's record
 * of whether a login is on file outranks what the failure text claims.
 */
export function useErrorNotice(sessionId: string | null, backend?: string | null) {
  const actions = useSessionActions();
  const { start } = useDeviceLogin();
  const provider = backend ? managedAuthProvider(backend) : null;
  const auth = useManagedAuth(provider !== null);
  const signedIn =
    auth.data?.providers.find((status) => status.provider === provider)?.signed_in ?? null;

  return useCallback(
    (error: RunError, retry?: () => void): ErrorNotice => {
      const { title, description, fix } = humanError(error, backend, signedIn);
      return {
        title,
        description,
        action: noticeAction(fix, {
          login: provider ? () => void start(provider) : null,
          settings: sessionId ? () => actions.settings(sessionId) : null,
          retry: retry ?? null,
        }),
      };
    },
    [actions, backend, provider, sessionId, signedIn, start],
  );
}

function noticeAction(
  fix: ErrorFix | undefined,
  handlers: {
    login: (() => void) | null;
    settings: (() => void) | null;
    retry: (() => void) | null;
  },
): ErrorNotice["action"] {
  if (!fix) return undefined;
  switch (fix.kind) {
    case "login":
      return handlers.login ? { label: fix.label, onClick: handlers.login } : undefined;
    case "settings":
      return handlers.settings ? { label: fix.label, onClick: handlers.settings } : undefined;
    case "retry":
      return handlers.retry ? { label: fix.label, onClick: handlers.retry } : undefined;
    case "link":
      return fix.url === undefined
        ? undefined
        : {
            label: fix.label,
            onClick: () => window.open(fix.url, "_blank", "noopener,noreferrer"),
          };
  }
}
