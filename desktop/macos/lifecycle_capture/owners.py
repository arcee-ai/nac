"""Finite threads around existing ci.run group/handle/drainer ownership only."""
import ctypes
import os
from pathlib import Path
import threading
import time
from .protocol import encoded, private, publish, read, require


def positive(log):
    row=read(Path(str(log)+'.ownership.json'))
    require(all(row[k] is True for k in ('accepted','reaped','drain_settled'))
        and row['unknown'] is False and row['teardown_error'] is None,'positive original process custody')
    return row


class Task:
    def __init__(self,argv,log,cap,clock,*,env,run=None,limit=512*1024):
        self.argv,self.log,self.cap,self.clock,self.env=argv,Path(log),cap,clock,env
        self.limit=limit
        self.run=run;self.thread=None;self.error=None;self.cancelled=threading.Event();self.done=threading.Event()
    def start(self):
        require(self.thread is None,'one process-owner acquisition')
        self.clock.require_phase('owned-helper',self.cap+15)
        def owned():
            from ci_paths_budget import using
            from ci import run
            try:
                with using(self.clock.work):
                    (self.run or run)(self.argv,self.log,self.cap,env=self.env,
                        abort=self.cancelled.is_set,retain_ownership=True,complete_output_limit=self.limit)
                positive(self.log)
            except BaseException as error:self.error=error
            finally:self.done.set()
        self.thread=threading.Thread(target=owned,daemon=True);self.thread.start();return self
    def finish(self,seconds):
        require(self.thread is not None,'accepted owner thread')
        self.thread.join(timeout=seconds)
        require(not self.thread.is_alive(),'process owner/drainer unsettled; preserve fixture')
        proof=positive(self.log)
        if self.error is not None:raise self.error
        return proof
    def cancel(self,seconds=45):
        if self.thread is None:return None
        self.cancelled.set();return self.finish(seconds)


class Hints:
    """Darwin notification hints are scheduling only, never screenshot evidence."""
    def __init__(self,nonce):self.nonce,self.tokens=nonce,[];self.library=None
    def __enter__(self):
        self.library=ctypes.CDLL('/usr/lib/libSystem.B.dylib')
        self.library.notify_register_check.argtypes=(ctypes.c_char_p,ctypes.POINTER(ctypes.c_int))
        self.library.notify_check.argtypes=(ctypes.c_int,ctypes.POINTER(ctypes.c_int))
        self.library.notify_cancel.argtypes=(ctypes.c_int,)
        try:
            for i in (1,2):
                token=ctypes.c_int();name=f'nac.lifecycle.{self.nonce}.done.{i}'.encode()
                require(self.library.notify_register_check(name,ctypes.byref(token))==0,'notification registration')
                self.tokens.append(token.value);self.changed(i) # Initial delivery is not a completion hint.
            return self
        except BaseException:
            self.__exit__(None,None,None);raise
    def changed(self,ordinal):
        flag=ctypes.c_int();require(self.library.notify_check(self.tokens[ordinal-1],ctypes.byref(flag))==0,'notification check')
        return bool(flag.value)
    def __exit__(self,*args):
        errors=[]
        for token in self.tokens:
            if self.library.notify_cancel(token)!=0:errors.append(token)
        self.tokens=[]
        require(not errors,'notification custody unsettled')


def helper_ready(task,config,helper,*,probe=None):
    from ci_startup_owner import native_identity
    probe=probe or native_identity;end=min(task.clock.work.deadline,time.monotonic()+5)
    while time.monotonic()<end:
        task.clock.work.check();require(not task.done.is_set(),'witness exited before ready')
        try:row=read(Path(config['port'])/'witness-ready.json')
        except FileNotFoundError:time.sleep(.01);continue
        require(row['schema']=='lifecycle-witness-ready-v1' and row['nonce']==config['nonce']
            and row['configuration_sha256']==config['configuration_sha256'],'witness readiness scope')
        actual=probe(row['pid'])
        require(actual is not None and actual['parent']==os.getpid() and actual['executable']==str(helper)
            and actual['uid']==os.getuid(),'original helper kernel identity')
        config['helper_token']=row['helper_token'];config['helper_identity']=actual;return actual
    raise TimeoutError('witness ready cutoff')


def stop_helper(task,config):
    publish(Path(config['port'])/'stop',{'nonce':config['nonce']})
    row=task.finish(25)
    require(row['pid']==config['helper_identity']['pid'],'same accepted witness handle')
    return row


def runner_settled(found,probe=None,*,derived=None):
    from ci_startup_owner import native_identity,signature
    import json
    probe=probe or native_identity
    identities=[json.loads(found[(i,'caption')])['runner'] for i in (1,2)]
    require(identities[0]==identities[1],'same original XCTest runner')
    node=identities[0]
    require(type(node['pid']) is int and node['pid']>0 and node['uid']==os.getuid()
        and type(node['executable']) is str and node['executable'].endswith('NACLifecycleCaptureUITests-Runner'), 'actual runner identity')
    require(all(type(node[k]) is int for k in ('parent','uid','start_seconds','start_microseconds'))
        and node['start_seconds']>0 and 0<=node['start_microseconds']<1000000,'exact runner generation')
    if derived is not None:
        require(Path(node['executable']).is_relative_to(derived) and Path(node['executable']).resolve()==Path(node['executable']),'runner under actual generated SDK products')
    actual=probe(node['pid'])
    require(actual is None or signature(actual)!=signature(node),'original XCTest runner remains live')
    return {'runner':node,'old_generation_settled':True,'PID_signals':False}


def settle_independently(actions,primary=None):
    results={};errors=[]
    for name,action in actions:
        try:results[name]=action()
        except BaseException as error:errors.append((name,error))
    if errors:
        if primary is None:primary=errors[0][1]
        for name,error in errors:
            if error is not primary and hasattr(primary,'add_note'):primary.add_note(name+': '+type(error).__name__)
    if primary is not None:raise primary
    return results
