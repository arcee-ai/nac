// `include_dir!` embeds `assets/` at compile time, but Cargo only tracks Rust
// sources by itself, so editing the frontend would otherwise leave a stale
// binary serving the previous assets.
fn main() {
    println!("cargo:rerun-if-changed=assets");
}
