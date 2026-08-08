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
import { ConfigRow } from "@/app/components/modals/ConfigRow";
import { useDeviceLogin } from "@/app/hooks/useDeviceLogin";
import { useManagedSignIn } from "@/app/hooks/useManagedSignIn";
import { errorMessage } from "@/app/providers/ToastProvider";
import {
  useManagedLogout,
  useManagedProviderModels,
} from "@/app/services/queries";
import type { BackendKind } from "@/app/types/api";

/**
 * The Authentication row a managed provider shows in place of the API key: the
 * credential is a browser login, so there is nothing to paste.
 *
 * The login belongs to the provider rather than to this configuration — one
 * file in NAC home backs every session using that backend — which is why the
 * row reports being signed in even when the sign-in happened elsewhere.
 */
export function AuthenticationRow({ backend }: { backend: BackendKind }) {
  const { provider, signedIn } = useManagedSignIn(backend);
  const { state, start, cancel } = useDeviceLogin();
  const logout = useManagedLogout();
  // Being signed in only says the credential is on file. Whether it still works
  // is answered by the one request that spends it, so the row asks for the model
  // index rather than reporting success on the strength of a file existing.
  const reach = useManagedProviderModels(
    backend,
    Boolean(provider) && signedIn,
  );

  if (!provider) return null;

  const failed = state.status === "failed";
  const expired = signedIn && reach.isError;

  const control =
    state.status === "waiting" ? (
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
          <span className="text-micro text-basic-muted">
            Waiting for the browser
          </span>
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
    ) : signedIn ? (
      <div className="flex items-center gap-2">
        {failed || expired ? null : (
          <Button
            variant={ButtonVariant.Ghost}
            size={ButtonSize.Medium}
            content={ButtonContent.Text}
            loading={logout.isPending}
            onClick={() => void logout.mutateAsync(provider).catch(() => {})}
          >
            Logout
          </Button>
        )}
        {expired ? (
          <Button
            variant={ButtonVariant.Primary}
            size={ButtonSize.Medium}
            content={ButtonContent.IconRight}
            loading={state.status === "starting"}
            onClick={() => void start(provider)}
          >
            <span>Login again</span>
            <Icon iconName={IconName.External} />
          </Button>
        ) : (
          <div className="flex items-center gap-1.5 rounded-[4px] bg-success-secondary py-2 pl-2 pr-4">
            <Icon
              iconName={IconName.CheckCircle}
              className="text-success-primary"
            />
            <span className="label-small text-success-primary">Success</span>
          </div>
        )}
      </div>
    ) : (
      <Button
        variant={ButtonVariant.Primary}
        size={ButtonSize.Medium}
        content={ButtonContent.IconRight}
        loading={state.status === "starting"}
        onClick={() => void start(provider)}
      >
        <span>Login</span>
        <Icon iconName={IconName.External} />
      </Button>
    );

  return (
    <ConfigRow
      label="Authentication"
      invalid={failed || expired}
      hint="Signs in through the browser; every session on this provider shares the login."
      control={
        <div className="flex flex-col items-end gap-1">
          {control}
          {failed || expired ? (
            <p className="label-micro !text-[10px] !leading-[12px] text-error-primary max-w-[280px] text-right pt-1 opacity-70">
              {failed ? state.message : errorMessage(reach.error)}
            </p>
          ) : null}
        </div>
      }
    />
  );
}
