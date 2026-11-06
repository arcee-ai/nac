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
              const context = {URL, Request, Response, TextEncoder, Promise, TypeError,
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


if __name__ == '__main__':
    unittest.main()
