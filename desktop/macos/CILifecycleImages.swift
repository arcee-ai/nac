import AppKit
import Darwin
import Vision

// Finite ALL-344 snapshot readability only. These are WK snapshots and owned
// AppKit cacheDisplay images, never composited OS paint or trusted input proof.
do {
    let arguments = CommandLine.arguments
    guard arguments.count == 3, ["workspace", "sheet"].contains(arguments[1]) else {
        throw NSError(domain: "LifecycleImage", code: 1)
    }
    let role = arguments[1]
    let url = URL(fileURLWithPath: arguments[2])
    let data = try Data(contentsOf: url)
    guard data.count <= 2 * 1024 * 1024,
          data.starts(with: [137, 80, 78, 71, 13, 10, 26, 10]),
          let bitmap = NSBitmapImageRep(data: data), let image = bitmap.cgImage else {
        throw NSError(domain: "LifecycleImage", code: 2)
    }
    let minimum = role == "sheet" ? (200, 100) : (800, 500)
    guard image.width >= minimum.0, image.height >= minimum.1,
          image.width <= 4096, image.height <= 4096 else {
        throw NSError(domain: "LifecycleImage", code: 3)
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
    let normalized = text.lowercased().filter { $0.isLetter || $0.isNumber }
    let sheetControls = normalized.contains("cancel") && normalized.contains("stopandquit")
    let readable = !normalized.isEmpty && (role != "sheet" || sheetControls)
    let result: [String: Any] = ["role": role, "width": image.width, "height": image.height,
        "readable": readable, "recognized_observations": request.results?.count ?? 0,
        "sheet_controls": role == "sheet" ? sheetControls : false,
        "method": "decoded PNG and one accurate Vision request; manual image inspection required",
        "composited_paint_acceptance": false, "trusted_input_acceptance": false]
    let output = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    FileHandle.standardOutput.write(output)
    FileHandle.standardOutput.write(Data([10]))
    if !readable { exit(2) }
} catch {
    FileHandle.standardError.write(Data("Lifecycle PNG readability failed: \(error)\n".utf8))
    exit(2)
}
