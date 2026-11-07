import Foundation

extension AttentionWire {
    private struct CompletionKey: CodingKey {
        let stringValue: String
        var intValue: Int? { nil }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { return nil }
    }
    private static func completionKeys(_ decoder: Decoder, _ expected: Set<String>) throws {
        let fields = try decoder.container(keyedBy: CompletionKey.self)
        guard Set(fields.allKeys.map(\.stringValue)) == expected else { throw AttentionFeedError.invalid }
    }
    struct CompletionPage: Decodable, Equatable {
        struct Item: Decodable, Equatable {
            enum Kind: String, Decodable { case request, goal }
            let sequence: Int64
            let session_id: String
            let run_id: String
            let behavior: String
            let kind: Kind
            let goal_id: String?
            let mark_version: Int64?
            private enum CodingKeys: String, CodingKey { case sequence, session_id, run_id, behavior, kind, goal_id, mark_version }
            init(from decoder: Decoder) throws {
                try AttentionWire.completionKeys(decoder, ["sequence", "session_id", "run_id", "behavior", "kind", "goal_id", "mark_version"])
                let value = try decoder.container(keyedBy: CodingKeys.self)
                sequence = try value.decode(Int64.self, forKey: .sequence)
                session_id = try value.decode(String.self, forKey: .session_id)
                run_id = try value.decode(String.self, forKey: .run_id)
                behavior = try value.decode(String.self, forKey: .behavior)
                kind = try value.decode(Kind.self, forKey: .kind)
                goal_id = try value.decodeIfPresent(String.self, forKey: .goal_id)
                mark_version = try value.decodeIfPresent(Int64.self, forKey: .mark_version)
            }
        }
        let store_id: UUID
        let cursor: Int64
        let high_water: Int64
        let baseline: Bool
        let more: Bool
        let items: [Item]
        private enum CodingKeys: String, CodingKey { case store_id, cursor, high_water, baseline, more, items }
        init(from decoder: Decoder) throws {
            try AttentionWire.completionKeys(decoder, ["store_id", "cursor", "high_water", "baseline", "more", "items"])
            let value = try decoder.container(keyedBy: CodingKeys.self)
            store_id = try value.decode(UUID.self, forKey: .store_id)
            cursor = try value.decode(Int64.self, forKey: .cursor)
            high_water = try value.decode(Int64.self, forKey: .high_water)
            baseline = try value.decode(Bool.self, forKey: .baseline)
            more = try value.decode(Bool.self, forKey: .more)
            items = try value.decode([Item].self, forKey: .items)
        }
        var cursorID: String { "\(store_id.uuidString.lowercased()):\(cursor)" }
        func occurrenceID(_ item: Item) -> String { "\(store_id.uuidString.lowercased()):\(item.sequence)" }

        func validate() throws {
            let validID: (String) -> Bool = { AttentionWire.validID($0) && !$0.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) } }
            guard AttentionWire.validUUID(store_id), cursor >= 0, high_water >= cursor, items.count <= 128,
                  !baseline || (items.isEmpty && !more && cursor == high_water),
                  !more || (!items.isEmpty && items.last?.sequence == cursor),
                  more || cursor == high_water else { throw AttentionFeedError.invalid }
            var previous: Int64 = 0
            for item in items {
                guard item.sequence > previous, item.sequence <= cursor,
                      [item.session_id, item.run_id].allSatisfy(validID),
                      ["orchestrator", "direct", "direct-with-orchestrator"].contains(item.behavior) else {
                    throw AttentionFeedError.invalid
                }
                switch item.kind {
                case .request:
                    guard item.goal_id == nil, item.mark_version == nil else { throw AttentionFeedError.invalid }
                case .goal:
                    guard let id = item.goal_id, validID(id),
                          let mark = item.mark_version, mark >= 0 else { throw AttentionFeedError.invalid }
                }
                previous = item.sequence
            }
        }
    }
}
