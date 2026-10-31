#if PREVIEW_SMOKE
import Foundation

/// Fixture-only model output. Never handles real credentials or user stores.
enum WorkspaceFixture {
    static var externalPath = ""
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
            return ["id": "fc-wk-approval", "type": "function_call", "status": "completed",
                    "call_id": "wk-approval", "name": "read",
                    "arguments": String(decoding: try! JSONSerialization.data(withJSONObject: ["path": externalPath]), as: UTF8.self)]
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
