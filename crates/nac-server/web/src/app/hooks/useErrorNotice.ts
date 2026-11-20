import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { ChatSessionMessageAction } from "@/app/atoms/chat-session-message";

import { useDeviceLogin } from "@/app/features/managed/controller/useDeviceLogin";
import { managedAuthProvider } from "@/app/lib/providers";
import { humanError, type ErrorFix, type RunError } from "@/app/lib/providerError";
import { routes, type SettingsSection } from "@/app/lib/routes";

export interface ErrorNotice {
  title: string;
  description?: string;
  action?: ChatSessionMessageAction;
}

/**
 * Turns a failure into the notice the chat shows, with the offered fix wired to
 * whatever carries it out from here: the browser login, the settings page that
 * holds the broken setup, the page on the platform that holds the account, or a
 * retry the caller supplies. A fix nothing here can perform is dropped, leaving
 * the wording to stand on its own.
 */
export function useErrorNotice(backend?: string | null) {
  const navigate = useNavigate();
  const { start } = useDeviceLogin();
  const provider = backend ? managedAuthProvider(backend) : null;

  return useCallback(
    (error: RunError, retry?: () => void): ErrorNotice => {
      const { title, description, fix } = humanError(error, backend);
      return {
        title,
        description,
        action: noticeAction(fix, {
          login: provider ? () => void start(provider) : null,
          settings: (section) => navigate(routes.settings(section)),
          retry: retry ?? null,
        }),
      };
    },
    [backend, navigate, provider, start],
  );
}

function noticeAction(
  fix: ErrorFix | undefined,
  handlers: {
    login: (() => void) | null;
    settings: (section: SettingsSection | undefined) => void;
    retry: (() => void) | null;
  },
): ErrorNotice["action"] {
  if (!fix) return undefined;
  switch (fix.kind) {
    case "login":
      return handlers.login ? { label: fix.label, onClick: handlers.login } : undefined;
    case "settings":
      return { label: fix.label, onClick: () => handlers.settings(fix.section) };
    case "retry":
      return handlers.retry ? { label: fix.label, onClick: handlers.retry } : undefined;
    case "link":
      return fix.url === undefined
        ? undefined
        : {
            label: fix.label,
            href: fix.url,
          };
  }
}
