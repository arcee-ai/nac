"""Two held confirmations; actual collection and owner retirement precede release2."""
import os
from pathlib import Path
import threading
import time
from . import collector
from .protocol import CASE_ALLOWANCE, ACTOR, read, publish, require, require_request, release
from .owners import Task, Hints, helper_ready, positive, runner_settled, settle_independently, stop_helper
from .transaction import supervisor


class Capture:
    def __init__(self,config,session,runner,runner_hash,helper,folder,clock,env,tool,command):
        self.config,self.session,self.runner,self.runner_hash=config,session,runner,runner_hash
        self.helper,self.folder,self.clock,self.env,self.tool,self.command=helper,folder,clock,env,tool,command
        self.witness=self.actor=None;self.router=None;self.error=None;self.requests=[];self.collected=None
        self.helper_stopped=False;self.helper_retiring=False;self.stop=threading.Event();self.done=threading.Event();self.settlement={}
    def failure(self):
        if self.error is not None:return True
        if self.witness is not None and self.witness.done.is_set() and not self.helper_retiring:return True
        return any(task is not None and task.done.is_set() and task.error is not None for task in (self.witness,self.actor))
    def start(self):
        from .protocol import digest
        require(digest(self.runner.read_bytes())==self.runner_hash,'actual generated runner changed')
        require(digest(self.helper.read_bytes())==self.config['helper_sha256'],'compiled companion changed')
        self.clock.require_phase('capture-acquire',CASE_ALLOWANCE)
        self.hints=Hints(self.config['nonce']);self.hints.__enter__()
        try:
            self.witness=Task([str(self.helper),str(self.session),self.config['case']],self.folder/'witness.log',ACTOR,self.clock,env=self.env)
            self.witness.start();helper_ready(self.witness,self.config,self.helper)
            self.clock.require_phase('capture-XCTest-acquire',CASE_ALLOWANCE)
            result=self.folder/'case.xcresult'
            test='testCapture'+self.config['case'].title()
            argv=['xcodebuild','test-without-building','-xctestrun',str(self.runner),
                '-destination','platform=macOS,arch=arm64','-parallel-testing-enabled','NO',
                '-maximum-concurrent-test-device-destinations','1','-resultBundlePath',str(result),
                '-only-testing:NACLifecycleCaptureUITests/LifecycleCaptureJourneys/'+test]
            self.actor=Task(argv,self.folder/'test.log',ACTOR,self.clock,env=self.env).start()
            def route():
                try:self._route(result)
                except BaseException as error:
                    self.error=error
                    try:publish(Path(self.config['port'])/'failure.json',{'status':'refused','nonce':self.config['nonce'],'failure':type(error).__name__})
                    except BaseException:pass # Never replaces first failure or makes a positive release.
                finally:self.done.set()
            self.router=threading.Thread(target=route,daemon=True);self.router.start()
        except BaseException:
            # Caller finally owns all accepted handles, including partial starts.
            raise
        return self
    def _route(self,result):
        from ci_paths_budget import using
        port=Path(self.config['port']);end=min(self.clock.work.deadline,time.monotonic()+ACTOR)
        with using(self.clock.work):
            for ordinal in (1,2):
                while time.monotonic()<end:
                    self.clock.work.check()
                    require(not self.stop.is_set() and not self.failure(),'capture owner unavailable')
                    require(not (port/'failure.json').exists(),'sticky witness refusal')
                    try:req=read(port/f'request-{ordinal}.json')
                    except FileNotFoundError:time.sleep(.01);continue
                    req=require_request(req,self.config,ordinal)
                    if self.hints.changed(ordinal):break
                    require(not self.actor.done.is_set(),'XCTest exited without ordered hint')
                    time.sleep(.01)
                else:raise TimeoutError('original capture actor cutoff')
                self.requests.append(req)
                if ordinal==1:
                    publish(port/'release-1.json',release(req));continue
                # A notification is no proof. Require actual successful SDK/test,
                # actual selected attachments and original runner retirement first.
                self.actor.finish(min(45,max(0,end-time.monotonic())))
                self.clock.require_phase('actual-attachment-collection',45)
                self.collected=collector.collect_public(result,self.folder,self.config,self.requests,self.command,tool=self.tool)
                from .transaction.contract import persist
                persist(Path(self.config['case_root'])/'public-candidate.json',dict(status='provisional-only',private_after_fences_verified=False,actual=self.collected[2]))
                self.settlement['runner']=runner_settled(self.collected[0],derived=self.runner.parent)
                self.helper_retiring=True
                self.settlement['witness']=stop_helper(self.witness,self.config);self.helper_stopped=True
                publish(port/'release-2.json',release(req)) # Still false capture_verified; private after-fence follows.
    def finish(self):
        require(self.router is not None,'capture router not acquired')
        self.router.join(timeout=5)
        require(not self.router.is_alive(),'capture coordinator unsettled')
        if self.error is not None:raise self.error
        require(self.done.is_set() and len(self.requests)==2 and self.helper_stopped and self.collected is not None,'full capture route')
        return self.collected
    def cleanup(self,primary=None):
        from ci_paths_budget import using
        self.stop.set()
        actions=[]
        if self.actor is not None:actions.append(('XCTest-owner',lambda:self.actor.cancel(max(0,min(45,self.clock.cleanup.deadline-time.monotonic())))))
        if self.witness is not None and not self.helper_stopped:
            def witness():
                publication_error=None
                try:
                    if 'helper_identity' in self.config and not (Path(self.config['port'])/'stop').exists():
                        publish(Path(self.config['port'])/'stop',{'nonce':self.config['nonce']})
                except BaseException as error:publication_error=error
                return settle_independently([('witness-handle',lambda:self.witness.cancel(max(0,min(25,self.clock.cleanup.deadline-time.monotonic()))))],publication_error)
            actions.append(('external-witness',witness))
        if self.router is not None:
            def router():
                self.router.join(timeout=max(0,min(5,self.clock.cleanup.deadline-time.monotonic())));require(not self.router.is_alive(),'router not settled')
            actions.append(('capture-coordinator',router))
        if hasattr(self,'hints'):actions.append(('notification-registration',lambda:self.hints.__exit__(None,None,None)))
        try:self.clock.cleanup.check()
        except BaseException as error:
            if primary is None:primary=error
        return settle_independently(actions,primary) # Even an expired bound attempts each accepted owner's cancellation.


def driver_with_capture(capture,command,log,env,owner,clock):
    from .transaction.contract import Binding
    class Observer:
        @staticmethod
        def retain(*args):
            owner.retain(*args)
            if capture.error is not None:raise capture.error
            for task in (capture.witness,capture.actor):
                if task is not None and task.error is not None:raise task.error
            require(not capture.failure(),'capture side unavailable')
    def acquire(*args,**kwargs):
        clock.require_phase('original-driver-acquire',CASE_ALLOWANCE)
        return supervisor.subprocess.Popen(*args,**kwargs)
    primary=None;result=None
    try:
        capture.start()
        result=supervisor.run_case(command,log,env,owner=Observer,binding=Binding.P12,spawn=acquire)
        capture.finish()
    except BaseException as error:primary=error
    capture.cleanup(primary)
    return result
