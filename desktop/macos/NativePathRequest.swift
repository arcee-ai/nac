import Foundation
import CoreFoundation

enum NativePathRequest {
    case choose(id: Int, initialPath: String)
    case cancel(id: Int)

    static func decode(_ body: String, binding: NativeDocumentBinding) -> NativePathRequest? {
        guard body.utf8.count <= 20_480, let data = body.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let version = object["version"] as? NSNumber,
              CFGetTypeID(version) != CFBooleanGetTypeID(), version == 1,
              object["launch"] as? String == binding.launch,
              object["view"] as? String == binding.view,
              object["document"] as? String == binding.document,
              let id = object["request"] as? NSNumber, CFGetTypeID(id) != CFBooleanGetTypeID(),
              id.doubleValue >= 1, id.doubleValue <= Double(Int32.max),
              id.doubleValue.rounded() == id.doubleValue else { return nil }
        let common: Set<String> = ["version", "kind", "launch", "view", "document", "request"]
        switch object["kind"] as? String {
        case "choose":
            guard Set(object.keys) == common.union(["initialPath"]),
                  let path = object["initialPath"] as? String,
                  path.utf8.count <= 16_384, !path.unicodeScalars.contains(where: { $0.value == 0 }) else { return nil }
            return .choose(id: id.intValue, initialPath: path)
        case "cancel":
            guard Set(object.keys) == common else { return nil }
            return .cancel(id: id.intValue)
        default: return nil
        }
    }
}
