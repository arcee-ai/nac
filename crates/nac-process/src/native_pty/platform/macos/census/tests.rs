use super::*;
use std::cell::Cell;
use std::sync::Barrier;

fn root(pid: libc::pid_t) -> Arc<Root> {
    Arc::new(Root {
        pid,
        uniqueid: Some(pid as u64),
    })
}
fn empty() -> Observation {
    Observation {
        sid: Ok(None),
        snapshot: Some(Ok(None)),
        ambiguous_uniqueid: None,
        capture: None,
        row: None,
    }
}
fn collect(cache: &mut Cache, epoch: u128) {
    cache.collect(&[400], epoch, |pid| Some(pid as u64), |_, _| empty());
}

#[test]
fn each_registered_root_consumes_a_current_generation_once_and_cleanup_is_fresh() {
    let first = root(200);
    let second = root(300);
    let mut cache = Cache {
        roots: vec![Arc::downgrade(&first), Arc::downgrade(&second)],
        generation: None,
    };
    collect(&mut cache, 10);
    assert!(cache.reusable(&first, None, 10, false));
    assert!(cache.reusable(&second, None, 10, false));
    let consumed = cache.generation.as_ref().unwrap().started;
    assert!(!cache.reusable(&first, Some(consumed), 10, false));
    assert!(!cache.reusable(&second, None, 11, false));
    assert!(!cache.reusable(&second, None, 10, true));
}

#[test]
fn newly_registered_root_cannot_reuse_an_existing_generation_even_in_same_epoch() {
    let first = root(200);
    let second = root(300);
    let mut cache = Cache {
        roots: vec![Arc::downgrade(&first)],
        generation: None,
    };
    collect(&mut cache, 10);
    cache.roots.push(Arc::downgrade(&second));
    assert!(!cache.reusable(&second, None, 10, false));
    collect(&mut cache, 10);
    assert!(cache.reusable(&second, None, 10, false));
}

#[test]
fn denied_reaped_or_replaced_root_does_not_join_or_poison_another_participant() {
    for mode in 0..3 {
        let first = root(200);
        let second = root(300);
        let mut cache = Cache {
            roots: vec![Arc::downgrade(&first), Arc::downgrade(&second)],
            generation: None,
        };
        let calls = Cell::new(0);
        cache.collect(
            &[400],
            10,
            |pid| {
                if pid != 200 {
                    return Some(pid as u64);
                }
                let call = calls.get();
                calls.set(call + 1);
                match mode {
                    0 => None,
                    1 if call > 0 => None,
                    2 if call > 0 => Some(201),
                    _ => Some(200),
                }
            },
            |_, _| empty(),
        );
        assert!(!cache.reusable(&first, None, 10, false));
        assert!(cache.reusable(&second, None, 10, false));
    }
}

#[test]
fn replacement_registration_at_same_numeric_pid_is_a_different_participant() {
    let original = root(200);
    let mut cache = Cache {
        roots: vec![Arc::downgrade(&original)],
        generation: None,
    };
    collect(&mut cache, 10);
    let replacement = root(200);
    assert!(!cache.reusable(&replacement, None, 10, false));
}

#[test]
fn registration_during_acquisition_waits_for_a_new_fenced_generation() {
    let first = root(200);
    let second = root(300);
    let cache = Arc::new(Mutex::new(Cache {
        roots: vec![Arc::downgrade(&first)],
        generation: None,
    }));
    let acquired = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let worker = std::thread::spawn({
        let cache = Arc::clone(&cache);
        let acquired = Arc::clone(&acquired);
        let release = Arc::clone(&release);
        move || {
            cache.lock().unwrap().collect(
                &[400],
                10,
                |pid| Some(pid as u64),
                |_, _| {
                    acquired.wait();
                    release.wait();
                    empty()
                },
            );
        }
    });
    acquired.wait();
    release.wait();
    worker.join().unwrap();
    let mut cache = cache.lock().unwrap();
    cache.roots.push(Arc::downgrade(&second));
    assert!(!cache.reusable(&second, None, 10, false));
    collect(&mut cache, 10);
    assert!(cache.reusable(&second, None, 10, false));
}

#[test]
fn root_registration_key_must_match_before_acquisition() {
    let first = root(200);
    let mut cache = Cache {
        roots: vec![Arc::downgrade(&first)],
        generation: None,
    };
    cache.collect(
        &[400],
        10,
        |_| Some(201),
        |_, roots| {
            assert!(roots.is_empty());
            empty()
        },
    );
    assert!(!cache.reusable(&first, None, 10, false));
}

#[test]
fn borrowed_batch_uses_only_fresh_inventory_and_keeps_missing_reads_local() {
    let observations = Arc::new(vec![(400, empty()), (600, empty()), (800, empty())]);
    let batch = Batch {
        observations: Arc::clone(&observations),
        missing: vec![(500, empty())],
    };
    let pids = [400, 500, 800];
    assert_eq!(
        batch.iter(&pids).map(|(pid, _)| pid).collect::<Vec<_>>(),
        pids
    );
    assert_eq!(
        observations.len(),
        3,
        "missing reads never alter another owner's generation"
    );
    assert!(std::ptr::eq(
        batch.iter(&pids).nth(1).unwrap().1,
        &batch.missing[0].1
    ));
}
