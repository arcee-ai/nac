"""Execute the exact smoke fixture JavaScript with inert DOM/style adapters."""
import json
from pathlib import Path
import re
import subprocess
import unittest


class CaptureReadinessTests(unittest.TestCase):
    def test_exact_fixture_rejects_loading_and_revalidates_paint(self):
        source = Path(__file__).with_name('PreviewSmoke.swift').read_text()
        script = source.split('private static let captureReadiness = #"""', 1)[1].split('"""#', 1)[0]
        old = re.search(r'waitJS\("persisted transcript after reload", "(.*?)"\)', source)[1]
        control = r"""
        import assert from 'node:assert/strict';
        let input = '';
        for await (const chunk of process.stdin) input += chunk;
        const {script, old} = JSON.parse(input);
        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
        const run = new AsyncFunction('phase','expectedSession','expectedOrigin',
          'expectedAnswer','documentToken', script);
        const legacy = new Function(old);
        const answer = 'Hello from the isolated NAC Mac preview.';
        class Element {
          constructor(text = '', parent = null) {
            this.textContent = text; this.parentElement = parent; this.isConnected = true;
            this.style = {display:'block', visibility:'visible', opacity:'1'};
            this.rect = {left:10, top:10, right:110, bottom:40, width:100, height:30};
          }
          getBoundingClientRect() { return this.rect; }
          contains(node) {
            for (let current = node; current; current = current.parentElement)
              if (current === this) return true;
            return false;
          }
        }
        globalThis.Element = Element;
        function fixture() {
          const body = new Element(); body.innerText = answer;
          const transcript = new Element('', body), composer = new Element('', body);
          const message = new Element(answer, transcript), field = new Element('', composer);
          const state = {body, transcript, composer, message, field, answers:[message],
            inputs:[field], loaders:[], frames:[]};
          const fonts = {status:'loaded', ready:Promise.resolve(),
            load:() => Promise.resolve([]), check:() => true};
          const document = {body, fonts, querySelectorAll(selector) {
            if (selector === 'p') return state.answers;
            if (selector.startsWith('[role=combobox]')) return state.inputs;
            if (selector.startsWith('[role=status]')) return state.loaders;
            throw new Error('Unexpected fixture query: ' + selector);
          }};
          Object.assign(globalThis, {window:{}, document,
            location:{origin:'http://127.0.0.1:47111', hash:'#/session/fixture/insights',
              href:'http://127.0.0.1:47111/#/session/fixture/insights'},
            innerWidth:1280, innerHeight:800,
            getComputedStyle:element => element.style,
            requestAnimationFrame:callback => { state.frames.push(callback); return state.frames.length; }});
          state.call = phase => run(phase, 'fixture', 'http://127.0.0.1:47111/', answer, 'owned-document');
          state.bind = async () => {
            await state.call('bind'); await Promise.resolve(); await Promise.resolve();
          };
          state.frame = () => { const callbacks = state.frames.splice(0); callbacks.forEach(fn => fn()); };
          state.settled = async () => {
            const pending = await state.call('probe');
            assert.equal(pending.reason, 'frames'); state.frame(); state.frame();
            return state.call('probe');
          };
          return state;
        }
        const passed = [];
        let state = fixture();
        state.loaders.push(new Element('', state.transcript)); await state.bind();
        assert.equal(legacy(), true, 'Exact old text-only predicate accepts loading content');
        assert.deepEqual(await state.call('probe'), {ready:false, reason:'loading'});
        passed.push('old-text-only-accepts-loader/new-rejects');
        state = fixture(); state.transcript.style.opacity = '0.2'; await state.bind();
        assert.equal(legacy(), true); assert.equal((await state.call('probe')).reason, 'layout');
        passed.push('old-text-only-accepts-fade/new-rejects');
        for (const [name, change] of [
          ['hidden', s => s.message.style.visibility = 'hidden'],
          ['display-none', s => s.composer.style.display = 'none'],
          ['zero-rect', s => s.message.rect.width = 0],
          ['nonfinite-rect', s => s.message.rect.top = NaN],
          ['offscreen', s => Object.assign(s.field.rect, {left:1300, right:1400})],
        ]) {
          state = fixture(); change(state); await state.bind();
          assert.equal((await state.call('probe')).reason, 'layout', name); passed.push(name);
        }
        state = fixture(); state.answers.push(new Element(answer, state.transcript)); await state.bind();
        assert.equal((await state.call('probe')).reason, 'content'); passed.push('ambiguous-answer');
        for (const [name, change] of [
          ['stale-token', () => window.__previewCapture.token = 'stale'],
          ['wrong-session', () => location.hash = '#/session/foreign/insights'],
          ['wrong-origin', () => location.origin = 'http://127.0.0.1:47112'],
          ['replaced-document', () => globalThis.document = {...document}],
        ]) {
          state = fixture(); await state.bind(); change();
          assert.equal((await state.call('probe')).reason, 'document', name); passed.push(name);
        }
        state = fixture(); await state.bind(); document.fonts.status = 'loading';
        assert.equal((await state.call('probe')).reason, 'fonts'); passed.push('fonts-loading');
        state = fixture(); await state.bind(); document.fonts.check = () => false;
        assert.equal((await state.call('probe')).reason, 'fonts'); passed.push('Inter-unavailable');
        state = fixture(); await state.bind(); window.__previewCapture.fontsReady = false;
        assert.equal((await state.call('probe')).reason, 'fonts'); passed.push('font-promise-pending');
        state = fixture(); await state.bind();
        assert.equal((await state.call('probe')).reason, 'frames');
        state.frame(); window.__previewCapture.token = 'replaced-after-first-frame'; state.frame();
        assert.equal((await state.call('probe')).reason, 'document'); passed.push('post-frame-binding-loss');
        state = fixture(); await state.bind();
        assert.equal((await state.call('probe')).reason, 'frames');
        state.frame(); state.transcript.style.opacity = '0.5'; state.frame();
        assert.equal((await state.call('probe')).reason, 'layout'); passed.push('post-frame-layout-loss');
        state = fixture(); await state.bind();
        assert.deepEqual(await state.settled(), {ready:true, reason:'settled'});
        passed.push('semantic-font-layout-two-frame-positive');
        state = fixture(); state.loaders.push(new Element('', new Element('', state.body)));
        await state.bind(); assert.equal((await state.settled()).ready, true);
        passed.push('unrelated-loader-does-not-block-owned-transcript');
        console.log(JSON.stringify({passed, count:passed.length, nativeAcceptance:false}));
        """
        result = subprocess.run(['node', '--input-type=module', '-e', control],
                                input=json.dumps({'script': script, 'old': old}),
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        facts = json.loads(result.stdout)
        self.assertEqual(facts['count'], 19)
        self.assertFalse(facts['nativeAcceptance'])


if __name__ == '__main__':
    unittest.main()
