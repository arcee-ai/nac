"""Inert collector/embedded-JS controls; no HTTP, app or provider."""
import copy
import json
import subprocess
import textwrap
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
import storage_q1 as q1
from storage_q1 import q1_fetch_reads


class FetchReadWitnessControls(unittest.TestCase):
    def setUp(self):
        self.provider = 'http://127.0.0.1:18080'
        self.expected = dict(nonce='inert-launch-nonce', selector='exact-private-selector', endpoint='http://127.0.0.1:12001',
                             launch='launch', view='view', document='document')

    def snapshot(self):
        return dict(version=1, nonce=self.expected['nonce'], provider=self.provider, selector=self.expected['selector'],
                    engineOrigin=self.expected['endpoint'], started=2, settled=2, errors=0, cancelled=0, active=0, overflow=False,
                    document={k:self.expected[k] for k in ('launch','view','document')}, rows=[
            dict(sequence=1, method='GET', origin=self.expected['endpoint'], path='/sessions/a',
                 state='settled', status=200, error=False, metadata=None, cancellation=None),
            dict(sequence=2, method='POST', origin=self.expected['endpoint'], path='/providers/models',
                 state='settled', status=502, error=False, cancellation=None, metadata=dict(kind='fixture-provider-models',
                    canonicalJSON=True, exactKeys=True, backendFixture=True, namedFixtureKey=True,
                    noInlineKey=True, fixtureEndpoint=True, safeHTTPPolicy=True, exactRoute=True))])

    def check(self, snapshot):
        return q1_fetch_reads(snapshot,self.expected,self.provider)

    def test_exact_bound_metadata_502_is_read_evidence_not_success(self):
        snapshot=self.snapshot();before=copy.deepcopy(snapshot)
        result=self.check(snapshot)
        self.assertEqual(result['metadataFailures'],[dict(sequence=2,status=502)])
        self.assertFalse(result['metadataSuccessClaimed'])
        self.assertEqual(snapshot,before)

    def test_only_proven_same_engine_get_cancellation_can_explain_a_counted_rejection(self):
        snapshot = self.snapshot(); row = snapshot['rows'][0]
        snapshot.update(errors=1, cancelled=1)
        row.update(state='cancelled', status=None, error=True,
                   cancellation=dict(name='AbortError', signalObserved=True, signalAborted=True))
        result = self.check(snapshot)
        self.assertEqual(result['cancelledReads'], [dict(sequence=1, path='/sessions/a')])
        self.assertFalse(result['cancelledReadSuccessClaimed'])
        self.assertEqual(snapshot['errors'], 1)
        mutations = [lambda x: x.update(errors=0), lambda x: x.update(cancelled=True),
                     lambda x: x['rows'][0].update(method='POST'),
                     lambda x: x['rows'][0].update(origin='http://127.0.0.1:12002'),
                     lambda x: x['rows'][0].update(status=200), lambda x: x['rows'][0].update(error=False),
                     lambda x: x['rows'][0].update(state='error'),
                     lambda x: x['rows'][0]['cancellation'].update(name='TypeError'),
                     lambda x: x['rows'][0]['cancellation'].update(signalAborted=False),
                     lambda x: x['rows'][0]['cancellation'].update(signalObserved=1),
                     lambda x: x['rows'][0]['cancellation'].update(extra=True),
                     lambda x: x['rows'][0].update(cancellation=None)]
        for mutate in mutations:
            value = copy.deepcopy(snapshot); mutate(value)
            with self.assertRaises(ValueError): self.check(value)

    def test_legacy_49_completed_rows_and_path_only_502_remain_unqualified(self):
        legacy=[dict(method='GET',path='/sessions/a',status=200) for _ in range(48)]
        legacy.append(dict(method='POST',path='/providers/models',status=502))
        with self.assertRaises(ValueError):self.check(dict(rows=legacy))
        snapshot=self.snapshot();snapshot['rows'][1]['metadata']=None
        with self.assertRaises(ValueError):self.check(snapshot)

    def test_unknown_managed_foreign_inline_malformed_and_other_writes_rejected(self):
        for flag in ('canonicalJSON','exactKeys','backendFixture','namedFixtureKey','noInlineKey',
                     'fixtureEndpoint','safeHTTPPolicy','exactRoute'):
            snapshot=self.snapshot();snapshot['rows'][1]['metadata'][flag]=False
            with self.subTest(flag=flag),self.assertRaises(ValueError):self.check(snapshot)
        for change in (lambda r:r.update(method='PUT'),lambda r:r.update(method='DELETE'),
                       lambda r:r.update(path='/sessions/a/runs'),lambda r:r.update(path='/sessions/a/goal'),
                       lambda r:r.update(origin='https://foreign.invalid'),
                       lambda r:r['metadata'].update(kind='unknown'),
                       lambda r:r['metadata'].update(rawBody='must not be retained')):
            snapshot=self.snapshot();change(snapshot['rows'][1])
            with self.assertRaises(ValueError):self.check(snapshot)

    def test_inflight_rejected_overflow_missing_or_foreign_frame_cannot_pass(self):
        changes=[lambda x:x.update(active=1,settled=1),lambda x:x.update(errors=1),
                 lambda x:x.update(overflow=True),lambda x:x.update(started=3),
                 lambda x:x.update(settled=True),lambda x:x.update(nonce='old'),
                 lambda x:x.update(provider='https://api.openai.com/v1'),
                 lambda x:x.update(engineOrigin='http://127.0.0.1:12002'),
                 lambda x:x['document'].update(document='retired'),
                 lambda x:x['rows'][1].update(state='error',error=True,status=None),
                 lambda x:x['rows'][1].update(state='active',status=None),
                 lambda x:x['rows'][0].update(origin='https://foreign.invalid')]
        for change in changes:
            snapshot=self.snapshot();change(snapshot)
            with self.assertRaises(ValueError):self.check(snapshot)
        with self.assertRaises(ValueError):self.check(None)
        with self.assertRaises(ValueError):q1_fetch_reads(self.snapshot(),self.expected,'http://localhost:18080')

    def test_local_metadata_refusal_is_explicit_and_cannot_claim_dispatch_or_success(self):
        snapshot = self.snapshot(); row = snapshot['rows'][1]
        row['status'] = 503
        row['metadata'] = dict(kind='locally-blocked-provider-models', canonicalJSON=True,
                               exactKeys=True, noInlineKey=True, exactRoute=True, notForwarded=True)
        result = self.check(snapshot)
        self.assertEqual(result['locallyBlockedMetadata'], [dict(sequence=2, status=503)])
        self.assertEqual(result['metadataFailures'], [dict(sequence=2, status=503)])
        self.assertFalse(result['metadataSuccessClaimed'])
        for mutate in (lambda r: r.update(status=200), lambda r: r['metadata'].update(noInlineKey=False),
                       lambda r: r['metadata'].update(rawBody='forbidden'),
                       lambda r: r['metadata'].pop('notForwarded')):
            broken = copy.deepcopy(snapshot); mutate(broken['rows'][1])
            with self.assertRaises(ValueError): self.check(broken)

    def test_actual_embedded_collector_and_capture_under_deferred_fetches(self):
        source = Path(__file__).with_name('RecoverySmoke.swift').read_text()
        producer = source.split('return WKUserScript(source: #"""', 1)[1].split('"""#.replacingOccurrences', 1)[0]
        capture = source.split('private static let captureScript = #"""', 1)[1].split('"""#', 1)[0]
        configuration = dict(provider=self.provider, nonce=self.expected['nonce'], selector=self.expected['selector'])
        producer = producer.replace('__NAC_Q1_FETCH_CONFIGURATION__', json.dumps(configuration))
        program = 'const producer = ' + json.dumps(producer) + '; const capture = ' + json.dumps(capture) + ';\n'
        program += textwrap.dedent(r"""
            const assert = (await import('node:assert/strict')).default;
            const vm = await import('node:vm');
            function harness(script = producer) {
              const actual = [], pending = [];
              const context = {URL, Request, Response, TextEncoder, Promise, TypeError, DOMException, AbortSignal,
                location: {origin: 'http://127.0.0.1:12001', href: 'http://127.0.0.1:12001/', hash: '#/session/a/files'},
                document: {querySelector: () => ({getAttribute: () => 'native'})},
                __nacDesktopStorage: {open: async () => ({document: {launch: 'launch', view: 'view', document: 'document'}})},
                fetch: (input, init) => { actual.push([String(input), init]); return new Promise((resolve, reject) => pending.push({resolve, reject})); }};
              context.window = context; context.top = context;
              vm.createContext(context); vm.runInContext(script, context);
              const read = body => context.fetch('/providers/models', {method: 'POST', body: JSON.stringify(body)});
              const take = () => vm.runInContext('(async () => {' + capture + '})()', context);
              return {context, actual, pending, read, take};
            }
            const h = harness();
            for (const body of [{backend: 'arcee-auth'}, {backend: 'chatgpt-codex-responses'},
                {backend: 'openai-responses'}, {backend: 'arcee-api', base_url: 'https://foreign.invalid'},
                {backend: 'anthropic-messages', base_url: 'https://foreign.invalid', api_key_env: 'foreign-selector'}]) {
              assert.equal((await h.read(body)).status, 503);
            }
            assert.equal(h.actual.length, 0); // No external credential resolution or network.
            const bound = h.read({backend: 'openai-responses', base_url: 'http://127.0.0.1:18080', api_key_env: 'exact-private-selector'});
            assert.equal(h.actual.length, 1);
            let completed = false;
            const taking = h.take().then(value => { completed = true; return value; });
            await new Promise(setImmediate); // Finish bootstrap's microtask chain before the concurrent-capture probe.
            assert.equal(completed, false);
            const concurrent = await h.context.__nacRecoveryEvidence.q1SettledSnapshot().then(() => null, e => e);
            assert.ok(concurrent instanceof TypeError);
            h.pending.shift().resolve(new Response('{}', {status: 502}));
            await bound;
            const result = await taking;
            assert.equal(result.fetch.active, 0); assert.equal(result.fetch.errors, 0);
            assert.equal(result.fetch.started, 6); assert.equal(result.fetch.settled, 6);
            assert.equal(result.fetch.rows[5].metadata.kind, 'fixture-provider-models');
            assert.equal(result.fetch.rows[5].status, 502);
            assert.equal(JSON.stringify(result.fetch).includes('foreign-selector'), false);
            assert.equal(JSON.stringify(result.fetch).includes('foreign.invalid'), false);
            const failed = harness();
            const flight = failed.context.fetch('/sessions/a').catch(() => null);
            const failedCapture = failed.take(); await new Promise(setImmediate);
            failed.pending.shift().reject(new TypeError('inert failure'));
            await flight;
            const failedResult = await failedCapture;
            assert.equal(failedResult.fetch.active, 0); assert.equal(failedResult.fetch.errors, 1);
            assert.deepEqual(JSON.parse(JSON.stringify(failedResult.fetchErrors)),
              [{sequence: 1, name: 'TypeError', signalObserved: false, signalAborted: false}]);
            const aborted = harness(), cancellation = new AbortController();
            const abortedRead = aborted.context.fetch('/sessions/a', {signal: cancellation.signal}).catch(() => null);
            cancellation.abort();
            aborted.pending.shift().reject(new DOMException('do not copy exception text', 'AbortError'));
            await abortedRead;
            const abortedResult = await aborted.take();
            assert.equal(abortedResult.fetch.errors, 1); // Every rejection remains counted and rethrown.
            assert.equal(abortedResult.fetch.cancelled, 1);
            assert.equal(abortedResult.fetch.rows[0].state, 'cancelled');
            assert.deepEqual(JSON.parse(JSON.stringify(abortedResult.fetchErrors)),
              [{sequence: 1, name: 'AbortError', signalObserved: true, signalAborted: true}]);
            assert.equal(JSON.stringify(abortedResult).includes('do not copy exception text'), false);
            const override = harness();
            const requestWithSignal = new Request('http://127.0.0.1:12001/sessions/a', {signal: cancellation.signal});
            const overrideRead = override.context.fetch(requestWithSignal, {signal: null}).catch(() => null);
            override.pending.shift().reject(new TypeError('inert network failure'));
            await overrideRead;
            assert.deepEqual(JSON.parse(JSON.stringify((await override.take()).fetchErrors)),
              [{sequence: 1, name: 'TypeError', signalObserved: false, signalAborted: false}]);
            const denied = harness();
            const forbidden = [
              ['/sessions/a/runs', {method: 'POST', body: '{}'}],
              ['/providers/models', {method: 'POST', body: '{"backend":"arcee-auth","api_key":"secret"}'}],
              ['/providers/models?foreign=1', {method: 'POST', body: '{"backend":"arcee-auth"}'}],
              ['https://foreign.invalid/providers/models', {method: 'POST', body: '{"backend":"arcee-auth"}'}],
              ['/providers/models', {method: 'POST', body: '{"backend":"unknown"}'}],
              ['/providers/models', {method: 'POST', body: '{"backend":"arcee-auth","extra":true}'}],
              ['/providers/models', {method: 'POST', body: '{"backend":"arcee-auth","allow_insecure_http":true}'}],
              ['/providers/models', {method: 'POST', body: '{"backend":"arcee-auth","backend":"arcee-api"}'}],
              ['/providers/models', {method: 'POST', body: 'not-json'}]];
            for (const [input, init] of forbidden) {
              await assert.rejects(denied.context.fetch(input, init));
            }
            assert.equal(denied.actual.length, 0);
            assert.equal(denied.context.__nacRecoveryEvidence.q1Snapshot().errors, forbidden.length);
            assert.equal(JSON.stringify(denied.context.__nacRecoveryEvidence.q1Snapshot()).includes('secret'), false);
            const overflow = harness();
            for (let i = 0; i < 129; i++) await overflow.read({backend: 'arcee-auth'});
            assert.equal(overflow.actual.length, 0);
            assert.equal(overflow.context.__nacRecoveryEvidence.q1Snapshot().overflow, true);
            const overflowResult = await overflow.take();
            const legacy = harness(producer.replace(/const q1 = .*?, engineOrigin = location.origin;/,
              'const q1 = null, engineOrigin = location.origin;'));
            const legacyFlight = legacy.context.fetch('/sessions/a/user-commands', {method: 'POST', body: '{}'});
            assert.equal(legacy.actual.length, 1);
            legacy.pending.shift().resolve(new Response('{}', {status: 200})); await legacyFlight;
            assert.equal(legacy.context.__nacRecoveryEvidence.q1Snapshot, undefined);
            legacy.context.__nacRecoveryEvidence.dropCommandResponse();
            const dropped = legacy.context.fetch('/sessions/a/user-commands', {method: 'POST', body: '{}'});
            legacy.pending.shift().resolve(new Response('{}', {status: 200}));
            await assert.rejects(dropped);
            assert.equal(legacy.actual.length, 2);
            process.stdout.write(JSON.stringify({snapshot: result.fetch, failed: failedResult.fetch, overflow: overflowResult.fetch}));
        """)
        result = subprocess.run(['node', '--input-type=module'], input=program, text=True,
                                capture_output=True, timeout=8, check=False)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        actual = json.loads(result.stdout)
        qualified = self.check(actual['snapshot'])
        self.assertEqual(len(qualified['locallyBlockedMetadata']), 5)
        self.assertEqual(qualified['metadataFailures'][-1], dict(sequence=6, status=502))
        with self.assertRaises(ValueError): self.check(actual['failed'])
        with self.assertRaises(ValueError): self.check(actual['overflow'])

    def test_swift_producer_contract_redacts_and_tracks_before_await_q1_only(self):
        source=Path(__file__).with_name('RecoverySmoke.swift').read_text()
        admission=source.index('started += 1; active += 1;')
        actual=source.index('await actual(input, init);')
        self.assertLess(admission,actual)
        self.assertLess(source.index('Q1 rejected an unproven outbound operation'), actual)
        # Actual embedded-script controls above verify rejection accounting and
        # distinguish cancellation without matching the producer's syntax.
        self.assertIn('if (row) active -= 1',source)
        self.assertIn('if (fetchRows.length < 128)',source)
        self.assertIn("q1Snapshot: q1 ?",source)
        self.assertIn("JSON.stringify(body) === text",source)
        self.assertIn("body.api_key_env === q1.selector",source)
        self.assertIn("body.base_url === q1.provider",source)
        self.assertIn("body.backend === 'openai-responses'",source)
        self.assertNotIn('row.body =',source)
        self.assertNotIn('row.headers =',source)
        self.assertIn("drop && method === 'POST' && path.endsWith('/user-commands') && response.ok",source)
        self.assertIn('"--storage-q1-fetch-provider", "--storage-q1-fetch-nonce"',source)


class SavedFixtureConfigurationControls(unittest.TestCase):
    def record(self):
        return dict(config_id='owned-config', name='Disposable Q1 fixed', backend='openai-responses',
                    model='gpt-5.6-sol', base_url='http://127.0.0.1:18080', allow_insecure_http=False,
                    api_key_env='exact-generated-selector')

    def test_supported_create_and_exact_readback_bind_only_returned_selector(self):
        record=self.record();request=Mock(side_effect=[record,dict(configurations=[record])])
        with patch.object(q1,'request',request),patch.object(q1.uuid,'uuid4',return_value='fixed'),             patch.object(q1.time,'monotonic',return_value=0):
            result=q1.seed_q1_configuration('http://127.0.0.1:12001',record['base_url'],
                                           dict(OPENAI_API_KEY='fixed-dummy-value'),4)
        self.assertEqual(result,record)
        self.assertEqual(request.call_args_list[0].args[2]['api_key'],'fixed-dummy-value')
        self.assertEqual(result['api_key_env'],'exact-generated-selector')
        self.assertNotIn('api_key',result)

    def test_foreign_managed_inline_or_changed_readback_is_rejected(self):
        for change in (dict(base_url='https://foreign.invalid'),dict(backend='codex-auth'),
                       dict(api_key='must-not-appear'),dict(api_key_env=None)):
            record=self.record();record.update(change)
            with patch.object(q1,'request',return_value=record),                 patch.object(q1.uuid,'uuid4',return_value='fixed'),                 patch.object(q1.time,'monotonic',return_value=0),self.assertRaises(ValueError):
                q1.seed_q1_configuration('http://127.0.0.1:12001','http://127.0.0.1:18080',
                                        dict(OPENAI_API_KEY='dummy'),4)
        record=self.record();other=dict(record,api_key_env='another-selector')
        with patch.object(q1,'request',side_effect=[record,dict(configurations=[other])]),             patch.object(q1.uuid,'uuid4',return_value='fixed'),             patch.object(q1.time,'monotonic',return_value=0),self.assertRaises(ValueError):
            q1.seed_q1_configuration('http://127.0.0.1:12001',record['base_url'],dict(OPENAI_API_KEY='dummy'),4)

    def test_expired_original_seed_barrier_does_not_send_request(self):
        request=Mock()
        with patch.object(q1,'request',request),patch.object(q1.time,'monotonic',return_value=5),             self.assertRaises(TimeoutError):
            q1.seed_q1_configuration('http://127.0.0.1:12001','http://127.0.0.1:18080',
                                    dict(OPENAI_API_KEY='dummy'),4)
        request.assert_not_called()


if __name__ == '__main__': unittest.main()
