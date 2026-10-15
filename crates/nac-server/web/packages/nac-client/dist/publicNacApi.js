/** Additive public reads over the caller's existing authenticated native transport. */
export function createPublicNacApi(client, source) {
    if (source.contract !== "public-native-v1" ||
        client.transport.jsonResponseDecodingVersion !== 1) {
        throw new Error("Public native presentation requires its explicit wire contract and response codec support.");
    }
    if (!source.decoders)
        throw new Error("Missing public native response codec.");
    for (const name of [
        "uiConfiguration",
        "modelCatalog",
        "modelConfigs",
        "projects",
        "sessions",
        "sessionConfig",
    ]) {
        if (typeof source.decoders[name] !== "function")
            throw new Error("Missing public native response codec.");
    }
    const decoders = Object.freeze({ ...source.decoders });
    const request = client.transport.request.bind(client.transport);
    return Object.freeze({
        getUiConfiguration: (signal) => request("GET", "/public/ui-config", {
            signal,
            decodeJson: decoders.uiConfiguration,
        }),
        getModelCatalog: (signal) => request("GET", "/public/models", {
            signal,
            decodeJson: decoders.modelCatalog,
        }),
        listModelConfigs: (signal) => request("GET", "/public/model-configs", {
            signal,
            decodeJson: decoders.modelConfigs,
        }),
        listProjects: (signal) => request("GET", "/public/projects", {
            signal,
            decodeJson: decoders.projects,
        }),
        listSessions: (options = {}, signal) => {
            const params = new URLSearchParams();
            if (options.projectId !== undefined)
                params.set("project_id", options.projectId);
            if (options.workspaceStats !== undefined) {
                params.set("workspace_stats", String(options.workspaceStats));
            }
            const query = params.size ? `?${params.toString()}` : "";
            return request("GET", `/public/sessions${query}`, {
                signal,
                decodeJson: decoders.sessions,
            });
        },
        getSessionConfig: (sessionId, signal) => request("GET", `/public/sessions/${encodeURIComponent(sessionId)}/config`, { signal, decodeJson: decoders.sessionConfig }),
    });
}
