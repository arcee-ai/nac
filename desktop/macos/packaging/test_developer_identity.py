"""Portable command-policy controls; synthetic certificates are never Apple acceptance."""
import json
from pathlib import Path
import plistlib
import re
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import package
from provenance import inventory
from signing import SignaturePolicy, verification_commands


class DeveloperIdentityContract(unittest.TestCase):
    def test_selected_leaf_changes_both_requirements_and_preserves_existing_constraints(self):
        app = Path('/synthetic/App With Spaces.app')
        paths = [package.ENGINE_PATH]
        first = SignaturePolicy('developer-id', 'a' * 40, 'TESTTEAM01')
        other = SignaturePolicy('developer-id', 'b' * 40, 'TESTTEAM01')
        self.assertNotEqual(first.requirement(), other.requirement())
        self.assertEqual(first.requirement(),
                         SignaturePolicy('developer-id', 'A' * 40, 'TESTTEAM01').requirement())
        for policy in (first, other):
            commands = verification_commands(app, paths, policy)
            self.assertEqual([command[-1] for command in commands[:-1]],
                             [str(app / package.ENGINE_PATH), str(app)])
            for command in commands[:-1]:
                requirement = command[command.index('--test-requirement') + 1]
                for clause in ('anchor apple generic', '1.2.840.113635.100.6.2.6',
                               '1.2.840.113635.100.6.1.13', 'TESTTEAM01',
                               f'certificate leaf = H"{policy.certificate_sha1.lower()}"'):
                    self.assertIn(clause, requirement)
            self.assertIn('--deep', commands[-1])

    def test_malformed_selected_fingerprints_cannot_enter_requirement_language(self):
        for value in ('', 'a' * 39, 'a' * 41, 'g' * 40, 'a' * 39 + '"', 'a' * 39 + '\n'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                SignaturePolicy('developer-id', value, 'TESTTEAM01')

    def exercise_gate(self, engine_certificate, app_certificate, succeeds):
        with tempfile.TemporaryDirectory(prefix='nac certificate policy ') as temporary:
            root = Path(temporary).resolve()
            app = root / 'Candidate With Spaces.app'
            engine = app / package.ENGINE_PATH
            engine.parent.mkdir(parents=True)
            engine.write_bytes(b'synthetic engine, never executable')
            (app / 'Contents/Info.plist').write_bytes(b'synthetic bundle metadata')
            observed = {str(engine): engine_certificate, str(app): app_certificate}
            output = root / 'verification'
            args = SimpleNamespace(app=str(app), output=str(output),
                                   certificate='A' * 40, team='TESTTEAM01')
            before = inventory(app)
            checked = []

            def cryptographic_execution(*command):
                # Model only the leaf constraint's documented semantics. An absent
                # pin admits either same-team certificate, reproducing the old bug.
                self.assertEqual(command[0], '/usr/bin/codesign')
                self.assertIn('--verify', command)
                self.assertNotIn('--sign', command)
                if '--test-requirement' in command:
                    requirement = command[command.index('--test-requirement') + 1]
                    selected = re.search(r'certificate leaf = H"([0-9a-fA-F]{40})"', requirement)
                    checked.append(command[-1])
                    if selected and selected[1].lower() != observed[command[-1]].lower():
                        raise subprocess.CalledProcessError(3, command, stderr='synthetic leaf mismatch')
                return ''

            def inspection_execution(command, **kwargs):
                self.assertEqual(command[0], '/usr/bin/codesign')
                self.assertIn('-d', command)
                if '--entitlements' in command:
                    return subprocess.CompletedProcess(command, 0, stdout=plistlib.dumps({}), stderr=b'')
                return subprocess.CompletedProcess(command, 0, stdout='', stderr=(
                    'flags=0x10000(runtime)\nTeamIdentifier=TESTTEAM01\n'
                    'Timestamp=synthetic timestamp\n'
                    'Authority=Developer ID Application: Synthetic Fixture\n'))

            with patch('package.require_mac'), patch('package.run', side_effect=cryptographic_execution), \
                    patch('package.subprocess.run', side_effect=inspection_execution) as inspect:
                if succeeds:
                    package.verify_developer_id(args)
                    self.assertEqual(checked, [str(engine), str(app)])
                    self.assertEqual(inspect.call_count, 4)
                    evidence = json.loads((output / 'signature-evidence.json').read_text())
                    self.assertEqual(set(evidence['signatures']), {'engine', 'app'})
                    self.assertFalse(evidence['consumer_qualification'])
                    self.assertFalse(evidence['notary_submission_performed'])
                else:
                    with self.assertRaises(subprocess.CalledProcessError):
                        package.verify_developer_id(args)
                    self.assertFalse(output.exists())
                    inspect.assert_not_called()
            self.assertEqual(inventory(app), before)

    def test_selected_certificate_on_engine_and_app_passes_portable_policy_control(self):
        self.exercise_gate('a' * 40, 'a' * 40, succeeds=True)

    def test_same_team_other_engine_certificate_fails_before_evidence(self):
        self.exercise_gate('b' * 40, 'a' * 40, succeeds=False)

    def test_same_team_other_app_certificate_fails_before_evidence(self):
        self.exercise_gate('a' * 40, 'b' * 40, succeeds=False)

    def test_same_team_other_certificates_on_both_objects_fail_before_evidence(self):
        self.exercise_gate('b' * 40, 'b' * 40, succeeds=False)


if __name__ == '__main__':
    unittest.main()
