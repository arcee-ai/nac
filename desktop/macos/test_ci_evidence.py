"""Compile unchanged reader/control code with injected framework adapters.

The fixtures are plain bytes, not PNGs. No AppKit, Vision/OCR request, product,
browser, hosted replay, UI input or original failed image is executed here.
"""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from ci import native_report

ADAPTERS = r'''
let fixture = try JSONSerialization.jsonObject(with: FileHandle.standardInput.readDataToEndOfFile()) as! [String: Any]
func mode(_ name: String) -> Bool { fixture["mode"] as? String == name }
let control = fixture["control"] as? String
if control != nil {
    var diagnostic = ImageDiagnostic(facts: ["observation_count": 100])
    if control == "invalid" { diagnostic.facts["invalid"] = Date() }
    if control == "oversized" { diagnostic.facts["oversized"] = String(repeating: "x", count: 20000) }
    if control == "candidates" {
        diagnostic.candidates = (0..<100).map {
            ImageDiagnostic.candidate(index: $0, confidence: .nan, box: [.infinity, 0, 1, 1],
                normalized: String(repeating: "fixture-only-", count: 1000), expected: ["fixed"])
        }
    }
    if control == "sink" {
        var calls = 0
        diagnostic.emit { _ in calls += 1; throw NSError(domain: "InjectedSink", code: 1) }
        print("{\"calls\":\(calls),\"continued\":true}")
    } else { FileHandle.standardOutput.write(diagnostic.encoded()) }
    exit(0)
}
struct NSColorSpaceName { let rawValue = "NSDeviceRGBColorSpace" }
final class NSImage {
    let size = CGSize(width: 1024, height: 642)
    init?(contentsOf: URL) { if mode("decode_nil") { return nil } }
}
final class NSBitmapImageRep {
    var pixelsWide: Int { fixture["width"] as? Int ?? 1024 }
    var pixelsHigh: Int { fixture["height"] as? Int ?? 642 }
    let hasAlpha = true, bitsPerPixel = 32, colorSpaceName = NSColorSpaceName()
    init?(data: Data) {}
}
final class Candidate {
    let string: String
    var confidence: Float { mode("nonfinite") ? .nan : 0.8 }
    init(_ text: String) { string = text }
}
final class Observation {
    let candidate: Candidate?
    var selections = 0
    var boundingBox: CGRect { CGRect(x: mode("nonfinite") ? .nan : 0.1, y: 0.2, width: 0.3, height: 0.1) }
    init(_ value: Any) { candidate = (value as? String).map(Candidate.init) }
    func topCandidates(_ count: Int) -> [Candidate] {
        selections += 1
        if count != 1 || selections != 1 { exit(98) }
        return candidate.map { [$0] } ?? []
    }
}
final class VNRecognizeTextRequest: NSObject {
    enum Level: Int { case fast, accurate }
    var recognitionLevel = Level.fast
    var usesLanguageCorrection = true
    let revision = 3, recognitionLanguages = ["en-US"]
    let minimumTextHeight: Float = 0
    let regionOfInterest = CGRect(x: 0, y: 0, width: 1, height: 1)
    var results: [Observation]? = mode("results_nil") ? nil :
        (fixture["texts"] as? [Any] ?? []).map(Observation.init)
}
final class VNImageRequestHandler {
    let url: URL
    static var invocations: [String: Int] = [:]
    init(url: URL) { self.url = url }
    func perform(_ requests: [VNRecognizeTextRequest]) throws {
        Self.invocations[url.path, default: 0] += 1
        guard Self.invocations[url.path] == 1, requests.count == 1,
              requests[0].recognitionLevel == .accurate, !requests[0].usesLanguageCorrection else { exit(99) }
        fputs("FIXTURE_RECOGNITION_ONCE\n", stderr)
        if mode("recognition_fail") { throw NSError(domain: "InjectedVision", code: 9) }
        if mode("second_failure") && Self.invocations.count == 2 { requests[0].results = [Observation("wrong")] }
        if mode("changed_file") { try Data("after".utf8).write(to: url) }
        if mode("deleted_file") { try FileManager.default.removeItem(at: url) }
    }
}
'''


@unittest.skipUnless(sys.platform == 'darwin' and shutil.which('swiftc'), 'Darwin Foundation compiler unavailable')
class ReaderDiagnosticControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='nac354-reader-controls-')
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name).resolve()
        source = Path(__file__).with_name('CIEvidence.swift').read_text()
        cls.production_source_sha256 = hashlib.sha256(source.encode()).hexdigest()
        helpers = source.split('// BEGIN IMAGE DIAGNOSTICS', 1)[1].split('\n', 1)[1].split('// END IMAGE DIAGNOSTICS', 1)[0]
        reader = 'func inspect' + source.split('func inspect', 1)[1]
        file = cls.root / 'main.swift'
        file.write_text('import Foundation\nimport CryptoKit\nimport CoreGraphics\n' + helpers + ADAPTERS + reader)
        cls.executable = cls.root / 'ReaderControls'
        result = subprocess.run(['xcrun', 'swiftc', '-swift-version', '5', str(file), '-o', str(cls.executable)],
                                capture_output=True, text=True, timeout=45)
        if result.returncode:
            raise AssertionError(result.stderr[-8192:])
        cls.records = []

    def invoke(self, texts=(), *, mode=None, exists=True, large=False, image_count=1, **values):
        image = self.root / 'plain-fixture-bytes-not-a-PNG.dat'
        images = [image] if image_count == 1 else [self.root / f'plain-{n}.dat' for n in range(image_count)]
        for path in images:
            if exists:
                path.write_bytes(b'x' * (2 * 1024 * 1024 + 1) if large else b'before')
            else:
                path.unlink(missing_ok=True)
        result = subprocess.run([str(self.executable), '--terminal', *map(str, images)],
            input=json.dumps({'texts': texts, 'mode': mode, **values}), capture_output=True, text=True, timeout=5)
        diagnostics = [json.loads(line) for line in result.stderr.splitlines() if line.startswith('{')]
        if 'control' not in values:
            self.assertEqual(len(diagnostics), image_count, result.stderr)
            for line in (line for line in result.stderr.splitlines() if line.startswith('{')):
                self.assertLessEqual(len(line.encode()) + 1, 8192)
                self.assertEqual(json.loads(line)['schema'], 'nac-ci-image-diagnostic-v1')
        self.records.append({'input': {'texts': texts, 'mode': mode, **values}, 'exit': result.returncode,
                             'stdout': result.stdout, 'stderr': result.stderr})
        return result, diagnostics[0] if diagnostics else None

    def test_original_success_and_failure_stdout_exit_and_single_request_survive(self):
        result, diagnostic = self.invoke(['NAC354_TRUSTED_OK'])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), [{'file': 'plain-fixture-bytes-not-a-PNG.dat',
            'width': 1024, 'height': 642, 'logical_width': 1024,
            'readable_fixture_text': True, 'fixture_kind': 'terminal'}])
        self.assertEqual(diagnostic['phase'], 'passed')
        self.assertEqual(diagnostic['comparison']['fixed_marker_membership'], [True])
        self.assertEqual(result.stderr.count('FIXTURE_RECOGNITION_ONCE'), 1)
        with tempfile.TemporaryDirectory() as temporary, patch('ci.subprocess.run', return_value=result):
            log = Path(temporary) / 'reader.log'
            self.assertEqual(native_report(['synthetic-reader-no-process'], log), json.loads(result.stdout))
            self.assertEqual(log.read_text(), result.stderr)
        result, diagnostic = self.invoke(['NAC354_TRUSTED_0K'])
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, '')
        self.assertIn('Fixture transcript is not readable in WKWebView snapshot', result.stderr)
        self.assertEqual(diagnostic['phase'], 'marker')
        self.assertEqual(diagnostic['comparison']['fixed_marker_membership'], [False])
        self.assertEqual(result.stderr.count('FIXTURE_RECOGNITION_ONCE'), 1)
        with tempfile.TemporaryDirectory() as temporary, patch('ci.subprocess.run', return_value=result):
            log = Path(temporary) / 'reader.log'
            with self.assertRaisesRegex(RuntimeError, r'failed \(1\)'):
                native_report(['synthetic-reader-no-process'], log)
            self.assertEqual(log.read_text(), result.stderr)

    def test_original_normalization_join_and_missing_top1_behavior_survive(self):
        result, diagnostic = self.invoke(['nac354_', None, 'trusted_ok'])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(diagnostic['observation_count'], 3)
        self.assertEqual(diagnostic['top1_count'], 2)
        self.assertTrue(diagnostic['candidates'][1]['top1_unavailable'])
        self.assertIsNone(diagnostic['candidates'][1]['normalized_sha256'])
        for texts, mode in [([], None), ([], 'results_nil')]:
            result, diagnostic = self.invoke(texts, mode=mode)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(diagnostic['results_available'], mode != 'results_nil')
            self.assertEqual(diagnostic['observation_count'], None if mode else 0)

    def test_two_image_caller_fanout_has_one_record_per_image_and_original_failure(self):
        result, _ = self.invoke(['NAC354_TRUSTED_OK'], image_count=2)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(json.loads(result.stdout)), 2)
        with tempfile.TemporaryDirectory() as temporary, patch('ci.subprocess.run', return_value=result):
            log = Path(temporary) / 'reader.log'
            self.assertEqual(len(native_report(['synthetic-reader-no-process'], log)), 2)
            self.assertEqual(log.read_text(), result.stderr)
        result, _ = self.invoke(['NAC354_TRUSTED_OK'], image_count=2, mode='second_failure')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, '')
        diagnostics = [json.loads(line) for line in result.stderr.splitlines() if line.startswith('{')]
        self.assertEqual([d['phase'] for d in diagnostics], ['passed', 'marker'])

    def test_metadata_caps_never_cap_original_predicate_or_collect_raw_text(self):
        private_text = 'synthetic-private-DO-NOT-EXPORT'
        texts = [private_text * 100] * 80 + ['NAC354_TRUSTED_OK']
        result, diagnostic = self.invoke(texts)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(diagnostic['observation_count'], 81)
        self.assertEqual(diagnostic['top1_count'], 81)
        self.assertTrue(diagnostic['candidate_metadata_truncated'])
        self.assertLessEqual(len(diagnostic['candidates']), 32)
        self.assertEqual(diagnostic['comparison']['fixed_marker_membership'], [True])
        self.assertNotIn(private_text, result.stdout + result.stderr)
        self.assertNotIn('NAC354_TRUSTED_OK', result.stdout + result.stderr)

    def test_file_hash_bookends_are_independent_and_unavailable_is_honest(self):
        before = hashlib.sha256(b'before').hexdigest()
        result, diagnostic = self.invoke(['NAC354_TRUSTED_OK'], mode='changed_file')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(diagnostic['before']['sha256'], before)
        self.assertEqual(diagnostic['after']['sha256'], hashlib.sha256(b'after').hexdigest())
        result, diagnostic = self.invoke(['NAC354_TRUSTED_OK'], mode='deleted_file')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(diagnostic['before']['sha256'], before)
        self.assertIsNone(diagnostic['after']['sha256'])
        self.assertEqual(diagnostic['after']['unavailable'], 'diagnostic_read_failed')
        result, diagnostic = self.invoke([], exists=False)
        self.assertEqual(result.returncode, 1)
        self.assertIsNone(diagnostic['before']['sha256'])
        self.assertEqual(diagnostic['phase'], 'decode')
        result, diagnostic = self.invoke(['NAC354_TRUSTED_OK'], large=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        for key in ('before', 'after'):
            self.assertIsNone(diagnostic[key]['sha256'])
            self.assertIsNone(diagnostic[key]['bytes'])
            self.assertEqual(diagnostic[key]['read_bytes'], 2 * 1024 * 1024 + 1)
            self.assertEqual(diagnostic[key]['unavailable'], 'diagnostic_byte_limit')

    def test_decoder_recognizer_failure_and_nonfinite_metadata_preserve_outcome(self):
        for mode, phase, error in [('decode_nil', 'decode', 'Missing/full-size PNG'),
                                    ('recognition_fail', 'recognition', 'InjectedVision')]:
            result, diagnostic = self.invoke(['NAC354_TRUSTED_OK'], mode=mode)
            self.assertEqual(result.returncode, 1)
            self.assertIn(error, result.stderr)
            self.assertEqual(diagnostic['phase'], phase)
            self.assertIsNone(diagnostic['observation_count'])
        result, diagnostic = self.invoke(['NAC354_TRUSTED_OK'], mode='nonfinite')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIsNone(diagnostic['candidates'][0]['confidence'])
        self.assertIn(None, diagnostic['candidates'][0]['box'])
        self.assertTrue(diagnostic['candidates'][0]['nonfinite'])

    def test_encoder_and_sink_failures_are_bounded_and_do_not_escape(self):
        for control in ['invalid', 'oversized', 'candidates']:
            result, _ = self.invoke(control=control)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertLessEqual(len(result.stdout.encode()), 8192)
            value = json.loads(result.stdout)
            self.assertTrue(value['candidate_metadata_truncated'])
            if control != 'candidates':
                self.assertEqual(value['unavailable'], 'diagnostic_encoding_or_size')
        result, _ = self.invoke(control='sink')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {'calls': 1, 'continued': True})


class OriginalCallerControls(unittest.TestCase):
    def test_actual_caller_keeps_json_stdout_and_retains_stderr_on_both_outcomes(self):
        diagnostic = '{"schema":"nac-ci-image-diagnostic-v1","phase":"marker"}\n'
        with tempfile.TemporaryDirectory() as temporary:
            log = Path(temporary) / 'reader.log'
            output = [{'readable_fixture_text': True}]
            result = SimpleNamespace(returncode=0, stdout=json.dumps(output), stderr=diagnostic)
            with patch('ci.subprocess.run', return_value=result):
                self.assertEqual(native_report(['synthetic-reader-no-process'], log), output)
            self.assertEqual(log.read_text(), diagnostic)
            result = SimpleNamespace(returncode=1, stdout='', stderr=diagnostic + 'original reader error\n')
            with patch('ci.subprocess.run', return_value=result), self.assertRaisesRegex(RuntimeError, r'failed \(1\)'):
                native_report(['synthetic-reader-no-process'], log)
            self.assertEqual(log.read_text(), result.stderr)


if __name__ == '__main__':
    unittest.main()
