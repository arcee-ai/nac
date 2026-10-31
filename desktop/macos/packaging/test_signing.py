"""Synthetic signature/notary records prove parser boundaries, never Apple acceptance."""
from pathlib import Path
import unittest

from signing import (SignaturePolicy, accepted_notarization, notarization_plan,
                     signature_evidence, signing_commands, verification_commands)


class SigningContract(unittest.TestCase):
    def setUp(self):
        self.app = Path('/owned fixture/App With Spaces.app')
        self.paths = ['Contents/Resources/nac-web']
        self.adhoc = SignaturePolicy('ad-hoc')
        self.developer = SignaturePolicy('developer-id', 'a' * 40, 'TESTTEAM01')
        self.developer_details = ('CodeDirectory v=20500 size=10 flags=0x10000(runtime) hashes=1\n'
                                  'TeamIdentifier=TESTTEAM01\nTimestamp=synthetic timestamp\n'
                                  'Authority=Developer ID Application: Synthetic Fixture\n')

    def test_policy_never_discovers_or_defaults_a_developer_identity(self):
        for args in [('developer-id',), ('developer-id', '-', 'TESTTEAM01'),
                     ('developer-id', 'a' * 40, 'untrusted team'), ('ad-hoc', 'a' * 40), ('other',)]:
            with self.assertRaises(ValueError):
                SignaturePolicy(*args)

    def test_command_plan_is_leaf_first_explicit_identity_timestamp_and_no_entitlement_broadening(self):
        paths = ['Contents/Helpers/Inner.app/Contents/MacOS/tool', *self.paths]
        commands = signing_commands(self.app, paths, self.developer)
        self.assertEqual(commands[0][-1], str(self.app / paths[0]))
        self.assertEqual(commands[-1][-1], str(self.app))
        for command in commands:
            self.assertIn('a' * 40, command)
            self.assertIn('--timestamp', command)
            self.assertIn('runtime', command)
            self.assertNotIn('--deep', command)
            self.assertNotIn('--entitlements', command)
        self.assertIn('--timestamp=none', signing_commands(self.app, self.paths, self.adhoc)[0])

    def test_nested_paths_cannot_escape_or_alias_another_target(self):
        for paths in [[], ['../other'], ['/app'], ['Contents/../other'],
                      ['Contents//tool'], ['Contents/./tool'], self.paths * 2]:
            with self.assertRaises(ValueError):
                signing_commands(self.app, paths, self.adhoc)

    def test_verification_requires_apple_developer_id_application_and_exact_team(self):
        commands = verification_commands(self.app, self.paths, self.developer)
        for command in commands[:-1]:
            self.assertIn('--test-requirement', command)
            requirement = command[command.index('--test-requirement') + 1]
            self.assertIn('anchor apple generic', requirement)
            self.assertIn('1.2.840.113635.100.6.1.13', requirement)
            self.assertIn('TESTTEAM01', requirement)
        self.assertIn('--deep', commands[-1])

    def test_signature_facts_disallow_runtime_word_in_path_as_flag_evidence(self):
        for details in ['Executable=/tmp/runtime/tool\nSignature=adhoc\n',
                        'flags=0x2(adhoc)\nRuntime Version=14\nSignature=adhoc\n']:
            with self.assertRaisesRegex(ValueError, 'hardened-runtime'):
                signature_evidence(details, {}, self.adhoc)
        record = signature_evidence('flags=0x10002(adhoc,runtime)\nSignature=adhoc\n', {}, self.adhoc)
        self.assertEqual(record['kind'], 'ad-hoc')

    def test_developer_id_rejects_adhoc_wrong_team_missing_timestamp_and_debug_entitlements(self):
        record = signature_evidence(self.developer_details, {}, self.developer)
        self.assertEqual(record['team_id'], 'TESTTEAM01')
        self.assertNotIn('Synthetic Fixture', str(record))
        for details in [self.developer_details + 'Signature=adhoc\n',
                        self.developer_details.replace('TESTTEAM01', 'OTHERTEAM1'),
                        self.developer_details.replace('Timestamp=synthetic timestamp\n', ''),
                        self.developer_details.replace('Developer ID Application:', 'Apple Development:')]:
            with self.assertRaises(ValueError):
                signature_evidence(details, {}, self.developer)
        for key in ['com.apple.security.get-task-allow', 'com.apple.security.app-sandbox',
                    'com.apple.security.cs.disable-library-validation']:
            with self.assertRaisesRegex(ValueError, 'entitlements'):
                signature_evidence(self.developer_details, {key: True}, self.developer)

    def test_notary_plan_has_no_execution_authority_and_staples_app_before_final_archive(self):
        plan = notarization_plan(self.app, Path('/owned fixture/submission.zip'), 'explicit-fixture-profile')
        self.assertFalse(plan['execution_authorized'])
        self.assertTrue(plan['requires_normal_app'])
        names = [stage['name'] for stage in plan['stages']]
        self.assertEqual(names, ['submission-container', 'notary-submit', 'staple-app',
                                 'validate-staple', 'gatekeeper-assessment'])
        submit = plan['stages'][1]
        self.assertIn('--keychain-profile', submit['argv'])
        self.assertIn('Accepted', submit['gate'])
        self.assertEqual(plan['stages'][2]['argv'][-1], str(self.app))
        self.assertIn('NEW final ZIP', plan['finalization'])
        for profile in ['', '-default', 'bad\nprofile']:
            with self.assertRaises(ValueError):
                notarization_plan(self.app, Path('/owned fixture/submission.zip'), profile)

    def test_only_accepted_exact_submission_uuid_is_a_notary_receipt(self):
        response = {'status': 'Accepted', 'id': '12345678-1234-1234-1234-123456789abc'}
        self.assertEqual(accepted_notarization(response)['status'], 'Accepted')
        for patch in [{'status': 'In Progress'}, {'status': 'Invalid'}, {'id': ''},
                      {'id': 'latest'}, {'id': True}]:
            with self.assertRaises(ValueError):
                accepted_notarization({**response, **patch})


if __name__ == '__main__':
    unittest.main()
