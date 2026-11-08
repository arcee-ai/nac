"""Whole canonical receipt/client controls with fake clocks/inputs; no AX actor."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

DRIVER = r'''
import Foundation
import CoreFoundation
import CoreGraphics
import Darwin

func run(_ mode: String) -> [String: Any] {
    var stamp: UInt64 = 3_000_000_000, loads = 0, inputs = 0
    let root = "00000000-0000-0000-0000-000000000001"
    let helper = StartupAXProcess(pid: 300, parent: 200, uid: Int32(getuid()), start_seconds: 1, start_microseconds: 2, executable: "/inert/helper")
    let target = StartupAXProcess(pid: 400, parent: 1, uid: Int32(getuid()), start_seconds: 3, start_microseconds: 4, executable: "/inert/NAC.app/Contents/MacOS/NACPreview")
    let declaration = StartupAXDeclaration(path: "/inert/receipt.json", nonce: String(repeating: "a", count: 64),
        helper_path: helper.executable, helper_sha256: String(repeating: "b", count: 64),
        support_sha256: ["StartupAXGuard.swift": String(repeating: "c", count: 64), "StartupAXReceipt.swift": String(repeating: "e", count: 64)], owner_pid: 200, deadline_ns: "100000000000")
    func record(_ sequence: String, _ began: String, _ ended: String) throws -> [String: Any] {
        let value = StartupAXReceipt(schema: "nac342-ax-witness-v1", nonce: declaration.nonce,
            configuration_sha256: String(repeating: "d", count: 64), helper_sha256: declaration.helper_sha256,
            support_sha256: declaration.support_sha256, trusted: true, helper: helper, target: target,
            app_launch_epoch: 10, window_number: 7, sequence: sequence, refusal_generation: "0", began_ns: began, ended_ns: ended,
            status: "ready", case_deadline_ns: "50000000000",
            observation: StartupAXSurface(surface: "form", root_id: root, panel_id: nil, go_to_id: nil,
                root_frame: [10, 20, 100, 30], focus: nil), refusal_stage: nil, refusal: nil)
        return try JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as! [String: Any]
    }
    do {
        let baseline = try record("1", "1000000000", "1100000000")
        var candidate = try record("2", "3100000000", "3150000000")
        switch mode {
        case "nonce": candidate["nonce"] = String(repeating: "e", count: 64)
        case "config": candidate["configuration_sha256"] = String(repeating: "e", count: 64)
        case "source": candidate["support_sha256"] = [:]
        case "binary": candidate["helper_sha256"] = String(repeating: "e", count: 64)
        case "helper": var h = candidate["helper"] as! [String: Any]; h["start_seconds"] = 8; candidate["helper"] = h
        case "target": var t = candidate["target"] as! [String: Any]; t["start_seconds"] = 8; candidate["target"] = t
        case "pid": var t = candidate["target"] as! [String: Any]; t["pid"] = 500; candidate["target"] = t
        case "window": candidate["window_number"] = 8
        case "trust": candidate["trusted"] = false
        case "old_begin": candidate["began_ns"] = "2900000000"
        case "future_end": candidate["ended_ns"] = "4000000000"
        case "long_sample": candidate["began_ns"] = "1"
        case "refusal_overwritten": candidate["refusal_generation"] = "1"
        case "retired": candidate["status"] = "retired"; candidate.removeValue(forKey:"observation")
        case "refused": candidate["status"] = "refused"; candidate["refusal_stage"] = "ax_predicate_refused"
        case "extra": candidate["foreign"] = true
        case "replacement": var o = candidate["observation"] as! [String: Any]; o["root_id"] = UUID().uuidString; candidate["observation"] = o
        case "phase": var o = candidate["observation"] as! [String: Any]; o["surface"] = "panel"; candidate["observation"] = o
        case "frame": var o = candidate["observation"] as! [String: Any]; o["root_frame"] = [10,20,0,30]; candidate["observation"] = o
        case "sequence_rollback": candidate["sequence"] = "0"
        case "changed_duplicate": candidate["sequence"] = "1"
        default: break
        }
        let encoder: ([String: Any]) throws -> Data = { try JSONSerialization.data(withJSONObject: $0, options: [.sortedKeys]) }
        let first = try encoder(baseline)
        let second = mode == "duplicate" ? first : try encoder(candidate)
        let client = StartupAXClient(declaration, configurationSHA: String(repeating:"d",count:64),
            pid: 400, launch: 10, window: 7, executable: target.executable,
            now: { stamp += 1_000_000; return stamp }, pause: { stamp += 31_000_000_000 }, load: {
                loads += 1
                if loads == 1 { return first }
                stamp = mode == "clock_rollback" ? 1_000_000_000 : max(stamp, 3_200_000_000)
                if mode == "missing" { throw StartupAXReceiptError.missing }
                if mode == "partial" { return Data("{".utf8) }
                if mode == "oversize" { return Data(repeating:32,count:8193) }
                if mode == "duplicate_key" {
                    var text = String(decoding: second, as: UTF8.self)
                    text.removeLast(); text += ",\"status\":\"ready\"}"
                    return Data(text.utf8)
                }
                return second
            })
        let ticket = try client.begin()
        _ = try client.consume(ticket, surface: .form, rootFrame: CGRect(x:10,y:20,width:100,height:30))
        inputs += 1 // Inert next-input port; ONLY after the actual production client.
        return ["accepted":true,"inputs":inputs,"loads":loads,"proof":client.evidence.count]
    } catch { return ["accepted":false,"inputs":inputs,"loads":loads] }
}


func lossRun(_ mode: String) -> [String: Any] {
    var stamp: UInt64 = 3_000_000_000, loads=0, inputs=0, pauses=0, last=Data()
    let process=StartupAXProcess(pid:300,parent:200,uid:Int32(getuid()),start_seconds:1,start_microseconds:0,executable:"/inert/helper")
    let target=StartupAXProcess(pid:400,parent:1,uid:Int32(getuid()),start_seconds:2,start_microseconds:0,executable:"/inert/app")
    let declaration=StartupAXDeclaration(path:"/inert/receipt",nonce:String(repeating:"a",count:64),helper_path:process.executable,helper_sha256:String(repeating:"b",count:64),support_sha256:["StartupAXGuard.swift":String(repeating:"c",count:64),"StartupAXReceipt.swift":String(repeating:"e",count:64)],owner_pid:200,deadline_ns:"100000000000")
    let client=StartupAXClient(declaration,configurationSHA:String(repeating:"d",count:64),pid:400,launch:10,window:7,executable:target.executable,
        now:{stamp += 1_000_000;return stamp},pause:{pauses += 1;stamp += 10_000_000},load:{
            loads += 1
            if mode == "loss_second_begin" && loads == 3 { throw StartupAXReceiptError.missing }
            if mode == "loss_initial" && loads == 1 { throw StartupAXReceiptError.missing }
            let index=loads - (mode == "loss_initial" ? 1 : 0)
            if index == 3 && mode != "loss_second_begin" && mode != "loss_retired" { return last }
            let sequence=index == 1 ? 1 : index == 2 ? 2 : index == 3 ? 3 : index-1
            let began:UInt64=index == 1 ? 1_000_000_000 : index == 2 ? 3_100_000_000 : UInt64(index)*100_000_000+3_000_000_000
            let ended=began+10_000_000;stamp=max(stamp,ended+10_000_000)
            last=try JSONEncoder().encode(StartupAXReceipt(schema:"nac342-ax-witness-v1",nonce:declaration.nonce,configuration_sha256:String(repeating:"d",count:64),helper_sha256:declaration.helper_sha256,support_sha256:declaration.support_sha256,trusted:true,helper:process,target:target,app_launch_epoch:10,window_number:7,sequence:String(sequence),refusal_generation:"0",began_ns:String(began),ended_ns:String(ended),status:mode == "loss_retired" && index == 3 ? "retired" : "ready",case_deadline_ns:"50000000000",observation:StartupAXSurface(surface:"form",root_id:"00000000-0000-0000-0000-000000000001",panel_id:nil,go_to_id:nil,root_frame:[10,20,100,30],focus:nil),refusal_stage:nil,refusal:nil))
            return last
        })
    do {
        for _ in 0..<2 { let ticket=try client.begin();_ = try client.consume(ticket,surface:.form,rootFrame:CGRect(x:10,y:20,width:100,height:30));inputs += 1 }
    } catch { }
    return ["inputs":inputs,"loads":loads,"pauses":pauses]
}

func focusRun(_ mode: String) -> [String: Any] {
    var stamp: UInt64 = 3_000_000_000, call = 0, sequence = 1, last = Data()
    let root = "00000000-0000-0000-0000-000000000001", panel = "00000000-0000-0000-0000-000000000002", goTo = "00000000-0000-0000-0000-000000000003"
    let declaration = StartupAXDeclaration(path:"/inert/receipt.json",nonce:String(repeating:"a",count:64),helper_path:"/inert/helper",helper_sha256:String(repeating:"b",count:64),support_sha256:["StartupAXGuard.swift":String(repeating:"c",count:64),"StartupAXReceipt.swift":String(repeating:"e",count:64)],owner_pid:200,deadline_ns:"100000000000")
    let target = StartupAXProcess(pid:400,parent:1,uid:Int32(getuid()),start_seconds:3,start_microseconds:4,executable:"/inert/app")
    let helper = StartupAXProcess(pid:300,parent:200,uid:Int32(getuid()),start_seconds:1,start_microseconds:2,executable:"/inert/helper")
    let client = StartupAXClient(declaration,configurationSHA:String(repeating:"d",count:64),pid:400,launch:10,window:7,executable:target.executable,
        now:{stamp += 1_000_000;return stamp},pause:{stamp += 31_000_000_000},load:{
            call += 1
            if call == 3 || call == 5 { return last }
            if call > 1 { stamp += 100_000_000;sequence += 1 }
            let phase = call <= 2 ? "form" : call == 4 ? "panel" : "goTo"
            let focus = phase == "goTo" ? StartupAXFocus(pid:mode == "focus_pid" ? 500 : 400,
                role:mode == "focus_role" ? "AXSecureTextField" : "AXTextField",focused:mode != "focus_false",
                attached:mode != "focus_ancestor",frame:mode == "focus_frame" ? [11,20,100,30] : [10,20,100,30],
                value:mode == "focus_value" ? "/foreign" : "/owned workspace") : nil
            let receipt = StartupAXReceipt(schema:"nac342-ax-witness-v1",nonce:declaration.nonce,configuration_sha256:String(repeating:"d",count:64),helper_sha256:declaration.helper_sha256,support_sha256:declaration.support_sha256,trusted:true,helper:helper,target:target,app_launch_epoch:10,window_number:7,sequence:String(sequence),refusal_generation:"0",began_ns:String(stamp-20_000_000),ended_ns:String(stamp-10_000_000),status:"ready",case_deadline_ns:"50000000000",observation:StartupAXSurface(surface:phase,root_id:root,panel_id:phase == "form" ? nil : panel,go_to_id:phase == "goTo" ? goTo : nil,root_frame:[10,20,100,30],focus:focus),refusal_stage:nil,refusal:nil)
            last = try JSONEncoder().encode(receipt);return last
        })
    do {
        for phase in [StartupNativeFolderPolicy.Surface.form,.panel,.goTo] {
            let ticket = try client.begin()
            _ = try client.consume(ticket,surface:phase,rootFrame:CGRect(x:10,y:20,width:100,height:30),
                field:phase == .goTo ? (CGRect(x:10,y:20,width:100,height:30),"/owned workspace") : nil)
        }
        return ["accepted":true,"inputs":1]
    } catch { return ["accepted":false,"inputs":0] }
}

func fileRun(_ mode: String) -> [String: Any] {
    var directory = URL(fileURLWithPath:ProcessInfo.processInfo.environment["NAC342_INERT_FILE_ROOT"] ?? FileManager.default.temporaryDirectory.path).appendingPathComponent("nac-ax-files-"+UUID().uuidString)
    do {
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:false,attributes:[.posixPermissions:0o700])
        defer { try? FileManager.default.removeItem(at:directory) }
        guard let resolved = realpath(directory.path, nil) else { throw StartupAXReceiptError.invalid }
        directory = URL(fileURLWithPath:String(cString:resolved)); free(resolved)
        let file = directory.appendingPathComponent("receipt.json").path
        if mode == "file_publish" {
            let process = StartupAXProcess(pid:1,parent:2,uid:Int32(getuid()),start_seconds:1,start_microseconds:0,executable:"/inert")
            func receipt(_ sequence: String) -> StartupAXReceipt {
                StartupAXReceipt(schema:"nac342-ax-witness-v1",nonce:String(repeating:"a",count:64),configuration_sha256:String(repeating:"b",count:64),helper_sha256:String(repeating:"c",count:64),support_sha256:[:],trusted:true,helper:process,target:process,app_launch_epoch:1,window_number:1,sequence:sequence,refusal_generation:"0",began_ns:"1",ended_ns:"2",status:"ready",case_deadline_ns:"100",observation:nil,refusal_stage:nil,refusal:nil)
            }
            try StartupAXFiles.publish(receipt("1"),to:file)
            let before = try StartupAXFiles.read(file)
            let old = FileHandle(fileDescriptor:open(file,O_RDONLY|O_NOFOLLOW|O_CLOEXEC),closeOnDealloc:true)
            try StartupAXFiles.publish(receipt("2"),to:file)
            let after = try StartupAXFiles.read(file)
            let stable = old.readDataToEndOfFile()
            let decoded = try StartupAXFiles.decode(after)
            let files = try FileManager.default.contentsOfDirectory(atPath:directory.path)
            return ["accepted":stable == before && before != after && decoded.sequence == "2" && files == ["receipt.json"]]
        }
        if mode == "file_fifo" { guard mkfifo(file,0o400) == 0 else { throw StartupAXReceiptError.invalid } }
        if mode == "file_directory" { try FileManager.default.createDirectory(atPath:file,withIntermediateDirectories:false,attributes:[.posixPermissions:0o400]) }
        let data = Data(mode == "file_oversize" ? String(repeating:" ",count:8193).utf8 : "{}".utf8)
        let target = directory.appendingPathComponent("target.json").path
        if !["file_fifo","file_directory"].contains(mode) { FileManager.default.createFile(atPath:mode == "file_symlink" ? target : file,contents:data,attributes:[.posixPermissions:0o400]) }
        if mode == "file_symlink" { try FileManager.default.createSymbolicLink(atPath:file,withDestinationPath:target) }
        if mode == "file_hardlink" { try FileManager.default.linkItem(atPath:file,toPath:target) }
        if mode == "file_foreign_parent" { try FileManager.default.setAttributes([.posixPermissions:0o755],ofItemAtPath:directory.path) }
        let read = try StartupAXFiles.read(file)
        return ["accepted":read == data]
    } catch { return ["accepted":false] }
}

func identityProof() -> [String: Any] {
    let root = NSObject()
    var panel: NSObject? = NSObject()
    weak var retained = panel
    var binding = StartupNativeFolderPolicy.Binding<StartupAXIdentity>()
    let a = binding.accept(.form, root: .init(element:root), panel:nil, goTo:nil)
    let b = binding.accept(.panel, root: .init(element:root), panel:.init(element:panel!), goTo:nil)
    panel = nil
    let c = binding.accept(.form, root:.init(element:root),panel:nil,goTo:nil)
    let replacement = binding.accept(.panel,root:.init(element:root),panel:.init(element:NSObject()),goTo:nil)
    return ["accepted":a && b && c,"retained":retained != nil,"replacement_rejected": !replacement]
}

func rejectionRun(_ mode: String) -> [String: Any] {
    var stamp: UInt64 = 3_000_000_000, loads=0, clocks=0, pauses=0, inputs=0
    let helper=StartupAXProcess(pid:300,parent:200,uid:Int32(getuid()),start_seconds:1,start_microseconds:0,executable:"/inert/helper")
    let target=StartupAXProcess(pid:400,parent:1,uid:Int32(getuid()),start_seconds:2,start_microseconds:0,executable:"/inert/app")
    let declaration=StartupAXDeclaration(path:"/inert/receipt",nonce:String(repeating:"a",count:64),helper_path:helper.executable,helper_sha256:String(repeating:"b",count:64),support_sha256:["StartupAXGuard.swift":String(repeating:"c",count:64),"StartupAXReceipt.swift":String(repeating:"e",count:64)],owner_pid:200,deadline_ns:"100000000000")
    let initial=mode.hasPrefix("reject_initial"), later=mode.hasPrefix("reject_later")
    let client=StartupAXClient(declaration,configurationSHA:String(repeating:"d",count:64),pid:400,launch:10,window:7,executable:target.executable,
        now:{clocks += 1;stamp += 1_000_000;return stamp},pause:{pauses += 1;stamp += 31_000_000_000},load:{
            loads += 1
            let rejecting = mode != "reject_ready" && (initial || later && loads>=3 || !initial && !later && loads>=2)
            if loads>1 {stamp=max(stamp,loads>=3 ? 3_400_000_000 : 3_200_000_000)}
            var status=rejecting ? "refused" : "ready"
            if rejecting && mode.contains("retiring") {status="retiring"}
            if rejecting && mode.contains("retired") {status="retired"}
            if rejecting && mode.contains("unknown") {status="PRIVATE_STATUS"}
            var stage:String?=rejecting ? "sample_deadline" : nil
            if rejecting && mode.contains("private") {stage="PRIVATE_STAGE"}
            var refusal:Data?=nil
            if rejecting && mode.contains("payload") {
                refusal=try JSONSerialization.data(withJSONObject:["terminal_refusal":["stage":mode.contains("private") ? "PRIVATE_TERMINAL" : "owned_pid"],"PRIVATE_RAW":"PRIVATE_FIELD_VALUE"])
            }
            var row=try JSONSerialization.jsonObject(with:JSONEncoder().encode(StartupAXReceipt(schema:"nac342-ax-witness-v1",nonce:declaration.nonce,configuration_sha256:String(repeating:"d",count:64),helper_sha256:declaration.helper_sha256,support_sha256:declaration.support_sha256,trusted:true,helper:helper,target:target,app_launch_epoch:10,window_number:7,sequence:String(loads),refusal_generation:"0",began_ns:loads==1 ? "1000000000" : loads>=3 ? "3300000000" : "3100000000",ended_ns:loads==1 ? "1100000000" : loads>=3 ? "3350000000" : "3150000000",status:status,case_deadline_ns:"50000000000",observation:StartupAXSurface(surface:"form",root_id:"00000000-0000-0000-0000-000000000001",panel_id:nil,go_to_id:nil,root_frame:[10,20,100,30],focus:nil),refusal_stage:stage,refusal:refusal))) as! [String:Any]
            if rejecting && mode.contains("invalid") {row["trusted"]=false}
            if rejecting && mode.contains("expired") {row["case_deadline_ns"]="1"}
            return try JSONSerialization.data(withJSONObject:row,options:[.sortedKeys])
        })
    var name="none", frozen=true
    do {
        for _ in 0..<(later ? 2 : 1) {
            let ticket=try client.begin()
            _=try client.consume(ticket,surface:.form,rootFrame:CGRect(x:10,y:20,width:100,height:30));inputs += 1
        }
    } catch {
        name=String(describing:error)
        if mode.contains("frozen") {
            let first=try! JSONSerialization.data(withJSONObject:client.rejectionContext ?? [:],options:[.sortedKeys])
            do {_=try client.begin()} catch {}
            frozen=first == (try! JSONSerialization.data(withJSONObject:client.rejectionContext ?? [:],options:[.sortedKeys]))
        }
    }
    return ["error":name,"inputs":inputs,"loads":loads,"clocks":clocks,"pauses":pauses,
            "context":client.rejectionContext ?? [:],"failure_data":client.failureData != nil,"frozen":frozen]
}

let modes = try JSONSerialization.jsonObject(with: FileHandle.standardInput.readDataToEndOfFile()) as! [String]
let rows = modes.map { $0.hasPrefix("reject_") ? rejectionRun($0) : $0.hasPrefix("loss_") ? lossRun($0) : $0 == "identity" ? identityProof() : $0.hasPrefix("focus_") ? focusRun($0) : $0.hasPrefix("file_") ? fileRun($0) : run($0) }
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:rows))
'''


@unittest.skipUnless(os.environ.get('NAC342_AX_WITNESS_PROOF') == '1', 'Explicit inert Swift witness controls not requested')
class ReceiptControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='nac342-ax-inert-')
        cls.addClassCleanup(cls.temporary.cleanup)
        root = Path(cls.temporary.name).resolve()
        driver = root / 'main.swift'
        driver.write_text(DRIVER)
        cls.binary = root / 'inert-client'
        sources = [Path(__file__).with_name(n) for n in ('StartupAXGuard.swift', 'StartupAXReceipt.swift')]
        result = subprocess.run(['/usr/bin/xcrun', 'swiftc', '-swift-version', '5', *map(str,sources), str(driver), '-o', str(cls.binary)],
                       capture_output=True, text=True, timeout=60)
        if result.returncode: raise AssertionError(result.stderr)

    def rows(self, modes, timeout=10):
        return json.loads(subprocess.check_output([str(self.binary)], input=json.dumps(modes), text=True, timeout=timeout,
                         env=dict(os.environ,NAC342_INERT_FILE_ROOT=self.temporary.name)))

    def test_passive_rejection_preserves_ready_error_and_exact_fake_port_counts(self):
        modes=['reject_ready','reject_initial_nil','reject_consume_nil','reject_later_nil',
               'reject_initial_invalid','reject_initial_expired']
        rows=self.rows(modes)
        for mode,row,error,counts in zip(modes,rows,['none','refused','refused','refused','invalid','invalid'],
                [(1,2,7),(0,1,2),(0,2,5),(1,3,9),(0,1,2),(0,1,2)]):
            with self.subTest(mode=mode):
                self.assertEqual(row['error'],error)
                self.assertEqual((row['inputs'],row['loads'],row['clocks']),counts)
                self.assertEqual(row['pauses'],0)
        self.assertFalse(rows[0]['context'])
        self.assertFalse(rows[4]['context'])
        self.assertFalse(rows[5]['context'])
        self.assertEqual(rows[1]['context']['client_phase'],'begin')
        self.assertEqual(rows[2]['context']['client_phase'],'consume')
        self.assertEqual(rows[3]['context']['client_phase'],'begin')
        self.assertFalse(rows[1]['failure_data'])
        self.assertFalse(rows[2]['failure_data'])

    def test_first_rejection_is_frozen_closed_and_private_payload_is_never_exported(self):
        modes=['reject_initial_retiring','reject_initial_retired','reject_initial_unknown_payload_private',
               'reject_initial_payload','reject_initial_frozen']
        rows=self.rows(modes)
        self.assertEqual([r['context']['receipt_status'] for r in rows],['retiring','retired','other','refused','refused'])
        self.assertEqual(rows[2]['context']['refusal_stage'],'other')
        self.assertEqual(rows[2]['context']['reader_terminal'],'other')
        self.assertEqual(rows[3]['context']['reader_terminal'],'owned_pid')
        self.assertTrue(rows[4]['frozen'])
        for row in rows:
            self.assertEqual(row['error'],'refused')
            self.assertEqual(row['inputs'],0)
            self.assertNotIn('PRIVATE',json.dumps(row))
            self.assertLessEqual(len(json.dumps(row['context']).encode()),2048)

    def test_fifo_without_writer_and_directory_are_refused_by_actual_file_port(self):
        self.assertEqual(self.rows(['file_fifo','file_directory'],timeout=1),[{'accepted':False}]*2)

    def test_second_guard_port_loss_is_not_erased_by_future_positive_samples(self):
        row=self.rows(['loss_second_begin'])[0]
        self.assertEqual(row,dict(inputs=1,loads=3,pauses=0))
        positive,initial=self.rows(['loss_positive','loss_initial'])
        self.assertEqual(positive['inputs'],2)
        self.assertEqual(initial['inputs'],2)
        self.assertEqual(initial['pauses'],1)
        self.assertEqual(self.rows(['retired'])[0]['inputs'],0)
        self.assertEqual(self.rows(['loss_retired'])[0]['inputs'],1)

    def test_actual_client_accepts_only_fresh_bound_receipt_before_next_input(self):
        self.assertEqual(self.rows(['positive'])[0], dict(accepted=True,inputs=1,loads=2,proof=1))

    def test_every_refusal_binding_freshness_shape_error_prevents_next_input(self):
        modes = ['nonce','config','source','binary','helper','target','pid','window','trust','old_begin','future_end',
                 'long_sample','refusal_overwritten','refused','extra','replacement','phase','frame',
                 'sequence_rollback','changed_duplicate','duplicate','clock_rollback','missing','partial','oversize','duplicate_key']
        for mode,row in zip(modes,self.rows(modes)):
            with self.subTest(mode=mode):
                self.assertFalse(row['accepted'])
                self.assertEqual(row['inputs'],0)
        self.assertEqual(self.rows(['refusal_overwritten'])[0]['loads'],2)

    def test_complete_client_compares_exact_focus_value_role_pid_geometry_and_ancestry(self):
        modes=['focus_positive','focus_pid','focus_role','focus_false','focus_ancestor','focus_frame','focus_value']
        self.assertEqual([r['accepted'] for r in self.rows(modes)],[True]+[False]*6)

    def test_real_read_port_refuses_symlink_hardlink_oversize_and_foreign_parent(self):
        modes=['file_positive','file_publish','file_symlink','file_hardlink','file_oversize','file_foreign_parent']
        self.assertEqual([r['accepted'] for r in self.rows(modes)],[True]*2+[False]*4)

    def test_real_cfequal_wrapper_retains_cancelled_handle_and_rejects_same_shaped_replacement(self):
        self.assertEqual(self.rows(['identity'])[0],dict(accepted=True,retained=True,replacement_rejected=True))


if __name__ == '__main__':
    unittest.main()
