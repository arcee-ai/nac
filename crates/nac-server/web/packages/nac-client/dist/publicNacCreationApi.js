/**
 * Explicit source ports for the frozen creation/metadata operations. This is not
 * installed into the presentation runtime or its closed collection commands.
 * Command results describe delivery fate, never backend admission or permission.
 */
export function createPublicNacCreationApi(client, source) {
    if (source.contract !== "public-native-v1" ||
        client.transport.jsonResponseDecodingVersion !== 1 ||
        typeof client.transport.admit !== "function") {
        throw new Error("Public native creation requires its explicit wire codecs and transport support.");
    }
    if (!source.decoders || !source.requests)
        throw new Error("Missing public native creation codec.");
    for (const name of [
        "workingLocations",
        "runtimeMetadata",
        "project",
        "createdSession",
    ]) {
        if (typeof source.decoders[name] !== "function")
            throw new Error("Missing public native creation codec.");
    }
    for (const name of ["project", "session"]) {
        if (typeof source.requests[name] !== "function")
            throw new Error("Missing public native creation codec.");
    }
    const decoders = Object.freeze({ ...source.decoders });
    const validators = Object.freeze({ ...source.requests });
    const request = client.transport.request.bind(client.transport);
    const admit = client.transport.admit.bind(client.transport);
    return Object.freeze({
        listWorkingLocations: (signal) => request("GET", "/public/working-locations", {
            signal,
            decodeJson: decoders.workingLocations,
        }),
        getRuntimeMetadata: (signal) => request("GET", "/public/runtime-metadata", {
            signal,
            decodeJson: decoders.runtimeMetadata,
        }),
        createProject: (payload, options = {}) => {
            // Frozen DTOs contain scalar fields only. Capture after canonical validation
            // and before any asynchronous credential refresh in the original transport.
            const body = Object.freeze({ ...validators.project(payload) });
            return admit("POST", "/public/projects", {
                signal: options.signal,
                requestId: options.requestId,
                body,
                decodeJson: decoders.project,
            });
        },
        createSession: (payload, options = {}) => {
            const body = Object.freeze({ ...validators.session(payload) });
            return admit("POST", "/public/sessions", {
                signal: options.signal,
                requestId: options.requestId,
                body,
                decodeJson: decoders.createdSession,
            });
        },
    });
}
