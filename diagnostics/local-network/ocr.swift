// Private image in, closed category out. Never print recognized strings.
import Foundation
import Vision

func match(_ value: String) -> Bool {
    let normalized = value.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        .replacingOccurrences(of: "“", with: "\"")
        .replacingOccurrences(of: "”", with: "\"")
    return normalized == "Allow \"Python\" to find devices on local networks?"
}
if CommandLine.arguments == [CommandLine.arguments[0], "--self-test"] {
    precondition(match("Allow “Python” to find devices\non local networks?"))
    precondition(match("Allow \"Python\" to find devices on local networks?"))
    precondition(!match("Prefix Allow “Python” to find devices on local networks?"))
    precondition(!match("Allow “Python” to find devices on local networks? Suffix"))
    precondition(!match("Allow “Python” to find other devices on local networks?"))
    print("matcher controls passed")
    exit(0)
}
do {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard data.count <= 8 * 1024 * 1024 else { throw NSError(domain: "bounded", code: 1) }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.recognitionLanguages = ["en-US"]
    try VNImageRequestHandler(data: data).perform([request])
    let rows = (request.results ?? []).prefix(512).compactMap { $0.topCandidates(1).first?.string }
    var found = false
    for i in rows.indices {
        for j in i..<min(i + 3, rows.count) {
            if match(rows[i...j].joined(separator: " ")) { found = true }
        }
    }
    print(found ? "ocr_title_match" : "unknown")
} catch {
    print("unknown")
}
