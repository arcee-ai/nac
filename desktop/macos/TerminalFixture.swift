#if PREVIEW_SMOKE && TERMINAL_SMOKE
import Foundation

/// Output comes from the owned shell's startup file, never an input API. Files
/// rendezvous with the fixture driver; neither source supplies human authority.
enum TerminalFixture {
    // Fixed, harmless fixture operations. External drivers must compare these
    // with their nominated contract; readiness never accepts caller commands.
    static let unicode = "Ω中🙂"
    static let unicodeCommand = "printf '%s' 'Ω中🙂' > wk-xctest-unicode.txt; printf 'WK-XCTEST-%s: ' UNICODE; cat wk-xctest-unicode.txt; printf '\\n'"
    static let interruptCommand = "trap 'printf INT > wk-xctest-int.txt; printf \"WK-XCTEST-%s\\n\" INTERRUPTED' INT; printf RUNNING > wk-xctest-running.txt; printf 'WK-XCTEST-%s\\n' RUNNING; /bin/sleep 30; printf '%s' \"$?\" > wk-xctest-status.txt"
    static let recoveryCommand = "trap - INT; printf RECOVERED > wk-xctest-recovered.txt; printf 'WK-XCTEST-%s\\n' RECOVERED"
    static let sizeCommand = "/bin/stty size > wk-xctest-size.txt; printf 'WK-XCTEST-%s\\n' SIZE"

    static let bashrc = #"""
    export PS1='WK-SHELL> '
    export HISTFILE=/dev/null
    wk352_wait() {
      local count=0
      while [ ! -f "$1" ] && [ "$count" -lt 400 ]; do
        /bin/sleep .05
        count=$((count+1))
      done
      [ -f "$1" ] || { printf 'WK-FIXTURE-RENDEZVOUS-TIMEOUT\r\n'; return 1; }
      /bin/rm "$1"
    }
    printf '\033[2J\033[HWK-UTF8-SPLIT-READY\r\nWK-UNICODE: \316'
    wk352_wait wk-unicode-continue || return
    printf '\251\344\270\255\360\237\231\202\r\n'
    printf 'WK-CSI-SPLIT-READY\r\n\033['
    wk352_wait wk-csi-continue || return
    printf '31mWK-CSI-JOINED\033[0m\r\n'
    unset -f wk352_wait
    printf 'WK-SPLIT:literal-'
    /bin/sleep .05
    printf 'fixture-only\r\n'
    printf '\033]52;c;V0stT1NDLUNMSVBCT0FSRA==\007WK-OSC-DONE\r\n'
    printf '\033[6n\033[c'
    /bin/stty size > wk-initial-size.txt
    (
      while :; do
        if [ -f wk-alternate ]; then
          /bin/rm wk-alternate
          printf '\033[?1049h\033[2J\033[HWK-ALT-SCREEN\r\n'
          : > wk-alternate.done
        fi
        if [ -f wk-normal ]; then
          /bin/rm wk-normal
          printf '\033[?1049lWK-NORMAL-SCREEN\r\n'
          : > wk-normal.done
        fi
        if [ -f wk-overflow ]; then
          /bin/rm wk-overflow
          /usr/bin/head -c 12582912 /dev/zero
          printf '\r\nWK-RETAINED-TAIL\r\n'
          : > wk-overflow.done
        fi
        /bin/sleep .1
      done
    ) &
    """#

    // Content-free bounded observation. No request is replayed, no response is
    // replaced, no input gate is patched. We do not keep typed/pasted text.
    static let observer = #"""
    window.__terminal352 = {inputPosts:0, inputBytes:0, inputSettled:0, inputWritten:0,
      trustedEvents:0, syntheticEvents:0, trustedKeys:0, syntheticKeys:0,
      controls:0, gapFrames:0, resetAcks:0, maxFrameBytes:0, markerReceipts:{}, frames:[], events:[], clipboardWrites:0};
    const evidence = window.__terminal352;
    const markerNames=['WK-UTF8-SPLIT-READY','WK-CSI-SPLIT-READY','WK-OSC-DONE',
      'WK-ALT-SCREEN','WK-NORMAL-SCREEN','WK-RETAINED-TAIL',
      'WK-XCTEST-UNICODE: Ω中🙂','WK-XCTEST-RUNNING','WK-XCTEST-INTERRUPTED',
      'WK-XCTEST-RECOVERED','WK-XCTEST-SIZE'];
    const tails=new Map();
    const decoders=new Map();
    const acceptedAcks=new Map();
    const push = (name, row) => { const list=evidence[name]; list.push(row); if(list.length>128) list.shift(); };
    for(const type of ['keydown','paste','compositionstart','compositionend','input']) {
      document.addEventListener(type, event => {
        if(event.target?.classList?.contains('xterm-helper-textarea')) {
          evidence[event.isTrusted?'trustedEvents':'syntheticEvents']++;
          if(type==='keydown') evidence[event.isTrusted?'trustedKeys':'syntheticKeys']++;
          push('events',{type, trusted:event.isTrusted, composing:!!event.isComposing});
        }
      },true);
    }
    const nativeFetch=window.fetch;
    window.fetch=function(resource,options) {
      const path=new URL(typeof resource==='string'?resource:resource.url,location.href).pathname;
      let body; try { body=JSON.parse(options?.body || '{}'); } catch {}
      if(path.endsWith('/input') && options?.method==='POST') {
        evidence.inputPosts++; evidence.inputBytes+=(body?.bytes?.length || 0);
      }
      if(path.endsWith('/input-control') && options?.method==='POST') evidence.controls++;
      const result=nativeFetch.apply(this,arguments);
      if(path.endsWith('/input') && options?.method==='POST') result.then(async response=>{
        const receipt=await response.clone().json();
        if(response.ok && receipt.outcome==='written') evidence.inputWritten++;
      }).catch(()=>{}).finally(()=>{evidence.inputSettled++;});
      if(path.includes('/observers/') && path.endsWith('/read')) result.then(async response=>{
        if(!response.ok) return;
        const observer=path.match(/\/observers\/([^/]+)\/read$/)?.[1];
        if(observer && body?.acknowledge_offset) {
          acceptedAcks.set(observer,body.acknowledge_offset);
          if(acceptedAcks.size>16) acceptedAcks.delete(acceptedAcks.keys().next().value);
        }
        for(const receipt of Object.values(evidence.markerReceipts)) {
          if(receipt.observer===observer && body?.acknowledge_offset &&
             BigInt(body.acknowledge_offset)>=BigInt(receipt.cursor))
            receipt.acknowledged=true;
        }
        const frame=await response.clone().json();
        if(frame.gap) evidence.gapFrames++;
        if(body?.acknowledge_reset) evidence.resetAcks++;
        evidence.maxFrameBytes=Math.max(evidence.maxFrameBytes,frame.bytes?.length || 0);
        if(frame.gap) { tails.delete(frame.observer_id); decoders.delete(frame.observer_id); }
        if(frame.bytes?.length) {
          let decoder=decoders.get(frame.observer_id);
          if(!decoder) {
            decoder=new TextDecoder(); decoders.set(frame.observer_id,decoder);
            if(decoders.size>16) decoders.delete(decoders.keys().next().value);
          }
          const text=(tails.get(frame.observer_id)||'')+decoder.decode(new Uint8Array(frame.bytes),{stream:true});
          for(const marker of markerNames) if(text.includes(marker)) evidence.markerReceipts[marker]={
            observer:frame.observer_id,cursor:frame.next_offset,
            acknowledged:acceptedAcks.has(frame.observer_id) &&
              BigInt(acceptedAcks.get(frame.observer_id))>=BigInt(frame.next_offset)};
          // A bounded transient prefix joins fixture markers across pages. No
          // output text, key data or prefix is copied into the evidence record.
          tails.set(frame.observer_id,text.slice(-64));
          if(tails.size>16) tails.delete(tails.keys().next().value);
        }
        push('frames',{gap:frame.gap, bytes:frame.bytes?.length || 0, caught_up:frame.caught_up,
          requires_ack:frame.requires_ack, cursor:frame.next_offset, acknowledge_reset:!!body?.acknowledge_reset});
      }).catch(()=>{});
      return result;
    };
    // Suppress any attempted write in this output-only fixture. Record calls
    // without touching clipboard representations, even if OSC policy regresses.
    if(navigator.clipboard?.writeText) {
      navigator.clipboard.writeText=async function() { evidence.clipboardWrites++; };
    }
    return true;
    """#
}
#endif
