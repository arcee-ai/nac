"""Accepted interaction contract: portable consumer/custody controls, no native input."""
import copy
import unittest
import uuid


def interaction_facts(guards):
    """Synthetic private-text-free proof fixtures, never native acceptance."""
    for index, entry in enumerate(guards, 1):
        entry['sequence'] = str(index * 10)
    kinds = ['button', 'button', 'panel', 'field', 'field', 'field', 'button', 'button', 'message', 'message', 'button']
    result = []
    for index, kind in enumerate(kinds):
        before = guards[2 + index * 2]
        entered = int(before['consumed_ns']) + 1
        keyboard = index in (2, 3, 4, 5, 9)
        result.append(dict(request_id=str(uuid.UUID(int=100 + index)), target_id=str(uuid.UUID(int=203 if kind == 'field' else 208 if kind == 'message' else 200 + index)),
            kind=kind, surface=before['surface'], point=[20, 25], anchor_frame=[10, 20, 100, 30],
            keyboard=keyboard, focus_checked=keyboard, sequence=str(int(before['sequence']) + 1),
            entered_ns=str(entered), began_ns=str(entered + 1), ended_ns=str(entered + 2),
            consumed_ns=str(entered + 3), finalized_ns=str(entered + 4),
            deadline_ns=str(int(before['entered_ns']) + 30_000_000_000)))
    return result


class InteractionExportControls(unittest.TestCase):
    def fixture(self):
        from test_ci_startup_ax import GuardProofControls
        return GuardProofControls().fixture()

    def test_new_point_proofs_are_required_in_addition_to_all_26_existing_guards(self):
        from ci_startup_ax import require_guard_proof
        config, witness, row = self.fixture()
        self.assertIs(require_guard_proof(row, config, 'e' * 64, witness), row)
        row.pop('interactions')
        with self.assertRaises(RuntimeError): require_guard_proof(row, config, 'e' * 64, witness)

    def test_bad_final_freshness_point_replay_privacy_or_dispatch_fence_never_qualifies(self):
        from ci_startup_ax import require_guard_proof
        config, witness, original = self.fixture()
        for mode in ('missing', 'replay', 'foreign_field', 'outside', 'nonfinite', 'focus', 'intent', 'phase',
                     'replaced_target', 'expired', 'stale_final', 'early_sample', 'after_input', 'late_sequence', 'renewed_ticket'):
            row = copy.deepcopy(original)
            entry = row['interactions'][0]
            if mode == 'missing': row['interactions'].pop()
            if mode == 'replay': entry['request_id'] = row['interactions'][1]['request_id']
            if mode == 'foreign_field': entry['private_value'] = 'PRIVATE-CANARY'
            if mode == 'outside': entry['point'] = [999, 999]
            if mode == 'nonfinite': entry['point'] = [float('nan'), 25]
            if mode == 'focus': entry['focus_checked'] = True
            if mode == 'intent': entry['kind'] = 'message'
            if mode == 'phase': entry['surface'] = 'panel'
            if mode == 'replaced_target': row['interactions'][4]['target_id'] = str(uuid.UUID(int=999))
            if mode == 'expired': entry['deadline_ns'] = entry['finalized_ns']
            if mode == 'stale_final': entry['finalized_ns'] = str(int(entry['ended_ns']) + 1_000_000_001)
            if mode == 'early_sample': entry['began_ns'] = entry['entered_ns']
            if mode == 'after_input': entry['finalized_ns'] = row['rows'][3]['entered_ns']
            if mode == 'late_sequence': entry['sequence'] = row['rows'][3]['sequence']
            if mode == 'renewed_ticket': entry['deadline_ns'] = str(int(entry['deadline_ns']) + 1)
            with self.subTest(mode=mode), self.assertRaises((RuntimeError, ValueError)):
                require_guard_proof(row, config, 'e' * 64, witness)


class InteractionCustodyControls(unittest.TestCase):
    def fixture(self, declared=True):
        from test_ci_startup_owner import StartupOwnerTests
        fixture = StartupOwnerTests()
        fixture.setUp()
        fixture.config['scenario'] = 'configuredLocal'
        if declared: fixture.config['ax_witness'] = {}
        fixture.ready()
        app, engine = fixture.node('app', 10, 1), fixture.node('engine', 11, 10)
        fixture.observe([app, engine])
        return fixture, app, engine

    def test_extra_cg_surface_does_not_veto_new_contract_or_replace_original_root(self):
        fixture, app, engine = self.fixture()
        fixture.observe([{**app, 'windows': [18, 17]}, engine])
        self.assertIsNone(fixture.owner.failure)
        self.assertEqual(fixture.owner.ui_root, 17)
        self.assertEqual(fixture.owner.app['windows'], [17])
        self.assertEqual(fixture.owner.attachment_binding()['window_number'], 17)
        # This is process/root custody only; it supplies no point/input proof.
        self.assertEqual(set(fixture.owner.history), {10, 11})

    def test_missing_original_root_remains_sticky_and_never_rebinds(self):
        fixture, app, engine = self.fixture()
        fixture.observe([{**app, 'windows': [18]}, engine])
        self.assertEqual(fixture.owner.failure, 'app_windows')
        fixture.observe([app, engine])
        self.assertEqual(fixture.owner.failure, 'app_windows')
        self.assertEqual(fixture.owner.ui_root, 17)
        with self.assertRaises(RuntimeError): fixture.owner.attachment_binding()

    def test_undeclared_legacy_caller_retains_its_original_cardinality_rule(self):
        fixture, app, engine = self.fixture(declared=False)
        fixture.observe([{**app, 'windows': [17, 18]}, engine])
        self.assertEqual(fixture.owner.failure, 'app_windows')


if __name__ == '__main__':
    unittest.main()
