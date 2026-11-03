import Foundation

@main
enum EngineFailureTests {
    static func main() {
        precondition(EngineFailure.startup(stage: "startup", code: "store_owned") == .storeOwned)
        let fallback = EngineFailure.startup(stage: "startup", code: "engine_unavailable")
        for (stage, code) in [(nil, "store_owned"), ("untrusted-peer-text", "store_owned"),
                              ("startup", nil), ("startup", "untrusted-peer-text"), (nil, nil)] {
            let failure = EngineFailure.startup(stage: stage, code: code)
            precondition(failure == fallback)
            precondition(!failure.localizedDescription.contains("untrusted-peer-text"))
        }
        precondition(EngineFailure.storeOwned.localizedDescription.contains("selected store"))
        print("Fixed native failure projection passed; receipt validation remains the protocol owner's responsibility.")
    }
}
