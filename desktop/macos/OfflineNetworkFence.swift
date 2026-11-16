#if PREVIEW_SMOKE && !LOCAL_APP
import Foundation
import Network
import WebKit

/// One immutable HTTP(S) outage simulation, not a whole-process/OS sandbox.
@MainActor
final class OfflineNetworkFence {
    let policy: OfflineProviderPolicy
    let origin: URL
    let store: WKWebsiteDataStore
    let session: URLSession
    private let provider: FixtureProvider
    private let httpTarget = OfflineHTTPControlTarget()
    private var completedPhases = Set<String>()
    private(set) var diagnosticStage = "constructed"

    init(provider: FixtureProvider, view: WKWebView) throws {
        guard OfflineProviderPolicy.selected(), provider.offline == nil,
              view.url == nil || view.url?.absoluteString == "about:blank" else {
            throw OfflineProviderPolicy.Refusal.invalid
        }
        origin = try OfflineProviderPolicy.loopback(provider.baseURL)
        self.provider = provider
        policy = OfflineProviderPolicy()
        store = view.configuration.websiteDataStore
        guard !store.isPersistent, store.proxyConfigurations.isEmpty else { throw OfflineProviderPolicy.Refusal.invalid }
        var proxy = ProxyConfiguration(httpCONNECTProxy: .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: UInt16(origin.port!))!))
        proxy.allowFailover = false
        proxy.excludedDomains = ["127.0.0.1"]
        store.proxyConfigurations = [proxy]
        let configuration = URLSessionConfiguration.ephemeral
        configuration.proxyConfigurations = [proxy]
        configuration.timeoutIntervalForRequest = 5
        configuration.timeoutIntervalForResource = 8
        configuration.urlCache = nil
        configuration.urlCredentialStorage = nil
        configuration.httpCookieStorage = nil
        session = URLSession(configuration: configuration)
        provider.offline = policy
    }

    func close() { httpTarget.close(); session.invalidateAndCancel() }

    func requireStore(_ view: WKWebView) throws {
        guard view.configuration.websiteDataStore === store, !store.isPersistent,
              store.proxyConfigurations.count == 1,
              store.proxyConfigurations[0].allowFailover == false,
              store.proxyConfigurations[0].excludedDomains == ["127.0.0.1"] else {
            throw OfflineProviderPolicy.Refusal.invalid
        }
    }

    func target(token: String, host: String = "127.0.0.1", secure: Bool = false) -> URL {
        var parts = URLComponents()
        parts.scheme = secure ? "https" : "http"
        parts.host = host
        parts.port = secure ? 443 : origin.port
        parts.path = "/offline-canary/" + token
        return parts.url!
    }

    private func authority(_ url: URL) -> String { url.host! + ":" + String(url.port ?? 443) }

    private func native(_ url: URL, using client: URLSession) async throws -> (Int, String?) {
        let (data, response) = try await client.data(for: URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
        guard data.count < 8192 else { throw OfflineProviderPolicy.Refusal.invalid }
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        return ((response as? HTTPURLResponse)?.statusCode ?? -1, json?["nonce"] as? String)
    }

    func initialControls() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.connectionProxyDictionary = [:] // Reference is local-only, not a fence fallback.
        config.timeoutIntervalForRequest = 5; config.timeoutIntervalForResource = 8
        config.urlCache = nil
        let baseline = URLSession(configuration: config)
        defer { baseline.invalidateAndCancel() }
        let reference = OfflineWebProbe(store: .nonPersistent())
        defer { reference.close() }
        for kind in ["native", "wk-fetch", "wk-navigation"] {
            diagnosticStage = "reference-" + kind
            let token = try policy.canary(), url = target(token: token, host: "localhost")
            if kind == "native" {
                let (status, nonce) = try await native(url, using: baseline)
                guard status == 200, nonce == token else { throw OfflineProviderPolicy.Refusal.missingObservation }
            } else if kind == "wk-fetch" {
                let result = try await reference.fetch(url, base: origin)
                guard result["status"] as? Int == 200, result["nonce"] as? String == token else { throw OfflineProviderPolicy.Refusal.missingObservation }
            } else {
                guard try await reference.navigate(url) == 200 else { throw OfflineProviderPolicy.Refusal.missingObservation }
            }
            guard policy.directCount(token) == 1 else { throw OfflineProviderPolicy.Refusal.missingObservation }
        }
        // The response fixture must reject missing and wrong keys, even locally.
        diagnosticStage = "reference-key-rejections"
        let before = policy.keyRejected
        for key in ["", "wrong-dummy-key"] {
            var request = URLRequest(url: origin.appendingPathComponent("models"))
            if !key.isEmpty { request.setValue("Bearer " + key, forHTTPHeaderField: "Authorization") }
            let (_, response) = try await baseline.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 401 else { throw OfflineProviderPolicy.Refusal.missingObservation }
        }
        guard policy.keyRejected == before + 2 else { throw OfflineProviderPolicy.Refusal.missingObservation }
        try await controls("before")
        diagnosticStage = "initial-controls-complete"
    }

    /// New owned authority for every HTTP operation, including clients that
    /// tunnel HTTP via CONNECT and therefore hide its nonce/path from the proxy.
    func httpControl(_ label: String, providerRequest: Bool = false,
                     operation: (URL) async throws -> Void) async throws {
        let owned = try await httpTarget.open()
        defer { httpTarget.close() }
        do {
            guard let targetPolicy = httpTarget.policy else { throw OfflineProviderPolicy.Refusal.invalid }
            let token = try targetPolicy.canary()
            var parts = URLComponents(url: owned, resolvingAgainstBaseURL: false)!
            parts.host = "localhost"
            let endpoint = parts.url!
            let canary = endpoint.appendingPathComponent("offline-canary/" + token)
            let path = providerRequest ? "/responses" : canary.path
            try policy.begin(label, authority: authority(endpoint),
                             request: .http(method: providerRequest ? "POST" : "GET", path: path))
            // Reach this exact owned target outside the fence first. This reference
            // session is never used by the product or as a fallback for the control.
            let config = URLSessionConfiguration.ephemeral
            config.connectionProxyDictionary = [:]
            config.timeoutIntervalForRequest = 5; config.timeoutIntervalForResource = 8
            config.urlCache = nil
            let baseline = URLSession(configuration: config)
            defer { baseline.invalidateAndCancel() }
            let (status, nonce) = try await native(canary, using: baseline)
            guard status == 200, nonce == token else { throw OfflineProviderPolicy.Refusal.missingObservation }
            try httpTarget.acceptBaseline(token)
            try await operation(providerRequest ? endpoint : canary)
            try await httpTarget.finish() // Zero additional direct requests and exact cancellation before a successor.
            try policy.finish(label)
        } catch {
            httpTarget.close()
            try? await httpTarget.settle() // No retry if its one original observation already failed.
            throw error
        }
    }

    func controls(_ phase: String) async throws {
        guard ["before", "after"].contains(phase), completedPhases.insert(phase).inserted else { throw OfflineProviderPolicy.Refusal.invalid }
        let probe = OfflineWebProbe(store: store)
        defer { probe.close() }
        for kind in ["native", "wk-fetch", "wk-navigation"] {
            diagnosticStage = phase + "-" + kind + "-loopback"
            let positive = try policy.canary(), allowed = target(token: positive)
            if kind == "native" {
                let (status, nonce) = try await native(allowed, using: session)
                guard status == 200, nonce == positive else { throw OfflineProviderPolicy.Refusal.missingObservation }
            } else if kind == "wk-fetch" {
                let facts = try await probe.fetch(allowed, base: origin)
                guard facts["status"] as? Int == 200, facts["nonce"] as? String == positive else { throw OfflineProviderPolicy.Refusal.missingObservation }
            } else { guard try await probe.navigate(allowed) == 200 else { throw OfflineProviderPolicy.Refusal.missingObservation } }
            guard policy.directCount(positive) == 1 else { throw OfflineProviderPolicy.Refusal.missingObservation }
            func attempt(_ url: URL) async throws {
                if kind == "native" {
                    do { _ = try await native(url, using: session) }
                    catch {
                        guard let failure = error as? URLError, failure.code != .timedOut, failure.code != .cancelled else { throw OfflineProviderPolicy.Refusal.missingObservation }
                    }
                } else if kind == "wk-fetch" { _ = try await probe.fetch(url, base: origin) }
                else { _ = try await probe.navigate(url) }
            }
            diagnosticStage = phase + "-" + kind + "-http"
            try await httpControl(phase + "-" + kind + "-http", operation: attempt)
            let token = try policy.canary()
            let url = target(token: token, host: token + ".invalid", secure: true)
            let label = phase + "-" + kind + "-https"
            diagnosticStage = phase + "-" + kind + "-https"
            try policy.begin(label, authority: authority(url), request: .httpsConnect)
            try await attempt(url)
            try policy.finish(label, directToken: token)
        }
    }

    var snapshot: [String: Any] {
        ["scope": "declared-app-engine-HTTP(S)-only", "whole_machine_offline": false,
         "failover_allowed": false, "literal_loopback_bypass": true,
         "baseline_local_reachable": true, "phases": completedPhases.sorted(), "observations": policy.snapshot]
    }
}
#endif
