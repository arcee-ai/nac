import Foundation

/// Native failure projection. Receipt text never supplies a display message;
/// the protocol owner must validate version/incarnation before this projection.
enum EngineFailure: LocalizedError, Equatable {
    case storeOwned
    case storeSchemaIncompatible
    case message(String)

    static func startup(stage: String?, code: String?) -> EngineFailure {
        if stage == "startup", code == "store_owned" { return .storeOwned }
        if stage == "startup", code == "store_schema_incompatible" { return .storeSchemaIncompatible }
        return .message("The bundled engine could not initialize its selected store or listener. Check directory access and whether another NAC process owns this store.")
    }

    var errorDescription: String? {
        switch self {
        case .storeOwned: return "Another NAC process owns the selected store."
        case .storeSchemaIncompatible: return "The selected store uses a newer database schema. Quit NAC and reopen this store with a compatible version of NAC. Keep your configuration and data; do not delete or downgrade the store. No alternative store was selected."
        case .message(let text): return text
        }
    }
}
