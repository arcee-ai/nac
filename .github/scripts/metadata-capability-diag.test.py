import importlib.util
import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("diag", Path(__file__).with_name("metadata-capability-diag.py"))
D = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(D)
SHA = "a" * 40
DIGEST = D.digest(SHA)


def fixture():
    name = "DIAG admission v1 " + DIGEST
    return [
        {"id": 10, "run_attempt": 1, "status": "completed", "event": "workflow_dispatch", "head_sha": SHA,
         "path": D.WORKFLOW, "display_title": "DIAG metadata capability admit",
         "head_branch": D.BRANCH.removeprefix("refs/heads/"),
         "repository": {"full_name": D.REPOSITORY}, "check_suite_id": 44},
        {"total_count": 1, "jobs": [{"id": 12, "name": name, "run_id": 10,
          "head_sha": SHA, "started_at": "2026-11-05T00:00:00Z",
          "check_run_url": "https://api.github.com/repos/arcee-ai/nac/check-runs/12"}]},
        {"total_count": 1, "check_runs": [{"id": 12, "name": name, "head_sha": SHA,
          "check_suite": {"id": 44}, "app": {"id": 15368}}]},
    ]


class Screen(unittest.TestCase):
    def verify(self, data):
        requests = []
        def read(endpoint):
            requests.append(endpoint)
            return data[len(requests) - 1]
        with redirect_stdout(io.StringIO()):
            D.verify("10", "20", SHA, DIGEST, read)
        self.assertEqual(len(requests), 3)
        self.assertIn("/attempts/1/jobs?per_page=100", requests[1])
        self.assertIn("/check-suites/44/check-runs?per_page=100", requests[2])

    def test_valid_public_jobs_and_checks_binding(self):
        self.verify(fixture())

    def test_quality_outcome_is_not_admission_input(self):
        for conclusion in ["failure", "cancelled", "success", None]:
            data = fixture()
            data[0]["conclusion"] = conclusion
            data[1]["jobs"][0]["conclusion"] = conclusion
            data[2]["check_runs"][0]["conclusion"] = conclusion
            self.verify(data)

    def test_identity_and_incomplete_graph_mutations_fail(self):
        mutations = [
            lambda d: d[0].update(id=11), lambda d: d[0].update(run_attempt=2),
            lambda d: d[0].update(run_attempt=True), lambda d: d[0].update(status="in_progress"),
            lambda d: d[0].update(event="pull_request"), lambda d: d[0].update(head_sha="b"*40),
            lambda d: d[0].update(path="foreign.yml"),
            lambda d: d[0].update(path=".github/workflows/metadata-capability-diag.yml"),
            lambda d: d[0].update(path=".github/workflows/apt-runtime-parity.yml"), lambda d: d[0].update(display_title="DIAG observe"),
            lambda d: d[0].update(head_branch="dev"),
            lambda d: d[0].update(head_branch="codex/all-582-metadata-capability"), lambda d: d[0].update(repository={"full_name":"foreign/repo"}),
            lambda d: d[0].update(check_suite_id=0), lambda d: d[1].update(total_count=2),
            lambda d: d[1]["jobs"][0].update(name="Required PR checks"),
            lambda d: d[1]["jobs"][0].update(started_at=None),
            lambda d: d[1]["jobs"][0].update(run_id=11),
            lambda d: d[1]["jobs"][0].update(check_run_url="https://foreign.example/checks/12"),
            lambda d: d[1]["jobs"][0].update(head_sha="b"*40),
            lambda d: d[2]["check_runs"][0].update(id=13),
            lambda d: d[2]["check_runs"][0].update(name="DIAG foreign"),
            lambda d: d[2]["check_runs"][0].update(head_sha="b"*40),
            lambda d: d[2]["check_runs"][0].update(check_suite={"id":45}),
            lambda d: d[2]["check_runs"][0].update(app={"id":1}),
            lambda d: d[2].update(total_count=0),
        ]
        for index, mutate in enumerate(mutations):
            with self.subTest(index=index):
                data = fixture()
                mutate(data)
                with self.assertRaises(ValueError):
                    self.verify(data)
        data = fixture()
        data[1]["jobs"] *= 2
        data[1]["total_count"] = 2
        with self.assertRaises(ValueError):
            self.verify(data)

    def test_no_loose_values_or_duplicate_json(self):
        for value in ["0", "01", "+1", "1.0", " 1", True, None]:
            with self.assertRaises(ValueError):
                D.positive(value)
        with self.assertRaises(ValueError):
            D.decode('{"id":1,"id":2}')
        for source in ["a"*39, "A"*40, "a"*40+"\n"]:
            with self.assertRaises(ValueError):
                D.digest(source)
        for prior in ["20", "21"]:
            with self.assertRaises(ValueError):
                D.verify(prior, "20", SHA, DIGEST, lambda _: self.fail("unexpected public read"))

    def test_public_reader_has_no_authorization_redirect_or_retry(self):
        seen = []
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self, limit):
                self_test.assertEqual(limit, D.LIMIT + 1)
                return b'{"id":10}'
        class Opener:
            def open(self, request, timeout):
                seen.append(request)
                self_test.assertLessEqual(timeout, 8)
                return Response()
        self_test = self
        reader = D.PublicReader()
        reader.opener = Opener()
        with redirect_stdout(io.StringIO()):
            for _ in range(3):
                self.assertEqual(reader("repos/arcee-ai/nac/actions/runs/10"), {"id":10})
        self.assertEqual(len(seen), 3)
        for request in seen:
            self.assertEqual(request.full_url, "https://api.github.com/repos/arcee-ai/nac/actions/runs/10")
            self.assertFalse(request.has_header("Authorization"))
        with self.assertRaises(ValueError):
            reader("repos/arcee-ai/nac/actions/runs/10")
        with self.assertRaises(ValueError):
            D.NoRedirect().redirect_request(None, None, 302, None, None, "https://foreign.example")

    def test_successful_admission_deliberately_has_no_mode_output(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)/"output"
            output.touch()
            env = {"GITHUB_EVENT_NAME":"workflow_dispatch", "GITHUB_REF":D.BRANCH,
                   "GITHUB_REPOSITORY":D.REPOSITORY, "GITHUB_RUN_ATTEMPT":"1",
                   "GITHUB_SHA":SHA, "DIAG_TUPLE_DIGEST":DIGEST,
                   "DIAG_PHASE":"admit", "GITHUB_OUTPUT":str(output)}
            with redirect_stdout(io.StringIO()):
                D.main(env)
            self.assertEqual(output.read_text(), "")
            for key, value in [("GITHUB_EVENT_NAME","push"), ("GITHUB_REF","refs/heads/dev"),
                               ("GITHUB_RUN_ATTEMPT","2"), ("DIAG_TUPLE_DIGEST","0"*64),
                               ("DIAG_PHASE","unknown"), ("DIAG_PRIOR_RUN","10")]:
                bad = dict(env, **{key:value})
                with self.subTest(key=key), self.assertRaises(ValueError):
                    D.main(bad)


if __name__ == "__main__":
    unittest.main()
