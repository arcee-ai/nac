// Compile with the exact pure callback/error definitions extracted from InstanceSmoke.swift.
@main
enum InstanceWorkspaceCompletionTests {
    @MainActor
    static func main() async throws {
        let first: String = try await withCheckedThrowingContinuation { continuation in
            let completion = InstanceWorkspaceCompletion<String>(continuation, timeout: 1, label: "success")
            completion.finish(.success("first"))
            completion.finish(.failure(InstanceFixtureError("duplicate")))
        }
        precondition(first == "first")

        var late: InstanceWorkspaceCompletion<String>?
        let start = ProcessInfo.processInfo.systemUptime
        do {
            let _: String = try await withCheckedThrowingContinuation { continuation in
                late = InstanceWorkspaceCompletion<String>(continuation, timeout: 0.01, label: "missing callback")
            }
            preconditionFailure("A missing WebKit callback must not produce readiness")
        } catch {
            precondition(error.localizedDescription == "Timed out: missing callback")
            precondition(ProcessInfo.processInfo.systemUptime - start < 2)
        }
        late?.finish(.success("retired late callback"))
        late?.finish(.failure(InstanceFixtureError("late duplicate")))
        late = nil
        print("Workspace callback success, timeout and late/duplicate completion controls passed")

        let atLimit = Data(repeating: 0, count: 2 * 1024 * 1024)
        try validateWorkspaceSnapshotSize(atLimit)
        do {
            try validateWorkspaceSnapshotSize(atLimit + Data([0]))
            preconditionFailure("Oversized diagnostic PNG must not reach the exporter")
        } catch {
            precondition(error.localizedDescription ==
                "Failure WK snapshot exceeds the 2 MiB export limit; pixel evidence not retained")
        }
        print("Exact 2 MiB snapshot boundary and explicit oversized coverage-gap controls passed")
    }
}
