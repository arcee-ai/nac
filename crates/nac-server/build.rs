#[path = "../../scripts/build-identity.rs"]
mod build_identity;

fn main() {
    println!("cargo:rerun-if-changed=assets");
    build_identity::configure();
}
