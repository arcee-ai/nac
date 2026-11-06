#!/usr/bin/env python3
"""PRIVATE one-shot GNU numeric observer diagnostic; never a production workflow."""
import argparse
import hashlib
import importlib.util
import json
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
import tomllib
sys.dont_write_bytecode=True

ROOT=Path(__file__).resolve().parents[2]
WEB=ROOT/'crates/nac-server/web'
BRANCH='codex/all-582-terminal-observer-profile-20261106'
CASE='connected renderer keeps copy selection, input, resize and Ctrl-C responsive under finite noisy output'
E2E='crates/nac-server/web/e2e/terminal-local-acceptance.e2e.ts'
E2E_SHA='cf54889e48d03df25c0e4e9c4a592255cb06861185abae866d3657ccb6840b25'
GIB=1024**3
PHASES={'fetch_begin','fetch_headers','json','parser_begin','parser_end','ack_ready','completion_admission','owner_config_before','owner_config_after','status','read_page','mapping','serialization'}
UUID=re.compile(r'[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}',re.I)


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
    def __init__(self,home):
        self.home=home;self.evidence=home/'evidence';self.raw=home/'raw';self.commands=[]
        self.evidence.mkdir(mode=0o700);self.raw.mkdir(mode=0o700)
        self.supervisor=module('profile_supervisor','browser-apt-supervisor.py');self.supervisor.subreaper()
        self.stopped=False
        for sig in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP):signal.signal(sig,self.stop)
    def stop(self,_sig,_frame):self.stopped=True
    def run(self,label,command,seconds,env=None,cwd=ROOT):
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
                            'dependency_bytes':sum(size(p)for p in (WEB/'node_modules',ROOT/'.github/scripts/node_modules'))if label=='setup'or not samples else samples[-1]['dependency_bytes'],
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
    controller=Controller(home);result={'schema':1,'diagnostic_only':True,'source':args.source,'tree':subprocess.check_output(['git','rev-parse','HEAD^{tree}'],cwd=ROOT,text=True).strip(),
        'e2e_sha256':E2E_SHA,'run_id':os.environ['GITHUB_RUN_ID'],'attempt':1,'outcome':'not-reached','compiler_budget_bytes':12*GIB,'runtime_budget_bytes':512*1024**2}
    env={k:os.environ[k]for k in ('PATH','HOME','LANG','LC_ALL','CI')if k in os.environ}
    env.update(CARGO_BUILD_JOBS='2',CARGO_PROFILE_DEV_DEBUG='0',CARGO_PROFILE_TEST_DEBUG='0',CARGO_INCREMENTAL='0',
        NAC_SOURCE_REVISION=args.source,NAC_BUILD_TRACK='dev',NAC_BUILD_ID='dev-'+args.source,NAC_TERMINAL_PHASE_PROFILE='1')
    try:
        require(subprocess.check_output(['cargo','--version'],text=True).startswith('cargo 1.98.0 '),'Cargo1.98')
        require(subprocess.check_output(['rustc','--version'],text=True).startswith('rustc 1.98.0 '),'Rust1.98')
        require(subprocess.check_output(['node','--version'],text=True).strip()=='v24.22.1','Node24.22.1')
        result['cpu_capacity']=capacity
        result['started_utc']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
        result['runner']={k:os.environ.get(k)for k in ('ImageOS','ImageVersion','RUNNER_ARCH','RUNNER_OS')}
        result['tools']={tool:subprocess.check_output([tool,'--version'],text=True).strip()for tool in ('cargo','rustc','node','npm')}
        # Normal signed APT; existing pidfd root supervisor owns privileged descendants.
        apt=module('profile_apt','browser-apt.py')
        apt.run(controller.raw,'apt-update',['sudo','apt-get','update'],timeout=180)
        controller.run('setup',['make','setup'],360,env)
        cli=WEB/'node_modules/playwright/cli.js'
        apt.run(controller.raw,'browser-libraries',['sudo',shutil.which('node'),str(cli),'install-deps','chromium'],cwd=WEB,timeout=180)
        controller.run('assets',['npm','run','build'],180,env,WEB)
        controller.run('source',['git','diff','--exit-code'],10,env)
        require(not subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip(),'asset writer drift/untracked source')
        controller.run('build',['cargo','build','--locked','-p','nac-server','--bin','nac-web'],720,env)
        binary=ROOT/'target/debug/nac-web';result['binary']={'sha256':digest(binary),'bytes':binary.stat().st_size}
        controller.run('version',[str(binary),'--version'],10,env)
        guide=controller.run('guide',[str(binary),'guide','skills','discovery'],10,env)
        with regular(guide)as handle:value=json.load(handle)
        identity=value.get('build_identity',{})
        version=tomllib.loads((ROOT/'Cargo.toml').read_text())['workspace']['package']['version']
        expected={'product_version':version,'source_revision':args.source,'build_id':'dev-'+args.source,'track':'dev'}
        require(value.get('provenance')=='first-party bundled NAC Guide'and identity==expected,'fresh bundled Guide full identity')
        result['guide_identity']=identity
        runtime=env|{'NAC_E2E_BINARY':str(binary),'NAC_E2E_ARTIFACTS':str(controller.raw/'playwright'),'KEEP_E2E':'1'}
        result['outcome']='case-started'
        controller.run('case',['node',str(cli),'test','terminal-local-acceptance.e2e.ts','--grep','^'+re.escape(CASE)+'$','--workers=1','--retries=0'],180,runtime,WEB)
        result['outcome']='case-pass'
    except BaseException as error:
        result['error']=type(error).__name__+': '+str(error)
        if result['outcome']=='case-started':result['outcome']='case-failed-or-incomplete'
        raise
    finally:
        try:
            result['phases']=capture_phases(controller.raw,controller.evidence)
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
