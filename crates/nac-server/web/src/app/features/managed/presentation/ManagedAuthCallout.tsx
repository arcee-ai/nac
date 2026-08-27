import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Loader,
  LoaderSize,
} from "@/app/atoms";
import { useDeviceLogin } from "@/app/features/managed/controller/useDeviceLogin";
import { useManagedSignIn } from "@/app/features/managed/controller/useManagedSignIn";
import { cn } from "@/app/lib/cn";
import { humanErrorText } from "@/app/lib/providerError";
import { managedAuthLabel } from "@/app/lib/providers";
import { useManagedLogout, useManagedProviderModels } from "@/app/services/queries";
import type { BackendKind, ManagedAuthProvider } from "@/app/types/api";

const PROVIDER_ICONS = {
  arcee: IconName.Arcee,
  codex: IconName.ChatGpt,
} satisfies Record<ManagedAuthProvider, IconName>;

/**
 * The browser sign-in a managed provider needs in place of an API key. It sits
 * outside the field rows deliberately: it is an action that sends the user to
 * another site, not a value being filled in, and its heading names the provider
 * so that what is being signed into is never in question.
 *
 * The login belongs to the provider rather than to any one configuration — one
 * file in NAC home backs every session using that backend — which is why this
 * reports being signed in even when the sign-in happened elsewhere.
 */
export function ManagedAuthCallout({
  backend,
  className = "",
}: {
  backend: BackendKind;
  className?: string;
}) {
  const { provider, signedIn } = useManagedSignIn(backend);
  const { state, start, cancel } = useDeviceLogin();
  const logout = useManagedLogout();
  // Being signed in only says the credential is on file. Whether it still works
  // is answered by the one request that spends it, so this asks for the model
  // index rather than reporting success on the strength of a file existing.
  const reach = useManagedProviderModels(backend, Boolean(provider) && signedIn);

  if (!provider) return null;

  const label = managedAuthLabel(provider);
  const failed = state.status === "failed";
  const expired = signedIn && reach.isError;
  const invalid = failed || expired;
  const waiting = state.status === "waiting";
  const settled = signedIn && !invalid;

  const control = waiting ? (
    <div className="flex items-center gap-2">
      <Loader size={LoaderSize.Micro} />
      {state.prompt.user_code ? (
        <>
          <span className="text-micro text-basic-muted">Code</span>
          <span className="label-small text-basic-primary tabular-nums">
            {state.prompt.user_code}
          </span>
        </>
      ) : (
        <span className="text-micro text-basic-muted">Waiting for the browser</span>
      )}
      <Button
        variant={ButtonVariant.Ghost}
        size={ButtonSize.Medium}
        content={ButtonContent.Text}
        onClick={() => void cancel()}
      >
        Cancel
      </Button>
    </div>
  ) : settled ? (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 rounded-[4px] bg-success-secondary py-2 pl-2 pr-4">
        <Icon iconName={IconName.CheckCircle} className="text-success-primary" />
        <span className="label-small text-success-primary">Signed in</span>
      </div>
      <Button
        variant={ButtonVariant.Ghost}
        size={ButtonSize.Medium}
        content={ButtonContent.Text}
        loading={logout.isPending}
        onClick={() => void logout.mutateAsync(provider).catch(() => {})}
      >
        Sign out
      </Button>
    </div>
  ) : (
    <Button
      variant={ButtonVariant.Primary}
      size={ButtonSize.Medium}
      content={ButtonContent.IconRight}
      loading={state.status === "starting"}
      onClick={() => void start(provider)}
    >
      <span>Sign in with {label}</span>
      <Icon iconName={IconName.External} />
    </Button>
  );

  const description = waiting
    ? `Approve the request in the ${label} tab NAC opened.`
    : settled
      ? `NAC holds this login and every session on this provider uses it.`
      : `This provider authenticates with ${label} in your browser instead of with an API key.`;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-[8px] border bg-elevation-level-2 p-3 md:flex-row md:items-center md:justify-between md:gap-4",
        invalid ? "border-error-primary" : "border-muted",
        className,
      )}
    >
      <div className="flex items-start gap-2 min-w-0">
        <Icon
          iconName={PROVIDER_ICONS[provider]}
          className={cn("shrink-0", invalid ? "text-error-primary" : "text-basic-secondary")}
        />
        <div className="flex flex-col gap-0.5 min-w-0">
          <span
            className={cn("label-small", invalid ? "text-error-primary" : "text-basic-primary")}
          >
            {label} sign-in
          </span>
          <span className="text-micro text-basic-muted">{description}</span>
        </div>
      </div>
      <div className="flex flex-col items-stretch md:items-end gap-1 shrink-0">
        {control}
        {invalid ? (
          <p className="label-micro !text-[10px] !leading-[12px] text-error-primary max-w-[280px] md:text-right pt-1 opacity-70">
            {humanErrorText(failed ? state.message : reach.error, backend)}
          </p>
        ) : null}
      </div>
    </div>
  );
}
