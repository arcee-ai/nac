import copy
import importlib.util
import json
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("admission", Path(__file__).with_name("ci-admission.py"))
A = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(A)
BASE, HEAD, CANDIDATE, TREE = (c * 40 for c in "abcd")
EXECUTED = b"trusted owner"


class FixtureGit:
    def __init__(self):
        self.parents = [BASE, HEAD]
        self.tree = TREE
        self.changed_paths = ["crates/nac-server/src/app.rs"]
        self.files = {revision: {path: EXECUTED if path == A.OWNER else path.encode()
                                for path in A.AUTHORITY + [A.WORKFLOW, A.UNIT]}
                      for revision in [BASE, HEAD, CANDIDATE]}
        for revision in self.files:
            for path in [".github/scripts/pr-checks.mjs", ".github/scripts/ci-admission-applicability.json"]:
                self.files[revision][path] = Path(path).read_bytes()

    def workflows(self, revision):
        return sorted(p for p in self.files[revision] if p.startswith(".github/workflows/"))

    def blob(self, revision, path):
        return self.files[revision][path]

    def paths(self, base, prepared):
        return self.changed_paths

    def current(self):
        return CANDIDATE

    def identity(self, revision):
        return self.tree, self.parents


def inputs():
    event = {"action": "edited", "number": 5, "repository": {"id": A.REPOSITORY_ID, "full_name": A.REPOSITORY},
             "changes": {"title": {"from": "old title"}},
             "pull_request": {"number": 5, "body": "description", "head": {"sha": HEAD, "ref": "codex/real-work", "repo": {"id": A.REPOSITORY_ID}},
                              "base": {"sha": BASE, "ref": "dev", "repo": {"id": A.REPOSITORY_ID, "full_name": A.REPOSITORY}}}}
    context = {"event_name": "pull_request", "run_id": 20, "run_attempt": 1,
               "candidate_sha": CANDIDATE, "policy_sha": BASE, "workflow_sha": CANDIDATE}
    return event, context


def run(run_id, second):
    return {"id": run_id, "run_attempt": 1, "created_at": f"2026-11-05T00:00:{second:02d}Z",
            "repository": {"id": A.REPOSITORY_ID}, "path": A.WORKFLOW, "event": "pull_request",
            "head_branch": "codex/real-work", "head_repository": {"id": A.REPOSITORY_ID},
            "head_sha": HEAD, "workflow_id": 42,
            "referenced_workflows": [{"path": A.REPOSITORY+"/"+A.UNIT+"@"+CANDIDATE,
                                      "sha": CANDIDATE, "ref": "refs/pull/5/merge"}]}


class History:
    def __init__(self, identity):
        self.requests = []
        self.current, self.prior = run(20, 20), run(10, 10)
        self.runs = [self.current, self.prior]
        self.jobs = {10: self.marker(self.prior, A.FULL + identity["digest"])}

    @staticmethod
    def marker(record, name):
        return {"total_count": 1, "jobs": [{"id": 100 + record["id"], "run_id": record["id"],
                 "head_sha": HEAD, "name": name, "started_at": record["created_at"]}]}

    def __call__(self, path, query=None):
        self.requests.append((path, query))
        if path.endswith("/actions/runs/20"):
            return self.current
        if path.endswith("/workflows/42/runs"):
            return {"total_count": len(self.runs), "workflow_runs": self.runs}
        return self.jobs[int(path.split("/runs/")[1].split("/")[0])]


class Admission(unittest.TestCase):
    def setUp(self):
        self.event, self.context = inputs()
        self.git = FixtureGit()
        self.identity = A.tuple_for(self.event, self.context, self.git, EXECUTED)
        self.history = History(self.identity)

    def select(self, **kwargs):
        return A.select(kwargs.get("event", self.event), kwargs.get("context", self.context),
                        kwargs.get("git", self.git), kwargs.get("read", self.history),
                        kwargs.get("executed", EXECUTED))

    def assert_full(self, **kwargs):
        result = self.select(**kwargs)
        self.assertEqual(result["mode"], "full", result)
        self.assertEqual(result["required_source_contexts"], A.CONTEXTS)
        self.assertFalse(result["quality_reused"])
        return result

    def test_exact_latest_full_admission_is_not_quality_reuse(self):
        result = self.select()
        self.assertEqual(result["mode"], "pure")
        self.assertEqual(result["admission"]["run_id"], 10)
        self.assertEqual(result["required_source_contexts"], [])
        self.assertFalse(result["consumer"]["cross_run_quality_reuse"])
        self.assertEqual(len(self.history.requests), 3)
        self.assertEqual(self.history.requests[1][1], {"branch":"codex/real-work","event":"pull_request","per_page":20,"page":1})
        self.assertEqual(self.history.requests[2][1], {"per_page":100})
        for verdict in ["success", "failure", "cancelled", None]:
            self.history.current["conclusion"] = verdict
            self.history.prior["conclusion"] = verdict
            self.history.jobs[10]["jobs"][0]["conclusion"] = verdict
            self.assertEqual(self.select()["mode"], "pure")

    def test_recent_pure_observations_preserve_latest_full_identity(self):
        observation = run(15, 15)
        self.history.runs.insert(1, observation)
        self.history.jobs[15] = History.marker(observation, A.PURE + A.observation_digest(self.identity["digest"], 10))
        self.assertEqual(self.select()["admission"]["run_id"], 10)
        self.history.jobs[15]["jobs"][0]["name"] = A.FULL + "0"*64
        self.assert_full()
        self.assertEqual(len(self.history.requests), 7)  # No search behind latest mismatch.

    def test_mandatory_events_and_cold_transitions_never_read_history(self):
        for action in ["opened", "synchronize", "reopened", "ready_for_review"]:
            event = copy.deepcopy(self.event)
            event["action"] = action
            self.assertEqual(self.assert_full(event=event)["tuple_digest"], self.identity["digest"])
        for old, new in [(None, A.MARKER), (A.MARKER, "description"),
                         (A.MARKER+"\nold", "new"), ("old", A.MARKER+"\r\nnew")]:
            event = copy.deepcopy(self.event)
            event["changes"] = {"body": {"from": old}}
            event["pull_request"]["body"] = new
            self.assertEqual(self.assert_full(event=event)["reason"], "cold_transition")
        event = copy.deepcopy(self.event)
        event["changes"] = {"base": {"from": {"ref": "old"}}}
        self.assert_full(event=event)
        self.assertFalse(self.history.requests)

    def test_marker_grammar_matches_existing_cold_owner(self):
        for body in [A.MARKER, A.MARKER+"\ntext", A.MARKER+"\r\ntext"]:
            self.assertTrue(A.cold(body))
        for body in [None, "", " "+A.MARKER, "\n"+A.MARKER, "> "+A.MARKER,
                     "```\n"+A.MARKER, "example\n"+A.MARKER, A.MARKER+"\rtext"]:
            self.assertFalse(A.cold(body))

    def test_squash_unknown_identity_and_untrusted_program_are_full(self):
        for parents in [[], [HEAD], [HEAD, BASE], [BASE, HEAD, BASE]]:
            self.git.parents = parents
            self.assertEqual(self.assert_full()["reason"], "unsupported_prepared_identity")
        self.git.parents = [BASE, HEAD]
        for revision in [BASE, HEAD, CANDIDATE]:
            for path in A.AUTHORITY + [A.WORKFLOW, A.UNIT]:
                git = copy.deepcopy(self.git)
                git.files[revision][path] = b"forged candidate program"
                self.assert_full(git=git)
        self.assert_full(executed=b"candidate self-declared digest is not authority")
        git = copy.deepcopy(self.git)
        del git.files[BASE][A.OWNER]
        self.assert_full(git=git)
        git = copy.deepcopy(self.git)
        git.files[HEAD][".github/workflows/extra.yml"] = b"extra"
        self.assert_full(git=git)
        self.assertFalse(self.history.requests)

    def test_silent_base_advance_changes_tuple_even_without_changes_base(self):
        event = copy.deepcopy(self.event)
        context = dict(self.context, policy_sha="e"*40)
        event["pull_request"]["base"]["sha"] = "e"*40
        self.git.files["e"*40] = copy.deepcopy(self.git.files[BASE])
        self.git.parents = ["e"*40, HEAD]
        self.assertEqual(self.assert_full(event=event, context=context)["reason"], "changed_admission_tuple")

    def test_unknown_intervening_or_partial_history_never_searches_back(self):
        edits = [
            lambda h: h.prior.update(run_attempt=2), lambda h: h.prior.update(head_sha="e"*40),
            lambda h: h.prior.update(head_repository={"id":1}), lambda h: h.prior.update(path="foreign"),
            lambda h: h.prior.update(head_branch="other"), lambda h: h.prior.update(event="push"), lambda h: h.prior.update(workflow_id=43),
            lambda h: h.prior.update(repository={"id":1}), lambda h: h.prior.update(created_at=h.current["created_at"]),
            lambda h: h.jobs[10].update(total_count=2), lambda h: h.jobs[10].update(total_count=0, jobs=[]),
            lambda h: h.jobs[10]["jobs"][0].update(started_at=None),
            lambda h: h.jobs[10]["jobs"][0].update(name=A.FULL+"0"*64),
            lambda h: h.jobs[10]["jobs"][0].update(run_id=11),
            lambda h: h.jobs[10]["jobs"][0].update(head_sha="e"*40),
            lambda h: h.jobs[10]["jobs"].append(copy.deepcopy(h.jobs[10]["jobs"][0])),
            lambda h: h.runs.remove(h.current), lambda h: h.runs.append(h.prior),
            lambda h: h.current.update(id=19), lambda h: h.current.update(head_sha="e"*40),
        ]
        for edit in edits:
            history = History(self.identity)
            edit(history)
            with self.subTest(edit=edit):
                self.assert_full(read=history)
        for error in [OSError("503"), ValueError("malformed")]:
            def fail(*_args): raise error
            self.assert_full(read=fail)

    def test_malformed_typed_input_is_full(self):
        for key, value in [("run_attempt", True), ("run_attempt", 2), ("run_id", "20"),
                           ("managed_applicable", "true"), ("policy_sha", "e"*40),
                           ("workflow_sha", HEAD), ("unknown", True), ("event_name", "workflow_dispatch")]:
            self.assert_full(context=dict(self.context, **{key:value}))
        for changes in [None, {}, {"label":{}}, {"title":{}}, {"body":{"from":True}},
                        {"body":{"from":"old","extra":1}}]:
            event = copy.deepcopy(self.event)
            event["changes"] = changes
            self.assert_full(event=event)
        with self.assertRaises(A.Unknown):
            json.loads('{"a":1,"a":2}', object_pairs_hook=A.unique)

    def test_anonymous_reader_is_bounded_and_never_redirects(self):
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self, _limit): return b'{}'
        seen = []
        class Opener:
            def open(self, request, timeout):
                seen.append(request)
                self_test.assertLessEqual(timeout, 8)
                return Response()
        self_test = self
        reader = A.PublicReader()
        reader.opener = Opener()
        for _ in range(11): reader("repos/arcee-ai/nac/actions/runs/20")
        self.assertTrue(all(not req.has_header("Authorization") for req in seen))
        with self.assertRaises(A.Unknown): reader("repos/arcee-ai/nac/actions/runs/20")
        with self.assertRaises(A.Unknown): A.NoRedirect().redirect_request(None,None,302,None,None,"https://foreign")

    def test_history_bounds_and_complete_second_page(self):
        class Pages(History):
            def __init__(self, identity, partial=False):
                super().__init__(identity)
                self.partial = partial
                self.future = []
                for index in range(20):
                    record = run(1000+index, 1)
                    record["created_at"] = "2026-11-06T00:00:01Z"
                    self.future.append(record)
            def __call__(self, path, query=None):
                if path.endswith("/workflows/42/runs"):
                    self.requests.append((path, query))
                    if self.partial:
                        return {"total_count":20, "workflow_runs":self.runs}
                    return {"total_count":22, "workflow_runs":self.future if query["page"] == 1 else self.runs}
                return super().__call__(path, query)
        self.assertEqual(self.select(read=Pages(self.identity))["mode"], "pure")
        self.assert_full(read=Pages(self.identity, partial=True))
        history = History(self.identity)
        history.runs = [history.current] + [run(i,i) for i in reversed(range(10,19))]
        for record in history.runs[1:]:
            history.jobs[record["id"]] = History.marker(record, A.PURE+A.observation_digest(self.identity["digest"], 10))
        self.assertEqual(self.assert_full(read=history)["reason"], "history_marker_budget")
        self.assertEqual(len(history.requests), 10)

    def test_real_response_shape_and_unchanged_byte_reader(self):
        fixture = json.loads(Path(__file__).with_name("ci-admission-history.fixture.json").read_text())
        self.assertEqual(A.HISTORY_PAGE_SIZE, 20)
        self.assertEqual(fixture["total_count"], 40)
        self.assertEqual(len(fixture["workflow_runs"]), 20)
        self.assertEqual(fixture["wire_bytes"], 269489)
        self.assertEqual(fixture["wire_sha256"], "3be195c663e216a218763ca0b7881d582fd4077a91765decbb78d0e3476d29fb")
        self.assertEqual([r["id"] for r in fixture["workflow_runs"][:2]], [42155651222,42155628832])
        self.assertEqual(len({r["head_sha"] for r in fixture["workflow_runs"][:2]}), 1)
        # Same retained response length with projected public rows + explicit inert padding.
        value={"total_count":fixture["total_count"],"workflow_runs":fixture["workflow_runs"],"unused_public_metadata":""}
        raw=json.dumps(value,separators=(",",":")).encode()
        value["unused_public_metadata"]="x"*(fixture["wire_bytes"]-len(raw))
        encoded=json.dumps(value,separators=(",",":")).encode()
        self.assertEqual(len(encoded),fixture["wire_bytes"])
        class Response:
            status=200
            def __enter__(self):return self
            def __exit__(self,*_):return False
            def read(self,limit):return self.data[:limit]
        class Opener:
            def open(self,request,timeout):
                self.request=request;return self.response
        response=Response();response.data=encoded;opener=Opener();opener.response=response
        reader=A.PublicReader();reader.opener=opener
        result=reader("repos/arcee-ai/nac/actions/workflows/42/runs",{"per_page":20,"page":1})
        self.assertEqual(A.rows(result,"workflow_runs")[1],40)
        self.assertIn("per_page=20",opener.request.full_url)
        response.data=b"x"*fixture["oversized_page100_sample_bytes"]
        reader=A.PublicReader();reader.opener=opener
        with self.assertRaisesRegex(A.Unknown,"history_byte_budget"):
            reader("repos/arcee-ai/nac/actions/workflows/42/runs",{"per_page":100,"page":1})

    def test_twenty_row_page_arithmetic_moving_overlap_and_intervening_head(self):
        class Pages(History):
            def __init__(self,identity,mutation=None):
                super().__init__(identity);self.total=22;self.mutation=mutation
                self.future=[run(1000+i,1)for i in range(20)]
                for record in self.future:record["created_at"]="2026-11-06T00:00:01Z"
            def __call__(self,path,query=None):
                if not path.endswith("/workflows/42/runs"):return super().__call__(path,query)
                self.requests.append((path,query));assert query["per_page"]==20
                values=copy.deepcopy(self.future if query["page"]==1 else self.runs)
                total=self.total
                if self.mutation=="moving"and query["page"]==2:total+=1
                if self.mutation=="partial"and query["page"]==2:values=values[:1]
                if self.mutation=="overlap"and query["page"]==2:values=[copy.deepcopy(self.future[-1]),self.current]
                if self.mutation=="head":
                    total=23
                    if query["page"]==2:values=[self.current,{**run(15,15),"head_sha":"e"*40},self.prior]
                return {"total_count":total,"workflow_runs":values}
        good=Pages(self.identity)
        self.assertEqual(self.select(read=good)["admission"]["run_id"],10)
        self.assertEqual(len(good.requests),4)
        for mutation,reason in [("moving","incomplete_or_moving_history_page"),("partial","incomplete_or_moving_history_page"),("overlap","history_overlap_or_order"),("head","intervening_head_change")]:
            history=Pages(self.identity,mutation)
            self.assertEqual(self.assert_full(read=history)["reason"],reason)
            self.assertFalse(any("/runs/10/attempts/"in path for path,_ in history.requests))
        self.assertEqual(self.history.requests,[])

    def test_no_third_page_or_hidden_full_beyond_bounded_forty(self):
        class Deep(History):
            def __call__(self,path,query=None):
                if not path.endswith("/workflows/42/runs"):return super().__call__(path,query)
                self.requests.append((path,query));assert query["per_page"]==20
                assert query["page"]in(1,2)
                future=[run(1000+i,1)for i in range(39)]
                for record in future:record["created_at"]="2026-11-06T00:00:01Z"
                values=future[:20]if query["page"]==1 else future[20:]+[self.current]
                return {"total_count":41,"workflow_runs":values}
        history=Deep(self.identity)
        self.assertEqual(self.assert_full(read=history)["reason"],"no_complete_latest_admission")
        self.assertEqual(len(history.requests),3)
        self.assertTrue(all("/attempts/"not in path for path,_ in history.requests))

    def test_machine_contract_matches_owner_constants(self):
        contract = json.loads(Path(__file__).with_name("ci-admission-contract.json").read_text())
        self.assertEqual(set(contract["selector"]["context_keys"]), A.CONTEXT_KEYS)
        self.assertEqual(set(contract["selector"]["authority_paths"]),set(A.AUTHORITY))
        self.assertEqual(len(contract["producer"]["tuple_fields"]),len(self.identity["values"]))
        self.assertEqual(contract["producer"]["full_required_source_contexts"], A.CONTEXTS)
        self.assertFalse(contract["selector"]["quality_reused"])
        self.assertEqual(contract["public_history"]["max_requests"], 11)
        self.assertEqual(contract["public_history"]["max_total_bytes"], A.MAX_BYTES)
        self.assertFalse(contract["check_consumer"]["cross_run_quality_receipt_or_result_copy"])

    def test_provider_attestation_and_compact_pointer_are_required(self):
        for change in [lambda r:r.pop("referenced_workflows"),
                       lambda r:r.update(referenced_workflows=[]),
                       lambda r:r["referenced_workflows"].append(r["referenced_workflows"][0].copy()),
                       lambda r:r["referenced_workflows"][0].update(sha="e"*40),
                       lambda r:r["referenced_workflows"][0].update(ref="refs/pull/6/merge"),
                       lambda r:r["referenced_workflows"][0].update(path="foreign/ci-admission.yml@"+CANDIDATE)]:
            history = History(self.identity)
            change(history.prior)
            self.assert_full(read=history)
        # Early current-unit visibility is not assumed. External must check final PURE.
        self.history.current.pop("referenced_workflows")
        self.assertEqual(self.select()["mode"], "pure")
        middle = run(15,15)
        self.history.runs.insert(1,middle)
        self.history.jobs[15] = History.marker(middle,A.PURE+A.observation_digest(self.identity["digest"],9))
        self.assertEqual(self.assert_full()["reason"], "observation_points_behind_latest_full")
        self.history.jobs[15] = History.marker(middle,A.PURE+A.observation_digest(self.identity["digest"],10))
        result = self.select()
        self.assertEqual(result["observation_digest"], A.observation_digest(self.identity["digest"],10))
        expected = __import__("hashlib").sha256(json.dumps([2,self.identity["digest"],10,1],separators=(",",":"),ensure_ascii=True).encode()).hexdigest()
        self.assertEqual(expected,result["observation_digest"])

    def test_managed_derivation_never_accepts_a_caller_boolean(self):
        for paths, expected in [([],False),(["docs/help.md"],False),(["crates/x.rs"],True),
                                ([".github/other"],True),(["Cargo.lock"],True),
                                (["docker/managed/Dockerfile"],True),(["tools/README"],False)]:
            self.git.changed_paths = paths
            identity = A.tuple_for(self.event,self.context,self.git,EXECUTED)
            self.assertEqual(identity["managed_applicable"],expected)
        self.assert_full(context=dict(self.context,managed_applicable=False))
        policy = json.loads(Path(".github/scripts/ci-admission-applicability.json").read_text())
        policy["pr_checks_sha256"] = "0"*64
        self.git.files[BASE][".github/scripts/ci-admission-applicability.json"] = json.dumps(policy).encode()
        self.assert_full()

    def test_real_git_merge_objects_and_trusted_base_program(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            def git(*args):
                return subprocess.check_output(["git", "-C", temp, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", *args], stderr=subprocess.DEVNULL).decode().strip()
            git("init", "--quiet")
            for path in A.AUTHORITY + [A.WORKFLOW, A.UNIT]:
                file = root/path
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(EXECUTED if path == A.OWNER else
                                 Path(path).read_bytes() if path in [".github/scripts/pr-checks.mjs", ".github/scripts/ci-admission-applicability.json"]
                                 else path.encode())
            git("add", ".")
            git("commit", "-qm", "trusted base")
            base = git("rev-parse", "HEAD")
            (root/"real-source.txt").write_text("meaningful change")
            git("add", ".")
            git("commit", "-qm", "real source")
            head = git("rev-parse", "HEAD")
            tree = git("rev-parse", "HEAD^{tree}")
            prepared = git("commit-tree", tree, "-p", base, "-p", head, "-m", "prepared merge")
            event, context = inputs()
            event["pull_request"]["head"]["sha"] = head
            event["pull_request"]["base"]["sha"] = base
            context.update(candidate_sha=prepared, workflow_sha=prepared, policy_sha=base)
            git("checkout", "--detach", prepared)
            actual = A.tuple_for(event, context, A.Git(root), EXECUTED)
            self.assertEqual(actual["values"][10], tree)
            context["candidate_sha"] = context["workflow_sha"] = head
            result = A.select(event, context, A.Git(root), lambda *_: self.fail("no history read"), EXECUTED)
            self.assertEqual(result["mode"], "full")
            self.assertEqual(result["reason"], "unsupported_prepared_identity")


if __name__ == "__main__":
    unittest.main()
