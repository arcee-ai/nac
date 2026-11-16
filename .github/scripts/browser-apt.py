#!/usr/bin/env python3
"""Same-run OS archive bytes; fresh native signed APT remains the authority."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import secrets
import shlex
import shutil
import signal
import stat
import subprocess
import sys
import time
from urllib.parse import unquote

sys.dont_write_bytecode=True
SPEC=importlib.util.spec_from_file_location('store',Path(__file__).with_name('apt-archive-store.py'))
store=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(store)
SUPERVISOR=importlib.util.spec_from_file_location('supervisor',Path(__file__).with_name('browser-apt-supervisor.py'))
supervisor=importlib.util.module_from_spec(SUPERVISOR);SUPERVISOR.loader.exec_module(supervisor)
ROOT=Path(__file__).resolve().parents[2]
CACHE=Path('/var/cache/apt/archives')
PLATFORM='ubuntu26.04-amd64-amd64v3'
FIELDS={'schema','source','repository','run_id','attempt','image','platform','baseline','tool','plan_key','requests'}
NO_ARTIFACT={'disabled-cold','unsupported-platform','nothing-missing'}


def require(value,message):
    if not value:raise ValueError(message)


def digest(path):
    value=hashlib.sha256()
    with store.regular(path)as source:
        while data:=source.read(1024*1024):value.update(data)
    return value.hexdigest()


def load(path):
    with store.regular(path)as source:raw=source.read(store.MAX_JSON+1)
    require(len(raw)<=store.MAX_JSON,'JSON bound')
    return json.loads(raw,object_pairs_hook=store.unique)


def write(path,value):
    raw=store.canonical(value);require(len(raw)<=store.MAX_JSON,'JSON bound')
    if os.path.lexists(path):
        with store.regular(path):pass
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as out:out.write(raw)
    if os.geteuid()==0 and os.environ.get('SUDO_UID','').isdigit():
        os.chown(path,int(os.environ['SUDO_UID']),int(os.environ['SUDO_GID']))


def emit(args,**values):
    write(args.state/(args.operation+'.json'),values)
    if args.github_output:
        with args.github_output.open('a')as out:
            for key,value in values.items():out.write(key+'='+(store.canonical(value).decode()if isinstance(value,dict)else str(value))+'\n')


def run(state,label,command,*,cwd=ROOT,timeout=900):
    require(re.fullmatch(r'[a-z][a-z0-9-]{0,60}',label),'unsafe log label')
    files=[state/(label+s)for s in ('.stdout.log','.stderr.log')]
    require(all(not os.path.lexists(p)for p in files),'command already attempted; no retry')
    env={k:os.environ[k]for k in ('PATH','HOME','LANG','LC_ALL')if k in os.environ}
    start=time.monotonic();child=None;error=None;control=None;nonce=None;privileged=command[:1]==['sudo']
    if privileged:
        require(len(command)>1 and not command[1].startswith('-'),'explicit sudo command required')
        caller=supervisor.process(os.getpid());require(caller and caller['uid']==os.getuid()and os.getuid()>0,'ordinary Linux caller required')
        control=state/(label+'-privileged');control.mkdir(mode=0o700);nonce=secrets.token_hex(16)
        executable='/usr/bin/apt-get'if command[1]=='apt-get'else command[1]
        require(Path(executable).is_absolute(),'absolute privileged executable required')
        launch=['sudo','-n','--',sys.executable,str(Path(__file__).with_name('browser-apt-supervisor.py')),
            '--control',str(control),'--nonce',nonce,'--caller',str(caller['pid']),'--start',str(caller['start']),
            '--timeout',str(timeout),'--cwd',str(cwd),'--',executable,*command[2:]]
    else:launch=command
    try:
        with files[0].open('xb')as out,files[1].open('xb')as err:
            child=subprocess.Popen(launch,cwd=cwd,env=env,stdout=out,stderr=err,start_new_session=True)
            while child.poll()is None:
                require(time.monotonic()-start<timeout,'command controller timeout; no retry')
                require(shutil.disk_usage(state).free>=13*1024**3,'13GiB reserve')
                require(sum(p.stat().st_size for p in files)<=32*1024**2,'command output bound')
                time.sleep(.1)
        if privileged:await_privileged_result(control,nonce)
        require(child.returncode==0,f'{label} exit{child.returncode}; no retry')
        require(sum(p.stat().st_size for p in files)<=32*1024**2,'command output bound')
        return files[0].read_text()
    except BaseException as caught:
        error=type(caught).__name__+': '+str(caught)
        if child and privileged:
            request_stop(control,nonce)
            # Root owns teardown. Sudo exit alone is never cleanup evidence.
            child.wait(timeout=8)
            await_privileged_result(control,nonce,cancelled=True)
        elif child:
            try:os.killpg(child.pid,signal.SIGKILL)
            except ProcessLookupError:pass
            child.wait(timeout=10)
        raise
    finally:
        write(state/(label+'-command.json'),{'args':command,'seconds':time.monotonic()-start,
            'pid':child.pid if child else None,'exit':child.returncode if child else None,'error':error,
            'privileged_supervision':str(control)if control else None})


def request_stop(control,nonce):
    path=control/'stop'
    if os.path.lexists(path):
        with store.regular(path)as source:require(source.read(65)==nonce.encode(),'foreign existing stop request')
        return
    temporary=control/'stop.tmp'
    handle=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(handle,'wb')as out:out.write(nonce.encode())
    os.rename(temporary,path)


def await_privileged_result(control,nonce,*,cancelled=False):
    deadline=time.monotonic()+5
    while not os.path.lexists(control/'result.json'):
        require(time.monotonic()<deadline,'missing bounded root cleanup receipt')
        time.sleep(.025)
    return privileged_result(control,nonce,cancelled=cancelled)


def privileged_result(control,nonce,*,cancelled=False):
    path=control/'result.json'
    info=path.lstat();require(stat.S_ISREG(info.st_mode)and info.st_uid==0 and info.st_nlink==1,'missing actual root receipt')
    result=load(path)
    require(result.get('schema')==1 and result.get('nonce')==nonce and result.get('uid')==0,'foreign root supervisor receipt')
    require(result.get('cleanup',{}).get('remaining')==[],'privileged descendants not reaped')
    if not cancelled:
        require(result.get('reason')=='completed'and result.get('exit')==0 and result.get('error')is None,'privileged command failed')
    return result


def source_identity(source):
    require(re.fullmatch(r'[0-9a-f]{40}',source or ''),'immutable source required')
    require(subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()==source,'wrong checkout')
    values={k:os.environ.get(k,'')for k in ('GITHUB_REPOSITORY','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','ImageOS','ImageVersion')}
    require(all(values.values()),'missing runner/run identity')
    require(re.fullmatch(r'[\w.-]+/[\w.-]+',values['GITHUB_REPOSITORY']),'wrong repository')
    require(all(re.fullmatch(r'[1-9][0-9]*',values[k])for k in ('GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT')),'wrong run/attempt')
    image=values['ImageOS']+'@'+values['ImageVersion']
    require(re.fullmatch(r'[A-Za-z0-9_.-]{1,80}@[A-Za-z0-9_.-]{1,80}',image),'wrong image')
    return {'source':source,'repository':values['GITHUB_REPOSITORY'],'run_id':values['GITHUB_RUN_ID'],
            'attempt':int(values['GITHUB_RUN_ATTEMPT']),'image':image}


def supported():
    if sys.platform!='linux'or platform.machine()!='x86_64':return False
    fields=dict(line.split('=',1)for line in Path('/etc/os-release').read_text().splitlines()if '='in line)
    return fields.get('ID','').strip('"')=='ubuntu'and fields.get('VERSION_ID','').strip('"')=='26.04'and \
        subprocess.check_output(['dpkg','--print-architecture'],text=True,timeout=5).strip()=='amd64'


def preflight(args):
    identity=source_identity(args.source);args.state.mkdir(mode=0o700)
    valid=supported();mode='disabled-cold'if args.cold=='true'else'pending'if valid else'unsupported-platform'
    identity.update(schema=1,platform=PLATFORM if valid else platform.system()+'-'+platform.machine(),
                    baseline=None,tool=None,plan_key=None,requests=[])
    write(args.state/'identity.json',identity)
    emit(args,mode=mode,enabled='true'if mode=='pending'else'false')


def requests(web):
    bundle=web/'node_modules/playwright-core/lib/coreBundle.js'
    package=json.loads((web/'node_modules/playwright-core/package.json').read_text())
    lock=json.loads((web/'package-lock.json').read_text())
    require(lock['packages']['node_modules/playwright-core']['version']==package['version'],'Playwright lock drift')
    text=bundle.read_text();chunk=text[text.index('"ubuntu26.04-x64": {'):];chunk=chunk[:chunk.index('firefox:')]
    names=[]
    for name in ('tools','chromium'):
        matches=re.findall(r'\b'+name+r':\s*(\[[^\]]+\])',chunk)
        require(len(matches)==1,'Playwright native request format drift')
        values=json.loads(matches[0]);require(values and all(re.fullmatch(r'[a-z0-9][a-z0-9+.-]*',p)for p in values),'unsafe requests')
        names.extend(values)
    return sorted(set(names)),{'version':package['version'],'bundle_sha256':digest(bundle),'lock_sha256':digest(web/'package-lock.json')}


def selected(text):
    require(not any(s.startswith('Remv ')for s in text.splitlines()),'unexpected package removal')
    rows=re.findall(r'^Inst ([a-z0-9][a-z0-9+.-]*)(?: \[[^\]]+\])? \((\S+)',text,re.M)
    require(len(rows)==len({p for p,_ in rows})==sum(s.startswith('Inst ')for s in text.splitlines()),'ambiguous solver records')
    return rows


def offers(text):
    result={}
    for line in text.splitlines():
        if not line.startswith("'"):continue
        parts=shlex.split(line);require(len(parts)==4 and re.match(r'^(?:https?|mirror\+file):',parts[0]),'unknown APT URI')
        path=unquote(parts[0],errors='strict');at=path.find('/pool/')
        require(at>=0 and parts[1]not in result,'unsafe/duplicate selected URI')
        result[parts[1]]=(path[at+1:],int(parts[2]))
    return result


def plan(args):
    identity=load(args.state/'identity.json');require(identity['platform']==PLATFORM,'unsupported native plan')
    require(os.geteuid()!=0,'native authority runs as ordinary runner')
    identity['baseline']=digest(Path('/var/lib/dpkg/status'))
    run(args.state,'signed-update',['sudo','apt-get','-o','Acquire::Check-Date=true','-o','Acquire::Check-Valid-Until=true',
        '-o','Acquire::AllowInsecureRepositories=false','-o','Acquire::AllowDowngradeToInsecureRepositories=false',
        '-o','APT::Get::AllowUnauthenticated=false','update','--error-on=any'])
    metadata=args.state/'signed-metadata';metadata.mkdir(mode=0o700);total=0
    sources=list(Path('/var/lib/apt/lists').glob('*_InRelease'));require(0<len(sources)<=32,'signed index inventory bound')
    for path in sources:
        with store.regular(path)as source:raw=source.read(4*1024**2+1)
        total+=len(raw);require(len(raw)<=4*1024**2 and total<=16*1024**2,'signed index byte bound')
        (metadata/path.name).write_bytes(raw)
    names,tool=requests(ROOT/'crates/nac-server/web');identity.update(tool=tool,requests=names)
    rows=selected(run(args.state,'solver',['apt-get','-s','install','--no-install-recommends',*names]))
    pins=[]
    if rows:
        uris=offers(run(args.state,'uris',['sudo','apt-get','--print-uris','--download-only','--yes','install','--no-install-recommends',*names]))
        text=run(args.state,'records',['apt-cache','show',*[p+'='+v for p,v in rows]])
        records=[dict(line.split(': ',1)for line in part.splitlines()if ': 'in line and not line[0].isspace())for part in text.strip().split('\n\n')]
        for name,version in rows:
            matches={store.canonical({k:r[k]for k in store.FIELDS})for r in records if r.get('Package')==name
                and r.get('Version')==version and store.offer_name(r)in uris
                and uris[store.offer_name(r)]==(r['Filename'],int(r['Size']))}
            require(len(matches)==1,'selected signed package missing/ambiguous');pins.append(json.loads(matches.pop()))
        require({store.offer_name(p)for p in pins}==set(uris),'selected URI inventory differs')
        require(all(not os.path.lexists(CACHE/store.offer_name(p))for p in pins),'uncontrolled pre-existing archive')
    value={'schema':1,'repository':identity['repository'],'platform':PLATFORM,'packages':sorted(pins,key=lambda p:p['Package'])}
    if pins:identity['plan_key']=store.key(value)
    write(args.state/'identity.json',identity);write(args.state/'packages.json',value)
    emit(args,mode='ready'if pins else'nothing-missing',packages=len(pins),archive_bytes=sum(int(p['Size'])for p in pins))


def export(args):
    identity=load(args.state/'identity.json');value=load(args.state/'packages.json')
    downloads=args.state/'downloads';downloads.mkdir(mode=0o700)
    run(args.state,'prefetch',['apt-get','download',*[p['Package']+'='+p['Version']for p in value['packages']]],cwd=downloads)
    require(len(list(downloads.iterdir()))==len(value['packages']),'download inventory differs')
    artifact=args.state/'artifact';artifact.mkdir(mode=0o700)
    result=store.export(value,{p['Package']:downloads/store.offer_name(p)for p in value['packages']},
        artifact/'snapshot',{'source':identity['source'],'origin':'same-run-package-relay-no-shared-cache-write'})
    files={p.name:{'sha256':digest(p),'bytes':p.stat().st_size}for p in (artifact/'snapshot').iterdir()}
    write(artifact/'transport.json',{'schema':1,'identity':identity,'key':result['key'],'files':files})
    emit(args,receipt={'schema':1,'identity':identity,'key':result['key'],'transport_sha256':digest(artifact/'transport.json'),
                       'transport_bytes':(artifact/'transport.json').stat().st_size},copied_bytes=result['copied_bytes'],export_seconds=result['seconds'])


def producer_identity(value,current):
    require(isinstance(value,dict)and set(value)==FIELDS and value['schema']==1,'malformed producer identity')
    for key in ('source','repository','run_id'):require(value[key]==current[key],'foreign producer '+key)
    require(type(value['attempt'])is int and 0<value['attempt']<=current['attempt'],'invalid/future producer attempt')
    require(isinstance(value['image'],str)and re.fullmatch(r'[A-Za-z0-9_.-]{1,80}@[A-Za-z0-9_.-]{1,80}',value['image']),'malformed producer image')
    require(value['platform']==PLATFORM,'malformed producer platform')
    require(all(isinstance(value[k],str)and re.fullmatch(r'[0-9a-f]{64}',value[k])for k in ('baseline','plan_key')),'malformed producer digest')
    tool=value['tool'];require(isinstance(tool,dict)and set(tool)=={'version','bundle_sha256','lock_sha256'},'malformed producer tool')
    require(isinstance(tool['version'],str)and re.fullmatch(r'[0-9.]+',tool['version'])and
        all(re.fullmatch(r'[0-9a-f]{64}',tool[k])for k in ('bundle_sha256','lock_sha256')),'malformed producer tool digest')
    lock=ROOT/'crates/nac-server/web/package-lock.json'
    require(tool['lock_sha256']==digest(lock)and tool['version']==json.loads(lock.read_text())['packages']['node_modules/playwright-core']['version'],
            'foreign current-source tool lock')
    require(isinstance(value['requests'],list)and 0<len(value['requests'])<=128 and len(set(value['requests']))==len(value['requests'])and
        all(re.fullmatch(r'[a-z0-9][a-z0-9+.-]*',p)for p in value['requests']),'malformed producer request set')


def consume(args):
    current=load(args.state/'identity.json');expected=source_identity(args.source)
    require(all(current[k]==v for k,v in expected.items()),'consumer identity drift')
    if args.producer_mode in NO_ARTIFACT:
        require(args.download is None and not os.environ.get('BROWSER_APT_RECEIPT',''),'unexpected no-artifact evidence')
        require((args.cold=='true')==(args.producer_mode=='disabled-cold'),'wrong cold producer mode')
        emit(args,mode='normal',reason=args.producer_mode);return
    require(args.producer_mode=='ready'and args.cold=='false','missing/invalid producer mode')
    raw=os.environ.get('BROWSER_APT_RECEIPT','').encode();require(0<len(raw)<=store.MAX_JSON,'missing receipt')
    receipt=json.loads(raw,object_pairs_hook=store.unique)
    require(set(receipt)=={'schema','identity','key','transport_sha256','transport_bytes'}and receipt['schema']==1,'malformed receipt')
    producer=receipt['identity'];producer_identity(producer,current)
    require(receipt['key']==producer['plan_key']and re.fullmatch(r'[0-9a-f]{64}',receipt['transport_sha256'])and
        type(receipt['transport_bytes'])is int and 0<receipt['transport_bytes']<=store.MAX_JSON,'malformed transport receipt')
    require(args.download and not args.download.is_symlink()and args.download.is_dir(),'missing regular download')
    require({p.name for p in args.download.iterdir()}=={'transport.json','snapshot'},'extra/missing transport files')
    transport=args.download/'transport.json'
    require(transport.stat().st_size==receipt['transport_bytes']and digest(transport)==receipt['transport_sha256'],'corrupt transport')
    envelope=load(transport)
    require(set(envelope)=={'schema','identity','key','files'}and envelope['schema']==1 and envelope['identity']==producer and
        envelope['key']==receipt['key'],'foreign envelope')
    snapshot=args.download/'snapshot';require(not snapshot.is_symlink()and snapshot.is_dir(),'unsafe snapshot')
    require({p.name for p in snapshot.iterdir()}==set(envelope['files']),'partial/extra snapshot')
    for name,value in envelope['files'].items():
        require(name=='manifest.json'or re.fullmatch(r'[0-9a-f]{64}\.deb',name),'unsafe member')
        require(set(value)=={'sha256','bytes'}and type(value['bytes'])is int and (snapshot/name).stat().st_size==value['bytes']and
            digest(snapshot/name)==value['sha256'],'corrupt member')
    manifest=load(snapshot/'manifest.json');value=manifest['plan']
    require(manifest['producer']['source']==producer['source']and value['repository']==producer['repository']and
        value['platform']==producer['platform']and store.key(value)==receipt['key'],'foreign manifest')
    require(not os.path.lexists(args.state/'offer'),'offer must be fresh')
    result=store.restore(value,snapshot,args.state/'validated')
    fresh=None
    if current['tool']is not None:
        require(producer['tool']==current['tool']and producer['requests']==current['requests'],'current locked tool drift')
        require(isinstance(current['baseline'],str)and re.fullmatch(r'[0-9a-f]{64}',current['baseline']),'malformed current baseline')
        fresh=load(args.state/'packages.json')
        require(fresh['repository']==current['repository']and fresh['platform']==current['platform'],'foreign current plan')
        if fresh['packages']:
            require(store.key(fresh)==current['plan_key'],'invalid current plan key')
        else:
            require(fresh=={'schema':1,'repository':current['repository'],'platform':PLATFORM,'packages':[]}and
                current['plan_key']is None,'malformed empty current plan')
    else:
        require(current['platform']!=PLATFORM and current['baseline']is None and current['plan_key']is None and
            current['requests']==[],'missing current native authority')
    reason=next((reason for changed,reason in (
        (producer['attempt']<current['attempt'],'older-attempt'),
        (producer['image']!=current['image'],'runner-image-change'),
        (producer['platform']!=current['platform'],'platform-change'),
        (producer['baseline']!=current['baseline'],'native-baseline-change'),
        (producer['plan_key']!=current['plan_key']or value!=fresh,'current-plan-change'))if changed),'')
    if reason:
        shutil.rmtree(args.state/'validated')
        emit(args,mode='normal',reason=reason,validated_bytes=result['copied_bytes'],validation_copy_seconds=result['seconds']);return
    os.rename(args.state/'validated',args.state/'offer')
    emit(args,mode='verified-offer',reason='',copied_bytes=result['copied_bytes'],validation_copy_seconds=result['seconds'])


def root_state(args):
    require(os.geteuid()==0 and all(os.environ.get(k,'').isdigit()for k in ('SUDO_UID','SUDO_GID')),'requires sudo caller')
    info=args.state.lstat();require(stat.S_ISDIR(info.st_mode)and info.st_uid==int(os.environ['SUDO_UID'])and
        stat.S_IMODE(info.st_mode)==0o700,'unsafe caller state')
    for directory in [CACHE,*CACHE.parents]:
        info=directory.lstat();require(stat.S_ISDIR(info.st_mode)and info.st_uid==0 and not info.st_mode&0o022,'unsafe root APT cache')


def offer(args):
    root_state(args);require(load(args.state/'consume.json')['mode']=='verified-offer','no verified hit')
    value=load(args.state/'packages.json');store.validate_plan(value)
    require(not os.path.lexists(args.state/'owned.json'),'offer already attempted; preserve ownership')
    owned=[]
    try:
        for row in value['packages']:
            name=store.offer_name(row)
            with store.regular(args.state/'offer'/name)as source:
                store.verify(source,row);source.seek(0)
                fd=os.open(CACHE/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
                info=os.fstat(fd);owned.append({'name':name,'device':info.st_dev,'inode':info.st_ino})
                with os.fdopen(fd,'wb')as out:shutil.copyfileobj(source,out,1024*1024);out.flush();os.fchmod(out.fileno(),0o644)
            with store.regular(CACHE/name)as copied:store.verify(copied,row)
    finally:write(args.state/'owned.json',owned)


def cleanup(args):
    root_state(args);rows=[]
    if os.path.lexists(args.state/'owned.json'):
        value=load(args.state/'packages.json');store.validate_plan(value);names={store.offer_name(p)for p in value['packages']}
        for row in load(args.state/'owned.json'):
            require(set(row)=={'name','device','inode'}and row['name']in names,'foreign cleanup name')
            path=CACHE/row['name']
            try:info=path.lstat()
            except FileNotFoundError:rows.append({**row,'absent':True});continue
            require(stat.S_ISREG(info.st_mode)and info.st_nlink==1 and (info.st_dev,info.st_ino)==(row['device'],row['inode']),
                'refuse foreign cache replacement')
            path.unlink();rows.append({**row,'removed':True})
    write(args.state/'cleanup.json',rows)


def installed(args):
    value=load(args.state/'packages.json');identity=load(args.state/'identity.json')
    names=sorted(set(identity['requests'])|{p['Package']for p in value['packages']})
    raw=run(args.state,'installed',['dpkg-query','-W','-f','${Package}\t${Version}\t${Architecture}\t${Architecture-Variant}\t${db:Status-Abbrev}\n',*names])
    actual={}
    for line in raw.splitlines():
        name,version,arch,variant,status=line.split('\t');require(status.strip()=='ii'and name not in actual,'not configured/duplicate package')
        actual[name]={'Version':version,'Architecture':arch,'Variant':variant}
    require(set(actual)==set(names),'missing configured package')
    for row in value['packages']:
        require(actual[row['Package']]=={'Version':row['Version'],'Architecture':row['Architecture'],
            'Variant':'amd64v3'if row['Filename'].endswith('_amd64v3.deb')else''},'installed selected identity changed')
    fonts=sorted(set(run(args.state,'fonts',['fc-list','--format','%{file}\n']).splitlines()));require(0<len(fonts)<=1024,'font inventory bound')
    files=[];total=0
    for name in fonts:
        path=Path(name).resolve();require(any(path.is_relative_to(p)for p in ('/usr/share/fonts','/usr/local/share/fonts')),'unexpected font root')
        with path.open('rb')as source:
            info=os.fstat(source.fileno());require(stat.S_ISREG(info.st_mode)and info.st_size<=store.MAX_FILE,'font file bound')
            total+=info.st_size;require(total<=256*1024**2,'font total bound');sha=hashlib.sha256()
            while data:=source.read(1024*1024):sha.update(data)
        files.append({'path':str(path),'bytes':info.st_size,'sha256':sha.hexdigest()})
    write(args.state/'installed.json',{'packages':actual,'fonts':files})


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation',choices=['preflight','plan','export','consume','offer','cleanup','installed'])
    parser.add_argument('--state',type=Path,required=True);parser.add_argument('--source')
    parser.add_argument('--cold',choices=['true','false'],default='false');parser.add_argument('--producer-mode')
    parser.add_argument('--download',type=Path);parser.add_argument('--github-output',type=Path)
    args=parser.parse_args();args.state=args.state.absolute();start=time.monotonic();failure=None
    def interrupt(_s,_f):raise InterruptedError('archive operation interrupted')
    for sig in (signal.SIGINT,signal.SIGTERM):signal.signal(sig,interrupt)
    existed=os.path.lexists(args.state)
    try:globals()[args.operation](args)
    except BaseException as error:failure=type(error).__name__+': '+str(error);raise
    finally:
        if args.state.is_dir()and not args.state.is_symlink()and not(args.operation=='preflight'and existed):
            write(args.state/('phase-'+args.operation+'.json'),{'operation':args.operation,'seconds':time.monotonic()-start,'error':failure})


if __name__=='__main__':main()
