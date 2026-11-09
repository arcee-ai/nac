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
    private var completedPhases = Set<String>()

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

    func close() { session.invalidateAndCancel() }

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
        let before = policy.keyRejected
        for key in ["", "wrong-dummy-key"] {
            var request = URLRequest(url: origin.appendingPathComponent("models"))
            if !key.isEmpty { request.setValue("Bearer " + key, forHTTPHeaderField: "Authorization") }
            let (_, response) = try await baseline.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 401 else { throw OfflineProviderPolicy.Refusal.missingObservation }
        }
        guard policy.keyRejected == before + 2 else { throw OfflineProviderPolicy.Refusal.missingObservation }
        try await controls("before")
    }

    func controls(_ phase: String) async throws {
        guard ["before", "after"].contains(phase), completedPhases.insert(phase).inserted else { throw OfflineProviderPolicy.Refusal.invalid }
        let probe = OfflineWebProbe(store: store)
        defer { probe.close() }
        for kind in ["native", "wk-fetch", "wk-navigation"] {
            let positive = try policy.canary(), allowed = target(token: positive)
            if kind == "native" {
                let (status, nonce) = try await native(allowed, using: session)
                guard status == 200, nonce == positive else { throw OfflineProviderPolicy.Refusal.missingObservation }
            } else if kind == "wk-fetch" {
                let facts = try await probe.fetch(allowed, base: origin)
                guard facts["status"] as? Int == 200, facts["nonce"] as? String == positive else { throw OfflineProviderPolicy.Refusal.missingObservation }
            } else { guard try await probe.navigate(allowed) == 200 else { throw OfflineProviderPolicy.Refusal.missingObservation } }
            guard policy.directCount(positive) == 1 else { throw OfflineProviderPolicy.Refusal.missingObservation }
            for secure in [false, true] {
                let token = try policy.canary()
                let url = target(token: token, host: secure ? token + ".invalid" : "localhost", secure: secure)
                let label = phase + "-" + kind + (secure ? "-https" : "-http")
                try policy.begin(label, authority: authority(url))
                if kind == "native" {
                    do { _ = try await native(url, using: session) }
                    catch {
                        guard let failure = error as? URLError, failure.code != .timedOut, failure.code != .cancelled else { throw OfflineProviderPolicy.Refusal.missingObservation }
                    }
                } else if kind == "wk-fetch" { _ = try await probe.fetch(url, base: origin) }
                else { _ = try await probe.navigate(url) }
                try policy.finish(label, directToken: token)
            }
        }
    }

    var snapshot: [String: Any] {
        ["scope": "declared-app-engine-HTTP(S)-only", "whole_machine_offline": false,
         "failover_allowed": false, "literal_loopback_bypass": true,
         "baseline_local_reachable": true, "phases": completedPhases.sorted(), "observations": policy.snapshot]
    }
}
#endif
