fn main() {
    // Cargo may reuse this executable after the checkout or target cache moves.
    let manifest_dir = std::env::var_os("CARGO_MANIFEST_DIR").unwrap_or_else(|| {
        panic!("Cargo must set CARGO_MANIFEST_DIR when running the build script")
    });
    let version_path = std::path::Path::new(&manifest_dir).join("../../version.txt");
    println!("cargo:rerun-if-changed={}", version_path.display());
    let product_version = std::fs::read_to_string(&version_path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", version_path.display()));
    let product_version = product_version.trim();
    assert_stable_version(product_version);
    println!("cargo:rustc-env=NAC_PRODUCT_VERSION={product_version}");
}

fn assert_stable_version(version: &str) {
    let components = version.split('.').collect::<Vec<_>>();
    assert!(
        components.len() == 3
            && components.iter().all(|component| {
                !component.is_empty()
                    && component
                        .chars()
                        .all(|character| character.is_ascii_digit())
                    && (component == &"0" || !component.starts_with('0'))
            }),
        "version.txt must contain one stable semantic version"
    );
}
