#if PREVIEW_SMOKE && !LOCAL_APP
import Foundation

/// At most one additional instance of the existing loopback fixture. The fence
/// separately consumes each authority forever, even when this owner fails.
@MainActor
final class OfflineHTTPControlTarget {
    private var active: FixtureProvider?
    private var baseline: Int?
    private var retirementDeadline: TimeInterval?
    private var settlementAttempted = false
    var policy: OfflineProviderPolicy? { active?.offline }

    func open() async throws -> URL {
        guard active == nil else { throw OfflineProviderPolicy.Refusal.invalid }
        let provider = FixtureProvider()
        provider.offline = OfflineProviderPolicy()
        active = provider
        do {
            try await provider.start()
            guard active === provider, !Task.isCancelled else { throw OfflineProviderPolicy.Refusal.invalid }
            return try OfflineProviderPolicy.loopback(provider.baseURL)
        } catch {
            close()
            try? await settle()
            throw error
        }
    }

    func acceptBaseline(_ token: String) throws {
        guard baseline == nil, let policy, !policy.retired,
              policy.directRequests == 1, policy.directCount(token) == 1 else {
            throw OfflineProviderPolicy.Refusal.missingObservation
        }
        baseline = policy.directRequests
    }

    func finish() async throws {
        let primary: Error?
        if let policy, let baseline, !policy.retired, policy.directRequests == baseline { primary = nil }
        else { primary = OfflineProviderPolicy.Refusal.missingObservation }
        do { try await settle() }
        catch { throw primary ?? error }
        if let primary { throw primary }
    }

    func close() {
        guard let provider = active, retirementDeadline == nil else { return }
        retirementDeadline = ProcessInfo.processInfo.systemUptime + 2
        provider.offline?.retire()
        provider.stop()
    }

    func settle() async throws {
        guard let provider = active else { return }
        close()
        guard !settlementAttempted, let deadline = retirementDeadline else { throw OfflineProviderPolicy.Refusal.invalid }
        settlementAttempted = true
        // One observation under the original retirement clock. Failure retains
        // the retired owner and refuses a successor; no automatic wait retry.
        try await provider.awaitOfflineControlStop(deadline: deadline)
        guard active === provider else { throw OfflineProviderPolicy.Refusal.invalid }
        active = nil
        baseline = nil
        retirementDeadline = nil
        settlementAttempted = false
    }
}
#endif
