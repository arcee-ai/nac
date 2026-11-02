"""Portable actual receipt-policy controls; never compiled XCTest/native proof."""
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from ci_paths_protocol import (CASES, Cursor, MAX_JSON, OPERATIONS, ORDERS, PRODUCT,
                               decode, final_record, read_record)


class PhaseControls(unittest.TestCase):
    def scope(self, operation=OPERATIONS[0]):
        return dict(run='11111111-1111-4111-8111-111111111111', source=PRODUCT, app_pid=10, window=20,
                    engine_pid=30, operation=operation, launch='22222222-2222-4222-8222-222222222222',
                    view='33333333-3333-4333-8333-333333333333', document='44444444-4444-4444-8444-444444444444')

    def phases(self, operation=OPERATIONS[0]):
        scope = self.scope(operation)
        return [dict(scope, version=1, sequence=i, name=name,
                     document='55555555-5555-4555-8555-555555555555' if i and operation == OPERATIONS[0] else scope['document'])
                for i, name in enumerate(ORDERS[OPERATIONS.index(operation)])]

    def test_normal_successor_and_failure_initial_document_orders_with_identical_rereads(self):
        for operation in OPERATIONS:
            cursor = Cursor(self.scope(operation))
            for phase in self.phases(operation):
                self.assertEqual(cursor.accept(phase), phase)
                self.assertEqual(cursor.accept(copy.deepcopy(phase)), phase)
            self.assertEqual(cursor.finish(), self.phases(operation))

    def test_every_foreign_identity_and_wrong_field_type_is_rejected(self):
        for field in self.scope():
            phase = self.phases()[0]
            phase[field] = 99 if type(phase[field]) is int else 'foreign'
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                Cursor(self.scope()).accept(phase)
        for field in ('app_pid', 'window', 'engine_pid', 'version', 'sequence'):
            phase = self.phases()[0]; phase[field] = True
            with self.subTest(boolean=field), self.assertRaises(RuntimeError):
                Cursor(self.scope()).accept(phase)
        for scope in ({**self.scope(), 'source': '0' * 40}, {**self.scope(), 'operation': 'paths'},
                      {**self.scope(), 'document': 'not-uuid'}, {**self.scope(), 'app_pid': 0}):
            with self.subTest(scope=scope), self.assertRaises(RuntimeError): Cursor(scope)

    def test_skips_backwards_same_sequence_mutation_and_document_replacement_fail_closed(self):
        phases = self.phases()
        variants = ([phases[1]], [phases[0], phases[2]], [*phases[:3], phases[1]],
                    [phases[0], {**phases[0], 'document': phases[1]['document']}],
                    [phases[0], {**phases[1], 'document': phases[0]['document']}],
                    [*phases[:2], {**phases[2], 'document': phases[0]['document']}],
                    [phases[0], {**phases[1], 'document': 'invalid'}],
                    [{**phases[0], 'name': 'failure-panel-observed'}],
                    [{**phases[0], 'extra': 1}])
        for rows in variants:
            with self.subTest(rows=rows), self.assertRaises(RuntimeError):
                cursor = Cursor(self.scope())
                for row in rows: cursor.accept(row)
        with self.assertRaisesRegex(RuntimeError, 'incomplete'): Cursor(self.scope()).finish()

    def test_atomic_regular_file_replacement_is_valid_but_symlinks_and_alternate_parent_are_not(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary).resolve(); parent.chmod(0o700)
            path = parent / 'known.json'
            for phase in self.phases():
                pending = parent / 'pending'; pending.write_text(json.dumps(dict(paths_phase=phase)))
                os.replace(pending, path)
                self.assertEqual(read_record(path, parent)['paths_phase'], phase)
            other = parent / 'other'; other.write_text('{}'); path.unlink(); path.symlink_to(other)
            with self.assertRaises(OSError): read_record(path, parent)
            with self.assertRaisesRegex(RuntimeError, 'known evidence'): read_record(other, parent / 'wrong')
            path.unlink(); path.mkdir()
            with self.assertRaisesRegex(RuntimeError, 'regular'): read_record(path, parent)
            path.rmdir(); path.write_bytes(b' ' * (MAX_JSON + 1))
            with self.assertRaisesRegex(RuntimeError, 'bounded'): read_record(path, parent)
            parent.chmod(0o755)
            with self.assertRaisesRegex(RuntimeError, 'private'): read_record(path, parent)

    def test_malformed_oversized_duplicate_and_nonfinite_records_never_decode(self):
        for data in (b'{', b'{} trailing', b'{"source":1,"source":2}', b'{"n":NaN}', b' ' * (MAX_JSON + 1)):
            with self.subTest(data=data[:32]), self.assertRaises((RuntimeError, ValueError)): decode(data)

    def test_nonregular_descriptor_is_closed_before_fdopen_without_fallback(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary).resolve()
            parent.chmod(0o700)
            path = parent / 'known.json'
            path.mkdir()
            opened = []
            real_open = os.open
            real_close = os.close
            def open_owned(*args, **kwargs):
                descriptor = real_open(*args, **kwargs)
                opened.append(descriptor)
                return descriptor
            with patch('ci_paths_protocol.os.open', side_effect=open_owned), \
                    patch('ci_paths_protocol.os.close', wraps=real_close) as close, \
                    patch('ci_paths_protocol.os.fdopen') as fdopen:
                with self.assertRaisesRegex(RuntimeError, 'regular bounded owned evidence'):
                    read_record(path, parent)
                fdopen.assert_not_called()
                self.assertEqual(len(opened), 2)
                self.assertEqual([call.args[0] for call in close.call_args_list], list(reversed(opened)))
            for descriptor in opened:
                with self.assertRaises(OSError):
                    os.fstat(descriptor)

    def test_final_product_receipt_requires_nested_actual_result_and_owned_cleanup(self):
        normal = dict(scenario=CASES[0], passed=True, engine_reaped=True, profile_removed=True,
                      native_paths=dict(finder_observation_grace_seconds=45, finder_cleanup_residual='left open',
                                        created_session={'id':'fixture'}, reveal_observation={'count':1}))
        failure = dict(scenario=CASES[1], passed=True, engine_reaped=True, profile_removed=True,
                       native_paths=dict(actual_failure='fixture', launch_identity_retired=True,
                                         path_bridge_after_failure=dict(installed=False, pending=False)))
        for row in (normal, failure):
            self.assertEqual(final_record(row, row['scenario']), row)
            for key in ('passed', 'engine_reaped', 'profile_removed', 'native_paths'):
                changed = copy.deepcopy(row); changed[key] = False
                with self.subTest(key=key), self.assertRaises((RuntimeError, AttributeError)): final_record(changed, row['scenario'])


if __name__ == '__main__': unittest.main()
