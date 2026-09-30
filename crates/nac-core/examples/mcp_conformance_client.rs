#[cfg(feature = "test-support")]
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let server_url = std::env::args()
        .next_back()
        .filter(|argument| argument.starts_with("http://") || argument.starts_with("https://"))
        .ok_or_else(|| anyhow::anyhow!("the conformance server URL must be the final argument"))?;
    nac_core::mcp_configurations::run_mcp_conformance_client(server_url).await
}

#[cfg(not(feature = "test-support"))]
fn main() {
    eprintln!("mcp_conformance_client requires --features test-support");
    std::process::exit(2);
}
