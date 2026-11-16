#!/usr/bin/env python3
"""Private hosted-only real UID0 lifecycle control; no package/network operations."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
SPEC=importlib.util.spec_from_file_location('apt',HERE/'browser-apt.py')
apt=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(apt)
supervisor=apt.supervisor


def require(value,message):
    if not value:raise ValueError(message)


def write(path,value):
    temporary=path.with_name(path.name+'.tmp')
    temporary.write_text(json.dumps(value,sort_keys=True));temporary.chmod(0o644);temporary.rename(path)


def read(path):return json.loads(path.read_text())


def wait_file(path,seconds=8):
    end=time.monotonic()+seconds
    while not path.exists():
        require(time.monotonic()<end,'bounded readiness file missing: '+str(path))
        time.sleep(.025)
    return read(path)


def payload(state,role):
    require(os.geteuid()==0,'actual UID0 payload required')
    signal.signal(signal.SIGTERM,signal.SIG_IGN)
    if role=='child':
        subprocess.Popen([sys.executable,str(Path(__file__).resolve()),'descendant','--state',str(state)],start_new_session=True)
        wait_file(state/'descendant.json')
    write(state/(role+'.json'),supervisor.process(os.getpid()))
    # A control bug cannot leave an indefinite root process. This is fixture-only.
    end=time.monotonic()+60
    while time.monotonic()<end:time.sleep(.05)


def legacy_owned(state):
    require(os.geteuid()==0,'actual legacy UID0 required');supervisor.subreaper()
    for sig in (signal.SIGTERM,signal.SIGHUP,signal.SIGINT):signal.signal(sig,signal.SIG_IGN)
    child=None;owner=supervisor.process(os.getpid());identity=None;error=None
    try:
        child=subprocess.Popen([sys.executable,str(Path(__file__).resolve()),'descendant','--state',str(state)],start_new_session=True)
        identity=supervisor.process(child.pid)
        wait_file(state/'descendant.json');write(state/'child.json',owner)
        end=time.monotonic()+15
        while not(state/'legacy-stop').exists()and time.monotonic()<end:time.sleep(.025)
    except BaseException as caught:error=type(caught).__name__+': '+str(caught);raise
    finally:
        cleanup=supervisor.settle(child)
        write(state/'legacy-result.json',{'uid':os.geteuid(),'owner':owner,'child':identity,'error':error,'cleanup':cleanup})
        require(not cleanup['remaining'],'legacy fixture cleanup incomplete')


def legacy_gap(state):
    state.mkdir(mode=0o700)
    with (state/'wrapper.stdout.log').open('xb')as out,(state/'wrapper.stderr.log').open('xb')as err:
        wrapper=subprocess.Popen(['sudo','-n','--',sys.executable,str(Path(__file__).resolve()),
            'legacy-bootstrap','--state',str(state)],stdout=out,stderr=err,start_new_session=True)
    direct=None;descendant=None;result=None
    try:
        direct=wait_file(state/'child.json');descendant=wait_file(state/'descendant.json')
        require(direct['uid']==descendant['uid']==0,'legacy root gap not exercised')
        outcome='sent SIGKILL to old sudo-wrapper group'
        try:os.killpg(wrapper.pid,signal.SIGKILL)
        except PermissionError:outcome='PermissionError from old sudo-wrapper group'
        require(supervisor.same(direct)and supervisor.same(descendant),'legacy survivor gap not reproduced')
        result={'outcome':outcome,'wrapper_pid':wrapper.pid,'root':direct,'escaped_descendant':descendant,
                'root_survived_old_cleanup':True}
    finally:
        (state/'legacy-stop').write_text('stop')
        cleanup=wait_file(state/'legacy-result.json',seconds=20)
        direct=direct or cleanup.get('owner');descendant=descendant or cleanup.get('child')
        wrapper.wait(timeout=8)
        end=time.monotonic()+5;rows=[]
        while time.monotonic()<end:
            rows.extend(supervisor.reaped(None))
            if (not direct or not supervisor.same(direct))and(not descendant or not supervisor.same(descendant)):break
            time.sleep(.025)
        if direct:assert_absent(direct)
        if descendant:assert_absent(descendant)
        require(cleanup['uid']==0 and cleanup['cleanup']['remaining']==[],'legacy root fixture not settled')
    require(result and cleanup['error']is None,'legacy baseline failed; cleanup retained')
    return {**result,'cleanup':cleanup,'adopted_reaped':rows}


def worker(state,role,timeout):
    def interrupted(_s,_f):raise InterruptedError('control interruption')
    for sig in (signal.SIGINT,signal.SIGTERM):signal.signal(sig,interrupted)
    apt.run(state,'payload',['sudo',sys.executable,str(Path(__file__).resolve()),role,'--state',str(state)],timeout=timeout)


def launch(state,role,timeout):
    state.mkdir(mode=0o700)
    out=(state/'worker.stdout.log').open('xb');err=(state/'worker.stderr.log').open('xb')
    child=subprocess.Popen([sys.executable,str(Path(__file__).resolve()),'worker','--state',str(state),
        '--role',role,'--timeout',str(timeout)],stdout=out,stderr=err,start_new_session=True)
    out.close();err.close();return child


def stop_worker(child):
    if child.poll()is None:
        child.send_signal(signal.SIGTERM)
        try:child.wait(timeout=10)
        except subprocess.TimeoutExpired:child.kill();child.wait(timeout=3)


def assert_absent(identity):
    require(not supervisor.same(identity),'owned original PID/start still exists: '+str(identity))


def driver(root):
    require(sys.platform=='linux'and os.geteuid()!=0,'unprivileged GNU hosted driver required')
    root.mkdir(mode=0o700);supervisor.subreaper();started=time.monotonic();active=[];rows=[];failure=None
    sentinel_state=root/'sentinel';sentinel=launch(sentinel_state,'sentinel',60);active.append(sentinel)
    sentinel_identity=None;legacy=None
    try:
        sentinel_identity=wait_file(sentinel_state/'sentinel.json');require(sentinel_identity['uid']==0,'root sentinel missing')
        legacy=legacy_gap(root/'legacy-baseline')
        require(supervisor.same(sentinel_identity),'legacy cleanup touched unrelated root sentinel')
        for name,sig in [('timeout',None),('sigint',signal.SIGINT),('sigterm',signal.SIGTERM),('parent-loss',signal.SIGKILL)]:
            state=root/name;child=launch(state,'child',3 if sig is None else 30);active.append(child)
            direct=wait_file(state/'child.json');descendant=wait_file(state/'descendant.json')
            ready=wait_file(state/'payload-privileged/ready.json')
            require(direct['uid']==descendant['uid']==ready['supervisor']['uid']==0,'UID0 ownership not exercised')
            require(direct['pgid']!=descendant['pgid'],'escaped descendant session not exercised')
            require(supervisor.same(sentinel_identity),'unrelated root sentinel unexpectedly stopped')
            if sig is None:
                # Prove the old unprivileged authority/group assumption is false.
                # Do not kill sudo: its forwarding behavior is deliberately not relied upon.
                denied=False
                try:os.killpg(direct['pgid'],signal.SIGKILL)
                except PermissionError:denied=True
                require(denied and supervisor.same(direct)and supervisor.same(descendant),'old root group authority gap not reproduced')
            else:child.send_signal(sig)
            exitcode=child.wait(timeout=12);require(exitcode!=0,'cancelled command silently passed')
            result=wait_file(state/'payload-privileged/result.json')
            require(result['uid']==0 and result['cleanup']['remaining']==[],'root teardown incomplete')
            require(result['reason']in ({'timeout','cancelled'}if sig is None else
                {'parent-loss','launcher-loss','supervisor-signal'}if sig==signal.SIGKILL else{'cancelled'}),'wrong lifecycle outcome')
            killed={p['pid']for p in result['cleanup']['signals']if p['signal']==signal.SIGKILL}
            reaped={p['pid']for p in result['cleanup']['reaped']}
            require({direct['pid'],descendant['pid']}<=killed and {direct['pid'],descendant['pid']}<=reaped,'ignored TERM descendants not killed/reaped')
            assert_absent(direct);assert_absent(descendant)
            require(supervisor.same(sentinel_identity),'unrelated root sentinel killed by teardown')
            rows.append({'case':name,'worker_exit':exitcode,'old_direct_root_group_denied':sig is None,
                'root':direct,'escaped_descendant':descendant,'supervisor':ready['supervisor'],
                'sentinel_preserved':True,'result':result})
    except BaseException as error:failure=type(error).__name__+': '+str(error);raise
    finally:
        for child in reversed(active):stop_worker(child)
        # Driver is a subreaper only for its own worker/sudo-launcher descendants.
        end=time.monotonic()+8;reaped=[]
        while True:
            reaped.extend(supervisor.reaped(None));remaining=supervisor.owned()
            if not remaining or time.monotonic()>=end:break
            time.sleep(.025)
        sentinel_cleanup=wait_file(sentinel_state/'payload-privileged/result.json')if sentinel_identity else None
        if sentinel_identity:assert_absent(sentinel_identity)
        write(root/'report.json',{'source':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
            'run_id':os.environ.get('GITHUB_RUN_ID'),'attempt':os.environ.get('GITHUB_RUN_ATTEMPT'),
            'image':os.environ.get('ImageOS','')+'@'+os.environ.get('ImageVersion',''),
            'seconds':time.monotonic()-started,'legacy':legacy,'cases':rows,'error':failure,'sentinel_cleanup':sentinel_cleanup,
            'driver_reaped':reaped,'remaining_driver_descendants':list(remaining.values())})
        require(not remaining,'owned worker/sudo launcher remains')
    require(len(rows)==4,'complete first-attempt lifecycle selection required')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation',choices=['driver','worker','child','descendant','sentinel','legacy-bootstrap','legacy-owned'])
    parser.add_argument('--state',type=Path,required=True);parser.add_argument('--role',default='child')
    parser.add_argument('--timeout',type=float,default=30);args=parser.parse_args()
    if args.operation=='driver':driver(args.state)
    elif args.operation=='worker':worker(args.state,args.role,args.timeout)
    elif args.operation=='legacy-owned':legacy_owned(args.state)
    elif args.operation=='legacy-bootstrap':
        require(os.geteuid()==0,'actual root bootstrap required')
        child=subprocess.Popen([sys.executable,str(Path(__file__).resolve()),'legacy-owned','--state',str(args.state)],start_new_session=True)
        require(child.wait(timeout=30)==0,'legacy owned fixture failed')
    else:payload(args.state,args.operation)


if __name__=='__main__':main()
