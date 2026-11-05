#!/usr/bin/env python3
"""Native diagnostic package authority, artifact admission and owned cache offers."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import shlex
import signal
import stat
import subprocess
import sys
import time
from types import SimpleNamespace
import threading
from urllib.parse import unquote

sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[2]
SPEC=importlib.util.spec_from_file_location('experiment',Path(__file__).with_name('apt-archive-experiment.py'))
experiment=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(experiment)
store=experiment.store
CACHE=Path('/var/cache/apt/archives')
BRANCH='refs/heads/codex/all-582-apt-runtime-parity'
MAX_JSON=128*1024


def require(value,message):
    if not value:raise ValueError(message)


def sha(path,*,single_link=True):
    result=hashlib.sha256()
    source=store.regular(path)if single_link else os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb')
    with source:
        info=os.fstat(source.fileno())
        require(stat.S_ISREG(info.st_mode)and info.st_size<=store.MAX_FILE,'regular bounded digest source')
        while data:=source.read(1024*1024):result.update(data)
    return result.hexdigest()


def load(path):
    with store.regular(path) as source:data=source.read(MAX_JSON+1)
    require(len(data)<=MAX_JSON,'JSON bound')
    return json.loads(data,object_pairs_hook=store.unique)


def write(path,value):
    path.write_bytes(store.canonical(value))


class State:
    def __init__(self,path):
        self.path=path.resolve()
        self.commands=load(self.path/'commands.json') if (self.path/'commands.json').exists() else []

    def run(self,label,args,*,cwd=ROOT,timeout=900):
        require(re.fullmatch(r'[a-z][a-z0-9-]{0,60}',label),'unsafe command label')
        require(0<timeout<=1800,'command controller bound')
        allowed=('PATH','HOME','LANG','LC_ALL','CARGO_HOME','RUSTUP_HOME','RUSTUP_TOOLCHAIN',
            'CARGO_INCREMENTAL','CARGO_PROFILE_DEV_DEBUG','CARGO_PROFILE_TEST_DEBUG','CARGO_BUILD_JOBS',
            'NAC_SOURCE_REVISION','NAC_BUILD_TRACK','NAC_BUILD_ID','NAC_E2E_BINARY','NAC_E2E_ARTIFACTS',
            'KEEP_E2E','PLAYWRIGHT_BROWSERS_PATH')
        env={k:os.environ[k]for k in allowed if k in os.environ}
        if label in ('browser-check','journeys'):
            env['NAC_E2E_CLEANUP_ID']=marker(load(self.path/'identity.json'))
            env['NAC_E2E_ARTIFACTS']=str(self.path/'test-results')
        require(all(not os.path.lexists(self.path/(label+s))for s in ('.stdout.log','.stderr.log')),
                'command evidence already exists; no retry')
        started=time.monotonic();events=[];sizes=[0,0];errors=[]
        require(__import__('shutil').disk_usage(self.path).free>=13*1024**3,'13GiB reserve')
        child=subprocess.Popen([str(x)for x in args],cwd=cwd,env=env,stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE,start_new_session=True)
        def drain(pipe,suffix,index):
            try:
                with (self.path/(label+suffix)).open('xb')as output:
                    pending=b''
                    while chunk:=pipe.read1(65536):
                        output.write(chunk);sizes[index]+=len(chunk)
                        pending=(pending+chunk)[-1024*1024:]
                        lines=pending.split(b'\n');pending=lines.pop()
                        if label=='normal-playwright':
                            for line in lines:
                                if re.search(rb'Need to get |^Fetched |Downloading |downloaded to |Installing dependencies',line):
                                    events.append({'seconds':time.monotonic()-started,
                                        'line':line[:4096].decode(errors='replace')})
            except BaseException as error:errors.append(str(error))
            finally:pipe.close()
        threads=[threading.Thread(target=drain,args=(pipe,suffix,i),daemon=True)for i,(pipe,suffix)in
                 enumerate(((child.stdout,'.stdout.log'),(child.stderr,'.stderr.log')))]
        for thread in threads:thread.start()
        interrupted=False
        try:
            while child.poll()is None:
                require(time.monotonic()-started<timeout,'command controller timeout; no retry')
                require(__import__('shutil').disk_usage(self.path).free>=13*1024**3,'13GiB reserve')
                require(sum(sizes)<=32*1024**2,'command output bound')
                time.sleep(.1)
        except BaseException:
            interrupted=True
            try:os.killpg(child.pid,signal.SIGKILL)
            except ProcessLookupError:pass
            child.wait(timeout=10)
            raise
        finally:
            for thread in threads:thread.join(timeout=.2)
            leaked_capture=any(t.is_alive()for t in threads)
            if leaked_capture:
                try:os.killpg(child.pid,signal.SIGKILL)
                except ProcessLookupError:pass
                for thread in threads:thread.join(timeout=10)
            self.commands.append({'label':label,'args':[str(x)for x in args],
                'pid':child.pid,'exit':child.returncode,'seconds':time.monotonic()-started,
                'interrupted':interrupted,'descendant_pipe_leak':leaked_capture,'stdout_bytes':sizes[0],'stderr_bytes':sizes[1],
                'install_events':events,'capture_errors':errors,
                'capture_complete':all(not t.is_alive()for t in threads)})
            write(self.path/'commands.json',self.commands)
        require(not leaked_capture and not errors and all(not t.is_alive()for t in threads)and sum(sizes)<=32*1024**2,
                'incomplete/bounded child capture')
        require(child.returncode==0,f'{label}: exit{child.returncode}; no retry')
        return (self.path/(label+'.stdout.log')).read_text()


def marker(identity):
    value=f"apt-parity-{identity['run_id']}-{identity['attempt']}-{identity['lane']}"
    require(re.fullmatch(r'apt-parity-[1-9][0-9]*-[1-9][0-9]*-(?:cold|hit)',value),'unsafe owned marker')
    return value


def context(state,source,lane):
    require(sys.platform=='linux' and os.geteuid()!=0 and platform.machine()=='x86_64',
            'requires unprivileged GNU runner')
    require(re.fullmatch(r'[0-9a-f]{40}',source),'immutable source required')
    require(state.run('source',['git','rev-parse','HEAD']).strip()==source,'checkout source mismatch')
    values={k:os.environ.get(k,'') for k in ('GITHUB_REPOSITORY','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT',
        'GITHUB_REF','GITHUB_EVENT_NAME','ImageOS','ImageVersion','RUNNER_OS','RUNNER_ARCH')}
    require(all(values.values()),'missing runner identity')
    require(values['RUNNER_OS']=='Linux'and values['RUNNER_ARCH']=='X64','wrong Actions runner platform')
    require(values['GITHUB_REPOSITORY']=='arcee-ai/nac' and values['GITHUB_REF']==BRANCH
            and values['GITHUB_EVENT_NAME']=='push','wrong diagnostic scope')
    require(all(re.fullmatch(r'[1-9][0-9]*',values[k])for k in ('GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT')),
            'invalid run/attempt')
    require('VERSION="26.04.1 LTS' in Path('/etc/os-release').read_text(),'unsupported actual Ubuntu')
    require(state.run('dpkg-architecture',['dpkg','--print-architecture']).strip()=='amd64','wrong ABI')
    node=state.run('node-version',['node','--version']).strip()
    rustc=state.run('rustc-version',['rustc','--version']).strip()
    require(node=='v24.22.1'and rustc.startswith('rustc 1.98.0 '),'wrong pinned tool runtime')
    write(state.path/'runner.json',{'actions':values,'os_release':Path('/etc/os-release').read_text(),
        'platform':platform.platform(),'python':sys.version,'node':node,'rustc':rustc})
    return {'schema':1,'source':source,'repository':values['GITHUB_REPOSITORY'],
        'run_id':values['GITHUB_RUN_ID'],'attempt':values['GITHUB_RUN_ATTEMPT'],'lane':lane,
        'ImageOS':values['ImageOS'],'ImageVersion':values['ImageVersion'],
        'dpkg_status_sha256':hashlib.sha256(Path('/var/lib/dpkg/status').read_bytes()).hexdigest(),
        'node':node,'rustc':rustc}


def selected_offers(text):
    result={}
    for line in text.splitlines():
        if not line.startswith("'"):continue
        parts=shlex.split(line)
        require(len(parts)==4 and re.match(r'^(?:https?|mirror\+file):',parts[0]),'unknown APT URI')
        path=unquote(parts[0],errors='strict');at=path.find('/pool/')
        require(at>=0 and parts[1]not in result,'unsafe/duplicate selected URI')
        result[parts[1]]=(path[at+1:],int(parts[2]))
    return result


def prepare(args):
    args.state.mkdir(mode=0o700)
    state=State(args.state)
    identity=context(state,args.source,args.lane)
    # The actual host policy/variants/hooks/locking are retained. This refresh is
    # additional authority work in BOTH lanes; normal Playwright refreshes again.
    state.run('fresh-signed-update',['sudo','apt-get','-o','Acquire::Check-Date=true',
        '-o','Acquire::Check-Valid-Until=true','-o','Acquire::AllowInsecureRepositories=false',
        '-o','Acquire::AllowDowngradeToInsecureRepositories=false','-o','APT::Get::AllowUnauthenticated=false','update','--error-on=any'])
    metadata=args.state/'signed-metadata';metadata.mkdir(mode=0o700)
    for path in Path('/var/lib/apt/lists').glob('*_InRelease'):
        with store.regular(path)as source:raw=source.read(4*1024**2+1)
        require(len(raw)<=4*1024**2,'signed index bound')
        (metadata/path.name).write_bytes(raw)
    require(any(metadata.iterdir()),'no retained signed index evidence')
    names,tool=experiment.requests(ROOT/'crates/nac-server/web')
    simulation=state.run('solver',['apt-get','-s','install','--no-install-recommends',*names])
    closure=experiment.selected(simulation)
    uris=state.run('selected-uris',['sudo','apt-get','--print-uris','--download-only','--yes',
        'install','--no-install-recommends',*names])
    offers=selected_offers(uris)
    raw=state.run('signed-package-records',['apt-cache','show',*[p+'='+v for p,v in closure]])
    records=[experiment.base.fields(x)for x in raw.strip().split('\n\n')]
    pins=[experiment.package_pin(records,p,v,offers)for p,v in closure]
    require({store.offer_name(p)for p in pins}==set(offers),'closure/URI inventory differs')
    plan={'schema':1,'repository':identity['repository'],'platform':'ubuntu26.04-amd64-amd64v3',
          'packages':sorted(pins,key=lambda p:p['Package'])}
    store.validate_plan(plan)
    # A pre-existing download is neither a controlled miss nor this artifact hit.
    require(all(not os.path.lexists(CACHE/store.offer_name(p))for p in pins),
            'required archive already cached before diagnostic offer')
    identity.update(plan_key=store.key(plan),playwright=tool,requests=names)
    write(args.state/'identity.json',identity);write(args.state/'plan.json',plan)
    print(json.dumps({'lane':args.lane,'packages':len(pins),'archive_bytes':sum(int(p['Size'])for p in pins)}))


def snapshot(args):
    state=State(args.state);identity=load(args.state/'identity.json');plan=load(args.state/'plan.json')
    downloads=args.state/'downloads';downloads.mkdir(mode=0o700)
    state.run('prefetch',['apt-get','download',*[p['Package']+'='+p['Version']for p in plan['packages']]],cwd=downloads)
    files=list(downloads.iterdir());require(len(files)==len(plan['packages']),'download inventory differs')
    inputs={p['Package']:downloads/store.offer_name(p)for p in plan['packages']}
    artifact=args.state/'package-artifact';artifact.mkdir(mode=0o700)
    result=store.export(plan,inputs,artifact/'snapshot',
        {'source':identity['source'],'origin':'same-run-unprivileged-artifact-no-shared-cache-write'})
    audit=SimpleNamespace(output=args.state,report={})
    experiment.Experiment.negatives(audit,plan,artifact/'snapshot')
    write(args.state/'snapshot-negatives.json',audit.report)
    hashes={p.name:{'sha256':sha(p),'bytes':p.stat().st_size}for p in (artifact/'snapshot').iterdir()}
    envelope={'schema':1,'identity':identity,'files':hashes,'key':result['key']}
    write(artifact/'transport.json',envelope)
    receipt={'schema':1,'identity':identity,'key':result['key'],
        'transport_sha256':sha(artifact/'transport.json'),'transport_bytes':(artifact/'transport.json').stat().st_size}
    write(args.state/'artifact-receipt.json',receipt);write(args.state/'export.json',result)
    if args.github_output:
        with args.github_output.open('a')as out:out.write('receipt='+store.canonical(receipt).decode()+'\n')


def validate_receipt(receipt,identity):
    require(set(receipt)=={'schema','identity','key','transport_sha256','transport_bytes'}and
            receipt['schema']==1,'wrong artifact receipt schema')
    other=dict(receipt['identity']);other['lane']=identity['lane']
    require(other==identity,'producer source/run/attempt/baseline/current-plan drift')
    require(receipt['key']==identity['plan_key']and re.fullmatch(r'[0-9a-f]{64}',receipt['transport_sha256']),
            'wrong artifact digest/key')
    require(type(receipt['transport_bytes'])is int and 0<receipt['transport_bytes']<=MAX_JSON,'receipt size bound')


def admit(args):
    identity=load(args.state/'identity.json');plan=load(args.state/'plan.json')
    raw=os.environ.get('APT_ARTIFACT_RECEIPT','').encode();require(0<len(raw)<=MAX_JSON,'missing artifact receipt')
    receipt=json.loads(raw,object_pairs_hook=store.unique);validate_receipt(receipt,identity)
    if identity['lane']=='cold':
        require(args.download is None,'cold lane must not read package artifact')
        write(args.state/'admission.json',{'mode':'cold-no-package-artifact-read','key':receipt['key']})
        return
    require(args.download and not args.download.is_symlink(),'missing regular download root')
    require({p.name for p in args.download.iterdir()}=={'transport.json','snapshot'},'unexpected artifact roots')
    transport=args.download/'transport.json'
    require(transport.stat().st_size==receipt['transport_bytes']and sha(transport)==receipt['transport_sha256'],
            'transport receipt mismatch')
    envelope=load(transport)
    require(set(envelope)=={'schema','identity','files','key'}and envelope['schema']==1 and
            envelope['identity']==receipt['identity']and envelope['key']==receipt['key'],'wrong artifact envelope')
    snapshot=args.download/'snapshot'
    require(not snapshot.is_symlink()and snapshot.is_dir(),'unsafe snapshot root')
    require({p.name for p in snapshot.iterdir()}==set(envelope['files']),'artifact inventory differs')
    for name,value in envelope['files'].items():
        require(name=='manifest.json'or re.fullmatch(r'[0-9a-f]{64}\.deb',name),'unsafe artifact member')
        path=snapshot/name
        require(set(value)=={'sha256','bytes'}and path.stat().st_size==value['bytes']and
                sha(path)==value['sha256'],'artifact file mismatch')
    result=store.restore(plan,snapshot,args.state/'offer')
    require(result['mode']=='verified-hit','no verified artifact offer')
    write(args.state/'admission.json',result)


def cache_root(path=CACHE):
    for directory in [path,*path.parents]:
        info=directory.lstat()
        require(stat.S_ISDIR(info.st_mode)and info.st_uid==0 and not info.st_mode&0o022,'unsafe root APT cache')


def offer_root(args):
    require(os.geteuid()==0 and all(os.environ.get(k,'').isdigit()for k in ('SUDO_UID','SUDO_GID')),
            'requires existing sudo caller')
    info=args.state.lstat()
    require(stat.S_ISDIR(info.st_mode)and info.st_uid==int(os.environ['SUDO_UID'])and
            stat.S_IMODE(info.st_mode)==0o700,'state must be caller-owned private root')
    cache_root();plan=load(args.state/'plan.json');store.validate_plan(plan)
    require(load(args.state/'identity.json')['lane']=='hit'and
            load(args.state/'admission.json')['mode']=='verified-hit','no admitted hit')
    require(not os.path.lexists(args.state/'owned-offers.json'),'offer already attempted; preserve ownership receipt')
    owned=[]
    try:
        for row in plan['packages']:
            name=store.offer_name(row);destination=CACHE/name
            with store.regular(args.state/'offer'/name)as source:
                store.verify(source,row);source.seek(0)
                fd=os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
                info=os.fstat(fd);owned.append({'name':name,'device':info.st_dev,'inode':info.st_ino})
                with os.fdopen(fd,'wb')as out:
                    __import__('shutil').copyfileobj(source,out,1024*1024);out.flush();os.fchmod(out.fileno(),0o644)
            with store.regular(destination)as copy:store.verify(copy,row)
    finally:
        write(args.state/'owned-offers.json',owned)
        os.chown(args.state/'owned-offers.json',int(os.environ['SUDO_UID']),int(os.environ['SUDO_GID']))


def cleanup_root(args):
    require(os.geteuid()==0 and all(os.environ.get(k,'').isdigit()for k in ('SUDO_UID','SUDO_GID')),
            'requires existing sudo cleanup')
    info=args.state.lstat()
    require(stat.S_ISDIR(info.st_mode)and info.st_uid==int(os.environ['SUDO_UID'])and
            stat.S_IMODE(info.st_mode)==0o700,'unsafe cleanup state')
    cache_root()
    if not(args.state/'owned-offers.json').exists():
        write(args.state/'offer-cleanup.json',[])
        if os.environ.get('SUDO_UID','').isdigit():
            os.chown(args.state/'offer-cleanup.json',int(os.environ['SUDO_UID']),int(os.environ['SUDO_GID']))
        return
    plan=load(args.state/'plan.json');store.validate_plan(plan)
    allowed={store.offer_name(p)for p in plan['packages']};rows=[]
    for value in load(args.state/'owned-offers.json'):
        require(set(value)=={'name','device','inode'}and value['name']in allowed,'foreign cleanup member')
        path=CACHE/value['name']
        try:info=path.lstat()
        except FileNotFoundError:rows.append({**value,'owned_inode_absent':True});continue
        require(stat.S_ISREG(info.st_mode)and info.st_nlink==1 and
                (info.st_dev,info.st_ino)==(value['device'],value['inode']),'refuse foreign cache replacement')
        path.unlink();rows.append({**value,'removed':True})
    write(args.state/'offer-cleanup.json',rows)
    if os.environ.get('SUDO_UID','').isdigit():
        os.chown(args.state/'offer-cleanup.json',int(os.environ['SUDO_UID']),int(os.environ['SUDO_GID']))


def installed(args):
    state=State(args.state);plan=load(args.state/'plan.json');identity=load(args.state/'identity.json')
    names=sorted(set(identity['requests'])|{p['Package']for p in plan['packages']})
    raw=state.run('installed-dpkg',['dpkg-query','-W','-f',
        '${Package}\t${Version}\t${Architecture}\t${Architecture-Variant}\t${db:Status-Abbrev}\n',*names])
    values={}
    for line in raw.splitlines():
        name,version,arch,variant,status=line.split('\t')
        require(status.strip()=='ii'and name not in values,'package not configured or duplicate')
        values[name]={'Version':version,'Architecture':arch,'Variant':variant}
    require(set(values)==set(names),'installed package inventory incomplete')
    for row in plan['packages']:
        actual=values[row['Package']]
        require(actual['Version']==row['Version']and actual['Architecture']==row['Architecture'],
                'installed selected package differs from current plan')
        variant='amd64v3'if row['Filename'].endswith('_amd64v3.deb')else''
        require(actual['Variant']==variant,'installed package variant differs')
    fonts=state.run('font-files',['fc-list','--format','%{file}\n']).splitlines()
    paths=sorted(set(fonts));require(0<len(paths)<=1024,'font inventory bound')
    fingerprints=[];total=0
    for value in paths:
        path=Path(value).resolve();require(any(path.is_relative_to(p)for p in ('/usr/share/fonts','/usr/local/share/fonts')),
                'unexpected font root')
        total+=path.stat().st_size;require(total<=256*1024**2,'font bytes bound')
        fingerprints.append({'path':str(path),'sha256':sha(path,single_link=False),'bytes':path.stat().st_size})
    text=(args.state/'normal-playwright.stdout.log').read_text()
    needs=re.findall(r'Need to get [^\n]+',text)
    require(len(needs)==1,'ambiguous normal APT transfer evidence')
    if identity['lane']=='hit':
        require(needs[0].startswith('Need to get 0 B/'),'normal APT did not confirm archive reuse')
    else:
        require(re.match(r'Need to get [1-9][0-9.,]* ',needs[0]),'cold arm did not request archive bytes')
    write(args.state/'apt-install-evidence.json',{'lane':identity['lane'],'need':needs[0]})
    write(args.state/'installed.json',{'packages':values,'fonts':fingerprints})


def execute(args):
    state=State(args.state)
    require(args.command,'missing exact child command')
    try:state.run(args.label,args.command,timeout=args.timeout)
    except BaseException as error:
        write(args.state/(args.label+'-failure.json'),{'error':str(error),'no_retry':True});raise


TITLES={'injected outgoing MCP CRUD, test and runtime status desktop',
        'injected outgoing MCP CRUD, test and runtime status mobile',
        'joined installed guide and scoped navigation on desktop'}


def check_journeys(report):
    require(report.get('errors')==[]and report['config']['workers']==1 and
            all(p['retries']==0 for p in report['config']['projects']),'journey infrastructure/retry drift')
    found=[]
    def visit(suites):
        for suite in suites:
            for spec in suite.get('specs',[]):
                for case in spec['tests']:
                    require(case['expectedStatus']=='passed'and len(case['results'])==1 and
                        case['results'][0]['status']=='passed'and case['results'][0]['retry']==0,
                        'journey failed/skipped/retried')
                    found.append(spec['title'])
            visit(suite.get('suites',[]))
    visit(report['suites'])
    require(len(found)==3 and set(found)==TITLES,'exact three unchanged journeys required')
    require(report['stats']['expected']==3 and not any(report['stats'][k]for k in
            ('unexpected','flaky','skipped')),'journey result drift')
    return sorted(found)


def cleanup_journeys(args):
    spec=importlib.util.spec_from_file_location('cleanup',Path(__file__).with_name('terminal-browser.py'))
    cleanup=importlib.util.module_from_spec(spec);spec.loader.exec_module(cleanup)
    token=marker(load(args.state/'identity.json'))
    require('NAC_E2E_CLEANUP_ID'not in os.environ,'cleanup controller must not own child marker')
    before=cleanup.settle_owned(token);after=cleanup.owned_processes(token)
    write(args.state/'journey-cleanup.json',{'marker':token,'before':before,'remaining':after})
    require(not before and not after,'journey teardown leaked owned process; settled but not parity')


def finish(args):
    identity=load(args.state/'identity.json');installed_state=load(args.state/'installed.json')
    browser=load(args.state/'browser.json')
    titles=check_journeys(load(args.state/'journeys.stdout.log'))
    joined=list((args.state/'test-results').glob('**/joined-evidence.json'))
    require(len(joined)==1,'missing/duplicate native Guide/API evidence')
    value=load(joined[0]);expected=browser['build_identity']
    require(value['build']==expected and value['native']['context']['build']==expected and
            value['native']['index']['build_identity']==expected,'native API/Guide identity differs')
    cleanup=load(args.state/'journey-cleanup.json')
    require(not cleanup['before']and not cleanup['remaining'],'incomplete fixture cleanup')
    if identity['lane']=='hit':require((args.state/'offer-cleanup.json').exists(),'missing owned archive cleanup')
    result={'status':'passed representative native parity; not full-suite/cache-service qualification',
        'identity':identity,'admission':load(args.state/'admission.json'),
        'runtime':{'installed':installed_state,'browser':browser,'API_build':value['build'],'journeys':titles},
        'cleanup':cleanup,'commands':load(args.state/'commands.json')}
    write(args.state/'runtime-result.json',result)


def compare(args):
    cold=load(args.cold);hit=load(args.hit)
    require(cold['status']==hit['status']=='passed representative native parity; not full-suite/cache-service qualification',
            'incomplete consumer results')
    expected=dict(cold['identity']);expected['lane']='hit'
    require(expected==hit['identity']and cold['identity']['lane']=='cold','source/run/attempt/baseline drift')
    require(cold['admission']['mode']=='cold-no-package-artifact-read'and
            hit['admission']['mode']=='verified-hit','wrong service arms')
    require(cold['runtime']==hit['runtime'],'installed/browser/binary/API/journey parity differs')
    print('Verified exact-source representative cold/artifact-hit runtime parity; no full-suite or cache-service claim')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation',choices=['prepare','snapshot','admit','offer-root','cleanup-root',
        'installed','execute','cleanup-journeys','finish','compare'])
    parser.add_argument('--state',required=True,type=Path)
    parser.add_argument('--source');parser.add_argument('--lane',choices=['producer','cold','hit'])
    parser.add_argument('--github-output',type=Path);parser.add_argument('--download',type=Path)
    parser.add_argument('--label');parser.add_argument('--timeout',type=int,default=900)
    parser.add_argument('--cold',type=Path);parser.add_argument('--hit',type=Path)
    args,extra=parser.parse_known_args();args.state=args.state.absolute();args.command=[]
    if args.operation=='execute':
        require(extra[:1]==['--'],'execute requires explicit command boundary');args.command=extra[1:]
    else:require(not extra,'unexpected command arguments')
    def interrupted(_s,_f):raise InterruptedError('owned diagnostic interrupted')
    for signum in (signal.SIGINT,signal.SIGTERM):signal.signal(signum,interrupted)
    started=time.monotonic();failure=None
    phase_allowed=not(args.operation=='prepare'and os.path.lexists(args.state))
    try:
        {'prepare':prepare,'snapshot':snapshot,'admit':admit,'offer-root':offer_root,
         'cleanup-root':cleanup_root,'installed':installed,'execute':execute,'cleanup-journeys':cleanup_journeys,
         'finish':finish,'compare':compare}[args.operation](args)
    except BaseException as error:
        failure=type(error).__name__+': '+str(error);raise
    finally:
        if phase_allowed and args.state.is_dir()and not args.state.is_symlink():
            path=args.state/('phase-'+args.operation+'.json')
            write(path,{'operation':args.operation,'seconds':time.monotonic()-started,
                        'error':failure,'no_retry':True})
            if os.geteuid()==0 and os.environ.get('SUDO_UID','').isdigit():
                os.chown(path,int(os.environ['SUDO_UID']),int(os.environ['SUDO_GID']))


if __name__=='__main__':main()
