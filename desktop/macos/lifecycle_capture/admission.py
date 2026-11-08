"""Literal future Root custody; never issues an allocation or downloads a package."""
import json
import math
import os
from pathlib import Path
import re
import sys
import time
from .protocol import P, CASES, closed, digest, require

BASE='ebdbd340bdc1220318446180c0a0df579489392c'
SOURCE_PARENT='10f0894bf4b4d3d1fc8fe260cbd671dcddfd560e'
BRANCH='refs/heads/codex/experimental-native-p12-lifecycle-capture-consumer01'
SCOPE='P12-six-composited-lifecycle-confirmations-source01'
MANIFEST='1ddcf153b7dabeb82b3e662b8770ab57ea734566343e16496c4932c72391cf78'
PRODUCER=dict(run_id=42455455480,artifact_id=13607980704,
    controller_sha='0210a3c52062ec28e9c6ae74098040e432e09a65',
    branch='codex/experimental-native-p12-lifecycle-package-20261108',
    artifact_name='ff8-host-package-42455455480-1')
STOP=[]


def admit(value=None,env=None,*,now=None):
    env=os.environ if env is None else env
    if value is None:
        text=env.get('ROOT_LIFECYCLE_CAPTURE_ADMISSION','')
        require(0<len(text.encode())<=8192,'one bounded Root declaration')
        def unique(pairs):
            d={}
            for k,v in pairs:require(k not in d,'duplicate admission key');d[k]=v
            return d
        value=json.loads(text,object_pairs_hook=unique)
    closed(value,('scope','controller_sha','H_base','P','Q_sha256','manifest_sha256','producer',
        'allocation_id','admission_nonce','attempt','retries','prior_dispatch_counts','clock'))
    require(value['scope']==SCOPE and value['H_base']==BASE and value['P']==P
        and value['Q_sha256']==digest(Path(__file__).with_name('q_driver.py').read_bytes())
        and value['manifest_sha256']==MANIFEST,'fixed supplier/controller/driver role')
    require(type(value['controller_sha']) is str and re.fullmatch('[0-9a-f]{40}',value['controller_sha'])
        and env.get('GITHUB_SHA')==value['controller_sha'] and env.get('GITHUB_REF')==BRANCH
        and env.get('GITHUB_EVENT_NAME')=='workflow_dispatch' and env.get('GITHUB_RUN_ATTEMPT')=='1'
        and env.get('GITHUB_REPOSITORY')=='arcee-ai/nac'
        and re.fullmatch('[1-9][0-9]*',env.get('GITHUB_RUN_ID','')),'exact first private manual job')
    require(type(value['allocation_id']) is str and re.fullmatch('[A-Za-z0-9_-]{1,100}',value['allocation_id'])
        and type(value['admission_nonce']) is str and re.fullmatch('[0-9a-f]{64}',value['admission_nonce']), 'named Root custody')
    require(type(value['attempt']) is int and value['attempt']==1 and type(value['retries']) is int
        and value['retries']==0 and value['prior_dispatch_counts']==dict.fromkeys(CASES,0)
        and all(type(x) is int for x in value['prior_dispatch_counts'].values()),'unspent serial allocation')
    require(type(value['producer']) is dict and value['producer']==PRODUCER
        and all(type(value['producer'][k]) is int for k in ('run_id','artifact_id')),'original producer identity')
    c=value['clock'];keys=('STARTED','WORK_DEADLINE','CLEANUP_DEADLINE','HARD_DEADLINE');closed(c,keys)
    require(all(type(c[k]) in (int,float) and math.isfinite(c[k]) for k in keys),'finite original clock')
    start,work,cleanup,hard=(c[k] for k in keys);stamp=time.time() if now is None else now
    require(start<=stamp<work<cleanup<hard and hard-start<=3600 and work-start<=2880
        and cleanup-work>=600 and hard-cleanup>=120,'queue-inclusive original48+10+2 clock')
    return value


def make_clock(value):
    from ci_paths_budget import Bound
    c=value['clock']
    class Clock:
        monotonic=staticmethod(time.monotonic)
        def __init__(self):
            self.mono,self.epoch=time.monotonic(),time.time();self.failed=[]
            self.work=Bound(self,self.mono+c['WORK_DEADLINE']-self.epoch,'work')
            self.cleanup=Bound(self,self.mono+c['CLEANUP_DEADLINE']-self.epoch,'cleanup')
            self.retention=Bound(self,self.mono+c['HARD_DEADLINE']-self.epoch,'retention')
        def fail(self,reason):
            if reason not in self.failed:self.failed.append(reason)
        def observe(self):
            before,epoch,after=time.monotonic(),time.time(),time.monotonic()
            if not all(math.isfinite(x) for x in (before,epoch,after)) or after<before or not self.epoch+before-self.mono-1<=epoch<=self.epoch+after-self.mono+1:self.fail('clock discontinuity')
            if STOP:self.fail('stop requested')
            require(not self.failed,'original clock stopped: '+','.join(self.failed))
        def require_phase(self,label,seconds):
            self.work.check()
            if self.work.deadline-self.monotonic()<seconds:self.fail('insufficient original allowance: '+label)
            self.work.check()
    return Clock()


def verify_package(source,package):
    require(digest((package/'manifest.json').read_bytes())==MANIFEST,'original sealed lifecycle manifest')
    body=json.loads((package/'manifest.json').read_bytes())
    require(body['role']=='canonical-lifecycle-fixture-v1' and body['source']['revision']==P,'original lifecycle role')
    sys.path.insert(0,str(source/'desktop/macos/packaging'))
    from lifecycle_package import verify_lifecycle_files
    return verify_lifecycle_files(body,package,source)
