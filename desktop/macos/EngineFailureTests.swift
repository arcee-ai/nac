import Foundation

@main
enum EngineFailureTests {
    static func main() {
        precondition(EngineFailure.startup(stage: "startup", code: "store_owned") == .storeOwned)
        let guidance = "The selected store uses a newer database schema. Quit NAC and reopen this store with a compatible version of NAC. Keep your configuration and data; do not delete or downgrade the store. No alternative store was selected."
        let schema = EngineFailure.startup(stage: "startup", code: "store_schema_incompatible")
        precondition(schema == .storeSchemaIncompatible && schema.localizedDescription == guidance)
        let fallback = EngineFailure.startup(stage: "startup", code: "engine_unavailable")
        precondition(!fallback.localizedDescription.contains("newer NAC version"))
        precondition(!fallback.localizedDescription.contains("compatible version"))
        for (stage, code) in [(nil, "store_owned"), ("untrusted-peer-text", "store_owned"),
                              ("startup", nil), ("startup", "untrusted-peer-text"), (nil, nil),
                              (nil, "store_schema_incompatible"), ("untrusted-peer-text", "store_schema_incompatible")] {
            let failure = EngineFailure.startup(stage: stage, code: code)
            precondition(failure == fallback)
            precondition(!failure.localizedDescription.contains("untrusted-peer-text"))
        }
        precondition(EngineFailure.storeOwned.localizedDescription.contains("selected store"))
        print("Fixed native failure projection passed; receipt validation remains the protocol owner's responsibility.")
    }
}
