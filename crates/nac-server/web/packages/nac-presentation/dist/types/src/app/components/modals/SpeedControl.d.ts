import { type DiscoveredTier, type ServiceTier } from "../../lib/serviceTier";
/** The form always offers a repair path; the composer only offers discovered acceleration. */
export declare function SpeedControl({ tiers, value, onChange, disabled, form, }: {
    tiers: DiscoveredTier[] | null;
    value: ServiceTier | null;
    onChange: (value: ServiceTier | null) => void;
    disabled?: boolean;
    form?: boolean;
}): import("react").JSX.Element | null;
