#!/usr/bin/env python3
"""PRIVATE one-shot GNU numeric observer diagnostic; never a production workflow."""
import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import stat
import subprocess
import sys
import time
sys.dont_write_bytecode=True

ROOT=Path(__file__).resolve().parents[2]
WEB=ROOT/'crates/nac-server/web'
DEPENDENCY_ROOTS=(WEB/'node_modules',ROOT/'.github/scripts/node_modules')
BRANCH='codex/all-582-terminal-profile-current-20261106'
CASE='connected renderer keeps copy selection, input, resize and Ctrl-C responsive under finite noisy output'
E2E='crates/nac-server/web/e2e/terminal-local-acceptance.e2e.ts'
E2E_SHA='cf54889e48d03df25c0e4e9c4a592255cb06861185abae866d3657ccb6840b25'
GIB=1024**3
PHASES={'fetch_begin','fetch_headers','json','parser_begin','parser_end','ack_ready','completion_admission','owner_config_before','owner_config_after','status','read_page','mapping','serialization'}
UUID=re.compile(r'[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}',re.I)


class BudgetRefusal(ValueError):
    """An operation was not launched because its complete budget did not fit."""


def record_failure(result,error):
    result['error']=type(error).__name__+': '+str(error)
    if isinstance(error,BudgetRefusal):result['outcome']='budget-not-executed/no-result'
    elif result['outcome']=='case-started':result['outcome']='case-failed-or-incomplete'


def require(value,message):
    if not value:raise ValueError(message)


def module(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file))
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result


def regular(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    info=os.fstat(fd)
    if not stat.S_ISREG(info.st_mode)or info.st_nlink!=1:
        os.close(fd);raise ValueError('regular single-link file required')
    return os.fdopen(fd,'rb')


def digest(path):
    h=hashlib.sha256()
    with regular(path)as source:
        while chunk:=source.read(1024*1024):h.update(chunk)
    return h.hexdigest()


def expected_identity(source):
    """Canonical product version is ROOT/version.txt; no Cargo/env fallback."""
    require(isinstance(source,str)and re.fullmatch(r'[0-9a-f]{40}',source),'canonical full source required')
    with regular(ROOT/'version.txt')as handle:raw=handle.read(129)
    require(len(raw)<=128,'version.txt bound')
    version=raw.decode('utf8').strip()
    require(re.fullmatch(r'(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)',version),'version.txt must contain one stable semantic version')
    return {'product_version':version,'source_revision':source,'build_id':'dev-'+source,'track':'dev'}


def verify_identities(expected,version_output,guide_output,evidence):
    """Full semantic identity gate before the unchanged runtime fixture."""
    receipt={'schema':1,'expected':expected,'observed':None,'version_match':False,
        'guide_provenance_match':False,'guide_identity_match':False,'accepted':False}
    try:
        with regular(version_output)as handle:version=handle.read(4097)
        require(len(version)<=4096,'version output bound')
        receipt['version_match']=version.decode('utf8').strip()==f"nac-web {expected['product_version']} ({expected['source_revision'][:12]})"
        with regular(guide_output)as handle:raw=handle.read(1024**2+1)
        require(len(raw)<=1024**2,'Guide output bound')
        value=json.loads(raw,object_pairs_hook=unique,parse_constant=lambda _:require(False,'nonfinite Guide value'))
        require(isinstance(value,dict),'Guide object required')
        observed=value.get('build_identity')
        patterns={'product_version':r'(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)',
            'source_revision':r'[a-f0-9]{40}','track':r'dev|beta|stable','build_id':r'(?:dev|beta|stable)-[a-f0-9]{40}'}
        if isinstance(observed,dict):
            receipt['observed']={key:observed.get(key)if isinstance(observed.get(key),str)and len(observed[key])<=128 and re.fullmatch(pattern,observed[key])else None for key,pattern in patterns.items()}
        receipt['guide_provenance_match']=value.get('provenance')=='first-party bundled NAC Guide'
        receipt['guide_identity_match']=observed==expected
        require(receipt['version_match']and receipt['guide_provenance_match']and receipt['guide_identity_match'],'version/full bundled Guide identity mismatch')
        receipt['accepted']=True
        return observed
    except BaseException as error:
        receipt['error_type']=type(error).__name__;raise
    finally:write(evidence/'build-identity-comparison.json',receipt)


def compiler_identity(evidence):
    """Only ROOT/target/debug/nac-web; never a selected-source reader or walker."""
    def metadata(info):
        return {name:getattr(info,'st_'+name)for name in
            ('dev','ino','mode','uid','gid','size','nlink','mtime_ns','ctime_ns')}
    receipt={'schema':1,'relative_path':'target/debug/nac-web','maximum_bytes':512*1024**2,
        'accepted':False,'leaf_lstat':None,'descriptor_before':None,'descriptor_after':None,'path_after':None}
    directory=None;fd=None;started=time.monotonic()
    try:
        directory=os.open(ROOT,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        for component in ('target','debug'):
            require(os.fstat(directory).st_uid==os.getuid(),'compiler directory owner')
            child=os.open(component,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=directory)
            os.close(directory);directory=child
        require(os.fstat(directory).st_uid==os.getuid(),'compiler directory owner')
        receipt['leaf_lstat']=metadata(os.stat('nac-web',dir_fd=directory,follow_symlinks=False))
        fd=os.open('nac-web',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=directory)
        before=os.fstat(fd);receipt['descriptor_before']=metadata(before)
        require(receipt['leaf_lstat']==receipt['descriptor_before'],'compiler path changed before acquisition')
        require(stat.S_ISREG(before.st_mode)and before.st_uid==os.getuid(),'compiler output regular owned file required')
        require(before.st_mode&0o111 and 0<before.st_size<=receipt['maximum_bytes'],'compiler output executable/size bound')
        result=hashlib.sha256();remaining=before.st_size
        while True:
            require(time.monotonic()-started<=10,'compiler hash time bound')
            chunk=os.read(fd,min(1024**2,remaining+1))
            if not chunk:break
            remaining-=len(chunk);require(remaining>=0,'compiler output grew while hashing')
            result.update(chunk)
        require(remaining==0,'compiler output shrank while hashing')
        receipt['sha256']=result.hexdigest()
        receipt['descriptor_after']=metadata(os.fstat(fd))
        receipt['path_after']=metadata(os.stat('nac-web',dir_fd=directory,follow_symlinks=False))
        require(receipt['descriptor_before']==receipt['descriptor_after']==receipt['path_after'],'compiler metadata changed while hashing')
        receipt['accepted']=True
        identity={'sha256':receipt['sha256'],'bytes':before.st_size}
    except BaseException as error:
        receipt['error']=type(error).__name__+': '+str(error)
        raise
    finally:
        changed_after_check=False
        if fd is not None:
            try:
                receipt['descriptor_after']=metadata(os.fstat(fd))
                changed_after_check=receipt['accepted']and receipt['descriptor_after']!=receipt['descriptor_before']
                if changed_after_check:
                    receipt['accepted']=False;receipt['error']='ValueError: compiler metadata changed before close'
            finally:os.close(fd)
        if directory is not None:os.close(directory)
        receipt['seconds']=time.monotonic()-started
        # Published before any rejection escapes or caller starts version/Guide.
        write(evidence/'compiler-output-identity.json',receipt)
        if changed_after_check:raise ValueError('compiler metadata changed before close')
    return identity


def write(path,value):
    raw=json.dumps(value,sort_keys=True).encode();require(len(raw)<=5*1024**2,'receipt bound')
    fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as out:out.write(raw)


def size(path):
    total=0;entries=0;started=time.monotonic()
    if not path.exists():return 0
    for directory,dirs,files in os.walk(path,followlinks=False):
        for name in dirs+files:
            entries+=1
            require(entries<=200000 and time.monotonic()-started<=10,'owned traversal bound')
            item=Path(directory)/name;info=item.lstat()
            require(not stat.S_ISLNK(info.st_mode),'owned tree symlink')
            require(stat.S_ISDIR(info.st_mode)or stat.S_ISREG(info.st_mode),'owned tree special file')
            if stat.S_ISREG(info.st_mode):total+=info.st_size
    return total


def dependency_inventory(path):
    """Only the two npm dependency roots: count link inode bytes, never targets."""
    require(path in DEPENDENCY_ROOTS,'explicit dependency root required')
    counts={'logical_bytes':0,'regular_files':0,'directories':0,'link_entries':0,'link_bytes':0,'entries':0}
    started=time.monotonic();stack=[]
    def enter(fd):
        try:stack.append((fd,os.scandir(fd)))
        except BaseException:os.close(fd);raise
    try:
        try:fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        except FileNotFoundError:return counts
        enter(fd)
        while stack:
            fd,iterator=stack[-1]
            try:entry=next(iterator)
            except StopIteration:
                iterator.close();os.close(fd);stack.pop();continue
            counts['entries']+=1
            require(counts['entries']<=200000 and len(stack)<=128 and time.monotonic()-started<=10,'dependency traversal bound')
            info=entry.stat(follow_symlinks=False)
            if stat.S_ISLNK(info.st_mode):
                counts['link_entries']+=1;counts['link_bytes']+=info.st_size;counts['logical_bytes']+=info.st_size
            elif stat.S_ISREG(info.st_mode):
                counts['regular_files']+=1;counts['logical_bytes']+=info.st_size
            elif stat.S_ISDIR(info.st_mode):
                counts['directories']+=1
                enter(os.open(entry.name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd))
            else:raise ValueError('dependency special file')
        return counts
    finally:
        for fd,iterator in stack:iterator.close();os.close(fd)


def numeric(value):
    require(isinstance(value,dict),'numeric record object')
    common={'schema','side','phase','seq'}
    require(type(value.get('schema'))is int and value['schema']==1 and value.get('side')in('client','server'),'record schema/side')
    require(type(value.get('seq'))is int and 0<=value['seq']<=2048,'record count')
    if value.get('phase')=='truncated':
        require(set(value)==common and value['seq']==2048,'truncation shape');return value
    require(value.get('phase')in PHASES,'phase allowlist')
    require(set(value)in(common|{'at_us','elapsed_us','observer','cursor'},common|{'at_us','elapsed_us','observer','cursor','request'}),'record fields')
    for name in ('at_us','elapsed_us'):require(type(value.get(name))is int and 0<=value[name]<=2**64-1,'numeric duration')
    require(UUID.fullmatch(value.get('observer',''))and re.fullmatch(r'0|[1-9][0-9]{0,19}',value.get('cursor','')),'record identifiers')
    if 'request'in value:require(UUID.fullmatch(value['request']),'request identifier')
    return value


def unique(pairs):
    value={}
    for key,item in pairs:
        require(key not in value,'duplicate numeric key');value[key]=item
    return value


def capture_phases(raw,out):
    rows=[];counts={'client':0,'server':0};errors=0
    for path in raw.rglob('*'):
        if path.name not in('nac-web.log','browser-events.json'):continue
        with regular(path)as source:
            data=source.read(32*1024**2+1)
        require(len(data)<=32*1024**2,'runtime log bound')
        if path.name=='browser-events.json':
            events=json.loads(data);lines=[e.get('text','')for e in events if e.get('kind')=='console']
        else:lines=data.decode('utf8',errors='replace').splitlines()
        for line in lines:
            if not line.startswith('NAC_TERMINAL_PHASE '):continue
            try:
                value=numeric(json.loads(line[len('NAC_TERMINAL_PHASE '):],object_pairs_hook=unique));side=value['side']
                require(counts[side]<2049,'per-side count');counts[side]+=1;rows.append(value)
            except (ValueError,TypeError,KeyError):errors+=1
    write(out/'phases.json',rows)
    return {'counts':counts,'invalid_records':errors,'truncated':any(r['phase']=='truncated'for r in rows),
            'clock_domains':'independent process clocks; never subtract client/server origins'}


def pressure(raw,out):
    paths=list(raw.rglob('pressure-observations.json'))
    require(len(paths)<=1,'one pressure observation owner')
    if not paths:return {'present':False}
    with regular(paths[0])as source:data=source.read(1024**2+1)
    require(len(data)<=1024**2,'pressure observation bound')
    value=json.loads(data,object_pairs_hook=unique)
    require(set(value)=={'measurements','heartbeat','pages','maxFrameBytes'},'pressure fields')
    def number(item):return type(item)in(int,float)and math.isfinite(item)and 0<=item<=10**12
    require(isinstance(value['measurements'],dict)and set(value['measurements'])<={
        'rowsBeforeHistoryRefresh','rowsAfterHistoryRefresh','resizeMs','interruptToDomMarkerMs','interruptToRenderedMarkerMs','closeSettledMs'},'measurement fields')
    require(all(number(item)for item in value['measurements'].values()),'numeric measurements')
    beat=value['heartbeat'];require(set(beat)=={'count','maxGapMs','last','active'}and type(beat['active'])is bool,'heartbeat fields')
    require(all(number(beat[name])for name in ('count','maxGapMs','last')),'numeric heartbeat')
    require(isinstance(value['pages'],list)and len(value['pages'])<=2048,'page observation bound')
    for page in value['pages']:
        require(set(page)=={'bytes','gap','retained'}and type(page['gap'])is bool and all(number(page[name])for name in ('bytes','retained')),'numeric page observation')
    require(number(value['maxFrameBytes']),'frame maximum')
    write(out/'pressure-observations.json',value)
    return {'present':True,'pages':len(value['pages'])}


def cpu_capacity():
    """Private process affinity only; never changes runner/cgroup configuration."""
    require(hasattr(os,'sched_getaffinity')and hasattr(os,'sched_setaffinity'),'CPU affinity unsupported; diagnostic inconclusive')
    before=sorted(os.sched_getaffinity(0))
    require(len(before)>=2,'fewer than two allowed CPUs; diagnostic inconclusive')
    selected=before[:2];os.sched_setaffinity(0,set(selected))
    after=sorted(os.sched_getaffinity(0));require(after==selected,'two-CPU affinity not enforced; diagnostic inconclusive')
    quotas=[];quota_error=None
    try:
        raw=Path('/proc/self/cgroup').read_text();require(len(raw)<=16384,'cgroup metadata bound')
        matches=[line[3:]for line in raw.splitlines()if line.startswith('0::')]
        require(len(matches)==1,'unknown unified cgroup')
        parts=Path(matches[0]).parts
        require(matches[0].startswith('/')and '..'not in parts,'noncanonical cgroup path')
        root=Path('/sys/fs/cgroup');current=root.joinpath(*parts[1:])
        while True:
            path=current/'cpu.max'
            if path.exists():
                words=path.read_text().split();require(len(words)==2,'unknown cpu.max')
                require(words[1].isdigit()and int(words[1])>0,'unknown quota period')
                if words[0]!='max':
                    require(words[0].isdigit()and int(words[0])>0,'unknown CPU quota')
                    quotas.append(int(words[0])/int(words[1]))
            if current==root:break
            current=current.parent
    except (OSError,ValueError)as error:quota_error=type(error).__name__+': '+str(error)
    return {'host_visible_cpus':os.cpu_count(),'affinity_before':before,'affinity_selected':after,
        'cgroup_v2_quota_cpus':quotas,'cgroup_observation_error':quota_error,
        'effective_upper_bound_cpus':min([2,*quotas]),
        'matched_failed_runtime':False,
        'comparison_limit':'failed-run affinity/cgroup capacity was not captured; pinning does not establish matched machine/runtime'}


class Controller:
    def __init__(self,home,deadline):
        self.home=home;self.deadline=deadline;self.evidence=home/'evidence';self.raw=home/'raw';self.commands=[]
        self.evidence.mkdir(mode=0o700);self.raw.mkdir(mode=0o700)
        self.supervisor=module('profile_supervisor','browser-apt-supervisor.py');self.supervisor.subreaper()
        self.stopped=False;self.privileged=False
        for sig in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP):signal.signal(sig,self.stop)
    def stop(self,_sig,_frame):
        self.stopped=True
        # Let the existing privileged wrapper send its stop request and verify
        # the root-owned cleanup receipt, rather than waiting out900s on signal.
        if self.privileged:raise InterruptedError('privileged controller interrupted')
    def native(self,apt,label,command,*,cwd=ROOT):
        self.admit(label,900);self.privileged=True
        try:return apt.run(self.raw,label,command,cwd=cwd,timeout=900)
        finally:self.privileged=False
    def admit(self,label,seconds):
        remaining=self.deadline-time.time()
        admitted=not self.stopped and remaining>=seconds+120+180
        write(self.evidence/(label+'-admission.json'),{'phase':label,'seconds':seconds,
            'cleanup_reserve_seconds':120,'artifact_margin_seconds':180,'remaining_seconds':remaining,'admitted':admitted})
        if not admitted:raise BudgetRefusal('budget-not-executed/no-result: full operation plus cleanup/transfer does not fit')
    def run(self,label,command,seconds,env=None,cwd=ROOT):
        self.admit(label,seconds)
        start=time.monotonic();child=None;error=None;cleanup=None;samples=[];owner=None
        out=self.raw/(label+'.stdout');err=self.raw/(label+'.stderr')
        try:
            with out.open('xb')as stdout,err.open('xb')as stderr:
                child=subprocess.Popen(command,cwd=cwd,env=env,stdout=stdout,stderr=stderr,start_new_session=True)
                owner=self.supervisor.process(child.pid)
                next_scan=0
                while child.poll()is None:
                    require(not self.stopped,'controller interrupted')
                    require(time.monotonic()-start<seconds,'phase timeout; no retry')
                    require(shutil.disk_usage(self.home).free>=13*GIB,'13GiB reserve')
                    if time.monotonic()>=next_scan:
                        sample={'seconds':time.monotonic()-start,
                            'target_bytes':size(ROOT/'target')if label=='build'or not samples else samples[-1]['target_bytes'],
                            'dependency_bytes':sum(dependency_inventory(p)['logical_bytes']for p in DEPENDENCY_ROOTS)if label=='setup'or not samples else samples[-1]['dependency_bytes'],
                            'runtime_bytes':size(self.home),'free_bytes':shutil.disk_usage(self.home).free}
                        samples.append(sample)
                        require(sample['target_bytes']<=12*GIB,'12GiB compiler target budget')
                        require(sample['dependency_bytes']<=2*GIB,'2GiB dependency setup budget')
                        require(sample['runtime_bytes']<=512*1024**2,'512MiB runtime/evidence budget')
                        require(out.stat().st_size+err.stat().st_size<=32*1024**2,'command log budget')
                        next_scan=time.monotonic()+5
                    time.sleep(.1)
            require(size(self.home)<=512*1024**2,'512MiB final runtime/evidence budget')
            require(size(ROOT/'target')<=12*GIB,'12GiB final compiler budget')
            require(shutil.disk_usage(self.home).free>=13*GIB,'13GiB final reserve')
            require(child.returncode==0,f'{label} failed exit{child.returncode}; no retry')
        except BaseException as caught:error=type(caught).__name__+': '+str(caught);raise
        finally:
            cleanup=self.supervisor.settle(child)
            receipt={'phase':label,'command':command,'seconds':time.monotonic()-start,'pid':child.pid if child else None,
                     'exit':child.returncode if child else None,'owner':owner,'error':error,'cleanup':cleanup,'samples':samples}
            self.commands.append(receipt);write(self.evidence/(label+'.json'),receipt)
            require(cleanup['remaining']==[],'owned descendants remain')
        return out


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source',required=True);args=parser.parse_args()
    require(re.fullmatch(r'[0-9a-f]{40}',args.source),'immutable source')
    require(platform.system()=='Linux'and platform.machine()=='x86_64'and os.getuid()>0,'ordinary GNU runner')
    require(os.environ.get('GITHUB_EVENT_NAME')=='workflow_dispatch'and os.environ.get('GITHUB_REF')=='refs/heads/'+BRANCH,'private manual ref')
    require(os.environ.get('GITHUB_REPOSITORY')=='arcee-ai/nac'and os.environ.get('GITHUB_REPOSITORY_ID')=='1194218201','repository binding')
    require(os.environ.get('GITHUB_RUN_ATTEMPT')=='1'and re.fullmatch(r'[1-9][0-9]*',os.environ.get('GITHUB_RUN_ID','')),'attempt1 only')
    require(os.environ.get('GITHUB_SHA')==args.source==subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'exact source')
    require(not subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip(),'clean source')
    require(os.environ.get('ImageOS')=='ubuntu26','ubuntu26 runner required')
    capacity=cpu_capacity()
    require(digest(ROOT/E2E)==E2E_SHA,'unchanged E2E case')
    parent=Path(os.environ['RUNNER_TEMP']);require(parent.is_absolute()and not parent.is_symlink(),'runner temp')
    home=parent/'terminal-observer-profile';home.mkdir(mode=0o700)
    require(shutil.disk_usage(home).free>=15*GIB,'15GiB starting reserve,13GiB monitored floor')
    anchor=os.environ.get('PROFILE_JOB_ANCHOR','')
    require(re.fullmatch(r'[1-9][0-9]{9}',anchor)and 0<=time.time()-int(anchor)<2400,'valid first-step40min anchor required')
    deadline=int(anchor)+2400
    controller=Controller(home,deadline);result={'schema':1,'diagnostic_only':True,'source':args.source,'tree':subprocess.check_output(['git','rev-parse','HEAD^{tree}'],cwd=ROOT,text=True).strip(),
        'e2e_sha256':E2E_SHA,'run_id':os.environ['GITHUB_RUN_ID'],'attempt':1,'outcome':'not-reached','compiler_budget_bytes':12*GIB,'runtime_budget_bytes':512*1024**2,'first_step_anchor':int(anchor),'deadline_unix':deadline,'cleanup_reserve_seconds':120,'artifact_margin_seconds':180}
    env={k:os.environ[k]for k in ('PATH','HOME','LANG','LC_ALL','CI')if k in os.environ}
    env.update(CARGO_BUILD_JOBS='2',CARGO_PROFILE_DEV_DEBUG='0',CARGO_PROFILE_TEST_DEBUG='0',CARGO_INCREMENTAL='0',
        NAC_SOURCE_REVISION=args.source,NAC_BUILD_TRACK='dev',NAC_BUILD_ID='dev-'+args.source,NAC_TERMINAL_PHASE_PROFILE='1')
    try:
        expected=expected_identity(args.source);result['expected_build_identity']=expected
        require(subprocess.check_output(['cargo','--version'],text=True).startswith('cargo 1.98.0 '),'Cargo1.98')
        require(subprocess.check_output(['rustc','--version'],text=True).startswith('rustc 1.98.0 '),'Rust1.98')
        require(subprocess.check_output(['node','--version'],text=True).strip()=='v24.22.1','Node24.22.1')
        result['cpu_capacity']=capacity
        result['started_utc']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
        result['runner']={k:os.environ.get(k)for k in ('ImageOS','ImageVersion','RUNNER_ARCH','RUNNER_OS')}
        result['tools']={tool:subprocess.check_output([tool,'--version'],text=True).strip()for tool in ('cargo','rustc','node','npm')}
        # Normal signed APT; existing pidfd root supervisor owns privileged descendants.
        apt=module('profile_apt','browser-apt.py')
        controller.native(apt,'apt-update',['sudo','apt-get','update'])
        controller.run('setup',['make','setup'],360,env)
        cli=WEB/'node_modules/playwright/cli.js'
        controller.native(apt,'browser-libraries',['sudo',shutil.which('node'),str(cli),'install-deps','chromium'],cwd=WEB)
        controller.run('assets',['npm','run','build'],180,env,WEB)
        controller.run('source',['git','diff','--exit-code'],10,env)
        require(not subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip(),'asset writer drift/untracked source')
        controller.run('build',['cargo','build','--locked','-p','nac-server','--bin','nac-web'],720,env)
        binary=ROOT/'target/debug/nac-web';result['binary']=compiler_identity(controller.evidence)
        version=controller.run('version',[str(binary),'--version'],10,env)
        guide=controller.run('guide',[str(binary),'guide','skills','discovery'],10,env)
        result['guide_identity']=verify_identities(expected,version,guide,controller.evidence)
        runtime=env|{'NAC_E2E_BINARY':str(binary),'NAC_E2E_ARTIFACTS':str(controller.raw/'playwright'),'KEEP_E2E':'1'}
        result['outcome']='case-started'
        controller.run('case',['node',str(cli),'test','terminal-local-acceptance.e2e.ts','--grep',r'(?:^| )'+re.escape(CASE)+'$','--workers=1','--retries=0'],180,runtime,WEB)
        result['outcome']='case-pass'
    except BaseException as error:
        record_failure(result,error)
        raise
    finally:
        try:
            result['phases']=capture_phases(controller.raw,controller.evidence)
            result['pressure']=pressure(controller.raw,controller.evidence)
            require(result['phases']['invalid_records']==0,'malformed numeric record')
            if result['outcome'].startswith('case-'):
                require(all(result['phases']['counts'].values()),'missing numeric side; diagnostic inconclusive')
        except BaseException as error:
            result['profile_error']=type(error).__name__+': '+str(error)
            raise
        finally:
            result['free_bytes']=shutil.disk_usage(home).free
            result['owned_cleanup']=controller.supervisor.settle(None)
            for ledger in controller.raw.glob('*-command.json'):
                with regular(ledger)as handle:write(controller.evidence/ledger.name,json.load(handle))
            for cleanup in controller.raw.glob('*-privileged/result.json'):
                with regular(cleanup)as handle:write(controller.evidence/(cleanup.parent.name+'-result.json'),json.load(handle))
            result['ended_utc']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
            result['raw_files']=[{'relative':str(p.relative_to(controller.raw)),'bytes':p.stat().st_size,'sha256':digest(p)}for p in controller.raw.rglob('*')if p.is_file()and not p.is_symlink()]
            write(controller.evidence/'result.json',result)
            # Delete only this invocation's newly created raw fixture tree. Never compiler/shared cache.
            require(not home.is_symlink()and home.stat().st_uid==os.getuid(),'owned cleanup root')
            shutil.rmtree(controller.raw)


if __name__=='__main__':main()
