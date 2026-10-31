import Foundation

/// Native failure projection. Receipt text never supplies a display message;
/// the protocol owner must validate version/incarnation before this projection.
enum EngineFailure: LocalizedError, Equatable {
    case storeOwned
    case message(String)

    static func startup(stage: String?, code: String?) -> EngineFailure {
        if stage == "startup", code == "store_owned" { return .storeOwned }
        return .message("The bundled engine could not initialize its selected store or listener.")
    }

    var errorDescription: String? {
        switch self {
        case .storeOwned: return "Another NAC process owns the selected store."
        case .message(let text): return text
        }
    }
}
