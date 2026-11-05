"""Timing acceptance guards using observed elapsed intervals, never DAG sums."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location('ci_timings', Path(__file__).with_name('ci-timings.py'))
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)
SHA = 'a' * 40


def fixture():
    run = {'id': 123, 'run_attempt': 1, 'repository': {'full_name': 'arcee-ai/nac'},
           'head_sha': 'b' * 40, 'event': 'pull_request', 'status': 'completed',
           'conclusion': 'success', 'created_at': '2026-11-04T00:00:00Z'}
    jobs = []
    for number, name, start, end in [(1, 'prepare', '01:00', '01:20'),
                                      (2, 'browser', '03:00', '05:00'),
                                      (3, 'Required PR checks', '10:00', '10:15')]:
        jobs.append({'id': number, 'name': name, 'run_id': 123, 'run_attempt': 1,
                     'status': 'completed', 'conclusion': 'success', 'labels': ['ubuntu-latest'],
                     'started_at': '2026-11-04T00:' + start + 'Z',
                     'completed_at': '2026-11-04T00:' + end + 'Z'})
    logs = {'1': f'2026-11-04T00:01:00Z   SOURCE_SHA: {SHA}\n  CANDIDATE_SHA: {SHA}\n',
            '3': f'2026-11-04T00:10:00Z   EXPECTED_SHA: {SHA}\n'}
    return run, jobs, logs


class TimingControls(unittest.TestCase):
    def report(self, evidence):
        return runner.summarize(*evidence, 'arcee-ai/nac')

    def test_elapsed_includes_later_scheduling_and_aggregation_not_just_job_sums(self):
        report = self.report(fixture())
        self.assertTrue(report['metric_eligible'])
        self.assertTrue(report['ordinary_first_attempt_metric'])
        self.assertEqual(report['processing_seconds'], 555)
        self.assertEqual(report['event_to_green_seconds'], 615)
        self.assertEqual(report['initial_wait_seconds'], 60)
        self.assertEqual(report['completed_job_seconds'], 155)
        self.assertNotEqual(report['branch_head_sha'], report['candidate_sha'])
        self.assertFalse(report['cohort_qualified'])

    def test_candidate_environment_log_identity_is_mandatory(self):
        for log in ['', 'echo "sha=$SOURCE_SHA"', f'SOURCE_SHA: {SHA}\nSOURCE_SHA: ' + 'c' * 40]:
            evidence = fixture()
            evidence[2]['1'] = log
            self.assertFalse(self.report(evidence)['metric_eligible'])
        evidence = fixture()
        evidence[2]['3'] = 'EXPECTED_SHA: ' + 'b' * 40
        self.assertFalse(self.report(evidence)['metric_eligible'])

    def test_failure_cancel_pending_skip_missing_aggregate_are_retained_ineligible(self):
        for conclusion in ['failure', 'cancelled', 'skipped', None]:
            evidence = fixture()
            evidence[1][-1]['conclusion'] = conclusion
            report = self.report(evidence)
            self.assertFalse(report['metric_eligible'])
            self.assertIsNone(report['processing_seconds'])
            self.assertIsNone(report['event_to_green_seconds'])
            self.assertEqual(report['observed_prepare_to_result_seconds'], 555)
        evidence = fixture()
        evidence[1][-1]['completed_at'] = None
        self.assertFalse(self.report(evidence)['metric_eligible'])
        evidence = fixture()
        evidence[1].pop()
        report = self.report(evidence)
        self.assertFalse(report['metric_eligible'])
        self.assertEqual(report['candidate_sha'], SHA)
        self.assertEqual(report['initial_wait_seconds'], 60)
        for status, conclusion in [('in_progress', None), ('completed', 'failure')]:
            evidence = fixture()
            evidence[0].update(status=status, conclusion=conclusion)
            self.assertFalse(self.report(evidence)['metric_eligible'])

    def test_wrong_repository_run_attempt_or_duplicate_jobs_are_ineligible(self):
        for field, value in [('run_id', 124), ('run_attempt', 2)]:
            evidence = fixture()
            evidence[1][1][field] = value
            self.assertFalse(self.report(evidence)['metric_eligible'])
        evidence = fixture()
        evidence[0]['repository']['full_name'] = 'foreign/repo'
        self.assertFalse(self.report(evidence)['metric_eligible'])
        evidence = fixture()
        evidence[1].append(copy.deepcopy(evidence[1][1]))
        self.assertFalse(self.report(evidence)['metric_eligible'])

    def test_retry_metrics_do_not_qualify_as_first_attempt(self):
        evidence = fixture()
        evidence[0]['run_attempt'] = 2
        for job in evidence[1]:
            job['run_attempt'] = 2
        report = self.report(evidence)
        self.assertTrue(report['metric_eligible'])
        self.assertFalse(report['ordinary_first_attempt_metric'])
        evidence[0]['event'] = 'workflow_dispatch'
        self.assertFalse(self.report(evidence)['ordinary_first_attempt_metric'])

    def test_skips_do_not_contribute_compute_and_partial_compute_is_explicit(self):
        evidence = fixture()
        evidence[1].append({**evidence[1][1], 'id': 4, 'name': 'not applicable', 'conclusion': 'skipped'})
        self.assertEqual(self.report(evidence)['completed_job_seconds'], 155)
        evidence[1][1]['completed_at'] = None
        report = self.report(evidence)
        self.assertEqual(report['incomplete_compute_job_ids'], [2])
        self.assertEqual(report['completed_job_seconds'], 35)

    def test_capture_rejects_reusing_old_evidence_without_network(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / 'old').write_text('preserved')
            with patch.object(runner.subprocess, 'run') as network:
                with self.assertRaisesRegex(ValueError, 'new or empty'):
                    runner.capture('arcee-ai/nac', ['123'], path)
                network.assert_not_called()
            self.assertEqual((path / 'old').read_text(), 'preserved')

    def test_capture_pins_attempt_and_pagination_preserves_commands_and_logs(self):
        run, jobs, logs = fixture()
        usage = {'billable': {'UBUNTU': {'total_ms': 0}}}
        responses = [json.dumps(run['repository']), json.dumps(run), json.dumps(usage), json.dumps(run), json.dumps([{'jobs': jobs}]), logs['1'], logs['3']]
        def response(command, **kwargs):
            return subprocess.CompletedProcess(command, 0, responses.pop(0), '')
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            with patch.object(runner.subprocess, 'run', side_effect=response) as request:
                report = runner.capture('arcee-ai/nac', ['123:1'], output)[0]
            self.assertTrue(report['ordinary_first_attempt_metric'])
            commands = json.loads((output / 'commands.json').read_text())
            self.assertEqual(len(commands), 7)
            self.assertIn('/attempts/1/jobs?per_page=100', commands[4]['command'][-1])
            self.assertIn('--paginate', commands[4]['command'])
            self.assertIn('--slurp', commands[4]['command'])
            self.assertIn('--allow-escape-sequences', commands[-1]['command'])
            self.assertEqual((output / 'run-123-attempt-1/job-1.log').read_text(), logs['1'])
            self.assertEqual(json.loads((output / 'repository.json').read_text()), run['repository'])
            self.assertEqual(json.loads((output / '123-run-usage.json').read_text()), usage)
            self.assertIn('not estimated', report['cost'])
            self.assertEqual(request.call_args.kwargs, {'capture_output': True, 'text': True, 'check': False})

    def test_capture_failure_stays_in_selection_and_retains_error(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            response = subprocess.CompletedProcess(['gh'], 1, '', 'unavailable')
            with patch.object(runner.subprocess, 'run', return_value=response):
                report = runner.capture('arcee-ai/nac', ['123:1'], output)
            self.assertEqual(len(report), 1)
            self.assertFalse(report[0]['metric_eligible'])
            self.assertEqual(json.loads((output / 'summary.json').read_text())['selection'], ['123:1'])
            self.assertEqual(json.loads((output / 'fetch-errors.json').read_text())[0]['stderr'], 'unavailable')


if __name__ == '__main__':
    unittest.main()
