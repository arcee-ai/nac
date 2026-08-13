use super::*;

pub fn render_self_context(thread_name: &str, episodes: &[EpisodeRecord]) -> Option<String> {
    if episodes.is_empty() {
        return None;
    }

    let mut rendered = format!("Retained history for thread \"{}\":", thread_name);
    for (index, episode) in episodes.iter().enumerate() {
        rendered.push_str(&format!(
            "\n\n=== Episode {} | {} | action: {} ===\n{}",
            index + 1,
            episode.created_at,
            episode.action,
            episode.content
        ));
    }
    Some(rendered)
}

pub fn render_source_context(episode: &EpisodeRecord) -> String {
    format!(
        "Latest retained episode from thread \"{}\" | {} | action: {}\n{}",
        episode.thread_name, episode.created_at, episode.action, episode.content
    )
}

pub fn render_thread_document(thread_name: &str, episodes: &[EpisodeRecord]) -> String {
    if episodes.is_empty() {
        return format!("Thread \"{}\" has no retained episodes.", thread_name);
    }

    let mut rendered = format!(
        "Thread \"{}\" retained episodes ({} total):",
        thread_name,
        episodes.len()
    );
    for (index, episode) in episodes.iter().enumerate() {
        rendered.push_str(&format!(
            "\n\n=== Episode {} | {} | action: {} ===\n{}",
            index + 1,
            episode.created_at,
            episode.action,
            episode.content
        ));
    }
    rendered
}

pub fn render_workset_document(workset: &WorksetRecord) -> String {
    let mut rendered = format!(
        "Workset \"{}\" | status: {} | {} item(s)",
        workset.id,
        workset.status,
        workset.items.len()
    );
    rendered.push_str(&format!(
        "\nsummary: {}",
        if workset.summary.is_empty() {
            "(none)"
        } else {
            &workset.summary
        }
    ));
    rendered.push_str(&format!("\ngoal: {}", workset.goal));
    if let Some(recipe) = workset.verification_recipe.as_deref() {
        rendered.push_str(&format!("\nverification: {}", recipe));
    }
    rendered.push_str(&format!(
        "\ncreated: {} | updated: {}",
        workset.created_at, workset.updated_at
    ));

    if workset.items.is_empty() {
        rendered.push_str("\n\nNo workset items defined.");
        return rendered;
    }

    rendered.push_str("\n\nItems:");
    for item in &workset.items {
        let dependencies = if item.depends_on.is_empty() {
            "none".to_string()
        } else {
            item.depends_on.join(", ")
        };
        rendered.push_str(&format!(
            "\n\n{}. [{}] {}",
            item.position, item.role, item.title
        ));
        rendered.push_str(&format!("\n   scope: {}", item.scope));
        rendered.push_str(&format!("\n   depends on: {}", dependencies));
        rendered.push_str(&format!("\n   description: {}", item.description));
        rendered.push_str(&format!("\n   acceptance: {}", item.acceptance));
        if let Some(notes) = item.notes.as_deref() {
            rendered.push_str(&format!("\n   notes: {}", notes));
        }
    }
    rendered
}

pub fn render_workset_list(worksets: &[WorksetSummary]) -> String {
    if worksets.is_empty() {
        return "No worksets in this session.".to_string();
    }

    let mut rendered = String::from("Worksets:");
    for workset in worksets {
        rendered.push_str(&format!(
            "\n- {} | {} | {} item(s) | updated {}",
            workset.id, workset.status, workset.item_count, workset.updated_at
        ));
        if !workset.summary.is_empty() {
            rendered.push_str(&format!("\n  {}", workset.summary));
        }
    }
    rendered
}
