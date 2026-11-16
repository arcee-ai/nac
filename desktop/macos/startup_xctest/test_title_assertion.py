"""Exact pure title decision; synthetic controls are not XCUI/SDK qualification."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


@unittest.skipUnless(os.environ.get('NAC342_SWIFT_TITLE_PROOF') == '1',
                     'Pure Swift onboarding title proof not requested')
class TitleAssertionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='nac342-title-proof-')
        cls.addClassCleanup(cls.temporary.cleanup)
        source = Path(__file__).with_name('StartupJourneys.swift').read_text()
        blocks = [source.split('// BEGIN ' + key, 1)[1].split('\n', 1)[1].split('// END ' + key, 1)[0]
                  for key in ('CONSOLE POLICY', 'PATH POLICY', 'QUERY DIAGNOSTIC', 'ONBOARDING TITLE')]
        driver = r'''
func rect(_ values: [Double]) -> CGRect {
    CGRect(x: values[0], y: values[1], width: values[2], height: values[3])
}
let rows = try JSONSerialization.jsonObject(with: FileHandle.standardInput.readDataToEndOfFile()) as! [[String: Any]]
let result: [[String: Any]] = rows.map { row in
    let mode = row["mode"] as? String ?? "value"
    var waits = 0, materializations = 0, projections = 0, verifications = 0, diagnostics = 0
    do {
        try StartupQueryDiagnostic.requireOnboarding(wait: {
            if mode == "legacy" { waits += 1; return row["legacy_exists"] as! Bool }
            return StartupOnboardingTitle.visible(wait: {
                waits += 1; return row["appeared"] as! Bool
            }, elements: {
                materializations += 1; return row["elements"] as! [[String: Any]]
            }, staticTextType: 48, project: { item in
                projections += 1
                let invalid = row["invalid_frame"] as? String
                let frame = invalid == "nan" ? CGRect(x: Double.nan, y: 0, width: 1, height: 1)
                    : invalid == "infinity" ? .infinite : rect(item["frame"] as! [Double])
                return StartupOnboardingTitle.Candidate(elementType: item["type"] as! Int,
                    exists: item["exists"] as! Bool, enabled: item["enabled"] as! Bool,
                    hittable: item["hittable"] as! Bool, value: item["value"], frame: frame)
            }, window: {
                row["invalid_window"] as? Bool == true ? .infinite : rect(row["window"] as! [Double])
            }, verify: {
                verifications += 1
                return (row["bindings"] as! [String: Bool]).values.allSatisfy { $0 }
            })
        }, diagnose: {
            // Only the historical label assertion has a v1 callback.
            if mode == "legacy" { diagnostics += 1 }
        })
        return ["passed": true, "waits": waits, "materializations": materializations,
                "projections": projections, "verifications": verifications, "diagnostics": diagnostics]
    } catch {
        let error = error as NSError
        return ["passed": false, "waits": waits, "materializations": materializations,
                "projections": projections, "verifications": verifications, "diagnostics": diagnostics,
                "domain": error.domain, "code": error.code, "message": error.localizedDescription]
    }
}
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]))
'''
        path = Path(cls.temporary.name) / 'main.swift'
        path.write_text('import Foundation\nimport CoreFoundation\nimport CoreGraphics\nimport Darwin\n'
                        + '\n'.join(blocks) + driver)
        cls.runner = path.with_name('title-proof')
        build = subprocess.run(['swiftc', '-swift-version', '5', str(path), '-o', str(cls.runner)], capture_output=True)
        if build.returncode:
            raise RuntimeError(build.stderr.decode())

    def run_rows(self, rows):
        result = subprocess.run([str(self.runner)], input=json.dumps(rows).encode(), check=True, capture_output=True)
        return json.loads(result.stdout)

    def sample(self):
        return dict(appeared=True, legacy_exists=False, window=[0, 0, 1024, 674],
                    elements=[dict(type=48, exists=True, enabled=True, hittable=True,
                                   value='No projects yet', frame=[453, 355, 172, 24])],
                    bindings={key: True for key in ('source', 'configuration', 'native_resource',
                        'app_incarnation', 'owned_window', 'foreground', 'console')})

    def assert_failure(self, result):
        self.assertFalse(result['passed'])
        self.assertEqual((result['domain'], result['code'], result['message']),
                         ('NAC342', 1, 'Shared onboarding absent'))
        self.assertEqual((result['waits'], result['diagnostics']), (1, 0))

    def test_observed_h14e_legacy_red_value_model_green(self):
        # Actual retained projection: label query 0; owned-window value query 1,
        # StaticText48/existing/enabled/hittable/intersecting/value_exact true.
        # No raw label/frame was retained: the rectangle below is SYNTHETIC.
        # Raw diagnostic SHA256: 1a2bc4759bf2c450833eeb53dc2f6afd643b44498f5756e942f8f673232397f6
        old, new = self.sample(), self.sample()
        old['mode'] = 'legacy'
        red, green = self.run_rows([old, new])
        self.assertFalse(red['passed'])
        self.assertEqual(red['message'], 'Shared onboarding absent')
        self.assertEqual(red['diagnostics'], 1)
        self.assertTrue(green['passed'])
        self.assertEqual([green[k] for k in ('waits', 'materializations', 'projections', 'verifications')], [1] * 4)
        self.assertEqual(green['diagnostics'], 0)
        print('H14e observed projection: old RED/new pure-model GREEN ' + json.dumps([red, green], sort_keys=True))

    def test_absence_and_ambiguity_stop_before_attribute_reads(self):
        absent, empty, duplicate = self.sample(), self.sample(), self.sample()
        absent['appeared'] = False
        empty['elements'] = []
        duplicate['elements'] *= 2
        for row, found in zip([absent, empty, duplicate], self.run_rows([absent, empty, duplicate])):
            self.assert_failure(found)
            self.assertEqual(found['materializations'], int(row['appeared']))
            self.assertEqual((found['projections'], found['verifications']), (0, 0))

    def test_exact_string_and_type_reject_other_label_success(self):
        rows = []
        for value in (None, True, 42, '', ' No projects yet', 'No projects yet ',
                      'No projects yet suffix', 'no projects yet', 'No Projects Yet'):
            row = self.sample()
            row['legacy_exists'] = True  # Cannot rescue the selected value assertion.
            row['elements'][0]['value'] = value
            rows.append(row)
        for kind in (0, 9, 46, 49):
            row = self.sample(); row['elements'][0]['type'] = kind; rows.append(row)
        for found in self.run_rows(rows):
            self.assert_failure(found)
            self.assertEqual(found['verifications'], 0)

    def test_existing_enabled_and_hittable_are_each_required(self):
        rows = []
        for key in ('exists', 'enabled', 'hittable'):
            row = self.sample(); row['elements'][0][key] = False; rows.append(row)
        for found in self.run_rows(rows):
            self.assert_failure(found)
            self.assertEqual(found['verifications'], 0)

    def test_finite_nonempty_intersecting_frames_are_required(self):
        rows = []
        for frame in ([0, 0, 0, 1], [0, 0, 1, 0], [0, 0, -1, 2], [2000, 2000, 10, 10]):
            row = self.sample(); row['elements'][0]['frame'] = frame; rows.append(row)
        for bounds in ([0, 0, 0, 1], [0, 0, 1, 0], [2000, 2000, 10, 10]):
            row = self.sample(); row['window'] = bounds; rows.append(row)
        for invalid in ('nan', 'infinity'):
            row = self.sample(); row['invalid_frame'] = invalid; rows.append(row)
        row = self.sample(); row['invalid_window'] = True; rows.append(row)
        for row, found in zip(rows, self.run_rows(rows)):
            with self.subTest(row=row):
                self.assert_failure(found)
                self.assertEqual(found['verifications'], 0)

    def test_final_original_bindings_cannot_be_bypassed(self):
        rows = []
        for key in self.sample()['bindings']:
            row = self.sample(); row['bindings'][key] = False; rows.append(row)
        for found in self.run_rows(rows):
            self.assert_failure(found)
            self.assertEqual((found['projections'], found['verifications']), (1, 1))


if __name__ == '__main__':
    unittest.main()
