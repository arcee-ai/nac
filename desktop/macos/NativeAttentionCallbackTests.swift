import Foundation

@main
enum NativeAttentionCallbackTests {
    @MainActor
    static func main() async {
        var late: ((Bool) -> Void)?
        let old = Task { @MainActor in
            await awaitNativeAttention(fallback: false) { late = $0 }
        }
        for _ in 0..<100 where late == nil { await Task.yield() }
        precondition(late != nil)
        old.cancel()
        let cancelled = await old.value
        precondition(!cancelled)
        let successor = await awaitNativeAttention(fallback: false) { $0(true) }
        precondition(successor)
        late?(true); late?(false) // callback consumed once; cannot resume old/successor
        let beforeStart = Task { @MainActor in
            await awaitNativeAttention(fallback: false) { _ in preconditionFailure("Cancelled work issued an OS/storage operation") }
        }
        beforeStart.cancel()
        let notIssued = await beforeStart.value
        precondition(!notIssued)
        print("Cancelled native waiters release once and late callbacks remain inert; no OS delivery claim.")
    }
}
