// Standalone CI evidence reader; never compiled into either app executable.
import AppKit
import CryptoKit
import Vision

// BEGIN IMAGE DIAGNOSTICS (Foundation-only injected controls compile unchanged)
struct ImageDiagnostic {
    static let byteLimit = 8192
    static let candidateLimit = 32
    static let imageReadLimit = 2 * 1024 * 1024
    var phase = "decode"
    var facts: [String: Any]
    var candidates: [[String: Any]] = []

    static func sha(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    static func finite(_ value: Double) -> Any { value.isFinite ? value as Any : NSNull() }

    static func fact(_ value: String?) -> [String: Any] {
        ["value": value.map { String($0.prefix(128)) as Any } ?? NSNull(),
         "unavailable": value == nil, "truncated": (value?.count ?? 0) > 128]
    }

    static func snapshot(_ url: URL) -> [String: Any] {
        do {
            let handle = try FileHandle(forReadingFrom: url)
            defer { try? handle.close() }
            var data = Data()
            while data.count <= imageReadLimit {
                let chunk = try handle.read(upToCount: min(65536, imageReadLimit + 1 - data.count)) ?? Data()
                if chunk.isEmpty {
                    return ["sha256": sha(data), "bytes": data.count, "complete_read": true]
                }
                data.append(chunk)
            }
            return ["sha256": NSNull(), "bytes": NSNull(), "read_bytes": data.count,
                    "complete_read": false, "unavailable": "diagnostic_byte_limit"]
        } catch {
            return ["sha256": NSNull(), "bytes": NSNull(), "complete_read": false,
                    "unavailable": "diagnostic_read_failed"]
        }
    }

    static func candidate(index: Int, confidence: Double?, box: [Double], normalized: String?,
                          expected: [String]) -> [String: Any] {
        var result: [String: Any] = ["index": index, "confidence": confidence.map(finite) ?? NSNull(),
            "box": box.map(finite), "top1_unavailable": normalized == nil,
            "nonfinite": (confidence.map { !$0.isFinite } ?? false) || box.contains { !$0.isFinite }]
        if let normalized {
            result["normalized_utf8_bytes"] = normalized.utf8.count
            result["normalized_sha256"] = sha(Data(normalized.utf8))
            result["fixed_marker_membership"] = expected.map { normalized.contains($0) }
        } else {
            result["normalized_utf8_bytes"] = NSNull()
            result["normalized_sha256"] = NSNull()
            result["fixed_marker_membership"] = NSNull()
        }
        return result
    }

    func encoded() -> Data {
        var record = facts
        record["schema"] = "nac-ci-image-diagnostic-v1"
        record["phase"] = phase
        var retained = Array(candidates.prefix(Self.candidateLimit))
        while true {
            record["candidates"] = retained
            record["candidate_metadata_truncated"] = retained.count < candidates.count
                || (facts["observation_count"] as? Int ?? 0) > retained.count
            if JSONSerialization.isValidJSONObject(record),
               let data = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]),
               data.count + 1 <= Self.byteLimit { return data + Data([10]) }
            guard !retained.isEmpty else { break }
            retained.removeLast()
        }
        // Diagnostic serialization/size failure must never replace the result.
        return Data("{\"schema\":\"nac-ci-image-diagnostic-v1\",\"unavailable\":\"diagnostic_encoding_or_size\",\"candidate_metadata_truncated\":true}\n".utf8)
    }

    func emit(sink: (Data) throws -> Void = { try FileHandle.standardError.write(contentsOf: $0) }) {
        try? sink(encoded())
    }
}
// END IMAGE DIAGNOSTICS

func inspect(_ path: String, kind: String) throws -> [String: Any] {
    let url = URL(fileURLWithPath: path)
    let os = ProcessInfo.processInfo.operatingSystemVersion
    let vision = Bundle(for: VNRecognizeTextRequest.self)
    var diagnostic = ImageDiagnostic(facts: ["fixture_kind": kind, "before": ImageDiagnostic.snapshot(url),
        "os": ["major": os.majorVersion, "minor": os.minorVersion, "patch": os.patchVersion],
        "vision_version": ImageDiagnostic.fact(vision.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String),
        "vision_build": ImageDiagnostic.fact(vision.object(forInfoDictionaryKey: "CFBundleVersion") as? String),
        "decoder": NSNull(), "request": NSNull(), "results_available": false,
        "observation_count": NSNull(), "top1_count": NSNull(), "comparison": NSNull(),
        "byte_observation_scope": "Independent file reads before/after inspect; not Vision internal bytes"])
    defer {
        diagnostic.facts["after"] = ImageDiagnostic.snapshot(url)
        diagnostic.emit()
    }
    guard let image = NSImage(contentsOf: url),
          let bitmap = NSBitmapImageRep(data: try Data(contentsOf: url)),
          bitmap.pixelsWide >= 800, bitmap.pixelsHigh >= 500 else {
        throw NSError(domain: "NACCI", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing/full-size PNG required"])
    }
    diagnostic.facts["decoder"] = ["width": bitmap.pixelsWide, "height": bitmap.pixelsHigh,
        "has_alpha": bitmap.hasAlpha, "bits_per_pixel": bitmap.bitsPerPixel,
        "color_space": ImageDiagnostic.fact(bitmap.colorSpaceName.rawValue)]
    diagnostic.phase = "recognition"
    // Decode the real snapshot with Apple's on-device OCR. A blank image or
    // loading shimmer cannot satisfy the known persisted fixture transcript.
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    diagnostic.facts["request"] = ["revision": request.revision, "recognition_level": request.recognitionLevel.rawValue,
        "language_correction": request.usesLanguageCorrection,
        "languages": Array(request.recognitionLanguages.prefix(8)).map { ImageDiagnostic.fact($0) },
        "languages_truncated": request.recognitionLanguages.count > 8,
        "minimum_text_height": ImageDiagnostic.finite(Double(request.minimumTextHeight)),
        "region": [Double(request.regionOfInterest.minX), Double(request.regionOfInterest.minY),
                   Double(request.regionOfInterest.width), Double(request.regionOfInterest.height)].map(ImageDiagnostic.finite)]
    try VNImageRequestHandler(url: url).perform([request])
    // Capture the exact top1 selections once for both the original comparison
    // and metadata. The diagnostic cap never limits the compared observations.
    let observedResults = request.results
    let observations = observedResults ?? []
    let top1 = observations.map { $0.topCandidates(1).first }
    let text = top1.compactMap { $0?.string }.joined(separator: " ")
    let markers = ["chat": ["Hello from the isolated NAC Mac preview"], "terminal": ["NAC354_TRUSTED_XY"],
                   "workspace": ["WK_RICH_COMPLETE"], "approval": ["Permission required"],
                   "instance-empty": ["No projects yet", "Get Started"],
                   "instance-conflict": ["Another NAC process", "Retry", "store-path"],
                   "instance-drain": ["Native instance", "drain"],
                   "startup-configured": ["Finder configured local response."],
                   "startup-invalid": ["config.toml", "repair", "relaunch"],
                   "startup-future": ["The selected store uses a newer database schema. Quit NAC and reopen this store with a compatible newer NAC app. Keep your configuration and data; do not delete or downgrade the store. No alternative store was selected."],
                   "terminal-unicode": ["WK-XCTEST-UNICODE"],
                   "terminal-completed": ["WK-XCTEST-RECOVERED", "WK-XCTEST-SIZE"]]
    let expected = markers[kind]!
    func normalized(_ value: String) -> String { value.lowercased().filter { $0.isLetter || $0.isNumber } }
    diagnostic.phase = "marker"
    diagnostic.facts["results_available"] = observedResults != nil
    diagnostic.facts["observation_count"] = observedResults.map { $0.count as Any } ?? NSNull()
    diagnostic.facts["top1_count"] = observedResults.map { _ in top1.compactMap { $0 }.count as Any } ?? NSNull()
    diagnostic.facts["comparison"] = ["normalized_utf8_bytes": normalized(text).utf8.count,
        "normalized_sha256": ImageDiagnostic.sha(Data(normalized(text).utf8)),
        "fixed_marker_membership": expected.map { normalized(text).contains(normalized($0)) }]
    for (index, row) in observations.prefix(ImageDiagnostic.candidateLimit).enumerated() {
        diagnostic.candidates.append(ImageDiagnostic.candidate(index: index,
            confidence: top1[index].map { Double($0.confidence) },
            box: [Double(row.boundingBox.minX), Double(row.boundingBox.minY),
                  Double(row.boundingBox.width), Double(row.boundingBox.height)],
            normalized: top1[index].map { normalized($0.string) }, expected: expected.map(normalized)))
    }
    guard expected.allSatisfy({ normalized(text).contains(normalized($0)) }) else {
        throw NSError(domain: "NACCI", code: 2, userInfo: [NSLocalizedDescriptionKey: "Fixture transcript is not readable in WKWebView snapshot"])
    }
    diagnostic.phase = "passed"
    return ["file": url.lastPathComponent, "width": bitmap.pixelsWide,
            "height": bitmap.pixelsHigh,
            "readable_fixture_text": true, "fixture_kind": kind,
            "logical_width": image.size.width]
}

do {
    var paths = Array(CommandLine.arguments.dropFirst())
    let modes = ["--terminal": "terminal", "--workspace": "workspace", "--approval": "approval",
                 "--instance-empty": "instance-empty", "--instance-conflict": "instance-conflict", "--instance-drain": "instance-drain",
                 "--startup-configured": "startup-configured", "--startup-invalid": "startup-invalid", "--startup-future": "startup-future",
                 "--terminal-unicode": "terminal-unicode", "--terminal-completed": "terminal-completed"]
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
