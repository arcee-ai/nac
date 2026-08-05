use std::io::{Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tokio::sync::{Barrier, Mutex};

use super::{open_locked_file, FileLockAccess};

const TASKS: usize = 8;
const OPERATIONS_PER_TASK: usize = 100;
const PAYLOAD_BYTES: usize = 64 * 1024;
const SAMPLES: usize = 30;
const SIMULATED_IO_LATENCY: Duration = Duration::from_millis(2);
const LATENCY_OPERATIONS_PER_TASK: usize = 20;

async fn benchmark_global_lock(paths: &[PathBuf], payload: Arc<Vec<u8>>) -> Duration {
    let lock = Arc::new(Mutex::new(()));
    let barrier = Arc::new(Barrier::new(TASKS + 1));
    let mut handles = Vec::with_capacity(TASKS);

    for path in paths {
        let path = path.clone();
        let payload = payload.clone();
        let lock = lock.clone();
        let barrier = barrier.clone();
        handles.push(tokio::spawn(async move {
            barrier.wait().await;
            for _ in 0..OPERATIONS_PER_TASK {
                let _guard = lock.lock().await;
                tokio::fs::write(&path, payload.as_slice()).await.unwrap();
            }
        }));
    }

    let started = Instant::now();
    barrier.wait().await;
    for handle in handles {
        handle.await.unwrap();
    }
    started.elapsed()
}

async fn benchmark_per_file_lock(paths: &[PathBuf], payload: Arc<Vec<u8>>) -> Duration {
    let barrier = Arc::new(Barrier::new(TASKS + 1));
    let mut handles = Vec::with_capacity(TASKS);

    for path in paths {
        let path = path.clone();
        let payload = payload.clone();
        let barrier = barrier.clone();
        handles.push(tokio::spawn(async move {
            barrier.wait().await;
            for _ in 0..OPERATIONS_PER_TASK {
                let mut file = open_locked_file(path.clone(), true, FileLockAccess::Write)
                    .await
                    .unwrap();
                let payload = payload.clone();
                tokio::task::spawn_blocking(move || {
                    file.set_len(0).unwrap();
                    file.seek(SeekFrom::Start(0)).unwrap();
                    file.write_all(payload.as_slice()).unwrap();
                })
                .await
                .unwrap();
            }
        }));
    }

    let started = Instant::now();
    barrier.wait().await;
    for handle in handles {
        handle.await.unwrap();
    }
    started.elapsed()
}

#[derive(Clone, Copy)]
struct Summary {
    median: Duration,
    p95: Duration,
}

fn summarize(mut samples: Vec<Duration>) -> Summary {
    samples.sort_unstable();
    Summary {
        median: samples[samples.len() / 2],
        p95: samples[(samples.len() * 95).div_ceil(100) - 1],
    }
}

async fn benchmark_global_lock_with_latency(paths: &[PathBuf]) -> Duration {
    let lock = Arc::new(Mutex::new(()));
    let barrier = Arc::new(Barrier::new(TASKS + 1));
    let mut handles = Vec::with_capacity(TASKS);

    for _ in paths {
        let lock = lock.clone();
        let barrier = barrier.clone();
        handles.push(tokio::spawn(async move {
            barrier.wait().await;
            for _ in 0..LATENCY_OPERATIONS_PER_TASK {
                let _guard = lock.lock().await;
                tokio::task::spawn_blocking(move || {
                    std::thread::sleep(SIMULATED_IO_LATENCY);
                })
                .await
                .unwrap();
            }
        }));
    }

    let started = Instant::now();
    barrier.wait().await;
    for handle in handles {
        handle.await.unwrap();
    }
    started.elapsed()
}

async fn benchmark_per_file_lock_with_latency(paths: &[PathBuf]) -> Duration {
    let barrier = Arc::new(Barrier::new(TASKS + 1));
    let mut handles = Vec::with_capacity(TASKS);

    for path in paths {
        let path = path.clone();
        let barrier = barrier.clone();
        handles.push(tokio::spawn(async move {
            barrier.wait().await;
            for _ in 0..LATENCY_OPERATIONS_PER_TASK {
                let file = open_locked_file(path.clone(), true, FileLockAccess::Write)
                    .await
                    .unwrap();
                tokio::task::spawn_blocking(move || {
                    let _file = file;
                    std::thread::sleep(SIMULATED_IO_LATENCY);
                })
                .await
                .unwrap();
            }
        }));
    }

    let started = Instant::now();
    barrier.wait().await;
    for handle in handles {
        handle.await.unwrap();
    }
    started.elapsed()
}

/// Manual comparison of the former process-global lock and the per-file lock.
///
/// Run with:
/// `cargo test --release -p nac-core benchmark_global_vs_per_file_lock -- --ignored --nocapture`
#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
#[ignore = "manual filesystem benchmark"]
async fn benchmark_global_vs_per_file_lock() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!(
        "nac_file_lock_benchmark_{}_{unique}",
        std::process::id()
    ));
    std::fs::create_dir_all(&root).unwrap();

    let same_path = root.join("shared.txt");
    let same_paths = vec![same_path; TASKS];
    let distinct_paths = (0..TASKS)
        .map(|index| root.join(format!("independent-{index}.txt")))
        .collect::<Vec<_>>();
    let payload = Arc::new(vec![b'x'; PAYLOAD_BYTES]);

    // Warm filesystem caches and the blocking pool before collecting samples.
    let _ = benchmark_global_lock(&distinct_paths, payload.clone()).await;
    let _ = benchmark_per_file_lock(&distinct_paths, payload.clone()).await;

    let mut global_same = Vec::with_capacity(SAMPLES);
    let mut per_file_same = Vec::with_capacity(SAMPLES);
    let mut global_distinct = Vec::with_capacity(SAMPLES);
    let mut per_file_distinct = Vec::with_capacity(SAMPLES);
    for sample in 0..SAMPLES {
        if sample % 2 == 0 {
            global_same.push(benchmark_global_lock(&same_paths, payload.clone()).await);
            per_file_same.push(benchmark_per_file_lock(&same_paths, payload.clone()).await);
            global_distinct.push(benchmark_global_lock(&distinct_paths, payload.clone()).await);
            per_file_distinct.push(benchmark_per_file_lock(&distinct_paths, payload.clone()).await);
        } else {
            per_file_distinct.push(benchmark_per_file_lock(&distinct_paths, payload.clone()).await);
            global_distinct.push(benchmark_global_lock(&distinct_paths, payload.clone()).await);
            per_file_same.push(benchmark_per_file_lock(&same_paths, payload.clone()).await);
            global_same.push(benchmark_global_lock(&same_paths, payload.clone()).await);
        }
    }

    let global_same = summarize(global_same);
    let per_file_same = summarize(per_file_same);
    let global_distinct = summarize(global_distinct);
    let per_file_distinct = summarize(per_file_distinct);

    let mut global_latency_same = Vec::with_capacity(SAMPLES);
    let mut per_file_latency_same = Vec::with_capacity(SAMPLES);
    let mut global_latency_distinct = Vec::with_capacity(SAMPLES);
    let mut per_file_latency_distinct = Vec::with_capacity(SAMPLES);
    for sample in 0..SAMPLES {
        if sample % 2 == 0 {
            global_latency_same.push(benchmark_global_lock_with_latency(&same_paths).await);
            per_file_latency_same.push(benchmark_per_file_lock_with_latency(&same_paths).await);
            global_latency_distinct.push(benchmark_global_lock_with_latency(&distinct_paths).await);
            per_file_latency_distinct
                .push(benchmark_per_file_lock_with_latency(&distinct_paths).await);
        } else {
            per_file_latency_distinct
                .push(benchmark_per_file_lock_with_latency(&distinct_paths).await);
            global_latency_distinct.push(benchmark_global_lock_with_latency(&distinct_paths).await);
            per_file_latency_same.push(benchmark_per_file_lock_with_latency(&same_paths).await);
            global_latency_same.push(benchmark_global_lock_with_latency(&same_paths).await);
        }
    }

    let global_latency_same = summarize(global_latency_same);
    let per_file_latency_same = summarize(per_file_latency_same);
    let global_latency_distinct = summarize(global_latency_distinct);
    let per_file_latency_distinct = summarize(per_file_latency_distinct);

    println!(
        "64 KiB cached writes, {TASKS} tasks × {OPERATIONS_PER_TASK} operations, {SAMPLES} alternating samples:"
    );
    println!(
        "same file:      global median={:?} p95={:?}, per-file median={:?} p95={:?}, median ratio={:.2}x",
        global_same.median,
        global_same.p95,
        per_file_same.median,
        per_file_same.p95,
        global_same.median.as_secs_f64() / per_file_same.median.as_secs_f64()
    );
    println!(
        "distinct files: global median={:?} p95={:?}, per-file median={:?} p95={:?}, median ratio={:.2}x",
        global_distinct.median,
        global_distinct.p95,
        per_file_distinct.median,
        per_file_distinct.p95,
        global_distinct.median.as_secs_f64() / per_file_distinct.median.as_secs_f64()
    );
    println!(
        "simulated 2 ms mutation latency, {TASKS} tasks × {LATENCY_OPERATIONS_PER_TASK} operations:"
    );
    println!(
        "same file:      global median={:?} p95={:?}, per-file median={:?} p95={:?}, median ratio={:.2}x",
        global_latency_same.median,
        global_latency_same.p95,
        per_file_latency_same.median,
        per_file_latency_same.p95,
        global_latency_same.median.as_secs_f64()
            / per_file_latency_same.median.as_secs_f64()
    );
    println!(
        "distinct files: global median={:?} p95={:?}, per-file median={:?} p95={:?}, median ratio={:.2}x",
        global_latency_distinct.median,
        global_latency_distinct.p95,
        per_file_latency_distinct.median,
        per_file_latency_distinct.p95,
        global_latency_distinct.median.as_secs_f64()
            / per_file_latency_distinct.median.as_secs_f64()
    );

    let _ = std::fs::remove_dir_all(root);
}
