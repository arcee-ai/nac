use std::net::SocketAddr;
use std::process;

use anyhow::Result;
use clap::Parser;
use nac_queue::{serve, ServerCli};

#[derive(Parser)]
#[command(name = "nac-queue", about = "pipeline queue server for nac")]
struct Cli {
    /// URL of the running nac-web server.
    #[arg(long, default_value = "http://127.0.0.1:3210")]
    nac_web_url: String,

    /// Address for nac-queue's own server.
    #[arg(long, default_value = "127.0.0.1:3211")]
    bind: SocketAddr,
}

impl From<Cli> for ServerCli {
    fn from(cli: Cli) -> Self {
        ServerCli {
            nac_web_url: cli.nac_web_url,
            bind: cli.bind,
        }
    }
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("Error: {error:#}");
        process::exit(1);
    }
}

async fn run() -> Result<()> {
    let cli = Cli::parse();
    tracing_subscriber::fmt::init();
    eprintln!("nac-queue listening on http://{}", cli.bind);
    eprintln!("nac-web URL: {}", cli.nac_web_url);
    serve(cli.into()).await
}