#if PREVIEW_SMOKE && TERMINAL_SMOKE
import Foundation

/// Output comes from the owned shell's startup file, never an input API. Files
/// rendezvous with the fixture driver; neither source supplies human authority.
enum TerminalFixture {
    static func inputReference(command: String?, expectedBytes: Int) -> [UInt8] {
        if let command { return Array(command.utf8) + [13] }
        return expectedBytes == 1 ? [3] : []
    }
    /// Passive native snapshots; this value never decides admission or expiry.
    final class PhaseEvidence {
        static func now() -> UInt64 { DispatchTime.now().uptimeNanoseconds }
        let identity: [String: String]
        let timing: [String: Any]
        private(set) var predicates: [String: String] = [:]
        private var baseline: [String: Any] = [:]
        private var latest: [String: Any] = [:]
        private var sampled: UInt64?
        private var readyReturned: UInt64?
        private var readyEmitted: UInt64?
        private var sealed: [String: Any]?
        private var terminal: [String: Any] = [:]
        private var output: [String: Any] = [:]
        private var projectionCalls = 0
        private var projectionTotal: UInt64 = 0
        private var projectionMax: UInt64 = 0

        init(identity: [String: String], whole: (UInt64, UInt64), phase: (UInt64, UInt64),
             seconds: Double, wallDeadline: Date, wholeDeadline: Date) {
            self.identity = identity
            for key in ["target", "console", "focus", "controller", "proof", "transport_settled", "marker_ack",
                        "current_screen", "deadline", "exact_bytes_written_trust", "file_unicode", "file_int",
                        "file_running", "file_status", "file_recovered", "file_size"] { predicates[key] = "not-evaluated" }
            let duration = UInt64(seconds * 1_000_000_000)
            timing = ["clock": "dispatch-uptime-ns", "whole_start_lower_ns": String(whole.0),
                "whole_start_upper_ns": String(whole.1), "whole_nominal_deadline_ns": String(whole.1 + 240_000_000_000),
                "whole_nominal_deadline_lower_ns": String(whole.0 + 240_000_000_000),
                "phase_start_lower_ns": String(phase.0), "phase_start_upper_ns": String(phase.1),
                "phase_nominal_deadline_ns": String(phase.1 + duration), "seconds_limit": seconds,
                "phase_nominal_deadline_lower_ns": String(phase.0 + duration),
                "wall_deadline_epoch_ms": wallDeadline.timeIntervalSince1970 * 1000,
                "whole_wall_deadline_epoch_ms": wholeDeadline.timeIntervalSince1970 * 1000]
        }

        func predicate(_ name: String, _ state: String) {
            guard sealed == nil, predicates[name] != nil,
                  ["sampling", "true", "false", "not-evaluated", "absent", "exact", "mismatch", "valid-unchecked"].contains(state) else { return }
            predicates[name] = state
        }

        func terminalState(_ source: [String: Any]) {
            guard sealed == nil else { return }
            var value: [String: Any] = ["observed_ns": String(Self.now()),
                "terminal_matches": source["terminal_id"] as? String == identity["terminal_id"]]
            for key in ["alive", "frozen"] { if let flag = source[key] as? Bool { value[key] = flag } }
            for key in ["cols", "rows"] { if let n = source[key] as? Int { value[key] = n } }
            if let revision = source["revision"] as? String, revision.count <= 20,
               !revision.isEmpty, revision.utf8.allSatisfy({ (48...57).contains($0) }) { value["revision"] = revision }
            if let controller = source["controller"] as? String, ["human", "agent"].contains(controller) { value["controller"] = controller }
            terminal = value
        }

        func markerState(_ name: String, _ source: [String: Any]) {
            guard sealed == nil, ["WK-XCTEST-UNICODE: Ω中🙂", "WK-XCTEST-RUNNING", "WK-XCTEST-INTERRUPTED",
                                  "WK-XCTEST-RECOVERED", "WK-XCTEST-SIZE"].contains(name) else { return }
            output = ["marker": name, "metadata_available": false]
            if let token = source["observer_token"] as? Int { output["observer_token"] = token;output["metadata_available"] = true }
            if let cursor = source["cursor"] as? String, cursor.count <= 20,
               !cursor.isEmpty, cursor.utf8.allSatisfy({ (48...57).contains($0) }) { output["cursor"] = cursor }
        }

        func file(_ name: String, _ data: Data?) {
            let expected = ["unicode": Data(TerminalFixture.unicode.utf8), "int": Data("INT".utf8),
                "running": Data("RUNNING".utf8), "status": Data("130".utf8), "recovered": Data("RECOVERED".utf8)]
            predicate("file_" + name, data == nil ? "absent" :
                expected[name].map { data == $0 ? "exact" : "mismatch" } ?? "valid-unchecked")
        }

        func observe(_ value: Any?, begin: UInt64, end: UInt64, baseline: Bool = false) {
            guard sealed == nil else { return }
            let elapsed = end >= begin ? end - begin : 0
            projectionCalls = min(projectionCalls, Int.max - 1) + 1
            let sum = projectionTotal.addingReportingOverflow(elapsed)
            projectionTotal = sum.overflow ? UInt64.max : sum.partialValue
            projectionMax = max(projectionMax, elapsed)
            var safe: [String: Any] = ["capture_complete": false]
            if let source = value as? [String: Any] {
                let numbers = ["inputPosts", "inputBytes", "inputSettled", "inputWritten", "trustedEvents",
                    "syntheticEvents", "trustedKeys", "syntheticKeys", "phase_sequence", "root_token", "textarea_token",
                    "js_now_ms", "performance_origin_ms", "observed_bytes", "expected_bytes", "prefix_bytes",
                    "mismatch_offset", "inflight", "written", "rejected", "uncertain", "unknown", "errors",
                    "dropped_events", "dropped_requests", "handler_calls", "handler_total_ms", "handler_max_ms"]
                for key in numbers {
                    if let value = source[key] as? NSNumber, value.doubleValue.isFinite { safe[key] = value }
                }
                // Null means unobserved; zero remains a valid document-clock timestamp.
                for key in ["request_first_ms", "request_last_ms", "response_first_ms", "response_last_ms"] {
                    if let value = source[key] as? NSNumber, value.doubleValue.isFinite { safe[key] = value }
                    else { safe[key] = NSNull() }
                }
                for key in ["capture_complete", "retired", "reference_exact", "measurement_degraded"] {
                    if let value = source[key] as? Bool { safe[key] = value }
                }
                if let id = source["document_id"] as? String, UUID(uuidString: id) != nil { safe["document_id"] = id }
                if let id = source["runtime_id"] as? String, id.count <= 20,
                   !id.isEmpty, id.allSatisfy({ $0.isNumber }) { safe["runtime_id"] = id }
                for key in ["events", "requests", "event_types"] {
                    let limit = key == "events" ? 128 : (key == "requests" ? 64 : 12)
                    guard let rows = source[key] as? [[String: Any]] else {
                        safe[key] = latest[key]
                        continue
                    }
                    if key != "event_types" { safe["rows_native_sample_end_ns"] = String(end) }
                    safe[key] = rows.suffix(limit).map { row -> [String: Any] in
                        var result: [String: Any] = [:]
                        for field in ["at_ms", "sequence", "bytes", "started_ms", "completed_ms", "status",
                                      "count", "first_ms", "last_ms", "composing_count", "focused_count"] {
                            if let n = row[field] as? NSNumber, n.doubleValue.isFinite { result[field] = n }
                        }
                        for field in ["trusted", "composing", "focused", "revision_matches"] {
                            if let flag = row[field] as? Bool { result[field] = flag }
                        }
                        let allowed = ["keydown", "paste", "compositionstart", "compositionend", "input", "beforeinput",
                            "pending", "written", "rejected", "uncertain", "unknown", "network-error"]
                        for field in ["type", "outcome"] {
                            if let text = row[field] as? String, allowed.contains(text) { result[field] = text }
                        }
                        return result
                    }
                }
            }
            if safe["rows_native_sample_end_ns"] == nil { safe["rows_native_sample_end_ns"] = latest["rows_native_sample_end_ns"] }
            safe["native_sample_begin_ns"] = String(begin)
            safe["native_sample_end_ns"] = String(end)
            safe["xterm_input_admission"] = "unknown"
            safe["client_pump_admission"] = "unknown"
            if !baseline && !self.baseline.isEmpty {
                let texts = ["document_id", "runtime_id"]
                let numbers = ["root_token", "textarea_token", "phase_sequence"]
                if texts.contains(where: { safe[$0] == nil || self.baseline[$0] == nil }) ||
                   numbers.contains(where: { safe[$0] == nil || self.baseline[$0] == nil }) {
                    latest["capture_complete"] = false
                    latest["observation_unavailable"] = true
                    latest["unavailable_observed_ns"] = String(end)
                    return
                }
                if texts.contains(where: { safe[$0] as? String != self.baseline[$0] as? String }) ||
                   numbers.contains(where: { safe[$0] as? NSNumber != self.baseline[$0] as? NSNumber }) {
                    latest["retired"] = true
                    latest["capture_complete"] = false
                    latest["retired_observed_ns"] = String(end)
                    return
                }
            }
            latest = safe
            sampled = end
            if baseline { self.baseline = safe }
        }

        func readyReturned(_ value: UInt64) { if sealed == nil { readyReturned = value } }

        func snapshot(state: String, stage: String, now: UInt64, seal: Bool = false) -> [String: Any] {
            if let sealed { return sealed }
            if state == "ready" { readyEmitted = now }
            var value: [String: Any] = ["schema": 1, "identity": identity, "timing": timing,
                "state": state, "stage": stage, "predicates": predicates.mapValues { $0 == "sampling" ? "unavailable" : $0 }, "terminal": terminal,
                "before": baseline, "last": latest, "output": output, "captured_ns": String(now),
                "writer_durable_time": "unknown", "driver_observed_ready_time": "unknown",
                "xctest_clock": "separate-unavailable", "sample_available": sampled != nil,
                "projection_calls": projectionCalls, "projection_roundtrip_total_ns": String(projectionTotal),
                "projection_roundtrip_max_ns": String(projectionMax)]
            if let sampled { value["sample_age_ns"] = String(now >= sampled ? now - sampled : 0) }
            if let text = latest["rows_native_sample_end_ns"] as? String, let rows = UInt64(text) {
                value["rows_sample_age_ns"] = String(now >= rows ? now - rows : 0)
            }
            if let readyReturned { value["ready_record_return_ns"] = String(readyReturned) }
            if let readyEmitted { value["ready_emit_ns"] = String(readyEmitted) }
            if let readyReturned, let readyEmitted, readyReturned >= readyEmitted {
                value["ready_callback_interval_ns"] = String(readyReturned - readyEmitted)
            }
            if let data = try? JSONSerialization.data(withJSONObject: value), data.count <= 65_536 {
                if seal { sealed = value }
                return value
            }
            value = ["schema": 1, "state": state, "stage": stage, "capture_complete": false,
                     "diagnostic_error": "snapshot-bound-or-serialization", "captured_ns": String(now)]
            if seal { sealed = value }
            return value
        }
    }

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
    // Separate fixture observation only. No xterm/client hooks or input authority.
    try {
      window.__terminal352Diagnostics?.retire();
      const stamp=()=>globalThis.performance?.now?.() || 0;
      const documentID=globalThis.crypto?.randomUUID?.() || '';
      const engineOrigin=new URL(location.href).origin;
      let alive=true, phase, binding, serial=0, lastRows=-Infinity;
      const nodes=new WeakMap(), observers=new Map();
      const token=node=>{if(!nodes.has(node)) nodes.set(node,++serial);return nodes.get(node);};
      const count=(p,key,n=1)=>{p[key]=Math.min(Number.MAX_SAFE_INTEGER,(p[key] || 0)+n);};
      const measure=(p,run)=>{
        const begin=stamp();
        try { return run(); } catch { count(p,'errors'); }
        finally {
          const elapsed=Math.max(0,stamp()-begin);
          count(p,'handler_calls');count(p,'handler_total_ms',elapsed);
          p.handler_max_ms=Math.max(p.handler_max_ms || 0,elapsed);
          if(elapsed>2 || p.handler_total_ms>20) p.measurement_degraded=true;
        }
      };
      const live=p=>{
        if(!p || phase!==p || p.sealed || !alive || window.__terminal352!==evidence) return false;
        if(!p.root.isConnected || !p.textarea.isConnected ||
           location.hash!==p.route || new URL(location.href).origin!==engineOrigin ||
           p.root.getAttribute('data-nac-runtime')!==p.runtime_id ||
           p.textarea.closest('[data-nac-runtime]')!==p.root) { p.retired=true;return false; }
        return true;
      };
      const bounded=(p,key,row,limit)=>{
        p[key].push(row);
        if(p[key].length>limit) { p[key].shift();count(p,'dropped_'+key); }
      };
      const api={
        begin(config) {
          if(phase) phase.sealed=true;
          phase=undefined;
          const allowed=['unicode','interrupt-arm','interrupt','recovery','resize','size-readback'];
          const targets=[...document.querySelectorAll('.xterm-helper-textarea')];
          if(!alive || !documentID || targets.length!==1 || !allowed.includes(config.name) ||
             ![config.session,config.terminal].every(s=>typeof s==='string' && s.length>0 && s.length<=256) ||
             !/^[0-9]{1,20}$/.test(config.revision || '') || typeof config.episode!=='string' || config.episode.length!==36 ||
             !Number.isInteger(config.sequence) || config.sequence<1 || config.sequence>6 ||
             !Array.isArray(config.reference) || config.reference.length>4096 ||
             !config.reference.every(n=>Number.isInteger(n) && n>=0 && n<=255)) return false;
          const textarea=targets[0], root=textarea.closest('[data-nac-runtime]');
          const route='#/session/'+encodeURIComponent(config.session)+'/terminal';
          if(location.hash!==route || (config.origin && new URL(config.origin).origin!==engineOrigin)) return false;
          const runtime=root?.getAttribute('data-nac-runtime');
          if(!root?.isConnected || !/^[0-9]{1,20}$/.test(runtime || '')) return false;
          if(binding && (binding.root!==root || binding.textarea!==textarea || binding.runtime!==runtime ||
             binding.episode!==config.episode)) { alive=false;return false; }
          binding ||= {root,textarea,runtime,episode:config.episode};
          phase={root,textarea,route,runtime_id:runtime,root_token:token(root),textarea_token:token(textarea),
            document_id:documentID,phase_sequence:config.sequence,reference:config.reference.slice(),
            revision:config.revision,paths:[
              '/sessions/'+encodeURIComponent(config.session)+'/executions/'+encodeURIComponent(config.terminal)+'/input',
              '/sessions/'+encodeURIComponent(config.session)+'/user-terminals/'+encodeURIComponent(config.terminal)+'/input'],
            events:[],requests:[],event_types:Object.create(null),observed_bytes:0,prefix_bytes:0,mismatch_offset:-1,
            inflight:0,written:0,rejected:0,uncertain:0,unknown:0,errors:0,request_sequence:0};
          return true;
        },
        event(event) {
          const p=phase;
          if(!p) return;
          measure(p,()=>{
            if(!live(p) || event.target!==p.textarea) return;
            if(!['keydown','paste','compositionstart','compositionend','input','beforeinput'].includes(event.type)) {count(p,'errors');return;}
            const at=stamp(), key=event.type+':'+!!event.isTrusted;
            const row=p.event_types[key] ||= {type:event.type,trusted:!!event.isTrusted,count:0,
              first_ms:at,last_ms:at,composing_count:0,focused_count:0};
            count(row,'count');row.last_ms=at;
            if(event.isComposing) count(row,'composing_count');
            if(document.activeElement===p.textarea) count(row,'focused_count');
            count(p,event.isTrusted?'trustedEvents':'syntheticEvents');
            if(event.type==='keydown') count(p,event.isTrusted?'trustedKeys':'syntheticKeys');
            bounded(p,'events',{type:event.type,trusted:!!event.isTrusted,
              composing:!!event.isComposing,focused:document.activeElement===p.textarea,at_ms:stamp()},128);
          });
        },
        request(path,origin,method,body) {
          const p=phase;
          if(!p) return;
          return measure(p,()=>{
            if(!live(p) || origin!==engineOrigin || method!=='POST' || !p.paths.includes(path)) return;
            const bytes=body?.bytes;
            count(p,'request_sequence');
            const row={sequence:p.request_sequence,bytes:Array.isArray(bytes)?bytes.length:0,
              revision_matches:body?.expected_revision===p.revision,started_ms:stamp(),outcome:'pending'};
            bounded(p,'requests',row,64);count(p,'inflight');
            count(p,'inputPosts');count(p,'inputBytes',row.bytes);
            p.request_first_ms ??= row.started_ms;p.request_last_ms=row.started_ms;
            if(!row.revision_matches) count(p,'errors');
            if(Array.isArray(bytes)) {
              for(let i=0;i<Math.min(bytes.length,4096);i++) {
                const offset=p.observed_bytes+i;
                if(p.mismatch_offset<0 && (offset>=p.reference.length || bytes[i]!==p.reference[offset])) p.mismatch_offset=offset;
                if(p.mismatch_offset<0) count(p,'prefix_bytes');
              }
              if(bytes.length>4096) count(p,'errors');
              count(p,'observed_bytes',bytes.length);
            } else count(p,'errors');
            return {phase:p,row};
          });
        },
        response(receipt,outcome,status) {
          if(!receipt) return;
          const p=receipt.phase;
          measure(p,()=>{
            if(!live(p)) return;
            let accepted=['written','rejected','uncertain','network-error'].includes(outcome)?outcome:'unknown';
            if(accepted==='written' && !(status>=200 && status<300)) accepted='unknown';
            receipt.row.outcome=accepted;receipt.row.status=Number.isInteger(status)?status:0;
            receipt.row.completed_ms=stamp();p.inflight=Math.max(0,p.inflight-1);
            p.response_first_ms ??= receipt.row.completed_ms;p.response_last_ms=receipt.row.completed_ms;
            count(p,['written','rejected','uncertain'].includes(accepted)?accepted:'unknown');
            count(p,'inputSettled');if(accepted==='written') count(p,'inputWritten');
          });
        },
        marker(name) {
          if(!live(phase) || !markerNames.includes(name)) return {};
          const receipt=evidence.markerReceipts[name];
          if(!receipt || typeof receipt.observer!=='string' || receipt.observer.length>128) return {};
          if(!observers.has(receipt.observer)) observers.set(receipt.observer,++serial);
          if(observers.size>16) observers.delete(observers.keys().next().value);
          const result={observer_token:observers.get(receipt.observer)};
          if(/^[0-9]{1,20}$/.test(receipt.cursor || '')) result.cursor=receipt.cursor;
          return result;
        },
        snapshot(includeRows=false) {
          const p=phase;
          if(!p) return {capture_complete:false};
          live(p);
          const result={};
          for(const key of ['document_id','runtime_id','root_token','textarea_token','phase_sequence',
            'observed_bytes','prefix_bytes','mismatch_offset','inflight','written','rejected','uncertain','unknown',
            'errors','dropped_events','dropped_requests','handler_calls','handler_total_ms','handler_max_ms']) result[key]=p[key] ?? 0;
          for(const key of ['request_first_ms','request_last_ms','response_first_ms','response_last_ms']) result[key]=p[key] ?? null;
          for(const key of ['inputPosts','inputBytes','inputSettled','inputWritten','trustedEvents','syntheticEvents','trustedKeys','syntheticKeys']) result[key]=p[key] || 0;
          const rows=includeRows || stamp()-lastRows>=1000;
          if(rows) lastRows=stamp();
          const errors=(p.errors || 0)+(evidence.diagnosticErrors || 0);
          return {...result,errors,expected_bytes:p.reference.length,js_now_ms:stamp(),
            performance_origin_ms:globalThis.performance?.timeOrigin || 0,retired:!!p.retired,
            measurement_degraded:!!p.measurement_degraded,
            capture_complete:!p.retired && !errors && !p.dropped_events && !p.dropped_requests && !p.measurement_degraded,
            reference_exact:p.observed_bytes===p.reference.length && p.mismatch_offset<0,
            event_types:Object.values(p.event_types).map(row=>({...row})),
            ...(rows?{events:p.events.map(row=>({...row})),requests:p.requests.map(row=>({...row}))}:{})};
        },
        retire() { alive=false;if(phase) {phase.retired=true;phase.sealed=true;} }
      };
      window.__terminal352Diagnostics=api;
      globalThis.addEventListener?.('pagehide',()=>api.retire(),{once:true,passive:true});
    } catch { /* Fixture diagnostics cannot interfere with ordinary input. */ }
    const diagnosticAPI=window.__terminal352Diagnostics;
    const diagnostic=(method,...args)=>{
      try{return diagnosticAPI?.[method](...args);}
      catch{try{evidence.diagnosticErrors=Math.min(Number.MAX_SAFE_INTEGER,(evidence.diagnosticErrors || 0)+1);}catch{}}
    };
    document.addEventListener('beforeinput',event=>diagnostic('event',event),{capture:true,passive:true});
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
        if(window.__terminal352!==evidence) return;
        diagnostic('event',event);
        if(event.target?.classList?.contains('xterm-helper-textarea')) {
          evidence[event.isTrusted?'trustedEvents':'syntheticEvents']++;
          if(type==='keydown') evidence[event.isTrusted?'trustedKeys':'syntheticKeys']++;
          push('events',{type, trusted:event.isTrusted, composing:!!event.isComposing});
        }
      },true);
    }
    const nativeFetch=window.fetch;
    window.fetch=function(resource,options) {
      let path='',origin='',body,method;
      try {
        if(typeof resource==='string') { const url=new URL(resource,location.href);path=url.pathname;origin=url.origin; }
        method=Object.getOwnPropertyDescriptor(options || {},'method')?.value;
        const text=Object.getOwnPropertyDescriptor(options || {},'body')?.value;
        if(typeof text==='string' && text.length<=131072) body=JSON.parse(text);
      } catch {}
      const receipt=diagnostic('request',path,origin,method,body);
      let input=false;
      try {
        input=path.endsWith('/input') && method==='POST';
        if(input) { evidence.inputPosts++;evidence.inputBytes+=(body?.bytes?.length || 0); }
        if(path.endsWith('/input-control') && method==='POST') evidence.controls++;
      } catch { /* Metadata failure must still dispatch the original call. */ }
      let result;
      try { result=nativeFetch.apply(this,arguments); }
      catch(error) { diagnostic('response',receipt,'network-error',0);throw error; }
      try {
      if(input) result.then(async response=>{
        if(window.__terminal352!==evidence) return;
        let body;
        try { body=await response.clone().json(); }
        catch { diagnostic('response',receipt,'unknown',response.status);return; }
        if(window.__terminal352===evidence && response.ok && body.outcome==='written') evidence.inputWritten++;
        diagnostic('response',receipt,body.outcome,response.status);
      },()=>diagnostic('response',receipt,'network-error',0)).catch(()=>{}).finally(()=>{
        if(window.__terminal352===evidence) evidence.inputSettled++;
      });
      if(path.includes('/observers/') && path.endsWith('/read')) result.then(async response=>{
        if(!response.ok || window.__terminal352!==evidence) return;
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
      } catch { /* Observation cannot replace the original fetch result. */ }
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
