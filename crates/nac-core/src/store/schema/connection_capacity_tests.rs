use super::*;

fn temp_store_path(label: &str) -> PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir()
        .join(format!("nac_schema_{label}_{unique}"))
        .join("store.db")
}

#[test]
fn connection_capacity_enforces_process_store_alias_and_cleanup() {
    let root = temp_store_path("capacity").parent().unwrap().to_path_buf();
    let store_a = root.join("a").join("store.db");
    let store_b = root.join("b").join("store.db");
    let store_c = root.join("c").join("store.db");
    let store_d = root.join("d").join("store.db");
    let capacity = ConnectionCapacity::new(3, 1);
    let wait = std::time::Duration::from_millis(20);

    let connection_a = connect_with_capacity(&store_a, &capacity, wait).unwrap();
    let resolved_a = resolved_store_path(&store_a).unwrap();
    assert_eq!(capacity.counts(&resolved_a), (1, 1));

    // Saturating one store does not reserve unused process capacity.
    let connection_b = connect_with_capacity(&store_b, &capacity, wait).unwrap();
    let connection_c = connect_with_capacity(&store_c, &capacity, wait).unwrap();
    let process_error = connect_with_capacity(&store_d, &capacity, wait)
        .err()
        .unwrap();
    assert!(process_error
        .to_string()
        .contains("timed out waiting for SQLite connection capacity"));

    drop(connection_c);
    let alias_a = store_a.parent().unwrap().join(".").join("store.db");
    let store_error = connect_with_capacity(&alias_a, &capacity, wait)
        .err()
        .unwrap();
    assert!(store_error
        .to_string()
        .contains("timed out waiting for SQLite connection capacity"));

    let waiting_capacity = Arc::clone(&capacity);
    let waiting_alias = alias_a.clone();
    let waiter = std::thread::spawn(move || {
        connect_with_capacity(
            &waiting_alias,
            &waiting_capacity,
            std::time::Duration::from_secs(1),
        )
    });
    std::thread::sleep(std::time::Duration::from_millis(20));
    drop(connection_a);
    let alias_connection = waiter.join().unwrap().unwrap();
    assert_eq!(capacity.counts(&resolved_a), (2, 1));

    drop(alias_connection);
    drop(connection_b);
    assert_eq!(capacity.counts(&resolved_a), (0, 0));

    let directory_path = root.join("not-a-database");
    std::fs::create_dir_all(&directory_path).unwrap();
    assert!(connect_with_capacity(&directory_path, &capacity, wait).is_err());
    assert_eq!(
        capacity.counts(&resolved_store_path(&directory_path).unwrap()),
        (0, 0)
    );
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn cached_writers_and_event_subscribers_hold_no_connection_capacity() {
    let path = temp_store_path("idle_writers");
    initialize(&path).unwrap();
    assert_eq!(active_connection_counts(&path).unwrap().1, 0);

    let transcript = TranscriptLogWriter::new(&path).unwrap();
    let events = crate::events::SessionEventBus::with_thread_event_store(
        Some("idle-session".to_string()),
        path.clone(),
    );
    let subscription = events.subscribe();

    assert_eq!(active_connection_counts(&path).unwrap().1, 0);
    drop((transcript, subscription, events));
    assert_eq!(active_connection_counts(&path).unwrap().1, 0);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
