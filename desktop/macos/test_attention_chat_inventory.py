"""Keep the portable attention controls in the ordinary frontend test gate."""
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]


class AttentionInventoryTests(unittest.TestCase):
    def test_frontend_gate_reaches_portable_python_and_node_controls(self):
        package = json.loads((ROOT / 'crates/nac-server/web/package.json').read_text())
        scripts = package['scripts']
        self.assertIn('npm run test:attention-fixtures', scripts['test'].split(' && '))
        command = scripts['test:attention-fixtures']
        self.assertIn("-p 'test_attention_chat_*.py'", command)
        self.assertIn(
            "python3 -B -m unittest discover -s ../../../desktop/macos -p 'test_attention_semantic_*.py' -v",
            command.split(' && '),
        )
        self.assertIn('node --test ../../../desktop/macos/test_attention_chat_dom.cjs', command)
        workflow = (ROOT / '.github/workflows/stable-release.yml').read_text()
        self.assertIn('working-directory: crates/nac-server/web\n        run: npm test', workflow)

    def test_discovery_contains_deadline_publication_capture_and_compatibility(self):
        suite = unittest.TestLoader().discover(str(Path(__file__).parent), 'test_attention_chat_*.py')

        def identities(tests):
            for case in tests:
                if isinstance(case, unittest.TestSuite):
                    yield from identities(case)
                else:
                    yield case.id().rsplit('.', 1)[-1]

        selected = set(identities(suite))
        required = {
            'test_late_truthy_is_rejected_but_old_default_remains_compatible',
            'test_slow_read_or_custody_cannot_publish',
            'test_delay_immediately_before_atomic_publication_is_denied',
            'test_timely_publish_expiry_is_clipped_to_same_deadline',
            'test_command_does_not_accept_late_publication_or_stage',
            'test_ready_acceptance_checks_absolute_deadline_after_truthy_sample',
            'test_capture_only_after_ready_with_current_custody_within_deadline',
        }
        self.assertTrue(required <= selected, sorted(required - selected))
        semantic = unittest.TestLoader().discover(
            str(Path(__file__).parent), 'test_attention_semantic_*.py'
        )
        self.assertGreater(semantic.countTestCases(), 0)
        semantic_selected = set(identities(semantic))
        semantic_required = {
            'test_replacement_during_callback_retains_both_generations',
            'test_real_driver_cleanup_blocks_reject_callback_replacement',
            'test_helper_root_replacement_retains_original_and_successor',
            'test_actual_caller_root_and_cleanup_argument_obey_real_helper_namespace',
            'test_planned_matrix_is_fourteen_real_model_steps_without_extra_goal_calls',
            'test_read_error_missing_or_duplicate_call_cannot_mark_goal',
            'test_exact_goal_accounting_run_status_version_and_result_call_are_required',
            'test_unknown_repeated_wrong_queue_and_missing_tools_fail_closed',
            'test_exact_mark_not_later_goal_version_and_distinct_B',
            'test_duplicate_foreign_store_frontier_or_generation_is_not_count_success',
            'test_content_free_schema_rejects_payload_extension',
            'test_mock_delivery_is_exact_target_title_and_distinct_identifier_not_just_count',
            'test_shipping_owner_contains_no_unconditional_fixture_audit_or_pause',
        }
        self.assertTrue(semantic_required <= semantic_selected, sorted(semantic_required - semantic_selected))


if __name__ == '__main__':
    unittest.main()
