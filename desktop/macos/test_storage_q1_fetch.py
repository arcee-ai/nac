"""Inert collector/producer-contract controls; no JS engine, HTTP, app or provider."""
import copy
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
                    engineOrigin=self.expected['endpoint'], started=2, settled=2, errors=0, active=0, overflow=False,
                    document={k:self.expected[k] for k in ('launch','view','document')}, rows=[
            dict(sequence=1, method='GET', origin=self.expected['endpoint'], path='/sessions/a',
                 state='settled', status=200, error=False, metadata=None),
            dict(sequence=2, method='POST', origin=self.expected['endpoint'], path='/providers/models',
                 state='settled', status=502, error=False, metadata=dict(kind='fixture-provider-models',
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

    def test_swift_producer_contract_redacts_and_tracks_before_await_q1_only(self):
        source=Path(__file__).with_name('RecoverySmoke.swift').read_text()
        admission=source.index('started += 1; active += 1;')
        actual=source.index('const response = await actual(input, init);')
        self.assertLess(admission,actual)
        self.assertLess(source.index('Q1 rejected an unproven outbound operation'), actual)
        self.assertIn("row.state = 'error'; row.error = true; errors += 1",source)
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
