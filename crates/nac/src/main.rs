use std::io::{self, Write};
use std::path::PathBuf;
use std::process;

use anyhow::Result;
use clap::Parser;

use nac::agent::Agent;
use nac::api::OpenAiClient;

#[derive(Parser)]
#[command(name = "nac", about = "agent")]
struct Cli {
    prompt: Option<String>,

    /// Working directory (default: current directory)
    #[arg(short = 'C', long)]
    directory: Option<PathBuf>,

    /// Run prompt and exit (no REPL)
    #[arg(long)]
    single: bool,
}

#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("Error: {}", e);
        process::exit(1);
    }
}

async fn run() -> Result<()> {
    let cli = Cli::parse();

    if let Some(dir) = cli.directory {
        std::env::set_current_dir(&dir)?;
    }

    let client = OpenAiClient::from_env()?;
    let mut agent = Agent::new(client);

    if let Some(prompt) = cli.prompt {
        let response = agent.send(&prompt).await?;
        println!("{}", response);
        if cli.single {
            return Ok(());
        }
    }

    let stdin = io::stdin();
    loop {
        eprint!("\n> ");
        io::stderr().flush()?;

        let mut line = String::new();
        let bytes = stdin.read_line(&mut line)?;
        if bytes == 0 {
            break;
        }

        let input = line.trim();
        if input.is_empty() {
            continue;
        }

        match agent.send(input).await {
            Ok(response) => println!("{}", response),
            Err(error) => eprintln!("Error: {}", error),
        }
    }

    Ok(())
}
