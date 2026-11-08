"""Execute extracted actual Python methods with inert ports; no imports of harness, threads or process actors."""
import ast
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest

import ci_paths_budget as budget

P=Path(__file__).resolve().parent
T=(P/'ci_startup_ax.py').read_text()

def require(value, reason):
    if not value: raise RuntimeError(reason)

def abort_function(source, witness):
    tree = ast.parse(source)
    method = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == '_abort')
    ns = {}
    exec(compile(ast.Module(body=[method], type_ignores=[]), '<actual-abort>', 'exec'), ns)
    owner = SimpleNamespace(witness=witness, bound=None, work_admitted=False)
    return lambda: ns['_abort'](owner)

def stop_method(source, ns):
    tree=ast.parse(source)
    method=next(n for n in ast.walk(tree) if isinstance(n,ast.FunctionDef) and n.name=='_stop')
    exec(compile(ast.Module(body=[method],type_ignores=[]),'<actual-stop>','exec'),ns)
    return ns['_stop']

class Fixture:
    def __init__(self, root, *, failure='app_windows', process=None, identity=True, cap=20, case=60,
                 finish=.1, process_at=None, finished=False, alive=False, custody=None, primary=None):
        self.clock=0.;self.waits=[];self.joins=[];self.stop_seen_during_wait=[];self.cap_calls=[]
        self.finish,self.process_at,self.done=finish,process_at,finished
        self.root=root;self.stop=root/'receipt.json.stop'
        self.row=dict(accepted=True,reaped=True,drain_settled=True,unknown=False,teardown_error=None,pid=12)
        if custody:self.row.update(custody)
        self.owner=SimpleNamespace(thread=SimpleNamespace(join=self.join,is_alive=lambda:alive),stopping=False,
            declaration={'path':str(root/'receipt.json'),'nonce':'a'*64,'helper_sha256':'b'*64},
            witness=SimpleNamespace(ui_failure=failure,process_failure=process),case_deadline_ns=int(case*1e9),
            identity={'pid':12} if identity else None,finished=SimpleNamespace(is_set=lambda:self.done,wait=self.wait),
            folder=root,phase={},error=primary,settlement=None)
        self.ns=dict(Path=Path,time=SimpleNamespace(monotonic=lambda:self.clock),time_limit=self.limit,
                     BudgetExpired=budget.BudgetExpired,require=require,os=SimpleNamespace(replace=lambda a,b:a.replace(b)),json=json,
                     bounded_file=lambda path,limit:json.dumps(self.row if str(path).endswith('ownership.json') else {'status':'waiting'}))
        self.cap=cap
    def limit(self,cap):
        self.cap_calls.append(cap)
        return min(cap,self.cap-self.clock)
    def wait(self,seconds):
        self.stop_seen_during_wait.append(self.stop.exists());self.waits.append(seconds);self.clock+=seconds
        if self.process_at is not None and self.clock>=self.process_at:self.owner.witness.process_failure='lost'
        if self.finish is not None and self.clock>=self.finish:self.done=True
    def join(self,timeout):self.joins.append(timeout)
    def run(self,source=T):return stop_method(source,self.ns)(self.owner)

class ProposalControls(unittest.TestCase):
    def fixture(self,**kw):
        temporary=tempfile.TemporaryDirectory(prefix='nac-ax-ro-inert-');self.addCleanup(temporary.cleanup)
        return Fixture(Path(temporary.name).resolve(),**kw)
    def test_ui_failure_does_not_cancel_owned_readonly_helper(self):
        witness=SimpleNamespace(failure='app_windows',ui_failure='app_windows',process_failure=None)
        self.assertFalse(abort_function(T,witness)())
    def test_process_failure_still_aborts_even_behind_sticky_ui_failure(self):
        witness=SimpleNamespace(failure='app_windows',ui_failure='app_windows',process_failure='lost')
        self.assertTrue(abort_function(T,witness)())
    def test_other_ui_rejections_still_abort_companion(self):
        for failure in ('app_window_reappeared', 'app_window_changed', 'unknown_ui_failure'):
            self.assertTrue(abort_function(T,SimpleNamespace(process_failure=None,ui_failure=failure))())
    def test_healthy_helper_does_not_abort(self):
        self.assertFalse(abort_function(T,SimpleNamespace(process_failure=None,ui_failure=None))())
    def test_stop_allows_existing_owner_to_finish_before_stop_publication(self):
        f=self.fixture();proof=f.run()
        self.assertTrue(f.waits);self.assertTrue(f.done);self.assertFalse(any(f.stop_seen_during_wait))
        self.assertTrue(f.stop.exists());self.assertTrue(proof['owned_processes_settled'])
        self.assertAlmostEqual(f.clock+f.joins[0],20)
    def test_process_loss_during_grace_stops_waiting_at_next_poll(self):
        f=self.fixture(finish=None,process_at=.05);f.run()
        self.assertEqual(f.waits,[.05]);self.assertEqual(f.owner.witness.process_failure,'lost')
    def test_hung_diagnostic_does_not_extend_original_twenty_second_stop(self):
        f=self.fixture(finish=None);f.run()
        self.assertAlmostEqual(sum(f.waits),5);self.assertAlmostEqual(f.joins[0],15)
        self.assertLessEqual(max(f.waits),.05)
    def test_original_case_cutoff_bounds_grace(self):
        f=self.fixture(finish=None,case=.12);f.run()
        self.assertAlmostEqual(sum(f.waits),.12);self.assertAlmostEqual(f.joins[0],19.88)
    def test_no_grace_without_fifteen_second_teardown_reserve(self):
        f=self.fixture(cap=3,finish=None);f.run()
        self.assertEqual(f.waits,[]);self.assertEqual(f.joins,[3])
    def test_expired_real_cleanup_bound_still_publishes_stop_without_waiting(self):
        f = self.fixture(finish=None)
        clock = budget.PathBudget({'started_at_epoch': 1000., 'deadline_epoch': 2200.}, 2000.,
            monotonic=lambda: f.clock, wall=lambda: 1000. + f.clock)
        f.clock = clock.cleanup.deadline + 1
        f.ns['time_limit'] = budget.time_limit
        token = budget._ACTIVE.set(clock.cleanup)
        try:
            with self.assertRaises(budget.BudgetExpired):
                f.run()
        finally:
            budget._ACTIVE.reset(token)
        self.assertTrue(f.stop.exists())
        self.assertEqual(f.waits, [])
        self.assertEqual(f.joins, [0])
        self.assertIsNone(f.owner.settlement)

    def test_expired_stop_preserves_original_helper_error(self):
        from ci_startup_ax import AXCompanion
        primary = RuntimeError('inert primary helper failure')
        f = self.fixture(primary=primary)
        f.owner.ui_failure = None
        f.owner._stop = lambda: f.run()
        def expired(cap):
            raise budget.BudgetExpired('inert original cleanup cutoff')
        f.ns['time_limit'] = expired
        with self.assertRaises(RuntimeError) as raised:
            AXCompanion.stop(f.owner)
        self.assertIs(raised.exception, primary)
        self.assertIsInstance(raised.exception.__cause__, budget.BudgetExpired)
        self.assertTrue(f.stop.exists())
        self.assertEqual(f.joins, [0])

    def test_no_grace_for_other_failure_missing_identity_or_process_failure(self):
        for kw in ({'failure':None},{'failure':'app_window_reappeared'},{'process':'lost'},
                   {'identity':False},{'finished':True}):
            with self.subTest(kw=kw):
                f=self.fixture(**kw);f.run();self.assertEqual(f.waits,[])
    def test_positive_custody_does_not_replace_original_failure(self):
        primary=RuntimeError('inert original');f=self.fixture(primary=primary)
        with self.assertRaises(RuntimeError) as raised:f.run()
        self.assertIs(raised.exception,primary);self.assertTrue(f.owner.settlement['owned_processes_settled'])
    def test_unsettled_helper_still_denies_custody(self):
        f=self.fixture(alive=True)
        with self.assertRaises(RuntimeError):f.run()
        self.assertIsNone(f.owner.settlement)
    def test_unknown_or_invalid_owned_handle_never_gains_custody(self):
        for row in ({'accepted':False},{'reaped':False},{'drain_settled':False},{'unknown':True},
                    {'teardown_error':'lost'},{'pid':999},{'pid':True}):
            with self.subTest(row=row):
                f=self.fixture(custody=row)
                with self.assertRaises(RuntimeError):f.run()
                self.assertIsNone(f.owner.settlement)
    def test_input_abort_and_first_error_callers_are_untouched(self):
        source=(P/'ci_startup.py').read_text()
        self.assertIn('reason = witness.failure',source)
        self.assertLess(source.index('companion.stop()'),source.index('settled = witness.settle('))
        self.assertIn('errors[stage] = primary_error = error',source)
        self.assertIn('primary_error = primary_error or error',source)
    def test_swift_retained_reader_and_unconditional_fatal_exit_are_untouched(self):
        source=(P/'CIStartupAXWitness.swift').read_text()
        opening=source.index('if apps.count == 1, target.pid != 0,')
        fatal=source.index('throw OwnershipError.invalid // Original extra-CG-window refusal, always fatal.',opening)
        self.assertNotIn('publish(',source[opening:fatal])
        self.assertIn('pristine: refusals == 0 && retired == nil && !pairedAttempted && reader.failureData == nil',source)
        self.assertIn('try reader.observe(pid: target.pid, frame: frame)',source[opening:fatal])
        self.assertIn('&& ended < deadline && ended - began <= 1_000_000_000',source[opening:fatal])

if __name__ == "__main__":
    unittest.main()
