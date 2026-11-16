import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("bootstrap",Path(__file__).with_name("ci-admission-bootstrap.py"))
B = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(B)
OWNER_SPEC = importlib.util.spec_from_file_location("owner",Path(__file__).with_name("ci-admission.py"))
A = importlib.util.module_from_spec(OWNER_SPEC)
OWNER_SPEC.loader.exec_module(A)


class Bootstrap(unittest.TestCase):
    def test_output_binding_and_safe_defaults(self):
        digest = "a"*64
        result = {"schema_version":2,"mode":"pure","quality_reused":False,"tuple_digest":digest,
                  "admission":{"run_id":10,"attempt":1,"tuple_digest":digest},
                  "observation_digest":A.observation_digest(digest,10)}
        self.assertEqual(B.outputs(result)["marker_name"],"NAC metadata observation v2 "+result["observation_digest"])
        for mutation in [dict(result,observation_digest="0"*64),dict(result,quality_reused=True),
                         dict(result,tuple_digest="bad"),dict(result,admission={"run_id":9,"attempt":1}),
                         dict(result,admission={"run_id":10,"attempt":True,"tuple_digest":digest}),None,{}]:
            self.assertEqual(B.outputs(mutation)["mode"],"full")
        self.assertEqual(B.outputs(dict(result,mode="full"))["marker_name"],"NAC full admission v2 "+digest)

    def test_executes_base_owner_not_candidate_program(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            def git(*args):
                return subprocess.check_output(["git","-C",temp,"-c","user.name=Fixture","-c","user.email=fixture@example.invalid",*args],stderr=subprocess.DEVNULL).decode().strip()
            git("init","--quiet")
            bootstrap=root/B.BOOTSTRAP
            bootstrap.parent.mkdir(parents=True)
            bootstrap.write_bytes(Path(B.__file__).read_bytes())
            owner=root/B.OWNER
            owner.write_text('print(\'{"schema_version":2,"mode":"full","quality_reused":false,"reason":"trusted_base_executed"}\')\n')
            git("add",".");git("commit","-qm","immutable base")
            base=git("rev-parse","HEAD")
            hostile=root/"candidate-executed"
            owner.write_text(f'open({str(hostile)!r},"w").write("unsafe")\n')
            git("add",".");git("commit","-qm","candidate owner must not execute")
            head=git("rev-parse","HEAD")
            event=root/"event.json"
            payload={"repository":{"id":1194218201,"full_name":"arcee-ai/nac"},"pull_request":{"base":{"sha":base,"repo":{"id":1194218201,"full_name":"arcee-ai/nac"}}}}
            event.write_text(json.dumps(payload))
            env={**os.environ,"GITHUB_EVENT_NAME":"pull_request","GITHUB_REPOSITORY":"arcee-ai/nac",
                 "GITHUB_RUN_ID":"20","GITHUB_RUN_ATTEMPT":"1","GITHUB_SHA":head,"GITHUB_WORKFLOW_SHA":head}
            result=B.bootstrap(root,event,env)
            self.assertEqual(result["reason"],"trusted_base_executed")
            self.assertFalse(hostile.exists())
            payload["pull_request"]["base"]["repo"]["id"]=1
            event.write_text(json.dumps(payload))
            self.assertEqual(B.bootstrap(root,event,env)["mode"],"full")
            self.assertFalse(hostile.exists())
            link=root/"linked-event.json";link.symlink_to(event)
            self.assertEqual(B.bootstrap(root,link,env)["mode"],"full")


if __name__ == "__main__":
    unittest.main()
