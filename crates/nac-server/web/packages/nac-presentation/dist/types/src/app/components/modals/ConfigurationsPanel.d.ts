import type { BackendKind, CreateModelConfigurationRequest, LightModelSettings } from "../../types/api";
/** What the panel hands the launch form once a provider setup is complete. */
export type LaunchModelSelection = {
    kind: "save";
    request: CreateModelConfigurationRequest;
} | {
    kind: "resolved";
    backend: BackendKind;
    model: string;
    base_url: string;
    allow_insecure_http: boolean;
    api_key_env: string | null;
    reasoning_effort: string | null;
    extra_headers: Record<string, string> | null;
    /**
     * An explicitly selected saved preset owns its compaction policy. An
     * omitted value preserves the project/session inheritance already
     * resolved by the server.
     */
    orchestrator_compaction_threshold?: number | null;
    /**
     * Light model for the launch form to seed from. A saved setup is
     * authoritative: its light model, or `null` for an explicitly
     * single-model setup. `undefined` means the source carries no opinion
     * (catalog and file launches), so the form keeps its own memory.
     */
    light_model: LightModelSettings | null | undefined;
    /**
     * The saved configuration this resolved from, when there is one. A
     * catalog or file pick has nothing to point at, which is why a project
     * created from one gets no default configuration.
     */
    config_id?: string | null;
};
export interface ConfigurationsPanelInitial {
    backend: BackendKind;
    model: string;
    base_url: string;
    allow_insecure_http?: boolean;
    api_key_env: string | null;
    reasoning_effort: string | null;
    extra_headers: Record<string, string>;
    orchestrator_compaction_threshold?: number | null;
    light_model?: LightModelSettings | null;
    config_id?: string | null;
}
/**
 * Picks the provider setup a new session launches with: a model chosen out of
 * the catalog, a fresh setup, one saved earlier, or one read out of a
 * `config.toml`.
 *
 * A key is checked by listing the models it can reach, which is also where the
 * default model choices come from — the same request answers both questions.
 * Keys are handed to the server only to be validated, and are persisted solely
 * as part of saving a named configuration. Browsing the catalog asks for
 * nothing: it is local data, and a provider the server already authenticates as
 * launches straight from it.
 */
export declare function ConfigurationsPanel({ invalid, errorText, onChange, initial, children, }: {
    /** The launch attempt failed on something the box owns. */
    invalid: boolean;
    errorText?: string;
    onChange: (selection: LaunchModelSelection | null) => void;
    /** Existing session setup to preserve until another source is selected. */
    initial?: ConfigurationsPanelInitial;
    /** Advanced section, which the design nests at the bottom of the box. */
    children?: React.ReactNode;
}): import("react").JSX.Element;
