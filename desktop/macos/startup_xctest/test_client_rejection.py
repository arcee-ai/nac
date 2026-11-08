"""Passive projection source fences and explicitly bound actor-free caller controls."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import unittest

class ClientRejectionSourceControls(unittest.TestCase):
    def test_same_read_and_original_error_with_content_free_first_record(self):
        source=Path(__file__).with_name('StartupAXReceipt.swift').read_text()
        branch=source.split('if receipt.status != "ready" {',1)[1].split('guard let observation',1)[0]
        self.assertIn('if rejectionContext == nil',branch)
        self.assertTrue(branch.rstrip().endswith('}'))
        self.assertIn('throw StartupAXReceiptError.refused',branch)
        self.assertNotIn('try load()',branch)
        self.assertNotIn('now()',branch)
        self.assertNotIn('focus.value',branch)
        self.assertIn('read(phase: "begin")',source)
        self.assertIn('read(phase: "consume")',source)

    def test_optional_attachment_is_independent_of_missing_reader_data(self):
        source=Path(__file__).with_name('StartupJourneys.swift').read_text()
        catch=source.split('if !clientRejectionEmitted',1)[1].split('throw error',1)[0]
        self.assertIn('axClient?.rejectionContext',catch)
        self.assertIn('data.count <= 2048',catch)
        self.assertLess(catch.index('JSONSerialization.isValidJSONObject(record)'),catch.index('JSONSerialization.data(withJSONObject: record'))
        self.assertIn('try? attachment',catch)
        self.assertLess(catch.index('rejection-v1'),catch.index('axClient?.failureData'))
        self.assertIn('initialGuardPending = false',source)

# Compiled only by the explicitly admitted actor-free caller control, never XCT/AX.
CALLER_DRIVER = r'''
import Foundation
struct HeldFixture {
    let scenario="configuredLocal", source_sha=String(repeating:"a",count:40)
    let test_source_sha=String(repeating:"b",count:40), harness_sha=String(repeating:"c",count:40)
    let startup_source_sha256=String(repeating:"d",count:64)
}
struct HeldClient {var rejectionContext:[String:Any]?; var failureData:Data?}
struct HeldSurface {let rawValue="form"}
struct HeldRunning {let processIdentifier=400}
func runCaller(_ mode:String)->[String:Any] {
    var record:[String:Any] = ["schema":"nac342-ax-client-rejection-v1","acceptance":false]
    if mode=="oversize" {record["oversize"]=String(repeating:"x",count:2049)}
    if mode=="nonfinite" {record["bad"]=Double.nan}
    let axClient:HeldClient?=HeldClient(rejectionContext:mode=="absent" ? nil : record,
        failureData:mode=="reader" ? Data("{\"terminal_refusal\":{\"stage\":\"owned_pid\"}}".utf8) : nil)
    let fixture=HeldFixture(), folderSurface=HeldSurface(), running=HeldRunning()
    let launch=Date(timeIntervalSince1970:10), number=7, bytes=Data()
    var clientRejectionEmitted=false, axRefusalEmitted=false
    let initialGuardPending=mode != "later"
    let marker=NSError(domain:"original",code:7), sink=NSError(domain:"sink",code:9)
    var emitted:[[String:Any]]=[], identities:[Bool]=[], attempts=0
    func json(_ data:Data)throws->[String:Any] {try JSONSerialization.jsonObject(with:data) as! [String:Any]}
    func digest(_ data:Data)->String {String(repeating:"e",count:64)}
    func attachment(_ row:[String:Any],name:String)throws {
        attempts += 1
        if mode=="sink" {throw sink}
        emitted.append(["name":name,"record":row])
    }
    for _ in 0..<2 {
        do {
            do {throw marker} catch {
                // CATCH_BODY
            }
        } catch {identities.append((error as NSError) === marker)}
    }
    return ["identities":identities,"attempts":attempts,"emitted":emitted]
}
let modes=try JSONSerialization.jsonObject(with:FileHandle.standardInput.readDataToEndOfFile()) as! [String]
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:modes.map(runCaller)))
'''


def caller_source():
    source=Path(__file__).with_name('StartupJourneys.swift').read_text()
    guard=source.split('        func guardTarget() throws {',1)[1].split('        func dispatch(',1)[0]
    catch=guard.split('            } catch {',1)[1].rsplit('            }\n        }',1)[0]
    return CALLER_DRIVER.replace('// CATCH_BODY',catch)


@unittest.skipUnless(os.environ.get('NAC342_CLIENT_CALLER_BINARY'), 'Explicit actor-free caller binary binding required')
class CallerControls(unittest.TestCase):
    def test_exact_catch_preserves_original_error_object_and_optional_first_only_failures(self):
        binary=Path(os.environ['NAC342_CLIENT_CALLER_BINARY'])
        self.assertEqual(hashlib.sha256(binary.read_bytes()).hexdigest(),os.environ['NAC342_CLIENT_CALLER_BINARY_SHA256'])
        self.assertEqual(hashlib.sha256(caller_source().encode()).hexdigest(),os.environ['NAC342_CLIENT_CALLER_SOURCE_SHA256'])
        modes=['initial','later','reader','absent','oversize','nonfinite','sink']
        rows=json.loads(subprocess.check_output([str(binary)],input=json.dumps(modes).encode(),timeout=10))
        for mode,row in zip(modes,rows):
            with self.subTest(mode=mode):
                self.assertEqual(row['identities'],[True,True])
                self.assertEqual(row['attempts'],2 if mode=='reader' else 0 if mode in ['absent','oversize','nonfinite'] else 1)
        self.assertEqual(rows[0]['emitted'][0]['record']['guard_site'],'initial_guard')
        self.assertEqual(rows[1]['emitted'][0]['record']['guard_site'],'later_guard')
        self.assertEqual(len(rows[2]['emitted']),2)
        self.assertIn('client-rejection',rows[2]['emitted'][0]['name'])
        self.assertIn('ax-refusal',rows[2]['emitted'][1]['name'])
