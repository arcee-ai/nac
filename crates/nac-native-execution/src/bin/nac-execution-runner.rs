//! Fixed internal Native child executable; target commands arrive only on its
//! original parent channel. This binary initializes no model/provider services.
#[cfg(target_os = "linux")]
#[tokio::main(flavor = "current_thread")]
async fn main() {
    if nac_native_execution::run_original_native_child()
        .await
        .is_err()
    {
        std::process::exit(1);
    }
}
#[cfg(not(target_os = "linux"))]
fn main() {
    eprintln!("nac-native-runner requires Linux original-parent kernel custody");
    std::process::exit(2);
}
