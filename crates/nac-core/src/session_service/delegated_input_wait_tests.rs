use super::*;
use crate::session_service::tests::test_direct_active_service_at;
use std::process::{Command, Stdio};

async fn restart_service(path: PathBuf, base_url: String) -> SessionService {
    crate::store::spawn_blocking_store_caller(move || {
        test_direct_active_service_at("child", ModelClient::new_for_test_server(base_url), path)
            .0
            .service
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn shutdown_before_child_delivery_retains_input_for_background_completion_after_restart() {
    let server = successor_server();
    let (service, path, original) = abandoned_child_with_client(
        "child_wait_shutdown",
        Some("relationship-run"),
        ModelClient::new_for_test_server(server.base_url.clone()),
    );
    let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
    let peer = sessions::SessionOperationLease::try_acquire(&path, "child").unwrap();
    let waiting = submit_foreground(&service);
    let item = queued_input(&owner).await;
    service.stop_run_admission().await.unwrap();
    let error = tokio::time::timeout(Duration::from_secs(2), waiting)
        .await
        .unwrap()
        .unwrap()
        .unwrap_err();
    assert!(error.to_string().contains("shutting down"), "{error:#}");
    assert_eq!(
        owner.list_session_inbox("child".into()).await.unwrap(),
        vec![item.clone()]
    );
    drop(service);
    let restarted = restart_service(path.clone(), server.base_url.clone()).await;
    drop(peer);
    restarted
        .start_next_direct_inbox_item()
        .await
        .unwrap()
        .unwrap();
    let successor = owner
        .load_traditional_child("child".into())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        successor.execution_mode,
        Some(TraditionalChildExecutionMode::Background)
    );
    assert_successor_delivery(
        &restarted,
        &owner,
        &original,
        &item,
        successor,
        crate::store::TraditionalChildStatus::Interrupted,
        server,
    )
    .await;
    owner.shutdown().await.unwrap();
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[tokio::test]
async fn legacy_foreground_input_without_waiter_authority_promotes_in_background() {
    let server = successor_server();
    let (service, path, original) = abandoned_child_with_client(
        "child_legacy_wait",
        Some("relationship-run"),
        ModelClient::new_for_test_server(server.base_url.clone()),
    );
    let item = crate::store::create_traditional_child_inbox_item(
        &path,
        "child",
        QUEUED_PROMPT,
        original.run_id.as_deref(),
        TraditionalChildExecutionMode::Foreground,
        None,
    )
    .unwrap();
    let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
    service
        .start_next_direct_inbox_item()
        .await
        .unwrap()
        .unwrap();
    let successor = owner
        .load_traditional_child("child".into())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        successor.execution_mode,
        Some(TraditionalChildExecutionMode::Background)
    );
    assert_successor_delivery(
        &service,
        &owner,
        &original,
        &item,
        successor,
        crate::store::TraditionalChildStatus::Interrupted,
        server,
    )
    .await;
    owner.shutdown().await.unwrap();
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[tokio::test]
async fn child_waiter_inspection_error_is_not_evidence_of_abandonment() {
    let (service, path, _) = abandoned_child("child_wait_error", Some("relationship-run"));
    let waiter = sessions::ChildInputWaitLease::new(&path).unwrap();
    let item = crate::store::create_traditional_child_inbox_item(
        &path,
        "child",
        QUEUED_PROMPT,
        Some("relationship-run"),
        TraditionalChildExecutionMode::Foreground,
        Some(waiter.id()),
    )
    .unwrap();
    let encoded: String = waiter
        .id()
        .bytes()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let lock_file = path
        .with_file_name("store.db.run-locks")
        .join(format!("{encoded}.child-wait"));
    drop(waiter);
    std::fs::remove_file(&lock_file).unwrap();
    std::fs::create_dir(&lock_file).unwrap();
    let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
    assert!(service.start_next_direct_inbox_item().await.is_err());
    assert_eq!(
        owner.list_session_inbox("child".into()).await.unwrap(),
        vec![item]
    );
    assert!(service.active_run().is_none());
    assert!(owner
        .list_session_inbox("parent".into())
        .await
        .unwrap()
        .is_empty());
    owner.shutdown().await.unwrap();
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[tokio::test]
async fn foreground_wait_process_helper() {
    let Some(path) = std::env::var_os("NAC_CHILD_WAIT_STORE").map(PathBuf::from) else {
        return;
    };
    let base_url = std::env::var("NAC_CHILD_WAIT_URL").unwrap();
    let ready = std::env::var_os("NAC_CHILD_WAIT_READY")
        .map(PathBuf::from)
        .unwrap();
    let (parts, _) = test_direct_active_service_at(
        "child",
        ModelClient::new_for_test_server(base_url),
        path.clone(),
    );
    let waiting = submit_foreground(&parts.service);
    tokio::time::timeout(Duration::from_secs(5), async {
        while crate::store::list_session_inbox(&path, "child")
            .unwrap()
            .is_empty()
        {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    std::fs::write(ready, b"queued with live waiter").unwrap();
    // Parent test terminates this process. Bound the helper if that test fails.
    tokio::time::sleep(Duration::from_secs(30)).await;
    waiting.abort();
}

#[tokio::test]
async fn child_promotion_distinguishes_live_peer_waiter_from_process_death() {
    for crashed in [false, true] {
        let server = successor_server();
        let (service, path, original) = abandoned_child_with_client(
            "child_peer_wait",
            Some("relationship-run"),
            ModelClient::new_for_test_server(server.base_url.clone()),
        );
        let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
        let peer = sessions::SessionOperationLease::try_acquire(&path, "child").unwrap();
        let ready = path.parent().unwrap().join("waiter-ready");
        let mut process = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "session_service::delegated_input::tests::waiter_tests::foreground_wait_process_helper", "--nocapture"])
            .env("NAC_CHILD_WAIT_STORE", &path)
            .env("NAC_CHILD_WAIT_URL", &server.base_url)
            .env("NAC_CHILD_WAIT_READY", &ready)
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::inherit())
            .spawn().unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            while !ready.exists() {
                assert!(
                    process.try_wait().unwrap().is_none(),
                    "peer waiter exited early"
                );
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("peer must commit its queued input");
        let item = queued_input(&owner).await;
        let wait_id = item.child_wait_id.as_deref().unwrap();
        assert!(matches!(
            sessions::ChildInputWaitLease::try_acquire(&path, wait_id),
            Err(sessions::SessionOperationLeaseError::Busy(_))
        ));
        let survivor = if crashed {
            process.kill().unwrap();
            process.wait().unwrap();
            assert!(sessions::ChildInputWaitLease::try_acquire(&path, wait_id).is_ok());
            restart_service(path.clone(), server.base_url.clone()).await
        } else {
            service.clone()
        };
        drop(peer);
        survivor.start_next_direct_inbox_item().await.unwrap();
        let successor = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let child = owner
                    .load_traditional_child("child".into())
                    .await
                    .unwrap()
                    .unwrap();
                if child.generation > original.generation {
                    return child;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("one of the coordinated owners must admit the successor");
        assert_eq!(
            successor.execution_mode,
            Some(if crashed {
                TraditionalChildExecutionMode::Background
            } else {
                TraditionalChildExecutionMode::Foreground
            })
        );
        assert_successor_delivery(
            &survivor,
            &owner,
            &original,
            &item,
            successor,
            crate::store::TraditionalChildStatus::Interrupted,
            server,
        )
        .await;
        if !crashed {
            process.kill().unwrap();
            process.wait().unwrap();
        }
        owner.shutdown().await.unwrap();
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
