// External pure Foundation caller of the immutable product's actual resolver.
// Never linked into, launches, or probes an application or engine.
import Foundation

@main
enum StartupEnvironmentResolver {
    struct Input: Decodable {
        let environment: [String: String]
        let cwd: String
        let extra_paths: [String]
    }

    static func main() {
        do {
            guard CommandLine.arguments.count == 2 else { throw invalid() }
            let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
            guard data.count <= 32768 else { throw invalid() }
            let input = try JSONDecoder().decode(Input.self, from: data)
            guard input.cwd.hasPrefix("/"), input.extra_paths.isEmpty,
                  input.environment.count <= 16 else { throw invalid() }
            let resolved = try CommandEnvironment.resolve(input.environment,
                cwd: URL(fileURLWithPath: input.cwd), extraPaths: input.extra_paths)
            let output = try JSONSerialization.data(withJSONObject: resolved, options: [.sortedKeys])
            guard output.count <= 32768 else { throw invalid() }
            FileHandle.standardOutput.write(output)
        } catch {
            FileHandle.standardError.write(Data("Startup environment resolution unavailable\n".utf8))
            exit(1)
        }
    }

    static func invalid() -> Error { NSError(domain: "NACStartupEnvironment", code: 1) }
}
