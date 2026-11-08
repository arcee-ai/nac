"""Closed two-phase per-case rendezvous. Releases are NEVER screenshot proof."""
import ctypes
import sys
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import time
import uuid

P = '4b7a1f3e0bf6175a77c5ebf627fe965860e99976'
CASES = ('run', 'approval', 'terminal')
PHASES = ('confirming', 'reconfirming')
TESTS = {case: 'test://com.apple.xcode/NACNativeUITests/NACLifecycleCaptureUITests/LifecycleCaptureJourneys/testCapture' + case.title() for case in CASES}
PNG_MAX = 2 * 1024**2
SUPPLEMENT_MAX = 12 * 1024**2
TOTAL_MAX = 54 * 1024**2
# Driver240 bounds the ENTIRE unchanged journey plus new60/90s holds.
# Case work: helper-ready5 + concurrent actor350 + collect45 + runner5
# + witness-retirement25 + margin10 =440. Failure cleanup: original driver155
# + SDK owner45 + companion25 + router5 + export60 =290, rounded to300.
DRIVER = 240
ACTOR = 350
CASE_WORK = 440  # fixed concurrent acquisition/capture/collection/retirement sum above
CASE_CLEANUP = 300
CASE_ALLOWANCE = CASE_WORK + CASE_CLEANUP  #740, never the old555
FIELDS = ('app_pid','engine_pid','workspace_window_number','launch_incarnation','ready_source',
          'ready_store','quit_confirmation_decisions','quit_sheet_presentations',
          'quit_cancel_choices','quit_stop_completions')


def require(value, reason):
    if not value:
        raise RuntimeError('Lifecycle capture: ' + reason)


def digest(data): return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()


def closed(value, keys):
    require(type(value) is dict and set(value)==set(keys), 'closed record fields')
    return value


def raw(path, limit=256*1024):
    path=Path(path)
    require(path.is_absolute() and path.resolve()==path and not path.is_symlink(), 'canonical known file')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb') as f:
        info=os.fstat(f.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid==os.getuid() and info.st_nlink==1
                and 0<info.st_size<=limit, 'owned bounded regular single-link file')
        data=f.read(limit+1)
        last=os.fstat(f.fileno())
        require((info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns,info.st_ctime_ns)==
                (last.st_dev,last.st_ino,last.st_size,last.st_mtime_ns,last.st_ctime_ns),'record changed during read')
    require(len(data)==info.st_size and len(data)<=limit,'record limit')
    return data


def decoded(data):
    def unique(pairs):
        result={}
        for k,v in pairs:
            require(k not in result,'duplicate JSON key');result[k]=v
        return result
    return json.loads(data,object_pairs_hook=unique,parse_constant=lambda _: require(False,'nonfinite'))


def read(path,limit=256*1024):return decoded(raw(path,limit))


def rename_exclusive(source, destination):
    """Darwin atomic no-clobber file commit; no target ever has two names.

    SDK sys/stdio.h: RENAME_EXCL=0x4, renamex_np available since macOS10.12.
    This is only an inert-filesystem port, not a process/AX/SDK actor. No
    ordinary rename/link fallback: unavailable exclusivity fails closed.
    """
    require(sys.platform=='darwin','exclusive publication requires the declared macOS host')
    library=ctypes.CDLL('/usr/lib/libSystem.B.dylib',use_errno=True)
    operation=library.renamex_np
    operation.argtypes=(ctypes.c_char_p,ctypes.c_char_p,ctypes.c_uint)
    operation.restype=ctypes.c_int
    if operation(os.fsencode(source),os.fsencode(destination),0x4)!=0:
        error=ctypes.get_errno()
        raise OSError(error,os.strerror(error),str(destination))


def publish(path, value):
    path=Path(path);require(not path.exists() and not path.is_symlink(),'immutable record/reentry')
    data=encoded(value);require(len(data)<=256*1024,'publication limit')
    temporary=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    try:
        with temporary.open('xb') as f:
            os.chmod(temporary,0o400);f.write(data);f.flush();os.fsync(f.fileno())
        # One atomic move of the complete single-link inode, refusing ANY
        # preexisting destination. Readers remain unchanged and strict.
        rename_exclusive(temporary,path)
        fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(fd)
        finally:os.close(fd)
    finally:temporary.unlink(missing_ok=True)


def private(path):
    path=Path(path)
    require(path.is_absolute() and path.resolve()==path and not path.is_symlink(),'private port spelling')
    info=path.stat();require(stat.S_ISDIR(info.st_mode) and info.st_uid==os.getuid()
        and stat.S_IMODE(info.st_mode)==0o700,'private port owner/mode')
    return path


def binding(record, phase):
    require(record['stage']==phase and record['ready_source']==P,'current product/phase')
    key='restored-minimize-quit' if phase=='confirming' else 'restored-minimize-quit-again'
    episode=record[key]
    value={k:record[k] for k in FIELDS}
    value.update(phase=phase,confirmation_id=episode['confirmation_id'],sheet_window=episode['sheet_window'],document=episode['document'])
    for key in ('app_pid','engine_pid','workspace_window_number','sheet_window'):
        require(type(value[key]) is int and value[key]>0,'positive exact identity')
    require(value['confirmation_id'] and value['document'] and value['launch_incarnation'],'episode identities')
    require(episode['owners_intact'] is True and episode['termination_pending'] is True
        and episode['miniaturized'] is False and episode['visible'] is True and episode['front'] is True,'visible owned confirmation')
    return value


def request(config, ordinal, state, app, native_path):
    require(type(ordinal) is int and ordinal in (1,2),'one ordered frame')
    return dict(schema='lifecycle-request-v1',case=config['case'],ordinal=ordinal,
        nonce=config['nonce'],configuration_sha256=config['configuration_sha256'],
        binding=binding(state,PHASES[ordinal-1]),app_path=str(app),native_path=str(native_path))


def require_request(value, config, ordinal):
    closed(value,('schema','case','ordinal','nonce','configuration_sha256','binding','app_path','native_path'))
    require(value['schema']=='lifecycle-request-v1' and value['case']==config['case']
        and type(value['ordinal']) is int and value['ordinal']==ordinal
        and value['nonce']==config['nonce'] and value['configuration_sha256']==config['configuration_sha256'],'request identity')
    b=value['binding'];closed(b,(*FIELDS,'phase','confirmation_id','sheet_window','document'))
    require(b['phase']==PHASES[ordinal-1] and b['ready_source']==P,'request phase/product')
    for k in ('app_pid','engine_pid','workspace_window_number','sheet_window'):
        require(type(b[k]) is int and b[k]>0,'exact positive owner')
    for k in ('launch_incarnation','ready_store','confirmation_id','document'):
        require(type(b[k]) is str and 0<len(b[k])<=4096,'bounded owner identity')
    require(b['sheet_window']!=b['workspace_window_number'],'distinct sheet and root window')
    for k,n in zip(('quit_confirmation_decisions','quit_sheet_presentations','quit_cancel_choices','quit_stop_completions'),(ordinal,ordinal,ordinal-1,0)):
        require(type(b[k]) is int and b[k]==n,'exact phase counters')
    case_root=Path(config['case_root']);app=Path(value['app_path']);native=Path(value['native_path'])
    require(app.is_absolute() and app.resolve()==app and app.parent.name=='Relocated app folder with spaces'
        and app.name=='NAC Lifecycle Smoke.app' and app.parent.parent.parent==case_root
        and app.parent.parent.name.startswith('nac-lifecycle-app-')
        and native==case_root/config['case']/'native.json' and native.resolve()==native,'exact current fixture paths')
    require(Path(b['ready_store']).parent.parent==app.parent.parent,'same store/fixture root')
    return value


def release(req):
    return dict(schema='lifecycle-provisional-release-v1',nonce=req['nonce'],case=req['case'],
        ordinal=req['ordinal'],configuration_sha256=req['configuration_sha256'],
        request_sha256=digest(encoded(req)),capture_verified=False)


def require_release(value, req):
    require(encoded(value)==encoded(release(req)),'exact provisional release; no image claim')


def wait_release(port, req, clock, *, pause=time.sleep):
    end=min(clock.work.deadline,time.monotonic()+(60 if req['ordinal']==1 else 90))
    while time.monotonic()<end:
        clock.work.check()
        if (port/'failure.json').exists():raise RuntimeError('Capture owner failed; no retry')
        try:value=read(port/f"release-{req['ordinal']}.json")
        except FileNotFoundError:pause(.02);continue
        require_release(value,req);return value
    raise TimeoutError('Original bounded provisional release wait exhausted')


class Client:
    def __init__(self,config,clock):
        self.config,self.clock=config,clock;self.port=private(config['port']);self.next=1;self.receipts=[]
    def __call__(self,journey,scenario,phase):
        require(scenario==self.config['case'] and self.next<=2 and phase==PHASES[self.next-1],'case/order/reentry')
        self.clock.require_phase('capture-hold',75 if self.next==1 else 105)
        journey.guard_focus();before=journey.read();req=request(self.config,self.next,before,journey.bundle,journey.output)
        publish(self.port/f'request-{self.next}.json',req)
        acknowledgment=wait_release(self.port,req,self.clock)
        journey.guard_focus();require(binding(journey.read(),phase)==req['binding'],'phase/owner changed during hold')
        self.receipts.append(dict(request=req,release=acknowledgment,before=req['binding'],after=binding(journey.read(),phase)));self.next+=1
