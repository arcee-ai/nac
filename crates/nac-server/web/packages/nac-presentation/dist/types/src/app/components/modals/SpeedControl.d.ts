import { type ReactNode } from "react";
import { type DiscoveredTier, type ServiceTier } from "../../lib/serviceTier";
/** The form always offers a repair path; the composer only offers discovered acceleration. */
export declare function SpeedControl({ tiers, value, onChange, disabled, form, openAiApi, fastContextLimit, }: {
    tiers: DiscoveredTier[] | null;
    value: ServiceTier | null;
    onChange: (value: ServiceTier | null) => void;
    disabled?: boolean;
    form?: boolean;
    openAiApi?: boolean;
    /** Exclusive input-token limit documented for Fast mode, when applicable. */
    fastContextLimit?: number | null;
}): string | number | bigint | boolean | Iterable<ReactNode> | Promise<string | number | bigint | boolean | import("react").ReactPortal | import("react").ReactElement<unknown, string | import("react").JSXElementConstructor<any>> | Iterable<ReactNode> | null | undefined> | import("react").JSX.Element | null | undefined;
