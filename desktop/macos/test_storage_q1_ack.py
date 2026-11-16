"""Actual embedded Q1 post/ACK reducer under inert, delayed native messages."""
import json
from pathlib import Path
import subprocess
import textwrap
import unittest


class FinalDraftAcknowledgementControls(unittest.TestCase):
    def test_actual_post_sequence_and_exact_durable_ack_are_both_required(self):
        source = Path(__file__).with_name('RecoverySmoke.swift').read_text()
        producer = source.split('return WKUserScript(source: #"""', 1)[1].split('"""#.replacingOccurrences', 1)[0]
        producer = producer.replace('__NAC_Q1_FETCH_CONFIGURATION__', json.dumps(dict(
            provider='http://127.0.0.1:18080', nonce='inert', selector='private-inert')))
        script = source.split('private static let storageQ1Script = #"""', 1)[1].split('"""#', 1)[0]
        waiter = script.split('    const acks = [];', 1)[1].split('    const input =', 1)[0]
        waiter = 'const acks = [];' + waiter
        program = 'const producer=' + json.dumps(producer) + '; const waiter=' + json.dumps(waiter) + ';\n'
        program += textwrap.dedent(r"""
            import assert from 'node:assert/strict';
            import vm from 'node:vm';
            const expected = {launch: 'launch', view: 'view', document: 'document'};
            const plan = {a: 'a', b: 'b'};
            const pause = () => new Promise(setImmediate);
            function harness() {
              const context = {URL, Request, Response, TextEncoder, Promise, TypeError, DOMException, AbortSignal,
                location: {origin: 'http://127.0.0.1:12001'}, fetch: () => { throw Error('No HTTP'); }};
              context.window = context; context.top = context;
              vm.createContext(context); vm.runInContext(producer, context);
              let receive;
              const port = {subscribe(callback) { receive = callback; return () => {}; }};
              const check = (value, message) => { if (!value) throw Error(message); };
              const same = value => value && Object.keys(expected).every(key => value[key] === expected[key]);
              let stopped = false;
              const until = async predicate => {
                for (let n = 0; n < 100 && !stopped; ++n) {
                  const value = predicate(); if (value) return value; await pause();
                }
                throw Error('Original bounded observation expired');
              };
              const methods = new Function('window', 'port', 'check', 'same', 'until', 'plan',
                waiter + '; return {latestWrite, awaitDraft};')(context, port, check, same, until, plan);
              const post = (sequence, drafts, document = expected) =>
                context.__nacRecoveryEvidence.q1StoragePost({...document, kind: 'write', namespace: 'drafts',
                  sequence, value: JSON.stringify({drafts})});
              const ack = (sequence, durable = true, document = expected) => receive({sequence, durable, document});
              return {...methods, post, ack, stop: () => { stopped = true; }, context};
            }
            const h = harness(); let done = false;
            const waiting = h.awaitDraft('b', '', 3).then(() => { done = true; });
            h.ack(4); await pause(); assert.equal(done, false); // No matching post.
            h.post(4, [['a', 'A'], ['b', 'still present']]); await pause(); assert.equal(done, false);
            h.post(5, [['a', 'A']]); h.ack(6); await pause(); assert.equal(done, false); // Unrelated ACK.
            h.ack(5, true, {...expected, document: 'old'}); await pause(); assert.equal(done, false);
            h.ack(5); await waiting; assert.equal(done, true);
            const cold = harness(); let cleared = false;
            const clear = cold.awaitDraft('a', '', 0).then(() => { cleared = true; });
            // Clearing newly typed text preserves the original cold review.
            // That unreviewed tuple is not a live composer draft.
            cold.post(1, [['a', 'fresh'], ['a', 'A', 'unreviewed']]); cold.ack(1);
            await pause(); assert.equal(cleared, false);
            cold.post(2, [['a', 'A', 'unreviewed']]); await pause();
            assert.equal(cleared, false); // The clear's exact ACK is still required.
            cold.ack(2); await clear; assert.equal(cleared, true);
            const delayed = harness(); delayed.post(1, [['a', 'old']]);
            const after = delayed.latestWrite(); let restored = false;
            const restore = delayed.awaitDraft('a', 'A', after).then(() => { restored = true; });
            delayed.post(2, [['a', 'A', 'unreviewed']]); delayed.ack(2); await pause();
            assert.equal(restored, false); // Old review is not the restored composer write.
            delayed.post(3, [['a', 'A']]); await pause(); assert.equal(restored, false);
            delayed.ack(3); await restore;
            const failed = harness(); failed.post(1, [['a', 'A']]); failed.ack(1, false);
            await assert.rejects(failed.awaitDraft('a', 'A', 0), /acknowledgement failed/);
            const missing = harness(); const missingResult = missing.awaitDraft('a', 'A', 0);
            missing.stop(); await assert.rejects(missingResult, /bounded observation expired/);
            const overflow = harness(); overflow.post(1, Array(3).fill(['a', 'A']));
            await assert.rejects(overflow.awaitDraft('a', 'A', 0), /overflow/);
            console.log('exact delayed post + matching durable ACK controls passed');
        """)
        result = subprocess.run(['node', '--input-type=module', '-e', program], capture_output=True,
                                text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)


    def test_native_live_row_and_actual_ui_predicate_distinguish_cold_recovery(self):
        import re
        import tempfile
        source = Path(__file__).with_name('RecoverySmoke.swift').read_text()
        start = source.index('fact["bPresent"] = rows.contains {')
        opening = source.index('{', start)
        depth = 1
        closing = opening + 1
        while depth:
            if source[closing] == '{': depth += 1
            if source[closing] == '}': depth -= 1
            closing += 1
        predicate = source[opening + 1:closing - 1]
        cases = [
            dict(name='live', rows=[['b', 'B']], native=True, ui=True),
            dict(name='cold-review', rows=[['b', 'B', 'unreviewed']], native=False, ui=False),
            dict(name='live-a-cold-b', rows=[['a', 'A'], ['b', 'B', 'unreviewed']], native=False, ui=False),
            dict(name='empty', rows=[], native=False, ui=False),
            dict(name='absent', rows=None, native=None, ui=False),
            dict(name='malformed-row', rows=[None], native=None, ui=False),
            dict(name='missing-text', rows=[['b']], native=False, ui=False),
            dict(name='wrong-id', rows=[['a', 'B']], native=False, ui=False),
            dict(name='wrong-text-type', rows=[['b', 7]], native=False, ui=False),
            dict(name='empty-text', rows=[['b', '']], native=False, ui=False),
            dict(name='extra-field', rows=[['b', 'B', 'unreviewed', 'extra']], native=False, ui=False),
            dict(name='different-live-text', rows=[['b', 'other']], native=True, ui=False),
            dict(name='wrong-id-type', rows=[[7, 'B']], native=False, ui=False),
            dict(name='not-array', rows={'b': 'B'}, native=None, ui=False),
        ]
        # Execute the actual Swift collector closure, not a translated JS copy.
        program = '''import Foundation
        @main enum Controls {
          static func main() throws {
            let cases = try JSONSerialization.jsonObject(with: Data(#"__DATA__"#.utf8)) as! [[String: Any]]
            let sessionB = "b"
            let results: [Any] = cases.map { item in
              guard let rows = item["rows"] as? [[Any]] else { return NSNull() }
              return rows.contains { __PREDICATE__ }
            }
            let bytes = try JSONSerialization.data(withJSONObject: results)
            print(String(decoding: bytes, as: UTF8.self))
          }
        }'''.replace('__DATA__', json.dumps(cases)).replace('__PREDICATE__', predicate)
        with tempfile.TemporaryDirectory(prefix='nac-q1-live-row-inert-') as temporary:
            swift, binary = Path(temporary) / 'Controls.swift', Path(temporary) / 'controls'
            swift.write_text(program)
            built = subprocess.run(['xcrun', 'swiftc', '-swift-version', '5', '-target',
                                    'arm64-apple-macosx14.0', '-parse-as-library', str(swift), '-o', str(binary)],
                                   capture_output=True, text=True, timeout=60)
            self.assertEqual(built.returncode, 0, built.stdout + built.stderr)
            actual = subprocess.run([str(binary)], capture_output=True, text=True, timeout=10)
            self.assertEqual(actual.returncode, 0, actual.stdout + actual.stderr)
            self.assertEqual(json.loads(actual.stdout), [c['native'] for c in cases])
        script = source.split('private static let storageQ1Script = #"""', 1)[1].split('"""#', 1)[0]
        matched = re.search(r'posts\(\)\.find\(row => ([\s\S]*?)\)\);', script)
        self.assertIsNotNone(matched)
        # The live-presence witness accepts any nonempty text. The UI content
        # oracle additionally requires the expected value, tested separately.
        js = '''const actual = new Function('row','after','plan','id','text', 'return ('+__PREDICATE__+');');
        const cases=__DATA__;
        const result=cases.map(c=>{try{return actual({sequence:1,drafts:c.rows},0,{a:'a',b:'b'},'b','B')===true;}catch{return false;}});
        console.log(JSON.stringify(result));'''.replace('__PREDICATE__', json.dumps(matched.group(1))).replace('__DATA__', json.dumps(cases))
        actual = subprocess.run(['node', '-e', js], capture_output=True, text=True, timeout=10)
        self.assertEqual(actual.returncode, 0, actual.stdout + actual.stderr)
        self.assertEqual(json.loads(actual.stdout), [c['ui'] for c in cases])


if __name__ == '__main__':
    unittest.main()
