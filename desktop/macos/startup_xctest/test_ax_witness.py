"""Whole canonical receipt/client controls with fake clocks/inputs; no AX actor."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


def journey_failure_catch():
    source = Path(__file__).with_name('StartupJourneys.swift').read_text()
    return source.split('        } catch {\n            failureEvidence.capture(error)', 1)[1].split('\n    }\n}', 1)[0]


class FailureScopeTests(unittest.TestCase):
    def test_journey_keeps_nested_guards_in_the_main_actor_method_and_catches_before_outer_teardown(self):
        source = Path(__file__).with_name('StartupJourneys.swift').read_text()
        method = source.split('    @MainActor\n    func testOrdinaryStartup() throws {', 1)[1]
        teardown, body = method.split('        let failureEvidence = ', 1)
        self.assertIn('        defer {', teardown)
        self.assertIn('ui.terminate()', teardown)
        self.assertIn('\n        do {\n', body)
        self.assertNotIn('failureEvidence.run', body)
        self.assertNotIn('assumeIsolated', body)
        self.assertNotIn('Task {', body)
        guards, caught = body.split('        } catch {\n            failureEvidence.capture(error)', 1)
        self.assertIn('func guardTarget() throws {', guards)
        self.assertIn('func dispatch(', guards)
        self.assertEqual(guards.count('try guardWindow('), 2)
        self.assertIn('throw error', caught)
        self.assertNotIn('try ', caught)


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
    var stamp: UInt64 = 3_000_000_000, call = 0, sequence = 1, last = Data(), pauses = 0
    let staleFocus = mode.hasPrefix("stale_")
    let scenario = staleFocus ? String(mode.dropFirst("stale_".count)) : mode
    let root = "00000000-0000-0000-0000-000000000001", panel = "00000000-0000-0000-0000-000000000002", goTo = "00000000-0000-0000-0000-000000000003"
    let declaration = StartupAXDeclaration(path:"/inert/receipt.json",nonce:String(repeating:"a",count:64),helper_path:"/inert/helper",helper_sha256:String(repeating:"b",count:64),support_sha256:["StartupAXGuard.swift":String(repeating:"c",count:64),"StartupAXReceipt.swift":String(repeating:"e",count:64)],owner_pid:200,deadline_ns:"100000000000")
    let target = StartupAXProcess(pid:400,parent:1,uid:Int32(getuid()),start_seconds:3,start_microseconds:4,executable:"/inert/app")
    let helper = StartupAXProcess(pid:300,parent:200,uid:Int32(getuid()),start_seconds:1,start_microseconds:2,executable:"/inert/helper")
    let client = StartupAXClient(declaration,configurationSHA:String(repeating:"d",count:64),pid:400,launch:10,window:7,executable:target.executable,
        now:{stamp += 1_000_000;return stamp},pause:{pauses += 1;stamp += staleFocus ? 10_000_000 : 31_000_000_000},load:{
            call += 1
            if call == 3 || call == 5 { return last }
            if call > 1 { stamp += 100_000_000;sequence += 1 }
            let phase = call <= 2 ? "form" : call == 4 ? "panel" : "goTo"
            let focus = phase == "goTo" ? StartupAXFocus(pid:scenario == "focus_pid" ? 500 : 400,
                role:scenario == "focus_role" ? "AXSecureTextField" : "AXTextField",focused:scenario != "focus_false",
                attached:scenario != "focus_ancestor",frame:scenario == "focus_frame" ? [11,20,100,30] : [10,20,100,30],
                value:scenario == "focus_value" ? "/foreign" : "/owned workspace") : nil
            let receipt = StartupAXReceipt(schema:"nac342-ax-witness-v1",nonce:declaration.nonce,configuration_sha256:String(repeating:"d",count:64),helper_sha256:declaration.helper_sha256,support_sha256:declaration.support_sha256,trusted:true,helper:helper,target:target,app_launch_epoch:10,window_number:7,sequence:String(sequence),refusal_generation:"0",began_ns:String(stamp-20_000_000),ended_ns:String(stamp-10_000_000),status:"ready",case_deadline_ns:"50000000000",observation:StartupAXSurface(surface:phase,root_id:root,panel_id:phase == "form" ? nil : panel,go_to_id:phase == "goTo" ? goTo : nil,root_frame:[10,20,100,30],focus:focus),refusal_stage:nil,refusal:nil)
            last = try JSONEncoder().encode(receipt)
            if staleFocus && call == 6 { stamp += 1_100_000_000 }
            return last
        })
    do {
        for phase in [StartupNativeFolderPolicy.Surface.form,.panel,.goTo] {
            let ticket = try client.begin()
            _ = try client.consume(ticket,surface:phase,rootFrame:CGRect(x:10,y:20,width:100,height:30),
                field:phase == .goTo ? (CGRect(x:10,y:20,width:100,height:30),"/owned workspace") : nil)
        }
        return ["accepted":true,"inputs":1,"loads":call,"pauses":pauses,"proof":client.evidence.map { $0.sequence }]
    } catch { return ["accepted":false,"inputs":0,"loads":call,"pauses":pauses,"proof":client.evidence.map { $0.sequence }] }
}


func publicationRun(_ name: String) -> [String: Any] {
    let mode = String(name.dropFirst("publication_".count))
    var stamp: UInt64 = 3_000_000_000, loads = 0, pauses = 0, inputs = 0, afterLoad = 0
    var deadline: UInt64 = 0, stale = Data()
    let root = "00000000-0000-0000-0000-000000000001"
    let helper = StartupAXProcess(pid:300,parent:200,uid:Int32(getuid()),start_seconds:1,start_microseconds:0,executable:"/inert/helper")
    let target = StartupAXProcess(pid:400,parent:1,uid:Int32(getuid()),start_seconds:2,start_microseconds:0,executable:"/inert/app")
    let declaration = StartupAXDeclaration(path:"/inert/receipt",nonce:String(repeating:"a",count:64),
        helper_path:helper.executable,helper_sha256:String(repeating:"b",count:64),
        support_sha256:["StartupAXGuard.swift":String(repeating:"c",count:64),"StartupAXReceipt.swift":String(repeating:"e",count:64)],
        owner_pid:200,deadline_ns:"100000000000")
    func record(_ sequence: Int, _ began: UInt64, _ ended: UInt64) throws -> [String: Any] {
        let value = StartupAXReceipt(schema:"nac342-ax-witness-v1",nonce:declaration.nonce,
            configuration_sha256:String(repeating:"d",count:64),helper_sha256:declaration.helper_sha256,
            support_sha256:declaration.support_sha256,trusted:true,helper:helper,target:target,
            app_launch_epoch:10,window_number:7,sequence:String(sequence),refusal_generation:"0",
            began_ns:String(began),ended_ns:String(ended),status:"ready",case_deadline_ns:"50000000000",
            observation:StartupAXSurface(surface:"form",root_id:root,panel_id:nil,go_to_id:nil,
                root_frame:[10,20,100,30],focus:nil),refusal_stage:nil,refusal:nil)
        return try JSONSerialization.jsonObject(with:JSONEncoder().encode(value)) as! [String:Any]
    }
    func encode(_ value: [String:Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject:value,options:[.sortedKeys])
    }
    let client = StartupAXClient(declaration,configurationSHA:String(repeating:"d",count:64),pid:400,
        launch:10,window:7,executable:target.executable,now:{
            afterLoad += 1
            stamp += mode == "final_age" && loads == 2 && afterLoad == 3 ? 200_000_000 : 1_000_000
            return stamp
        },pause:{pauses += 1;stamp += mode == "deadline" ? 1_000_000_000 : 10_000_000},load:{
            loads += 1;afterLoad = 0
            if mode == "initial_waiting" && loads == 1 {
                var waiting = try record(0,0,0);waiting["status"] = "waiting"
                return try encode(waiting)
            }
            let index = loads - (mode == "initial_waiting" ? 1 : 0)
            if index == 1 { return try encode(record(1,1_000_000_000,1_100_000_000)) }
            if index == 2 {
                if mode == "malformed" { return Data("{".utf8) }
                if mode == "oversize" { return Data(repeating:32,count:8193) }
                if mode == "unchanged" { return try encode(record(1,1_000_000_000,1_100_000_000)) }
                var candidate = try record(2,3_100_000_000,3_150_000_000)
                stamp = max(stamp, mode == "final_age" ? 4_050_000_000 : 4_300_000_000)
                switch mode {
                case "preentry": candidate["began_ns"] = "2900000000";candidate["ended_ns"] = "2950000000"
                case "initial_waiting":
                    let began = stamp + 100_000_000
                    candidate["began_ns"] = String(began);candidate["ended_ns"] = String(began+50_000_000)
                    stamp = began + 60_000_000
                case "duration": candidate["began_ns"] = "3050000000";candidate["ended_ns"] = "4200000000"
                case "refused": candidate["status"] = "refused";candidate["refusal_stage"] = "inert_refused"
                case "generation": candidate["refusal_generation"] = "1"
                case "ownership": var t = candidate["target"] as! [String:Any];t["start_seconds"] = 8;candidate["target"] = t
                case "surface":
                    var o = candidate["observation"] as! [String:Any];o["surface"] = "panel"
                    o["panel_id"] = "00000000-0000-0000-0000-000000000002";candidate["observation"] = o
                case "frame": var o = candidate["observation"] as! [String:Any];o["root_frame"] = [11,20,100,30];candidate["observation"] = o
                default: break
                }
                stale = try encode(candidate);return stale
            }
            if mode == "deadline" || (mode == "repeat_then_fresh" && index == 3) { return stale }
            if mode == "lost_after_stale" { throw StartupAXReceiptError.missing }
            if mode == "changed_after_stale" {
                var changed = try JSONSerialization.jsonObject(with:stale) as! [String:Any]
                changed["window_number"] = 8;return try encode(changed)
            }
            let began = stamp + 100_000_000
            var fresh = try record(mode == "rollback_after_stale" ? 1 : 3,began,began+50_000_000)
            stamp = began + 60_000_000
            if mode == "generation_after_stale" { fresh["refusal_generation"] = "1" }
            if mode == "deadline_after_stale" { fresh["case_deadline_ns"] = "60000000000" }
            return try encode(fresh)
        })
    func result(_ accepted: Bool, _ error: String) -> [String:Any] {
        ["accepted":accepted,"inputs":inputs,"loads":loads,"pauses":pauses,"error":error,
         "deadline":String(deadline),"now":String(stamp),"proof":client.evidence.map { $0.sequence }]
    }
    do {
        let ticket = try client.begin();deadline = ticket.deadline
        _ = try client.consume(ticket,surface:.form,rootFrame:CGRect(x:10,y:20,width:100,height:30))
        inputs += 1
        return result(true,"")
    } catch { return result(false,String(describing:error)) }
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


func requestRun(_ name: String) -> [String: Any] {
    let mode = String(name.dropFirst("request_".count))
    var directory = URL(fileURLWithPath:ProcessInfo.processInfo.environment["NAC342_INERT_FILE_ROOT"]!)
        .appendingPathComponent("request-"+UUID().uuidString)
    do {
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:false,attributes:[.posixPermissions:0o700])
        defer { try? FileManager.default.removeItem(at:directory) }
        guard let resolved = realpath(directory.path,nil) else { throw StartupAXReceiptError.invalid }
        directory=URL(fileURLWithPath:String(cString:resolved));free(resolved)
        let path = directory.appendingPathComponent("receipt.json.request").path
        let request = StartupAXInteractionRequest(schema:"nac342-ax-interaction-v1",nonce:String(repeating:"a",count:64),
            configuration_sha256:String(repeating:"b",count:64),id:UUID().uuidString,
            root_id:"00000000-0000-0000-0000-000000000001",entered_ns:"100",deadline_ns:"1000",
            baseline_sequence:"3",refusal_generation:"0",surface:"form",kind:"button",label:"Intended",keyboard:false,
            point:[20,25],anchor_frame:[10,20,100,30],root_frame:[0,0,1024,674],value:nil)
        if mode == "positive" {
            try StartupAXFiles.publish(request,to:path)
            return ["accepted":try StartupAXInteractionRequest.read(path) == request]
        }
        var body = try JSONSerialization.jsonObject(with:JSONEncoder().encode(request)) as! [String:Any]
        switch mode {
        case "point": body["point"]=[999,999]
        case "precision": body["point"]=[20.0000000001,25]
        case "frame": body["anchor_frame"]=[10,20,0,30]
        case "deadline": body["deadline_ns"]="30000000101"
        case "clock": body["entered_ns"]="01"
        case "kind": body["kind"]="arbitrary-attribute-selector"
        case "root": body["root_id"]="unknown"
        case "label": body["label"]=""
        case "value": body["value"]="PRIVATE-CANARY"
        case "oversize_value": body["kind"]="field";body["surface"]="goTo";body["keyboard"]=true;body["value"]=String(repeating:"x",count:4097)
        case "unknown": body["attribute"]="AXTitle"
        default: break
        }
        var data=try JSONSerialization.data(withJSONObject:body,options:[.sortedKeys])
        if mode == "duplicate" {
            var text=String(decoding:data,as:UTF8.self);text.removeLast();text += ",\"kind\":\"button\"}";data=Data(text.utf8)
        }
        FileManager.default.createFile(atPath:path,contents:data,attributes:[.posixPermissions:0o400])
        _ = try StartupAXInteractionRequest.read(path)
        return ["accepted":true]
    } catch { return ["accepted":false] }
}
func interactionRun(_ name: String) -> [String: Any] {
    let mode = String(name.dropFirst("interaction_".count))
    var stamp: UInt64 = 3_000_000_000, loads = 0, inputs = 0, clears = 0, published: StartupAXInteractionRequest?
    var last = Data(), finalEnd: UInt64 = 0
    let root = "00000000-0000-0000-0000-000000000001"
    let helper = StartupAXProcess(pid:300,parent:200,uid:Int32(getuid()),start_seconds:1,start_microseconds:0,executable:"/inert/helper")
    let target = StartupAXProcess(pid:400,parent:1,uid:Int32(getuid()),start_seconds:2,start_microseconds:0,executable:"/inert/app")
    let declaration = StartupAXDeclaration(path:"/inert/receipt",nonce:String(repeating:"a",count:64),
        helper_path:helper.executable,helper_sha256:String(repeating:"b",count:64),
        support_sha256:["StartupAXGuard.swift":String(repeating:"c",count:64),"StartupAXReceipt.swift":String(repeating:"e",count:64)],
        owner_pid:200,deadline_ns:"100000000000")
    let client = StartupAXClient(declaration,configurationSHA:String(repeating:"d",count:64),pid:400,launch:10,window:7,
        executable:target.executable,now:{stamp += 1_000_000;return stamp},pause:{stamp += 31_000_000_000},load:{
            loads += 1
            if loads >= 4 {
                if mode == "final_stale" { stamp = finalEnd + 1_100_000_000 }
                if mode == "final_loss" { throw StartupAXReceiptError.missing }
                return last
            }
            let began: UInt64 = loads == 1 ? 1_000_000_000 : loads == 2 ? 3_100_000_000 : UInt64(published!.entered_ns)! + 10_000_000
            let ended = began + 10_000_000
            stamp = max(stamp,ended+1_000_000); finalEnd = ended
            var observed = StartupAXSurface(surface:"form",root_id:root,panel_id:nil,go_to_id:nil,root_frame:[10,20,100,30],focus:nil)
            if let request = published, mode != "no_proof" {
                observed.interaction = StartupAXInteraction(request_id:mode == "wrong_request" ? UUID().uuidString : request.id,
                    target_id:mode == "target_token" ? "invalid" : UUID().uuidString,
                    point:mode == "wrong_point" ? [21,25] : request.point,
                    anchor_frame:mode == "wrong_anchor" ? [11,20,100,30] : request.anchor_frame,
                    keyboard:mode == "wrong_keyboard" ? !request.keyboard : request.keyboard,
                    focus_checked:mode == "focus_flag" ? !request.keyboard : request.keyboard)
            }
            let receipt = StartupAXReceipt(schema:"nac342-ax-witness-v1",nonce:declaration.nonce,
                configuration_sha256:String(repeating:"d",count:64),helper_sha256:declaration.helper_sha256,
                support_sha256:declaration.support_sha256,trusted:true,helper:helper,target:target,app_launch_epoch:10,
                window_number:7,sequence:String(loads),refusal_generation:loads == 3 && mode == "generation" ? "1" : "0",
                began_ns:String(began),ended_ns:String(ended),status:loads == 3 && mode == "refused" ? "refused" : "ready",
                case_deadline_ns:"50000000000",observation:observed,refusal_stage:nil,refusal:nil)
            last = try JSONEncoder().encode(receipt)
            return last
        })
    do {
        let ticket = try client.begin()
        _ = try client.consume(ticket,surface:.form,rootFrame:CGRect(x:10,y:20,width:100,height:30))
        let request = try client.prepareInteraction(ticket,point:CGPoint(x:20,y:25),anchor:CGRect(x:10,y:20,width:100,height:30),
            kind:"button",label:"Intended",keyboard:false,value:nil,rootFrame:CGRect(x:10,y:20,width:100,height:30),publish:{published=$0})
        try client.finishInteraction(request,clear:{if mode == "clear_loss" { throw StartupAXReceiptError.invalid };clears += 1})
        inputs += 1
        return ["accepted":true,"inputs":inputs,"loads":loads,"clears":clears,"proofs":client.interactions.count,
                "deadline":request.deadline_ns,"finalized":client.interactions[0].finalized_ns]
    } catch {
        var denied = false
        do { _ = try client.begin() } catch { denied = true }
        return ["accepted":false,"inputs":inputs,"clears":clears,"next_denied":denied]
    }
}
func interactionPolicyRun(_ name: String) -> [String: Any] {
    let mode = String(name.dropFirst("point_".count)), anchor = CGRect(x:10,y:20,width:100,height:30)
    do {
        let selected = try StartupInteractionPolicy.target(hit: mode == "occluded" || mode == "owned_occluder" ? 4 : 1,
            owner:mode == "depth" ? 100 : 3,pid:400,anchor:anchor,roles:["AXButton"],label:"Intended",project:{ token in
                let owner: Int32 = token == 4 && mode == "occluded" ? 500 : 400
                let role = token == 2 || (token == 1 && mode == "ambiguous") ? "AXButton" : "AXGroup"
                let frame = role == "AXButton" ? (mode == "moved" ? anchor.offsetBy(dx:1,dy:0) : anchor) : .zero
                return (owner,role,frame,mode == "wrong_label" ? "Occluder" : "Intended")
            },parent:{token in
                if mode == "cycle" { return 1 }
                if mode == "owned_occluder" { return nil }
                if mode == "depth" { return token+1 }
                return token == 1 ? 2 : token == 2 ? 3 : nil
            })
        var binding = StartupInteractionPolicy.Binding<Int>()
        var targets = StartupInteractionPolicy.Targets<Int>()
        let retained = binding.accept("one",target:selected)
            && binding.accept("one",target:mode == "replaced" ? 9 : selected)
            && targets.accept("field",target:selected)
            && targets.accept("field",target:mode == "later_replacement" ? 9 : selected)
        let point = CGPoint(x:20,y:25)
        let unchanged = StartupInteractionPolicy.unchanged(point:mode == "point_changed" ? CGPoint(x:21,y:25) : point,
            expected:point,anchor:mode == "anchor_changed" ? anchor.offsetBy(dx:1,dy:0) : anchor,expectedAnchor:anchor,
            root:mode == "root_changed" ? anchor.offsetBy(dx:1,dy:0) : anchor,expectedRoot:anchor)
        return ["accepted":retained && unchanged]
    } catch { return ["accepted":false] }
}

final class InertOriginalFailure: Error {}

// Compile-only actor scope control, never instantiated or invoked. The catch
// is extracted from the real journey; XCUI SDK compilation is still separate.
@MainActor final class InertJourneyActorScope {
    private func guardWindow() throws {}
    func journey(_ failureEvidence: StartupFailureEvidence) throws {
        defer {}
        do {
            func guardTarget() throws { try guardWindow() }
            func dispatch() throws { try guardWindow(); try guardTarget() }
            try dispatch()
        __JOURNEY_FAILURE_CATCH__
    }
}

func firstFailureRun(_ mode: String) -> [String: Any] {
    var directory = URL(fileURLWithPath: ProcessInfo.processInfo.environment["NAC342_INERT_FILE_ROOT"]!)
        .appendingPathComponent(UUID().uuidString)
    try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false,
        attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(at: directory) }
    if mode != "first_alias" {
        let resolved = realpath(directory.path, nil)!
        directory = URL(fileURLWithPath: String(cString: resolved)); free(resolved)
    }
    var info = stat()
    let statOK = lstat(directory.path, &info) == 0
    let frontier: [String: Bool] = ["canonical": StartupAXFiles.canonical(directory.path), "stat": statOK,
        "directory": info.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR), "uid": info.st_uid == getuid(),
        "mode": info.st_mode & 0o777 == 0o700]
    let declaration = StartupAXDeclaration(path: directory.appendingPathComponent("receipt.json").path,
        nonce: String(repeating: "a", count: 64), helper_path: "/inert", helper_sha256: "", support_sha256: [:], owner_pid: 1, deadline_ns: "1")
    let recorder = StartupFailureEvidence(mode == "first_unconfigured" ? nil : declaration,
        configurationSHA: String(repeating: "b", count: 64))
    recorder.step = .prepare_interaction; recorder.operationIndex = 1
    let errors: [String: Error] = ["missing": StartupAXReceiptError.missing, "invalid": StartupAXReceiptError.invalid,
        "refused": StartupAXReceiptError.refused, "expired": StartupAXReceiptError.expired,
        "decoding": DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "PRIVATE-CANARY")),
        "foundation": CocoaError(.fileReadUnknown), "other": NSError(domain: "PRIVATE-CANARY", code: 1),
        "identity": InertOriginalFailure()]
    let selected = String(mode.dropFirst("first_".count)), error = errors[selected] ?? errors["other"]!
    let path = declaration.path + ".failure"
    if selected == "publish_failure" { try! FileManager.default.removeItem(at: directory) }
    var beforeTeardown = false, events: [String] = []
    func ui() throws {
        defer { beforeTeardown = FileManager.default.fileExists(atPath: path); events.append("teardown") }
        let failureEvidence = recorder
        do {
            if selected != "success" { events.append("throw"); throw error }
        __JOURNEY_FAILURE_CATCH__
    }
    var preserved = false
    do { try ui() } catch let caught {
        preserved = selected == "identity" ? (caught as? InertOriginalFailure) === (error as? InertOriginalFailure)
            : StartupFailureEvidence.family(caught) == StartupFailureEvidence.family(error)
    }
    events.append("api_absent") // Inert subsequent listener sample, no OS query.
    let first = try? Data(contentsOf: URL(fileURLWithPath: path))
    if selected == "publish_failure" {
        // A recovered writable port must not retry the first failed publication.
        try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700])
    }
    recorder.step = .terminal
    if selected != "success" { recorder.capture(StartupAXReceiptError.expired) }
    let unchanged = first == (try? Data(contentsOf: URL(fileURLWithPath: path)))
    let row = first.flatMap { try? JSONSerialization.jsonObject(with: $0) } ?? NSNull()
    return ["record": row, "before_teardown": beforeTeardown, "original_preserved": preserved,
            "unchanged": unchanged, "order": events, "publisher_parent": frontier]
}


func floatSelectionRun(_ name: String) -> [String: Any] {
    let mode = String(name.dropFirst("float_".count)), ulp = Double(Float(120).nextUp) - 120
    var anchor = CGRect(x:100,y:20,width:40,height:30), preferred = CGPoint(x:120,y:35)
    switch mode {
    case "fractional", "readback": anchor.origin.x += 1.0/1048576; preferred.x = anchor.midX
    case "lower": anchor = CGRect(x:120,y:20,width:2*ulp,height:30); preferred.x = 120+ulp/4
    case "upper": anchor = CGRect(x:120,y:20,width:2*ulp,height:30); preferred.x = 120+2*ulp-ulp/4
    case "tie_even": preferred.x = 120+ulp/2
    case "tie_next": preferred.x = 120+ulp+ulp/2
    case "tiny": anchor = CGRect(x:120+ulp/4,y:20,width:ulp/4,height:30); preferred.x = anchor.midX
    case "boundary_only": anchor = CGRect(x:0,y:20,width:1e-100,height:30); preferred.x = anchor.midX
    case "empty": anchor.size.width = 0
    case "negative": anchor.size.width = -40
    case "infinite": anchor.origin.x = .infinity
    case "native_infinite": anchor = .infinite; preferred = .zero
    case "nan": anchor.size.height = .nan
    default: break
    }
    struct Coordinate { let point: CGPoint; let id: Int }
    var offsets = 0, publications = 0, inputs = 0
    do {
        let (coordinate, point) = try StartupInteractionPolicy.selectCoordinate(anchor: anchor,
            center: Coordinate(point: preferred,id:1), screenPoint: { $0.point }, offset: { original, delta in
                offsets += 1
                return Coordinate(point: mode == "readback" ? original.point :
                    CGPoint(x:original.point.x+delta.dx,y:original.point.y+delta.dy),id:2)
            })
        let request = StartupAXInteractionRequest(schema:"nac342-ax-interaction-v1",nonce:String(repeating:"a",count:64),
            configuration_sha256:String(repeating:"b",count:64),id:UUID().uuidString,root_id:UUID().uuidString,
            entered_ns:"1",deadline_ns:"100",baseline_sequence:"1",refusal_generation:"0",surface:"form",kind:"button",
            label:"Intended",keyboard:false,point:[point.x,point.y],anchor_frame:[anchor.minX,anchor.minY,anchor.width,anchor.height],
            root_frame:[0,0,1024,674],value:nil)
        if mode == "native_infinite" {
            let decoded = try JSONDecoder().decode(StartupAXInteractionRequest.self, from: JSONEncoder().encode(request))
            for candidate in [request, decoded] {
                do { try candidate.validate(); publications += 1; inputs += 1 } catch {}
            }
            return ["accepted": publications > 0, "publications": publications, "inputs": inputs,
                    "native_is_infinite": anchor.isInfinite, "selected_zero": point == .zero]
        }
        try request.validate(); publications += 1
        try StartupAXFiles.need(coordinate.point == point && StartupInteractionPolicy.unchanged(point:coordinate.point,
            expected:point,anchor:anchor,expectedAnchor:anchor,root:anchor,expectedRoot:anchor))
        inputs += 1 // Same retained coordinate, inert input only.
        return ["accepted":true,"point_x":point.x,"coordinate_x":coordinate.point.x,"coordinate_id":coordinate.id,
                "offsets":offsets,"publications":publications,"inputs":inputs]
    } catch { return ["accepted":false,"publications":publications,"inputs":inputs] }
}

let modes = try JSONSerialization.jsonObject(with: FileHandle.standardInput.readDataToEndOfFile()) as! [String]
let rows = modes.map { $0.hasPrefix("float_") ? floatSelectionRun($0) : $0.hasPrefix("first_") ? firstFailureRun($0) : $0.hasPrefix("request_") ? requestRun($0) : $0.hasPrefix("interaction_") ? interactionRun($0) : $0.hasPrefix("point_") ? interactionPolicyRun($0) : $0.hasPrefix("publication_") ? publicationRun($0) : $0.hasPrefix("loss_") ? lossRun($0) : $0 == "identity" ? identityProof() : ($0.hasPrefix("focus_") || $0.hasPrefix("stale_focus")) ? focusRun($0) : $0.hasPrefix("file_") ? fileRun($0) : run($0) }
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
        catch = '        } catch {\n            failureEvidence.capture(error)' + journey_failure_catch()
        driver.write_text(DRIVER.replace('        __JOURNEY_FAILURE_CATCH__', catch))
        cls.binary = root / 'inert-client'
        sources = [Path(__file__).with_name(n) for n in ('StartupAXGuard.swift', 'StartupAXReceipt.swift')]
        result = subprocess.run(['/usr/bin/xcrun', 'swiftc', '-swift-version', '5', *map(str,sources), str(driver), '-o', str(cls.binary)],
                       capture_output=True, text=True, timeout=60)
        if result.returncode: raise AssertionError(result.stderr)

    def rows(self, modes, timeout=10):
        return json.loads(subprocess.check_output([str(self.binary)], input=json.dumps(modes), text=True, timeout=timeout,
                         env=dict(os.environ,NAC342_INERT_FILE_ROOT=self.temporary.name)))

    def test_float_selection_constructs_and_reads_back_the_same_representable_public_coordinate(self):
        modes = ['integer', 'fractional', 'lower', 'upper', 'tie_even', 'tie_next',
                 'tiny', 'boundary_only', 'empty', 'negative', 'infinite', 'nan', 'readback', 'native_infinite']
        rows = self.rows(['float_' + mode for mode in modes])
        for mode, row in zip(modes[:6], rows[:6]):
            with self.subTest(mode=mode):
                self.assertTrue(row['accepted'])
                self.assertEqual(row['point_x'], row['coordinate_x'])
                self.assertEqual((row['publications'],row['inputs']),(1,1))
        self.assertEqual((rows[0]['point_x'],rows[0]['coordinate_id'],rows[0]['offsets']),(120,1,0))
        self.assertEqual((rows[1]['point_x'],rows[1]['coordinate_id'],rows[1]['offsets']),(120,2,1))
        import struct
        ulp = struct.unpack('f',struct.pack('I',struct.unpack('I',struct.pack('f',120))[0]+1))[0]-120
        self.assertEqual([rows[i]['point_x'] for i in (2,3,4,5)],[120+ulp,120+ulp,120,120+2*ulp])
        self.assertEqual(rows[6:13],[dict(accepted=False,publications=0,inputs=0)]*7)
        self.assertEqual(rows[13], dict(accepted=False,publications=0,inputs=0,
                                       native_is_infinite=True,selected_zero=True))

    def test_first_real_journey_failure_is_closed_and_published_before_teardown_without_replacing_error(self):
        modes = ['missing', 'invalid', 'refused', 'expired', 'decoding', 'foundation', 'other', 'publish_failure']
        rows = self.rows(['first_' + mode for mode in modes])
        for mode, row in zip(modes, rows):
            with self.subTest(mode=mode):
                self.assertTrue(row['original_preserved'])
                self.assertTrue(row['unchanged'])
                self.assertEqual(row['order'], ['throw', 'teardown', 'api_absent'])
                self.assertEqual(row['before_teardown'], mode != 'publish_failure')
                if mode == 'publish_failure':
                    self.assertIsNone(row['record'])
                else:
                    self.assertEqual(row['record'], dict(schema='nac342-first-preflight-failure-v1', acceptance=False,
                        nonce='a'*64, configuration_sha256='b'*64, step='prepare_interaction', operation_index=1,
                        error_family='receipt_' + mode if mode in modes[:4] else mode))
                self.assertNotIn('PRIVATE-CANARY', json.dumps(row))

    def test_actual_journey_catch_preserves_error_identity_and_does_not_publish_success_or_unconfigured(self):
        identity, success, unconfigured = self.rows(['first_identity', 'first_success', 'first_unconfigured'])
        self.assertTrue(identity['original_preserved'])
        self.assertTrue(identity['before_teardown'])
        self.assertEqual(identity['record']['error_family'], 'other')
        self.assertEqual(success['order'], ['teardown', 'api_absent'])
        self.assertFalse(success['before_teardown'])
        self.assertIsNone(success['record'])
        self.assertTrue(unconfigured['original_preserved'])
        self.assertFalse(unconfigured['before_teardown'])
        self.assertIsNone(unconfigured['record'])

    def test_real_private_request_port_accepts_only_closed_bound_finite_interaction_shapes(self):
        modes = ['positive', 'point', 'precision', 'frame', 'deadline', 'clock', 'kind', 'root',
                 'label', 'value', 'oversize_value', 'unknown', 'duplicate']
        self.assertEqual(self.rows(['request_' + m for m in modes]), [{'accepted':True}] + [{'accepted':False}] * 12)

    def test_exported_interaction_evidence_contains_no_private_request_label_or_value(self):
        receipt = Path(__file__).with_name('StartupAXReceipt.swift').read_text()
        evidence = receipt.split('struct InteractionEvidence:', 1)[1].split('private(set) var interactions', 1)[0]
        for private in ('label', 'value', 'focus.value'):
            self.assertNotIn(private, evidence)
        self.assertIn('finalized_ns', evidence)

    def test_selected_point_proof_and_final_consumption_authorize_exactly_one_inert_input(self):
        row = self.rows(['interaction_positive'])[0]
        self.assertTrue(row['accepted'])
        self.assertEqual((row['inputs'], row['loads'], row['clears'], row['proofs']), (1, 4, 1, 1))
        self.assertEqual(row['deadline'], '33001000000')
        self.assertGreater(int(row['finalized']), 0)

    def test_wrong_proof_refusal_stale_final_or_lost_channel_latches_no_next_input(self):
        modes = ['wrong_request', 'wrong_point', 'wrong_anchor', 'wrong_keyboard', 'focus_flag',
                 'target_token', 'generation', 'refused', 'no_proof', 'final_stale', 'final_loss', 'clear_loss']
        for mode, row in zip(modes, self.rows(['interaction_' + m for m in modes])):
            with self.subTest(mode=mode):
                self.assertEqual(row, dict(accepted=False, inputs=0, clears=0, next_denied=True))

    def test_global_hit_ancestry_rejects_foreign_and_same_pid_occlusion_ambiguity_cycles_and_replacement(self):
        modes = ['positive', 'occluded', 'owned_occluder', 'ambiguous', 'cycle', 'depth', 'moved', 'replaced', 'wrong_label', 'later_replacement']
        self.assertEqual(self.rows(['point_' + m for m in modes]), [{'accepted':True}] + [{'accepted':False}] * 9)

    def test_immediate_recheck_refuses_changed_point_anchor_or_root(self):
        self.assertEqual(self.rows(['point_point_changed', 'point_anchor_changed', 'point_root_changed']),
                         [{'accepted':False}] * 3)

    def test_stale_valid_waits_for_fresh_publication_using_only_fresh_evidence(self):
        for mode, loads, pauses in [('stale_then_fresh', 3, 1), ('repeat_then_fresh', 4, 2)]:
            with self.subTest(mode=mode):
                row = self.rows(['publication_' + mode])[0]
                self.assertTrue(row['accepted'])
                self.assertEqual((row['inputs'], row['loads'], row['pauses'], row['proof']),
                                 (1, loads, pauses, ['3']))
                self.assertEqual(row['deadline'], '33001000000')
                self.assertLess(int(row['now']), int(row['deadline']))

    def test_repeated_stale_positive_expires_at_original_ticket_without_input(self):
        row = self.rows(['publication_deadline'])[0]
        self.assertFalse(row['accepted'])
        self.assertEqual((row['inputs'], row['proof'], row['error']), (0, [], 'expired'))
        self.assertEqual(row['deadline'], '33001000000')
        self.assertGreater(row['pauses'], 1)
        self.assertGreaterEqual(int(row['now']), int(row['deadline']))

    def test_stale_invalid_refusal_duration_geometry_or_ownership_is_terminal(self):
        modes = ['surface', 'frame', 'duration', 'refused', 'generation', 'ownership', 'malformed', 'oversize']
        for mode, row in zip(modes, self.rows(['publication_' + m for m in modes])):
            with self.subTest(mode=mode):
                self.assertFalse(row['accepted'])
                self.assertEqual((row['inputs'], row['loads'], row['pauses'], row['proof']), (0, 2, 0, []))

    def test_stale_then_generation_loss_rollback_changed_bytes_or_case_deadline_is_terminal(self):
        modes = ['generation_after_stale', 'lost_after_stale', 'rollback_after_stale',
                 'changed_after_stale', 'deadline_after_stale']
        for mode, row in zip(modes, self.rows(['publication_' + m for m in modes])):
            with self.subTest(mode=mode):
                self.assertFalse(row['accepted'])
                self.assertEqual((row['inputs'], row['loads'], row['pauses'], row['proof']), (0, 3, 1, []))

    def test_initial_waiting_preentry_and_unchanged_publication_still_wait(self):
        for mode in ['initial_waiting', 'preentry', 'unchanged']:
            with self.subTest(mode=mode):
                row = self.rows(['publication_' + mode])[0]
                self.assertTrue(row['accepted'])
                self.assertEqual((row['inputs'], row['loads'], row['pauses']), (1, 3, 1))

    def test_sample_crossing_one_second_at_final_consumption_is_not_accepted(self):
        row = self.rows(['publication_final_age'])[0]
        self.assertFalse(row['accepted'])
        self.assertEqual((row['inputs'], row['loads'], row['pauses'], row['proof']), (0, 2, 0, []))

    def test_stale_go_to_focus_is_validated_before_waiting_for_fresh(self):
        modes = ['stale_focus_positive', 'stale_focus_pid', 'stale_focus_role', 'stale_focus_false',
                 'stale_focus_ancestor', 'stale_focus_frame', 'stale_focus_value']
        rows = self.rows(modes)
        self.assertTrue(rows[0]['accepted'])
        self.assertEqual((rows[0]['loads'], rows[0]['pauses'], rows[0]['proof']), (7, 1, ['2', '3', '5']))
        for mode, row in zip(modes[1:], rows[1:]):
            with self.subTest(mode=mode):
                self.assertFalse(row['accepted'])
                self.assertEqual((row['inputs'], row['loads'], row['pauses'], row['proof']),
                                 (0, 6, 0, ['2', '3']))

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
