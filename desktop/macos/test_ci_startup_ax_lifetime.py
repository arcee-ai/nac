"""Compiled canonical lifetime decision with inert metadata; never a witness actor."""
import json,os
from pathlib import Path
import subprocess,tempfile,unittest

@unittest.skipUnless(os.environ.get('NAC342_AX_WITNESS_PROOF')=='1','Explicit inert lifetime proof required')
class LifetimeControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(prefix='nac-ax-retired-inert-');cls.addClassCleanup(cls.temp.cleanup)
        root=Path(cls.temp.name)
        source=Path(__file__).with_name('CIStartupAXWitness.swift').read_text()
        if '// BEGIN AX LIFETIME' in source:
            policy=source.split('// BEGIN AX LIFETIME',1)[1].split('// END AX LIFETIME',1)[0]
        else:
            # Execute the actual predecessor fatal branch, not a mock prediction.
            line=next(line.strip() for line in source.splitlines() if 'need(apps.count == 1)' in line)
            policy='enum StartupAXLifetime { static func outcome(_ snapshot:[String:Any],target:StartupAXProcess,window:Int,latched:inout String?) throws -> String { let apps=(snapshot["nodes"] as! [[String:Any]]).filter{$0["kind"] as? String == "app"}; '+line+'; return "ready" } }'
        # Frozen H4 policy snapshot, SHA256 2eed93937b7268923dba036b579b8fab3bab24af1fdb2bd13ebe6dceb7d01aa7.
        # Self-contained characterization: clean CI needs no private Git object.
        legacy=r'''
// Positive known-identity retirement is terminal, never new ready authority.
enum StartupAXLifetimeLegacy {
    static func outcome(_ snapshot: [String: Any], target: StartupAXProcess, window: Int, latched: inout String?) throws -> String {
        try StartupObserver.need(snapshot["complete"] as? Bool == true && target.valid)
        let apps = (snapshot["nodes"] as! [[String: Any]]).filter { $0["kind"] as? String == "app" }
        try StartupObserver.need(apps.count <= 1)
        if let app = apps.first {
            let keys = ["pid", "parent", "uid", "start_seconds", "start_microseconds", "executable"]
            let current = try JSONDecoder().decode(StartupAXProcess.self,
                from: JSONSerialization.data(withJSONObject: app.filter { keys.contains($0.key) }))
            try StartupObserver.need(current == target && latched != "retired")
            guard let windows = app["windows"] as? [Int] else { throw OwnershipError.invalid }
            if windows.isEmpty { latched = "retiring"; return "retiring" }
            try StartupObserver.need(latched == nil && windows == [window])
            return "ready"
        }
        let retired = snapshot["retired"] as? [[String: Any]] ?? []
        let matches = try retired.filter { row in
            guard row["proof"] as? String == "kill_zero_ESRCH", let identity = row["identity"] as? [String: Any] else { return false }
            return try JSONDecoder().decode(StartupAXProcess.self,
                from: JSONSerialization.data(withJSONObject: identity)) == target
        }
        try StartupObserver.need(matches.count == 1)
        latched = "retired"
        return "retired"
    }
}
'''
        driver=r'''
import Foundation
enum OwnershipError: Error { case invalid }
struct StartupObserver { static func need(_ value:Bool) throws { if !value { throw NSError(domain:"inert",code:1) } } }
'''+policy+legacy+r'''
let process=StartupAXProcess(pid:400,parent:1,uid:Int32(getuid()),start_seconds:3,start_microseconds:4,executable:"/inert/app")
let identity=try JSONSerialization.jsonObject(with:JSONEncoder().encode(process)) as! [String:Any]
let modes=try JSONSerialization.jsonObject(with:FileHandle.standardInput.readDataToEndOfFile()) as! [String]
let rows=modes.map { mode -> [String:Any] in
    var latched:String?=nil
    var retired:[String:Any]=["identity":identity,"proof":"kill_zero_ESRCH"]
    if mode == "unknown" { retired["proof"]="unknown" }
    var snapshot:[String:Any]=["complete":true,"nodes":[],"retired":[retired]]
    if mode == "missing" { snapshot["retired"]=[] }
    if mode == "incomplete" { snapshot["complete"]=false }
    if mode == "replacement" { var app=identity;app["kind"]="app";app["windows"]=[7];app["start_seconds"]=9;snapshot["nodes"]=[app] }
    if mode == "windowless" || mode == "window_reappeared" { var app=identity;app["kind"]="app";app["windows"]=[] as [Int];snapshot["nodes"]=[app] }
    if ["extra", "legacy_extra", "original_lost", "duplicate"].contains(mode) {
        var app=identity;app["kind"]="app"
        app["windows"]=mode == "original_lost" ? [8] : mode == "duplicate" ? [7,7] : [8,7]
        snapshot["nodes"]=[app]
    }
    do {
        let state=try mode == "legacy_extra"
            ? StartupAXLifetimeLegacy.outcome(snapshot,target:process,window:7,latched:&latched)
            : StartupAXLifetime.outcome(snapshot,target:process,window:7,latched:&latched)
        let terminal=state != "ready"
        if mode == "reappeared" || mode == "window_reappeared" || mode == "empty_reappeared" { var app=identity;app["kind"]="app";app["windows"]=[7];if mode == "empty_reappeared" { app["windows"]=[] as [Int] };snapshot["nodes"]=[app];_ = try StartupAXLifetime.outcome(snapshot,target:process,window:7,latched:&latched) }
        return ["terminal":terminal,"latched":latched != nil,"ready": !terminal]
    } catch { return ["rejected":true] }
}
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:rows))
'''
        path=root/'main.swift';path.write_text(driver);cls.binary=root/'inert-lifetime'
        q=Path(os.environ['NAC342_AX_Q_ROOT'])/'desktop/macos/startup_xctest'
        subprocess.run(['/usr/bin/xcrun','swiftc','-swift-version','5',str(q/'StartupAXGuard.swift'),str(q/'StartupAXReceipt.swift'),str(path),'-o',str(cls.binary)],capture_output=True,text=True,timeout=60,check=True)

    def rows(self,modes):
        return json.loads(subprocess.check_output([str(self.binary)],input=json.dumps(modes),text=True,timeout=3))

    def test_actual08_original_refusal_is_characterized_and_only_original_root_custody_is_replaced(self):
        self.assertEqual(self.rows(['legacy_extra','extra','original_lost','duplicate']),
            [{'rejected':True},dict(terminal=False,latched=False,ready=True),{'rejected':True},{'rejected':True}])

    def test_normal_positive_retirement_before_parent_stop_is_terminal_never_ready(self):
        self.assertEqual(self.rows(['normal']),[dict(terminal=True,latched=True,ready=False)])

    def test_window_closure_is_nonready_until_positive_retirement_and_never_reopens(self):
        self.assertEqual(self.rows(['windowless']),[dict(terminal=True,latched=True,ready=False)])
        self.assertEqual(self.rows(['window_reappeared']),[{'rejected':True}])

    def test_missing_unknown_incomplete_replaced_and_reappeared_target_never_qualify(self):
        self.assertEqual(self.rows(['missing','unknown','incomplete','replacement','reappeared','empty_reappeared']),[{'rejected':True}]*6)

if __name__=='__main__':
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(LifetimeControls))
    raise SystemExit(not result.wasSuccessful() or bool(result.skipped) or result.testsRun!=4)
