import type { BackendKind } from "../../../types/api";
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
export declare function ManagedAuthCallout({ backend, className, }: {
    backend: BackendKind;
    className?: string;
}): import("react").JSX.Element | null;
