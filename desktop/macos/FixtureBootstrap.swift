import Foundation

/// Seeds only disposable model/project configuration. Session creation, chat,
/// streaming and history stay in the production React/HTTP workflows.
enum FixtureBootstrap {
    static func seed(base: URL, profile: PreviewProfile, provider: FixtureProvider,
                     seedModel: Bool = true, session: URLSession? = nil) async throws -> String {
        var projectBody: [String: Any] = ["name": "Disposable Mac preview", "cwd": profile.workspace.path]
        if seedModel {
            let configuration = try await post(base, "model-configs", [
                "name": "Mac preview — deterministic local fixture", "backend": "openai-responses",
                "model": "gpt-5.6-sol", "base_url": provider.baseURL.absoluteString,
                "api_key": "preview-dummy-only", "reasoning_effort": "high", "extra_headers": [:],
                "orchestrator_compaction_threshold": 0], session: session)
            guard let configID = configuration["config_id"] as? String else {
                throw PreviewError.message("Fixture configuration returned no identifier")
            }
            projectBody["default_model_config_id"] = configID
        }
        let project = try await post(base, "projects", projectBody, session: session)
        guard let projectID = project["project_id"] as? String else {
            throw PreviewError.message("Fixture project returned no identifier")
        }
        return projectID
    }

    private static func post(_ base: URL, _ path: String, _ body: [String: Any], session supplied: URLSession?) async throws -> [String: Any] {
        var request = URLRequest(url: base.appendingPathComponent(path), timeoutInterval: 10)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let session = supplied ?? URLSession(configuration: .ephemeral)
        defer { if supplied == nil { session.invalidateAndCancel() } }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw PreviewError.message("Fixture setup failed at /\(path): \(String(decoding: data, as: UTF8.self))")
        }
        return json
    }
}
