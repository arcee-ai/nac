"""Finite path-qualification clock, scoped to existing owning operations.

ROOT's <=2340s original allocation precedes the one dispatch/job. Under the
existing synchronized-UTC engineering premise its deadline is conservative
against the40-minute host bound. The60s allowance is declared, not measured skew.
No signal timer, process owner, eligibility grant or deadline renewal lives here.
"""
from contextlib import contextmanager
from contextvars import ContextVar
import hashlib
import math
import time

_ACTIVE = ContextVar('nac_path_operation_bound', default=None)


class BudgetExpired(TimeoutError):
    pass


class PathBudget:
    def __init__(self, allocation, H_deadline, *, monotonic=time.monotonic, wall=time.time):
        self.monotonic, self.wall = monotonic, wall
        self.mono = monotonic()  # Sample first; conversion only shortens by sampling delay.
        self.epoch = wall()
        start, end = allocation['started_at_epoch'], allocation['deadline_epoch']
        if any(type(x) not in (int,float) or not math.isfinite(x)
               for x in (start,end,H_deadline,self.mono,self.epoch)):
            raise ValueError('Nonfinite original path clock')
        if not start <= self.epoch < end or not 0 < end-start <= 2340:
            raise ValueError('Original queue-inclusive path allocation clock')
        self.origin = self.mono+start-self.epoch
        self.hard = min(H_deadline,self.mono+end-self.epoch-60)
        self.failed = []
        self.evidence=dict(initial_epoch=self.epoch,initial_monotonic=self.mono,
            uncertainty_margin_seconds=60,checks=0,failed=self.failed,
            premise='ordinary synchronized UTC; allowance is not measured skew evidence')
        self.work = Bound(self,self.hard-600,'work')
        self.cleanup = Bound(self,self.hard-120,'cleanup')
        self.retention = Bound(self,self.hard,'retention')
        self.work.check()

    def fail(self, reason):
        if reason not in self.failed:self.failed.append(reason)

    def observe(self):
        before=self.monotonic();epoch=self.wall();after=self.monotonic()
        # One-second discontinuity detection tolerance is an engineering check,
        # not a measured ROOT/runner skew bound. Unknown/steps never renew C'.
        if (not all(math.isfinite(x) for x in (before,epoch,after)) or after<before
                or not self.epoch+before-self.mono-1 <= epoch <= self.epoch+after-self.mono+1):
            self.fail('clock discontinuity/unknown')
            raise BudgetExpired('Path clock discontinuity/unknown')
        observation=dict(epoch=epoch,monotonic_before=before,monotonic_after=after)
        self.evidence['checks']+=1
        self.evidence['last']=observation
        return observation

    def require_success(self):
        self.retention.check()
        if self.failed:raise BudgetExpired('Path budget latched: '+', '.join(self.failed))


class Bound:
    def __init__(self, owner, deadline, kind):
        self.owner,self.deadline,self.kind=owner,deadline,kind

    def capped(self, deadline):
        # None is the declared optional cap: keep the same absolute bound/latch.
        if deadline is None:return self
        return Bound(self.owner,min(self.deadline,deadline),self.kind)

    def check(self):
        if self.kind=='work':
            self.owner.observe()
            if self.owner.failed:
                raise BudgetExpired('Path work expiry remains latched')
        if self.owner.monotonic()>=self.deadline:
            self.owner.fail(self.kind+': original cutoff')
            raise BudgetExpired('Path '+self.kind+' original cutoff')

    def timeout(self, cap, reserve=0):
        self.check()
        seconds=min(cap,self.deadline-self.owner.monotonic()-reserve)
        if seconds<=0:
            self.owner.fail(self.kind+': helper reserve')
            raise BudgetExpired('Path '+self.kind+' helper reserve')
        return seconds


@contextmanager
def using(bound):
    parent=_ACTIVE.get()
    if bound is not None and parent is not None and bound.kind==parent.kind:
        bound=bound.capped(parent.deadline)
    token=_ACTIVE.set(bound)
    try:
        if bound is not None:bound.check()
        yield bound
        if bound is not None:bound.check()
    finally:
        _ACTIVE.reset(token)  # Restore original absolute parent, never a fresh allowance.


def active():return _ACTIVE.get()


def check():
    if active() is not None:active().check()


def time_limit(cap, reserve=0):
    return active().timeout(cap,reserve) if active() is not None else cap


def timeout_options(cap=30):
    return {'timeout':time_limit(cap)} if active() is not None else {}


def checked_items(items):
    check()
    for item in items:
        check();yield item
    check()


def checked_digest(stream):
    value=hashlib.sha256()
    for chunk in iter(lambda:stream.read(1024*1024),b''):
        check();value.update(chunk)
    check();return value


def path_digest(path):
    with path.open('rb') as stream:return checked_digest(stream).hexdigest()
