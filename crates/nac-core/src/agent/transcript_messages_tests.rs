use super::*;

fn user(content: &str) -> Message {
    Message::User {
        content: content.into(),
    }
}

#[test]
fn appends_keep_the_generation_and_any_other_mutation_replaces_it() {
    let mut transcript = TranscriptMessages::from(vec![user("a")]);
    let appended = transcript.generation();
    transcript.push(user("b"));
    transcript.extend([user("c"), user("d")]);
    assert_eq!(transcript.generation(), appended);
    assert_eq!(transcript.len(), 4);

    transcript.truncate(2);
    let truncated = transcript.generation();
    assert_ne!(truncated, appended);
    if let Some(Message::User { content }) = transcript.last_mut() {
        content.push('!');
    }
    assert_ne!(transcript.generation(), truncated);
}

#[test]
fn a_clone_or_replacement_never_shares_a_generation() {
    let transcript = TranscriptMessages::from(vec![user("a")]);
    let clone = transcript.clone();
    assert_ne!(clone.generation(), transcript.generation());
    let replaced: TranscriptMessages = Vec::<Message>::from(clone).into();
    assert_ne!(replaced.generation(), transcript.generation());
}
