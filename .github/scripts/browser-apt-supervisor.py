#!/usr/bin/env python3
"""Linux sudo-side supervisor: exact owned ancestry, parent lease, bounded reaping."""
import argparse
import ctypes
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import time


def require(value,message):
    if not value:raise ValueError(message)


def process(pid):
    try:
        root=Path('/proc')/str(pid);text=(root/'stat').read_text()
        fields=text[text.rfind(')')+2:].split()
        return {'pid':int(pid),'start':int(fields[19]),'ppid':int(fields[1]),
                'pgid':int(fields[2]),'state':fields[0],'uid':root.stat().st_uid}
    except (FileNotFoundError,ProcessLookupError):return None


def same(value):
    current=process(value['pid'])
    return current if current and current['start']==value['start']else None


def children(pid):
    result=set()
    try:tasks=list((Path('/proc')/str(pid)/'task').iterdir())
    except FileNotFoundError:return result
    for task in tasks:
        try:text=(task/'children').read_text()
        except (FileNotFoundError,ProcessLookupError):continue
        require(re.fullmatch(r'[0-9\s]*',text)is not None,'malformed kernel child list')
        result.update(int(p)for p in text.split())
    return result


def owned():
    found={};pending=list(children(os.getpid()))
    while pending:
        pid=pending.pop()
        if pid in found:continue
        value=process(pid)
        if value:
            found[pid]=value;pending.extend(children(pid))
        require(len(found)<=4096,'owned descendant bound')
    return found


def subreaper():
    require(sys.platform=='linux'and hasattr(os,'pidfd_open')and hasattr(signal,'pidfd_send_signal'),
            'Linux pidfd and child subreaper required')
    libc=ctypes.CDLL(None,use_errno=True)
    if libc.prctl(36,1,0,0,0)!=0:raise OSError(ctypes.get_errno(),'PR_SET_CHILD_SUBREAPER')


def reaped(child):
    rows=[]
    while True:
        try:pid,status=os.waitpid(-1,os.WNOHANG)
        except ChildProcessError:break
        if not pid:break
        code=os.waitstatus_to_exitcode(status);rows.append({'pid':pid,'exit':code})
        if child and pid==child.pid:child.returncode=code
    return rows


def settle(child):
    signals=[];rows=[];sent=set()
    # Each pass rediscovers only this subreaper's children/adoptees, including
    # setsid descendants. Revalidate start ticks immediately before signalling.
    for sig,seconds in ((signal.SIGTERM,1.0),(signal.SIGKILL,2.0)):
        end=time.monotonic()+seconds
        while True:
            rows.extend(reaped(child));values=owned()
            if not values:return {'signals':signals,'reaped':rows,'remaining':[]}
            for value in values.values():
                current=same(value)
                if not current or current['state']=='Z':continue
                key=(value['pid'],value['start'],int(sig))
                if key in sent:continue
                handle=None
                try:
                    handle=os.pidfd_open(value['pid'])
                    if not same(value):continue
                    signal.pidfd_send_signal(handle,sig)
                    sent.add(key);signals.append({'pid':value['pid'],'start':value['start'],'signal':int(sig)})
                    if sig==signal.SIGTERM:signal.pidfd_send_signal(handle,signal.SIGCONT)
                except ProcessLookupError:pass
                finally:
                    if handle is not None:os.close(handle)
            if time.monotonic()>=end:break
            time.sleep(.025)
    rows.extend(reaped(child))
    return {'signals':signals,'reaped':rows,'remaining':list(owned().values())}


def control_fd(path,uid):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        info=os.fstat(fd)
        require(info.st_uid==uid and stat.S_IMODE(info.st_mode)==0o700,'private caller control root required')
        require(set(os.listdir(fd))<={'stop','stop.tmp'},'control root must be fresh')
        return fd
    except BaseException:os.close(fd);raise


def publish(fd,name,value):
    raw=json.dumps(value,sort_keys=True).encode();require(len(raw)<=1024*1024,'receipt bound')
    try:os.stat(name,dir_fd=fd,follow_symlinks=False)
    except FileNotFoundError:pass
    else:raise ValueError('receipt already exists')
    handle=os.open(name+'.tmp',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644,dir_fd=fd)
    with os.fdopen(handle,'wb')as out:os.fchmod(out.fileno(),0o644);out.write(raw);out.flush()
    os.rename(name+'.tmp',name,src_dir_fd=fd,dst_dir_fd=fd)


def requested(fd,nonce,uid):
    try:handle=os.open('stop',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
    except FileNotFoundError:return False
    with os.fdopen(handle,'rb')as source:
        info=os.fstat(source.fileno());require(stat.S_ISREG(info.st_mode)and info.st_nlink==1 and
            info.st_uid==uid and info.st_size<=64,'unsafe stop request')
        require(source.read(65)==nonce.encode(),'foreign stop request')
    return True


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--control',type=Path,required=True);parser.add_argument('--nonce',required=True)
    parser.add_argument('--caller',type=int,required=True);parser.add_argument('--start',type=int,required=True)
    parser.add_argument('--timeout',type=float,required=True);parser.add_argument('--cwd',type=Path,required=True)
    args,command=parser.parse_known_args()
    require(command[:1]==['--']and command[1:]and Path(command[1]).is_absolute(),'absolute child command required')
    require(os.geteuid()==0 and os.environ.get('SUDO_UID','').isdigit(),'requires actual sudo root')
    uid=int(os.environ['SUDO_UID']);require(uid>0 and args.caller>1 and args.start>0,'ordinary caller required')
    require(re.fullmatch(r'[0-9a-f]{32}',args.nonce)and 0<args.timeout<=900,'invalid nonce/controller bound')
    fd=control_fd(args.control,uid);child=None;reason='';error=None;start=time.monotonic();rows=[]
    caller={'pid':args.caller,'start':args.start};launcher=process(os.getppid());interruption=[];report={}
    for sig in (signal.SIGINT,signal.SIGTERM,signal.SIGHUP):signal.signal(sig,lambda s,_f:interruption.append(s))
    try:
        current=same(caller);require(current and current['uid']==uid and current['state']!='Z','caller lease lost before start')
        subreaper()
        if requested(fd,args.nonce,uid):reason='cancelled-before-start'
        else:
            env={k:os.environ[k]for k in ('PATH','HOME','LANG','LC_ALL')if k in os.environ}
            child=subprocess.Popen(command[1:],cwd=args.cwd,env=env,start_new_session=True)
            report={'schema':1,'nonce':args.nonce,'supervisor':process(os.getpid()),'caller':current,'launcher':launcher,'child':process(child.pid)}
            publish(fd,'ready.json',report)
            while True:
                rows.extend(reaped(child));current=same(caller)
                if not current or current['uid']!=uid or current['state']=='Z':reason='parent-loss';break
                if launcher and not same(launcher):reason='launcher-loss';break
                if interruption:reason='supervisor-signal';break
                if requested(fd,args.nonce,uid):reason='cancelled';break
                if time.monotonic()-start>=args.timeout:reason='timeout';break
                if child.returncode is not None:
                    reason='descendant-leak'if owned()else'completed';break
                time.sleep(.025)
    except BaseException as caught:error=type(caught).__name__+': '+str(caught);reason=reason or'supervisor-error'
    finally:
        cleanup=settle(child);cleanup['reaped']=rows+cleanup['reaped']
        report.update(schema=1,nonce=args.nonce,uid=os.geteuid(),reason=reason,error=error,
            exit=child.returncode if child else None,seconds=time.monotonic()-start,cleanup=cleanup,received_signals=interruption)
        publish(fd,'result.json',report);os.close(fd)
    require(not error and reason=='completed'and child and child.returncode==0 and not cleanup['remaining'],
            'privileged command failed or was cancelled; see owned result receipt')


if __name__=='__main__':main()
