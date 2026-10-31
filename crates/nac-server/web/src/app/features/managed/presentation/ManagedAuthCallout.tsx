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
import { ManagedDeviceCode } from "@/app/features/managed/presentation/ManagedDeviceCode";
import { cn } from "@/app/lib/cn";
import { humanError, humanErrorText } from "@/app/lib/providerError";
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
 *
 * Sign in is offered only once the server has said there is no login. Until it
 * answers the callout says it is checking, and a check that fails says so with
 * a retry rather than guessing either way.
 */
export function ManagedAuthCallout({
  backend,
  className = "",
  rejected = false,
}: {
  backend: BackendKind;
  className?: string;
  rejected?: boolean;
}) {
  const check = useManagedSignIn(backend);
  const { provider, signedIn } = check;
  const { state, start, cancel } = useDeviceLogin(undefined, provider);
  const logout = useManagedLogout();
  // Being signed in only says the credential is on file. Whether it still works
  // is answered by the one request that spends it, so this asks for the model
  // index rather than reporting success on the strength of a file existing.
  const reach = useManagedProviderModels(backend, Boolean(provider) && signedIn);

  if (!provider) return null;

  const label = managedAuthLabel(provider);
  const failed = state.status === "failed";
  // Only the provider refusing the credential speaks against the login. A model
  // index that timed out or could not be reached is the endpoint's trouble, so
  // it is reported beside a login that stays signed in and is never signed out.
  const reachFailed = signedIn && reach.isError;
  const expired = reachFailed && humanError(reach.error, backend).fix?.kind === "login";
  const unreachable = reachFailed && !expired;
  const checkFailed = check.status === "unavailable";
  const invalid = failed || expired || rejected || checkFailed;
  const waiting = state.status === "waiting";
  const checking = check.status === "checking" && state.status !== "starting";
  const settled = signedIn && !failed && !expired && !rejected;
  // Managed repair never overwrites a credential, so a refused one is signed out first.
  const replacing = (rejected || expired) && signedIn;

  const control = waiting ? (
    <ManagedDeviceCode
      key={state.prompt.login_id}
      prompt={state.prompt}
      label={label}
      onCancel={() => void cancel()}
    />
  ) : checking ? (
    <div role="status" className="flex items-center gap-2 py-2">
      <Loader size={LoaderSize.XSmall} />
      <span className="label-small text-basic-secondary">Checking connection…</span>
    </div>
  ) : checkFailed ? (
    <Button
      variant={ButtonVariant.Secondary}
      size={ButtonSize.Medium}
      content={ButtonContent.IconLeft}
      onClick={check.retry}
    >
      <Icon iconName={IconName.Retry} />
      <span>Retry</span>
    </Button>
  ) : settled ? (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 rounded-[4px] bg-success-secondary py-2 pl-2 pr-4">
        <Icon iconName={IconName.CheckCircle} className="text-success-primary" />
        <span className="label-small text-success-primary">Signed in</span>
      </div>
      {unreachable ? (
        <Button
          variant={ButtonVariant.Ghost}
          size={ButtonSize.Medium}
          content={ButtonContent.Text}
          loading={reach.isFetching}
          onClick={() => void reach.refetch()}
        >
          Reload models
        </Button>
      ) : null}
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
      loading={state.status === "starting" || logout.isPending}
      onClick={() =>
        void (replacing ? logout.mutateAsync(provider) : Promise.resolve())
          .then(() => start(provider))
          .catch(() => {})
      }
    >
      <span>{replacing ? `Sign in to ${label} again` : `Sign in with ${label}`}</span>
      <Icon iconName={IconName.External} />
    </Button>
  );

  const description = waiting
    ? `Enter the code on ${label} and approve the request, then return here.`
    : checking
      ? `Checking whether NAC holds a ${label} login.`
      : checkFailed
        ? `NAC could not check the ${label} login. Nothing was changed; try the check again.`
        : settled
          ? `NAC holds this login and every session on this provider uses it.`
          : `This provider authenticates with ${label} in your browser instead of with an API key.`;

  const problem =
    failed || expired || logout.isError
      ? humanErrorText(
          failed ? state.message : logout.isError ? logout.error : reach.error,
          backend,
        )
      : unreachable
        ? `Still signed in, but the ${label} model list did not load: ${humanErrorText(reach.error, backend)}`
        : null;

  return (
    <div
      className={cn(
        // A device code needs more room than a single button, so the
        // controls wrap below the heading rather than squeezing it.
        "flex flex-col gap-3 rounded-[8px] border bg-elevation-level-2 p-3 md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-x-4",
        invalid ? "border-error-primary" : "border-muted",
        className,
      )}
    >
      <div className="flex items-start gap-2 min-w-0 md:flex-1 md:basis-[220px]">
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
          <span
            key={checkFailed ? "alert" : "note"}
            className="text-micro text-basic-muted"
            role={checkFailed ? "alert" : undefined}
          >
            {description}
          </span>
        </div>
      </div>
      <div className="flex flex-col items-stretch md:items-end gap-1 shrink-0 md:ml-auto">
        {control}
        {problem ? (
          <p className="label-micro !text-[10px] !leading-[12px] text-error-primary max-w-[280px] md:text-right pt-1 opacity-70">
            {problem}
          </p>
        ) : null}
      </div>
    </div>
  );
}
