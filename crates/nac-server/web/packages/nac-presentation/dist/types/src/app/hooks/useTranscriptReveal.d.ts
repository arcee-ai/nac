/**
 * Whether the transcript is ready to be shown, as opposed to still being
 * assembled behind a loader.
 *
 * A conversation arrives in pieces — the snapshot, the chunk that turns its text
 * into prose, then a read per turn for the files that turn's run wrote — and
 * every piece lands in its own paint. Revealing on the first of them shows the
 * messages as raw source, without their snapshots, and then rewrites them in
 * place; this holds the whole thing back until there is nothing left to add.
 *
 * One-way per session: a refetch later in the session is an update to a
 * transcript that is already on screen, and hiding it again for that would be a
 * flicker rather than a load.
 *
 * None of it applies to a conversation that is already in hand. Switching
 * between chats a few times would otherwise mean waiting behind the same rows
 * over and over for a transcript the cache could have drawn at once.
 */
export declare function useTranscriptReveal(sessionId: string,
/** False while there is nothing to reveal yet, e.g. before the snapshot. */
hasContent: boolean): boolean;
