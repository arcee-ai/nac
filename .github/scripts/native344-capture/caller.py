"""Closed caller for the reviewed capture role; never issues Root admission."""
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import signal
import sys
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'desktop/macos'))
from lifecycle_capture.admission import admit,make_clock,verify_package,P,BRANCH,SOURCE_PARENT,STOP
from lifecycle_capture.protocol import require,read,encoded,raw
from lifecycle_capture.owners import Task
from lifecycle_capture.transaction.contract import persist
import transfer

CAPS={'rust':3,'node':2,'checkout-P':2,'setup-controller':12,'setup-P':12,'metadata':2,'download':2,'prepare':2}
WORKFLOW_REF='arcee-ai/nac/.github/workflows/stable-release.yml@'+BRANCH
GATE_MAX=2*1024**2


def context(value=None,*,now=None):
    value=admit(value,now=now)
    require(os.environ.get('GITHUB_WORKFLOW_REF')==WORKFLOW_REF and os.environ.get('GITHUB_JOB')=='capture', 'registered manual workflow/job only')
    require(os.environ.get('ImageVersion')=='20261102.0473.1','exact host image; no fallback')
    return value


def minutes(value,phase,*,now=None):
    now=time.time() if now is None else now
    context(value,now=now)
    if phase=='episode':deadline,cap=value['clock']['CLEANUP_DEADLINE'],58
    else:
        require(phase in CAPS,'fixed caller phase');deadline,cap=value['clock']['WORK_DEADLINE'],CAPS[phase]
    result=min(cap,math.floor((deadline-now-60)/60));require(result>=1,'original queue-inclusive phase exhausted')
    if phase!='episode':
        require(result==cap,'insufficient original allowance for complete caller phase and owner settlement')
    return result


def retention_minutes(value,*,now=None):
    now=time.time() if now is None else now;c=value['clock'];start,hard=c['STARTED'],c['HARD_DEADLINE']
    require(os.environ.get('GITHUB_REPOSITORY')=='arcee-ai/nac' and os.environ.get('GITHUB_REF')==BRANCH
        and os.environ.get('GITHUB_SHA')==value['controller_sha'] and os.environ.get('GITHUB_RUN_ATTEMPT')=='1'
        and os.environ.get('GITHUB_WORKFLOW_REF')==WORKFLOW_REF,'same original retention custody')
    require(all(type(x) in (int,float) and math.isfinite(x) for x in (start,hard,now))
        and start<=now<hard and 0<hard-start<=3600,'original hard retention clock')
    return max(0,min(2,math.floor((hard-now-15)/60)))


def owned(argv,log,cap,clock,*,env=None):
    from ci_xctest import runner_environment
    from ci_paths_budget import using
    import ci
    ci.RUN_DEADLINE=clock.cleanup.deadline
    environment=runner_environment() if env is None else env
    clock.require_phase('caller-helper',cap+15)
    # Existing ci.run/Task remains the only process-group/handle/drainer owner.
    task=Task(argv,log,cap,clock,env=environment,limit=256*1024)
    # Task uses ci.run's existing cwd default, so make runs with explicit -C.
    try:
        task.start()
        return task.finish(cap+20)
    except BaseException as primary:
        try:task.cancel(25)
        except BaseException as secondary:
            if hasattr(primary,'add_note'):primary.add_note('Caller helper settlement: '+type(secondary).__name__)
        raise


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):raise RuntimeError('Metadata redirect refused; no credential forwarding')


def metadata(value,gate,*,opener=None):
    opener=opener or urllib.request.build_opener(NoRedirects())
    token=os.environ.get('GH_TOKEN','');require(token and '\r' not in token and '\n' not in token,'metadata token only in scoped child')
    rows={};hashes={}
    for name,suffix in [('run','/actions/runs/42455455480'),('artifact','/actions/artifacts/13607980704')]:
        context(value);remaining=value['clock']['WORK_DEADLINE']-time.time()-15;require(remaining>0,'metadata original work cutoff')
        url='https://api.github.com/repos/arcee-ai/nac'+suffix
        req=urllib.request.Request(url,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'})
        with opener.open(req,timeout=min(30,remaining)) as response:
            require(response.geturl()==url and response.status==200,'direct exact metadata endpoint')
            body=response.read(1024**2+1)
        require(len(body)<=1024**2,'metadata response limit');rows[name]=json.loads(body);hashes[name]=hashlib.sha256(body).hexdigest()
    identity=transfer.artifact_identity(value,rows['run'],rows['artifact'])
    # Export only the needed actual identity projection, not arbitrary API bodies.
    run=rows['run'];artifact=rows['artifact']
    run={k:run[k] for k in ('id','head_sha','head_branch','event','run_attempt','status','conclusion','repository','head_repository')}
    for key in ('repository','head_repository'):run[key]={'full_name':run[key]['full_name']}
    artifact={k:artifact[k] for k in ('id','name','expired','size_in_bytes','digest','workflow_run')}
    artifact['workflow_run']={k:artifact['workflow_run'][k] for k in ('id','head_sha','head_branch','repository_id','head_repository_id')}
    persist(gate/'producer-run.json',run);persist(gate/'producer-artifact.json',artifact)
    persist(gate/'producer-identity.json',dict(identity=identity,raw_response_sha256=hashes))


def prepare(value,clock,gate,download,package):
    transfer.artifact_identity(value,read(gate/'producer-run.json'),read(gate/'producer-artifact.json'))
    manifest,archive,body=transfer.handoff(download,value)
    require(package.is_absolute() and package.resolve()==package and not package.exists(),'absent canonical selected package')
    package.mkdir(mode=0o700)
    for source in (manifest,archive):
        target=package/source.name;shutil.copyfile(source,target);require(transfer.digest(target)==transfer.digest(source),'unchanged selected transfer')
    require(transfer.digest(package/manifest.name)==value['manifest_sha256']
        and transfer.digest(package/archive.name)==body['container']['sha256'],'sealed selected hashes before extraction')
    owned(['/usr/bin/ditto','-x','-k',str(package/archive.name),str(package)],gate/'extract.log',90,clock)
    # The reviewed controller performs original P verify_lifecycle_files and
    # source/binary/policy checks before any compiler/SDK/native acquisition.
    persist(gate/'package-transfer.json',dict(role=body['role'],P=P,manifest_sha256=transfer.digest(package/manifest.name),
        archive_sha256=transfer.digest(package/archive.name),runtime=False,signature_qualified=False))


def retain(value,gate,episode,retained):
    require(retention_minutes(value)>0,'no original retention allowance')
    require(gate.parent==retained and gate.is_dir() and not gate.is_symlink(),'one fixed retention root')
    evidence=episode/'evidence';files=[];gate_bytes=0;images=nonimages=0
    for folder,prefix in [(gate,Path('caller')),(evidence,Path('episode'))]:
        if not folder.exists():continue
        for source in sorted(folder.rglob('*')):
            require(source.resolve()==source and not source.is_symlink(),'no-follow retained source')
            if not source.is_file():continue
            info=source.stat();require(info.st_nlink==1 and info.st_uid==os.getuid(),'single-link owned retained file')
            image=source.suffix=='.png';limit=2*1024**2 if image else 256*1024
            require(info.st_size<=limit,'retained file bound');relative=prefix/source.relative_to(folder)
            if folder==gate:gate_bytes+=info.st_size;require(not image and source.suffix in ('.json','.log'),'bounded caller metadata only')
            if image:images+=info.st_size
            else:nonimages+=info.st_size
            data=raw(source,limit) if info.st_size else b''
            require(len(data)==info.st_size,'stable retained byte count')
            files.append((data,relative,len(data),hashlib.sha256(data).hexdigest()))
    require(gate_bytes<=GATE_MAX,'caller metadata2MiB cap inside original12MiB')
    manifest=encoded(dict(scope='single54MiB capture+caller retention',files=[dict(file=str(p),bytes=n,sha256=h) for _,p,n,h in files],
        controller_evidence_present=evidence.exists(),structural_acceptance=False,paint_acceptance=False,trusted_input_acceptance=False))
    require(len(manifest)<=64*1024 and nonimages+len(manifest)<=12*1024**2
        and images+nonimages+len(manifest)<=54*1024**2,'single aggregate54MiB/12MiB non-image cap')
    destination=retained/'episode';require(not destination.exists(),'no retention reentry')
    if evidence.exists():
        destination.mkdir(mode=0o700)
        for data,relative,_,_ in files:
            if relative.parts[0]!='episode':continue
            target=retained/relative;target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
            with target.open('xb') as stream:stream.write(data)
    (retained/'retention.json').write_bytes(manifest)


def main():
    action,*args=sys.argv[1:];gate=Path(os.environ['CAPTURE_GATE'])
    if action=='--retain':
        value=json.loads(os.environ['ROOT_LIFECYCLE_CAPTURE_ADMISSION'])
        try:retain(value,gate,Path(os.environ['CAPTURE_EPISODE']),Path(os.environ['CAPTURE_RETAINED']))
        except BaseException as error:
            persist(gate/'retention-error.json',dict(complete_controller_evidence=False,publication_accepted=False,error_type=type(error).__name__))
            raise
        return
    value=context();clock=make_clock(value)
    if action=='--gate':
        phase=args[0];n=minutes(value,phase)
        with open(os.environ['GITHUB_OUTPUT'],'a') as f:f.write('minutes='+str(n)+'\n')
        persist(gate/('clock-'+phase+'.json'),dict(phase=phase,minutes=n,clock=value['clock']));return
    if action=='--metadata-child':metadata(value,gate);return
    if action=='--metadata':
        from ci_xctest import runner_environment
        env=dict(runner_environment(),GH_TOKEN=os.environ['GH_TOKEN'])
        owned([sys.executable,'-B',str(Path(__file__).resolve()),'--metadata-child'],gate/'metadata.log',60,clock,env=env);return
    if action=='--setup':
        from ci_qualifications import require_checkout
        source=ROOT if args==['controller'] else Path(os.environ['P_ROOT'])
        require(args in (['controller'],['P']),'fixed setup source')
        from ci_paths_budget import using
        with using(clock.work):
            require_checkout(source,value['controller_sha'] if args==['controller'] else P)
        from ci_xctest import runner_environment
        owned(['make','-C',str(source),'setup'],gate/('setup-'+args[0]+'.log'),600,clock,
            env=dict(runner_environment(),RUSTUP_AUTO_INSTALL='0',GIT_OPTIONAL_LOCKS='0'));return
    if action=='--prepare':prepare(value,clock,gate,Path(os.environ['CAPTURE_DOWNLOAD']),Path(os.environ['CAPTURE_PACKAGE']));return
    require(action=='--episode' and not args,'fixed controller invocation')
    from lifecycle_capture.controller import episode
    episode(Path(os.environ['P_ROOT']),Path(os.environ['CAPTURE_PACKAGE']),Path(os.environ['CAPTURE_EPISODE']))


if __name__=='__main__':
    for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,lambda n,f:STOP.append(n))
    main()
