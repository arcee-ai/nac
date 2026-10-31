// Standalone CI evidence reader; never compiled into either app executable.
import AppKit
import Vision

func inspect(_ path: String, kind: String) throws -> [String: Any] {
    let url = URL(fileURLWithPath: path)
    guard let image = NSImage(contentsOf: url),
          let bitmap = NSBitmapImageRep(data: try Data(contentsOf: url)),
          bitmap.pixelsWide >= 800, bitmap.pixelsHigh >= 500 else {
        throw NSError(domain: "NACCI", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing/full-size PNG required"])
    }
    // Decode the real snapshot with Apple's on-device OCR. A blank image or
    // loading shimmer cannot satisfy the known persisted fixture transcript.
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    try VNImageRequestHandler(url: url).perform([request])
    let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
    let markers = ["chat": "Hello from the isolated NAC Mac preview", "terminal": "NAC354_TRUSTED_OK",
                   "workspace": "WK_RICH_COMPLETE", "approval": "Permission required"]
    let expected = markers[kind]!
    func normalized(_ value: String) -> String { value.lowercased().filter { $0.isLetter || $0.isNumber } }
    guard normalized(text).contains(normalized(expected)) else {
        throw NSError(domain: "NACCI", code: 2, userInfo: [NSLocalizedDescriptionKey: "Fixture transcript is not readable in WKWebView snapshot"])
    }
    return ["file": url.lastPathComponent, "width": bitmap.pixelsWide,
            "height": bitmap.pixelsHigh,
            "readable_fixture_text": true, "fixture_kind": kind,
            "logical_width": image.size.width]
}

do {
    var paths = Array(CommandLine.arguments.dropFirst())
    let modes = ["--terminal": "terminal", "--workspace": "workspace", "--approval": "approval"]
    let kind = paths.first.flatMap { modes[$0] } ?? "chat"
    if kind != "chat" { paths.removeFirst() }
    guard !paths.isEmpty else { throw NSError(domain: "NACCI", code: 3) }
    let results = try paths.map { try inspect($0, kind: kind) }
    let data = try JSONSerialization.data(withJSONObject: results, options: [.prettyPrinted, .sortedKeys])
    print(String(decoding: data, as: UTF8.self))
} catch {
    fputs("Native image qualification failed: \(error)\n", stderr)
    exit(1)
}
