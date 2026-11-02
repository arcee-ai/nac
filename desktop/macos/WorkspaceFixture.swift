#if PREVIEW_SMOKE
import Foundation
import Darwin

/// Fixture-only model output. Never handles real credentials or user stores.
enum WorkspaceFixture {
    private(set) static var externalPath = ""
    private static var externalIdentity: (root: String, rootDevice: dev_t, rootInode: ino_t,
                                          device: dev_t, inode: ino_t)?

    // Disposable fixture only. Freeze a POSIX canonical existing-file identity
    // before constructing provider arguments or the expected approval target.
    static func prepareExternalReadTarget(in root: URL) throws {
        let directory = open(root.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard directory >= 0 else { throw PreviewError.message("Owned approval root unavailable") }
        defer { _ = close(directory) }
        var owner = stat()
        guard fstat(directory, &owner) == 0,
              owner.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR), owner.st_uid == getuid(),
              owner.st_mode & mode_t(S_IRWXG | S_IRWXO) == 0 else {
            throw PreviewError.message("Approval root is not an owned private directory")
        }
        let descriptor = openat(directory, "approval.txt", O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW,
                                mode_t(S_IRUSR | S_IWUSR))
        guard descriptor >= 0 else { throw PreviewError.message("Owned approval fixture creation failed") }
        defer { _ = close(descriptor) }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: false)
        try handle.write(contentsOf: Data("Owned external fixture for approval\n".utf8))
        var created = stat()
        guard fstat(descriptor, &created) == 0,
              created.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG), created.st_uid == getuid(),
              created.st_nlink == 1, created.st_mode & mode_t(S_IRWXG | S_IRWXO) == 0,
              let rootBytes = realpath(root.path, nil) else {
            throw PreviewError.message("Owned approval fixture identity unavailable")
        }
        defer { free(rootBytes) }
        let canonicalRoot = String(cString: rootBytes)
        let requested = root.appendingPathComponent("approval.txt").path
        guard let fileBytes = realpath(requested, nil) else {
            throw PreviewError.message("Owned approval fixture canonical binding failed")
        }
        defer { free(fileBytes) }
        let canonical = String(cString: fileBytes)
        guard canonical == canonicalRoot + "/approval.txt" else {
            throw PreviewError.message("Owned approval fixture escaped its private root")
        }
        externalPath = canonical
        externalIdentity = (canonicalRoot, owner.st_dev, owner.st_ino, created.st_dev, created.st_ino)
        _ = try requireExternalReadTarget()
    }

    static func requireExternalReadTarget() throws -> String {
        guard let identity = externalIdentity, !externalPath.isEmpty else {
            throw PreviewError.message("Owned approval target was not bound")
        }
        let directory = open(identity.root, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard directory >= 0 else { throw PreviewError.message("Owned approval root changed") }
        defer { _ = close(directory) }
        var owner = stat()
        guard fstat(directory, &owner) == 0, owner.st_uid == getuid(),
              owner.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
              owner.st_mode & mode_t(S_IRWXG | S_IRWXO) == 0,
              owner.st_dev == identity.rootDevice, owner.st_ino == identity.rootInode else {
            throw PreviewError.message("Owned approval root identity changed")
        }
        let descriptor = openat(directory, "approval.txt", O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
        guard descriptor >= 0 else { throw PreviewError.message("Owned approval target changed") }
        defer { _ = close(descriptor) }
        var bound = stat()
        guard fstat(descriptor, &bound) == 0, bound.st_uid == getuid(), bound.st_nlink == 1,
              bound.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              bound.st_mode & mode_t(S_IRWXG | S_IRWXO) == 0,
              bound.st_dev == identity.device, bound.st_ino == identity.inode,
              externalPath == identity.root + "/approval.txt" else {
            throw PreviewError.message("Owned approval target identity changed")
        }
        return externalPath
    }
    // Static JSON-RPC metadata over stdio; no tools or shell commands run on behalf of a model.
    static let mcpScript = #"""
    #!/bin/sh
    while IFS= read -r message; do
      id=$(printf '%s\n' "$message" | /usr/bin/sed -nE 's/.*"id"[[:space:]]*:[[:space:]]*([^,}]+).*/\1/p')
      [ -n "$id" ] || continue
      case "$message" in
        *initialize*)
          version=$(printf '%s\n' "$message" | /usr/bin/sed -nE 's/.*"protocolVersion"[[:space:]]*:[[:space:]]*"([0-9-]+)".*/\1/p')
          result=$(printf '{"protocolVersion":"%s","capabilities":{"tools":{}},"serverInfo":{"name":"wk-fixture","version":"1"}}' "$version") ;;
        *tools/list*) result='{"tools":[{"name":"wk_fixture_echo","description":"Owned inert fixture","inputSchema":{"type":"object","properties":{}}}]}' ;;
        *) result='{}' ;;
      esac
      printf '{"jsonrpc":"2.0","id":%s,"result":%s}\n' "$id" "$result"
    done
    """#
    static let rich = #"""
    WK_RICH_COMPLETE

    | Engine | Workspace |
    | --- | --- |
    | System WebKit | shared React |

    A formula: $x^2 + y^2 = z^2$.

    ```typescript
    export const webkitFixture = 351;
    ```

    [Fixture source](workspace.ts) and [NAC documentation](https://github.com/arcee-ai/nac).
    """#

    static func wireResponse(_ request: [String: Any]) -> String? {
        let args = CommandLine.arguments
        guard let at = args.firstIndex(of: "--smoke-scenario"), args.indices.contains(at + 1),
              args[at + 1].hasPrefix("workspace-"), let item = response(request) else { return nil }
        let envelope: [String: Any] = ["id": "resp-workspace", "object": "response", "status": "completed",
            "model": "gpt-5.6-sol", "output": [item],
            "usage": ["input_tokens": 7, "output_tokens": 9, "total_tokens": 16]]
        func encode(_ object: [String: Any]) -> String {
            String(decoding: try! JSONSerialization.data(withJSONObject: object), as: UTF8.self)
        }
        if request["stream"] as? Bool == true {
            return "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n" +
                "data: \(encode(["type": "response.output_item.done", "output_index": 0, "item": item]))\n\n" +
                "data: \(encode(["type": "response.completed", "response": envelope]))\n\n"
        }
        let body = encode(envelope)
        return "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n\(body)"
    }

    private static func response(_ request: [String: Any]) -> [String: Any]? {
        guard let input = request["input"] as? [[String: Any]] else { return nil }
        let last = input.last ?? [:]
        if last["type"] as? String == "function_call_output",
           last["call_id"] as? String == "wk-approval" {
            return text("WK_APPROVAL_COMPLETE")
        }
        guard let user = input.last(where: { $0["role"] as? String == "user" }) else { return nil }
        let serialized = String(decoding: try! JSONSerialization.data(withJSONObject: user), as: UTF8.self)
        if serialized.contains("WK_APPROVAL") {
            guard let path = try? requireExternalReadTarget() else {
                return text("WK_APPROVAL_FIXTURE_INVALID")
            }
            return ["id": "fc-wk-approval", "type": "function_call", "status": "completed",
                    "call_id": "wk-approval", "name": "read",
                    "arguments": String(decoding: try! JSONSerialization.data(withJSONObject: ["path": path]), as: UTF8.self)]
        }
        if serialized.contains("WK_RICH") { return text(rich) }
        return nil
    }

    private static func text(_ value: String) -> [String: Any] {
        ["id": "msg-wk-fixture", "type": "message", "status": "completed", "role": "assistant",
         "content": [["type": "output_text", "text": value, "annotations": []]]]
    }
}
#endif
