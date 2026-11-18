use std::{
    io::{self, IsTerminal, Read, Write},
    net::{IpAddr, SocketAddr},
    path::{Path, PathBuf},
    process,
};

use anyhow::{anyhow, Context, Result};
use clap::{Args, CommandFactory, FromArgMatches, Parser, Subcommand};
use nac_core::{
    model::{run_arcee_auth_action, run_codex_auth_action, ArceeAuthAction, CodexAuthAction},
    upgrade::{run_upgrade, UpgradeRequest},
};
use nac_server::{serve_with_policy, BindPolicy, ServerOptions, SessionManager};

const MCP_OAUTH_CALLBACK_ORIGIN_ENV: &str = "NAC_MCP_OAUTH_CALLBACK_ORIGIN";

/// Root NAC product version, intentionally independent of internal crate versions.
const RELEASE_VERSION: &str = env!("NAC_PRODUCT_VERSION");
const BUILD_VERSION: &str = concat!(
    env!("NAC_PRODUCT_VERSION"),
    " (",
    env!("NAC_BUILD_REVISION"),
    ")"
);

#[derive(Parser)]
#[command(
    name = "nac-web",
    about = "Run the NAC web dashboard and manage credentials and updates",
    long_about = "Run the NAC web dashboard for a project, or use a command to manage credentials or upgrade this executable.\n\nWith no command, this executable serves the selected project and opens the dashboard in the default browser when run interactively.",
    version = RELEASE_VERSION,
    long_version = BUILD_VERSION,
    args_conflicts_with_subcommands = true,
)]
struct Cli {
    #[command(flatten)]
    server: ServerCli,

    #[command(subcommand)]
    command: Option<RootCommand>,
}

#[derive(Subcommand)]
enum RootCommand {
    /// Resolve local Mac launch paths without opening the selected store.
    #[cfg(unix)]
    #[command(name = "__desktop-configuration", hide = true)]
    DesktopConfiguration {
        #[arg(long)]
        directory: PathBuf,
        #[arg(long)]
        store_path: Option<PathBuf>,
    },
    /// Read the bundled release-local NAC Guide without a server or network
    #[command(version = RELEASE_VERSION, long_version = BUILD_VERSION)]
    Guide(GuideCli),
    #[cfg(unix)]
    #[command(name = "__desktop-identity", hide = true)]
    DesktopIdentity,
    /// Manage ChatGPT credentials used by Codex models
    #[command(version = RELEASE_VERSION, long_version = BUILD_VERSION)]
    CodexAuth(CodexAuthCli),

    /// Manage Arcee account credentials
    #[command(version = RELEASE_VERSION, long_version = BUILD_VERSION)]
    ArceeAuth(ArceeAuthCli),

    /// Download and reinstall the latest stable NAC release
    #[command(version = RELEASE_VERSION, long_version = BUILD_VERSION)]
    Upgrade(UpgradeCli),

    #[command(name = "__github-credential", hide = true)]
    GitHubCredential(GitHubCredentialCli),
}

#[derive(Args)]
struct GuideCli {
    /// Stable document ID; omit to list the installed topic index
    document_id: Option<String>,
    /// Stable section ID; omit to list this document's sections
    #[arg(requires = "document_id")]
    section_id: Option<String>,
    /// Search the installed pack
    #[arg(long, conflicts_with = "document_id")]
    query: Option<String>,
    /// UTF-8 byte offset within a section
    #[arg(long, default_value_t = 0, requires = "section_id")]
    offset: usize,
}

fn read_guide(cli: GuideCli) -> Result<()> {
    let guide = nac_core::guide::bundled()?;
    let result = match (cli.document_id.as_deref(), cli.section_id.as_deref()) {
        (Some(document), Some(section)) => {
            serde_json::to_value(guide.read(document, section, cli.offset, 6000)?)?
        }
        (Some(document), None) => {
            let document = guide.document(document)?;
            serde_json::json!({"document_id":document.document_id,"sections":document.sections.iter().map(|section| serde_json::json!({"section_id":section.section_id,"title":section.title})).collect::<Vec<_>>()})
        }
        _ => serde_json::to_value(guide.search(cli.query.as_deref().unwrap_or(""), 20)?)?,
    };
    println!(
        "{}",
        serde_json::json!({"provenance":"first-party bundled NAC Guide","schema_version":guide.schema_version,"fingerprint":guide.fingerprint,"build_identity":nac_contracts::build_identity(),"result":result})
    );
    Ok(())
}

#[derive(Args)]
struct ServerCli {
    /// Socket address to listen on (default: loopback only).
    #[arg(long, default_value = "127.0.0.1:3210")]
    bind: SocketAddr,

    /// Permit a non-loopback bind after network access has been restricted.
    ///
    /// Every client that can connect receives control equivalent to the local
    /// user. Use only behind an authenticated, encrypted network boundary.
    #[arg(long, action = clap::ArgAction::SetTrue)]
    allow_remote: bool,

    /// Port to listen on at 127.0.0.1 (1-65535; default: 3210).
    ///
    /// Cannot be used with --bind.
    #[arg(
        short,
        long,
        value_name = "PORT",
        value_parser = clap::value_parser!(u16).range(1..),
        conflicts_with = "bind"
    )]
    port: Option<u16>,

    /// Project directory to manage (skips the interactive confirmation).
    ///
    /// Without this flag an interactive terminal confirms the current working
    /// directory or asks for another path. Non-interactive runs use cwd.
    #[arg(short = 'C', long)]
    directory: Option<PathBuf>,

    /// Accept the current working directory without prompting.
    #[arg(short = 'y', long, action = clap::ArgAction::SetTrue)]
    yes: bool,

    /// Override the server SQLite store path.
    #[arg(long)]
    store_path: Option<PathBuf>,

    /// Explicit versioned Managed NAC host configuration document.
    ///
    /// Omit this for ordinary NAC. `NAC_MANAGED_CONFIG` is consulted only when
    /// the flag is absent so managed containers can mount the document without
    /// changing local defaults.
    #[arg(long)]
    managed_config: Option<PathBuf>,

    /// Public origin used for MCP OAuth callbacks, for example
    /// https://nac.example.com. Required with a remote bind outside Managed NAC.
    #[arg(long, value_name = "ORIGIN")]
    mcp_oauth_callback_origin: Option<String>,

    /// Open the dashboard in the default browser after listening.
    ///
    /// Interactive terminals open by default; pass `--no-open` to skip, or set
    /// `BROWSER=none`. `--open` forces a window even when stdin is not a TTY.
    #[arg(long, action = clap::ArgAction::SetTrue)]
    open: bool,

    /// Do not open the dashboard in a browser.
    #[arg(long = "no-open", action = clap::ArgAction::SetTrue)]
    no_open: bool,
}

impl ServerCli {
    fn bind_addr(&self) -> SocketAddr {
        let mut bind = self.bind;
        if let Some(port) = self.port {
            bind.set_port(port);
        }
        bind
    }

    fn bind_policy(&self) -> BindPolicy {
        if self.allow_remote {
            BindPolicy::AllowRemote
        } else {
            BindPolicy::LoopbackOnly
        }
    }
}

#[derive(Args)]
struct CodexAuthCli {
    #[command(subcommand)]
    command: Option<CodexAuthCommand>,
}

#[derive(Subcommand)]
enum CodexAuthCommand {
    /// Sign in to ChatGPT using device code authorization
    Login,
    /// Show stored ChatGPT credential status
    Status,
    /// Remove stored ChatGPT credentials
    Logout,
}

#[derive(Args)]
struct ArceeAuthCli {
    #[command(subcommand)]
    command: Option<ArceeAuthCommand>,
}

#[derive(Subcommand)]
enum ArceeAuthCommand {
    /// Sign in to Arcee using device code authorization
    Login,
    /// Show stored Arcee credential status
    Status,
    /// Remove stored Arcee credentials
    Logout,
}

#[derive(Args)]
struct UpgradeCli {
    /// Directory containing the executable to replace.
    ///
    /// Defaults to $INSTALL_DIR when set, otherwise the current executable directory.
    #[arg(long)]
    install_dir: Option<PathBuf>,

    /// Deprecated compatibility flag; prerelease upgrades are unsupported.
    #[arg(long)]
    pre_release: bool,

    /// Deprecated compatibility flag accepted only with --pre-release.
    #[arg(short = 'y', long, requires = "pre_release")]
    yes: bool,
}

#[derive(Args)]
struct GitHubCredentialCli {
    #[arg(long, hide = true)]
    state_root: PathBuf,

    #[arg(long, hide = true)]
    client_id: String,

    #[arg(hide = true)]
    operation: String,
}

#[tokio::main]
async fn main() {
    let result = run().await;
    let _ = nac_core::telemetry::finish_export(std::time::Duration::from_millis(100));
    if let Err(error) = result {
        eprintln!("Error: {error:#}");
        process::exit(1);
    }
}

async fn run() -> Result<()> {
    #[cfg(unix)]
    let desktop = nac_server::desktop_launch::DesktopLaunch::inherit()
        .map_err(|_| anyhow!("invalid private desktop launch channel"))?;
    if std::env::var_os("NAC_MANAGED_FAULT_ROOT").is_some() {
        #[cfg(not(feature = "managed-fault-fixture"))]
        return Err(anyhow!(
            "managed fault controls require the private fault-fixture build"
        ));
        #[cfg(feature = "managed-fault-fixture")]
        nac_core::managed_fault_fixture::validate_environment()?;
    }
    let invocation_name = current_invocation_name();
    let matches = cli_command(&invocation_name).get_matches();
    let cli = Cli::from_arg_matches(&matches).map_err(|error| anyhow!(error.to_string()))?;
    #[cfg(all(feature = "native-auth-fixture", unix))]
    if cli.command.is_some()
        && !matches!(
            &cli.command,
            Some(RootCommand::DesktopIdentity | RootCommand::DesktopConfiguration { .. })
        )
    {
        return Err(anyhow!(
            "native auth fixture executable does not admit effectful CLI commands"
        ));
    }
    match cli.command {
        #[cfg(unix)]
        Some(RootCommand::DesktopConfiguration {
            directory,
            store_path,
        }) => {
            #[cfg(feature = "native-auth-fixture")]
            nac_server::native_auth_fixture::admit_configuration(
                &directory,
                store_path.as_deref(),
            )?;
            println!(
                "{}",
                nac_server::desktop_startup::configuration_json(&directory, store_path)?
            );
            Ok(())
        }
        None => {
            #[cfg(unix)]
            if let Some(desktop) = desktop {
                let result = run_server_inner(cli.server, &invocation_name, Some(&desktop)).await;
                if let Err(error) = &result {
                    desktop.failed(error);
                    return Err(anyhow!("bundled desktop engine startup failed"));
                }
                return result;
            }
            run_server(cli.server, &invocation_name).await
        }
        #[cfg(unix)]
        Some(RootCommand::DesktopIdentity) => {
            println!("{}", nac_server::desktop_launch::identity_json()?);
            Ok(())
        }
        Some(RootCommand::Guide(guide)) => read_guide(guide),
        Some(RootCommand::GitHubCredential(helper)) => run_github_credential(helper).await,
        Some(RootCommand::CodexAuth(auth)) => run_codex_auth_cli(auth, &invocation_name).await,
        Some(RootCommand::ArceeAuth(auth)) => run_arcee_auth_cli(auth, &invocation_name).await,
        Some(RootCommand::Upgrade(upgrade)) => run_upgrade_cli(upgrade, &invocation_name).await,
    }
}

fn current_invocation_name() -> String {
    std::env::current_exe()
        .ok()
        .and_then(|path| {
            path.file_name()
                .map(|name| name.to_string_lossy().into_owned())
        })
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "nac-web".to_string())
}

fn cli_command(invocation_name: &str) -> clap::Command {
    Cli::command().bin_name(invocation_name.to_string())
}

async fn run_github_credential(cli: GitHubCredentialCli) -> Result<()> {
    if cli.operation != "get" {
        return Ok(());
    }
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .context("failed to read Git credential request")?;
    if let Some(token) = resolve_github_credential(&cli, &input).await? {
        println!("username=x-access-token");
        println!("password={}", token.secret());
    }
    Ok(())
}

async fn resolve_github_credential(
    cli: &GitHubCredentialCli,
    input: &str,
) -> Result<Option<nac_managed::GitHubAccessToken>> {
    let mut protocol = None;
    let mut host = None;
    for line in input.lines() {
        if let Some((name, value)) = line.split_once('=') {
            match name {
                "protocol" => protocol = Some(value),
                "host" => host = Some(value),
                _ => {}
            }
        }
    }
    let github_host = host
        .and_then(|host| host.split(':').next())
        .is_some_and(|host| host.eq_ignore_ascii_case("github.com"));
    if protocol != Some("https") || !github_host {
        return Ok(None);
    }
    let auth = nac_managed::ManagedGitHubAuth::new(&cli.state_root, cli.client_id.clone())?;
    let token = auth.current_token().await?.ok_or_else(|| {
        anyhow!("GitHub is not connected; reconnect GitHub before using HTTPS Git")
    })?;
    Ok(Some(token))
}

fn configured_mcp_oauth_callback_origin(
    cli_origin: Option<&str>,
    environment_origin: Option<String>,
) -> Option<String> {
    cli_origin
        .map(str::trim)
        .filter(|origin| !origin.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            environment_origin
                .map(|origin| origin.trim().to_owned())
                .filter(|origin| !origin.is_empty())
        })
}

async fn run_server(cli: ServerCli, invocation_name: &str) -> Result<()> {
    run_server_inner(
        cli,
        invocation_name,
        #[cfg(unix)]
        None,
    )
    .await
}

async fn run_server_inner(
    cli: ServerCli,
    invocation_name: &str,
    #[cfg(unix)] desktop: Option<&nac_server::desktop_launch::DesktopLaunch>,
) -> Result<()> {
    let bind = cli.bind_addr();
    let bind_policy = cli.bind_policy();
    #[cfg(all(feature = "native-auth-fixture", unix))]
    nac_server::native_auth_fixture::admit_serving(
        cli.directory.as_deref(),
        cli.store_path.as_deref(),
        bind,
        desktop.is_some(),
        cli.managed_config.is_some() || std::env::var_os("NAC_MANAGED_CONFIG").is_some(),
        cli.allow_remote,
    )?;
    let managed_config_path = cli
        .managed_config
        .or_else(|| std::env::var_os("NAC_MANAGED_CONFIG").map(PathBuf::from));
    bind_policy.validate(bind)?;
    if !bind.ip().is_loopback() {
        eprintln!("warning: every client that can reach {bind} receives full control of nac-web");
    }
    let launch_cwd = std::env::current_dir()?;
    let root_cwd = resolve_project_directory(&launch_cwd, cli.directory.as_deref(), cli.yes)?;
    eprintln!("project: {}", root_cwd.display());
    let managed_host =
        nac_managed::ManagedHostConfig::load_optional(managed_config_path.as_deref())?;
    if managed_host.is_none() {
        let callback_origin = configured_mcp_oauth_callback_origin(
            cli.mcp_oauth_callback_origin.as_deref(),
            std::env::var(MCP_OAUTH_CALLBACK_ORIGIN_ENV).ok(),
        );
        if !bind.ip().is_loopback() && callback_origin.is_none() {
            return Err(anyhow!(
                "--mcp-oauth-callback-origin is required for a non-loopback server bind"
            ));
        }
        if let Some(origin) = callback_origin {
            // The HTTP handlers independently validate the origin before use. Store the
            // explicit operator value process-wide so embedded router construction and
            // the CLI share one immutable source that never consults request headers.
            // SAFETY: startup is single-threaded here, before the server or workers spawn.
            unsafe { std::env::set_var(MCP_OAUTH_CALLBACK_ORIGIN_ENV, origin) };
        }
    }
    configure_telemetry(managed_host.as_ref());
    let options = ServerOptions {
        root_cwd,
        store_path: cli.store_path,
        managed_host,
    };
    #[cfg(unix)]
    let manager = match desktop {
        Some(_) => SessionManager::new_async(options).await?,
        None => SessionManager::new(options)?,
    };
    #[cfg(not(unix))]
    let manager = SessionManager::new(options)?;
    // Fire-and-forget models.dev catalog overlay refresh (4h cadence,
    // ETag-revalidated, never on picker/resume/validation paths).
    nac_core::model::spawn_overlay_refresh();
    // Fire-and-forget arcee model refresh (4h cadence, same pattern as the
    // models.dev overlay; fetches the live model list from the arcee API and
    // merges it into the catalog, falling back to seed models on failure).
    nac_core::model::spawn_arcee_model_refresh();
    // Fire-and-forget anthropic model refresh (4h cadence, same pattern as
    // the models.dev and arcee overlays; fetches model capabilities from the
    // Anthropic API and merges effort tiers, context window, max tokens,
    // thinking types and context_management support into the catalog).
    nac_core::model::spawn_anthropic_model_refresh();
    nac_core::model::spawn_codex_model_refresh();
    #[cfg(unix)]
    if let Some(desktop) = desktop {
        return desktop.serve(bind, manager).await;
    }
    let info = manager.store_info();
    let store_path = info.store_path.display().to_string();
    let open = should_open_dashboard(cli.open, cli.no_open);
    // Open the browser only after bind succeeds — otherwise the first load can
    // hit connection-refused while the socket is still closed. Post-login
    // dashboard launch goes through this same path.
    serve_with_policy(bind, bind_policy, manager, |bound| {
        let url = dashboard_url(bound);
        eprintln!("{invocation_name} listening on {url}");
        eprintln!(
            "build: {} {} ({})",
            env!("NAC_BUILD_TRACK"),
            env!("NAC_BUILD_ID"),
            env!("NAC_SOURCE_REVISION")
        );
        eprintln!("store: {store_path}");
        if open {
            eprintln!("opening the dashboard in your browser…");
            nac_core::browser::open_url(&url);
        }
    })
    .await
}

#[cfg(all(test, target_os = "linux"))]
fn restrict_managed_server_process(managed_config_path: Option<&Path>) -> Result<()> {
    if managed_config_path.is_some() {
        nac_core::runtime::restrict_same_uid_inspection()
            .context("failed to restrict Managed NAC process inspection")?;
    }
    Ok(())
}

/// Picks the project root: explicit `-C`, else confirm cwd (or type another path).
fn resolve_project_directory(
    launch_cwd: &Path,
    directory: Option<&Path>,
    assume_yes: bool,
) -> Result<PathBuf> {
    if let Some(path) = directory {
        return resolve_cli_cwd(launch_cwd, Some(path));
    }

    let default = resolve_cli_cwd(launch_cwd, None)?;
    if assume_yes || !io::stdin().is_terminal() {
        return Ok(default);
    }

    eprintln!("Project directory: {}", default.display());
    eprint!("Confirm this project folder? [Y/n] ");
    io::stderr().flush()?;

    let mut answer = String::new();
    io::stdin()
        .read_line(&mut answer)
        .context("failed to read project folder confirmation")?;
    let answer = answer.trim();
    if answer.is_empty() || answer.eq_ignore_ascii_case("y") || answer.eq_ignore_ascii_case("yes") {
        return Ok(default);
    }
    if !(answer.eq_ignore_ascii_case("n") || answer.eq_ignore_ascii_case("no")) {
        anyhow::bail!("expected y or n");
    }

    eprint!("Enter project directory: ");
    io::stderr().flush()?;
    let mut entered = String::new();
    io::stdin()
        .read_line(&mut entered)
        .context("failed to read project directory")?;
    let entered = entered.trim();
    if entered.is_empty() {
        anyhow::bail!("project directory is required");
    }
    resolve_cli_cwd(launch_cwd, Some(Path::new(&expand_user_path(entered))))
}

fn expand_user_path(value: &str) -> PathBuf {
    if value == "~" {
        return std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(value));
    }
    if let Some(rest) = value.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(value)
}

/// URL shown to humans and handed to the browser. Wildcard binds (`0.0.0.0`,
/// `::`) are rewritten to loopback so the link is actually reachable.
fn dashboard_url(bind: SocketAddr) -> String {
    let host = match bind.ip() {
        IpAddr::V4(ip) if ip.is_unspecified() => "127.0.0.1".to_string(),
        IpAddr::V6(ip) if ip.is_unspecified() => "[::1]".to_string(),
        IpAddr::V6(ip) => format!("[{ip}]"),
        ip => ip.to_string(),
    };
    format!("http://{host}:{}", bind.port())
}

fn should_open_dashboard(force_open: bool, no_open: bool) -> bool {
    if no_open {
        return false;
    }
    force_open || nac_core::browser::should_open_browser()
}

fn configure_telemetry(managed_host: Option<&nac_managed::ManagedHostConfig>) {
    let scenario = std::env::var("NAC_TELEMETRY_SCENARIO").ok();
    let runtime = nac_core::telemetry::RuntimeMetadata::sqlite(
        env!("NAC_BUILD_ID"),
        env!("NAC_SOURCE_REVISION"),
        nac_core::store::schema_version(),
        managed_host.map(|host| host.logical_host_id.as_str()),
        scenario.as_deref(),
    );
    if nac_core::telemetry::configure_from_env(runtime)
        == nac_core::telemetry::ConfigureStatus::Invalid
    {
        eprintln!("nac: ignoring invalid NAC_TELEMETRY mode; expected stderr or disabled");
    }
}
async fn run_codex_auth_cli(cli: CodexAuthCli, invocation_name: &str) -> Result<()> {
    match cli.command {
        Some(command) => {
            let is_login = matches!(command, CodexAuthCommand::Login);
            run_codex_auth_action(codex_auth_action(command)).await?;
            if is_login {
                println!("{}", login_complete_message(invocation_name));
            }
            Ok(())
        }
        None => {
            let mut root = cli_command(invocation_name);
            root.find_subcommand_mut("codex-auth")
                .ok_or_else(|| anyhow!("codex-auth command is missing from the CLI definition"))?
                .print_help()?;
            println!();
            Ok(())
        }
    }
}

fn codex_auth_action(command: CodexAuthCommand) -> CodexAuthAction {
    match command {
        CodexAuthCommand::Login => CodexAuthAction::Login,
        CodexAuthCommand::Status => CodexAuthAction::Status,
        CodexAuthCommand::Logout => CodexAuthAction::Logout,
    }
}

async fn run_arcee_auth_cli(cli: ArceeAuthCli, invocation_name: &str) -> Result<()> {
    match cli.command {
        Some(command) => {
            let is_login = matches!(command, ArceeAuthCommand::Login);
            run_arcee_auth_action(arcee_auth_action(command)).await?;
            if is_login {
                println!("{}", login_complete_message(invocation_name));
            }
            Ok(())
        }
        None => {
            let mut root = cli_command(invocation_name);
            root.find_subcommand_mut("arcee-auth")
                .ok_or_else(|| anyhow!("arcee-auth command is missing from the CLI definition"))?
                .print_help()?;
            println!();
            Ok(())
        }
    }
}

fn login_complete_message(invocation_name: &str) -> String {
    format!("Login complete. Run `{invocation_name}` to start the dashboard.")
}

fn arcee_auth_action(command: ArceeAuthCommand) -> ArceeAuthAction {
    match command {
        ArceeAuthCommand::Login => ArceeAuthAction::Login,
        ArceeAuthCommand::Status => ArceeAuthAction::Status,
        ArceeAuthCommand::Logout => ArceeAuthAction::Logout,
    }
}

async fn run_upgrade_cli(cli: UpgradeCli, invocation_name: &str) -> Result<()> {
    if cli.pre_release {
        let _compatibility_confirmation = cli.yes;
        return Err(anyhow!(
            "prerelease upgrades are unsupported; NAC has no RC, nightly, or preview channel"
        ));
    }
    if env!("NAC_BUILD_TRACK") == "dev" {
        return Err(anyhow!(
            "{invocation_name} is a dev source build and cannot self-upgrade; rebuild and reinstall it from the checkout with `make install-dev`"
        ));
    }
    let request = UpgradeRequest {
        install_dir: cli.install_dir,
        executable_path: Some(
            std::env::current_exe().context("failed to determine nac-web executable path")?,
        ),
        package_version: RELEASE_VERSION.to_string(),
    };
    run_upgrade(request).await
}

fn resolve_cli_cwd(
    launch_cwd: &std::path::Path,
    directory: Option<&std::path::Path>,
) -> Result<PathBuf> {
    let target = match directory {
        Some(path) if path.is_absolute() => path.to_path_buf(),
        Some(path) => launch_cwd.join(path),
        None => launch_cwd.to_path_buf(),
    };
    target
        .canonicalize()
        .with_context(|| format!("failed to resolve working directory {}", target.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "linux")]
    fn linux_process_controls() -> (libc::c_int, libc::c_int) {
        // SAFETY: these prctl getters take no pointer arguments.
        let dumpable = unsafe { libc::prctl(libc::PR_GET_DUMPABLE) };
        // SAFETY: PR_GET_NO_NEW_PRIVS takes integer zero placeholders only.
        let no_new_privs = unsafe { libc::prctl(libc::PR_GET_NO_NEW_PRIVS, 0, 0, 0, 0) };
        assert!(dumpable >= 0);
        assert!(no_new_privs >= 0);
        (dumpable, no_new_privs)
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn process_control_child_helper() {
        let Some(path) = std::env::var_os("NAC_PROCESS_CONTROL_CHILD_REPORT") else {
            return;
        };
        let (dumpable, no_new_privs) = linux_process_controls();
        std::fs::write(path, format!("dumpable={dumpable};nnp={no_new_privs}")).unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn managed_process_control_parent_helper() {
        let Some(root) = std::env::var_os("NAC_PROCESS_CONTROL_ROOT") else {
            return;
        };
        let root = PathBuf::from(root);
        let managed = std::env::var_os("NAC_PROCESS_CONTROL_MANAGED").is_some();
        let before = linux_process_controls();
        restrict_managed_server_process(managed.then_some(Path::new("/managed/config"))).unwrap();
        let after = linux_process_controls();
        let child_report = root.join("child");
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "tests::process_control_child_helper",
                "--nocapture",
            ])
            .env("NAC_PROCESS_CONTROL_CHILD_REPORT", &child_report)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "process-control child failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let child = std::fs::read_to_string(child_report).unwrap();
        std::fs::write(
            root.join("parent"),
            format!(
                "before-dump={};before-nnp={};after-dump={};after-nnp={};child={child}",
                before.0, before.1, after.0, after.1
            ),
        )
        .unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn managed_hardening_is_opt_in_and_precedes_descendants() {
        for managed in [false, true] {
            let root = std::env::temp_dir().join(format!(
                "nac_process_controls_{}_{}",
                managed,
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&root).unwrap();
            let mut command = std::process::Command::new(std::env::current_exe().unwrap());
            command
                .args([
                    "--exact",
                    "tests::managed_process_control_parent_helper",
                    "--nocapture",
                ])
                .env("NAC_PROCESS_CONTROL_ROOT", &root);
            if managed {
                command.env("NAC_PROCESS_CONTROL_MANAGED", "1");
            }
            let output = command.output().unwrap();
            assert!(
                output.status.success(),
                "process-control parent failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            let report = std::fs::read_to_string(root.join("parent")).unwrap();
            let fields = report
                .split(';')
                .map(|field| field.split_once('=').unwrap())
                .collect::<std::collections::BTreeMap<_, _>>();
            if managed {
                assert!(report.contains("after-dump=0;after-nnp=1"), "{report}");
                assert_eq!(fields["nnp"], "1", "{report}");
            } else {
                assert_eq!(fields["before-dump"], fields["after-dump"], "{report}");
                assert_eq!(fields["before-nnp"], fields["after-nnp"], "{report}");
                assert_eq!(fields["before-nnp"], fields["nnp"], "{report}");
            }
            let _ = std::fs::remove_dir_all(root);
        }
    }

    fn parse_server(args: &[&str]) -> ServerCli {
        let cli = Cli::try_parse_from(args.iter().copied()).unwrap();
        assert!(cli.command.is_none());
        cli.server
    }

    fn rendered_help(args: &[&str]) -> String {
        let error = Cli::try_parse_from(args.iter().copied())
            .err()
            .expect("--help must short-circuit parsing");
        assert_eq!(error.kind(), clap::error::ErrorKind::DisplayHelp);
        error.to_string()
    }

    #[test]
    fn retired_worker_command_and_option_are_rejected() {
        assert!(Cli::try_parse_from(["nac-web", "__worker"]).is_err());
        assert!(Cli::try_parse_from(["nac-web", "--worker-executable", "worker"]).is_err());
        let help = rendered_help(&["nac-web", "--help"]);
        assert!(!help.contains("__worker"));
        assert!(!help.contains("worker-executable"));
    }

    #[test]
    fn auth_commands_parse_optional_actions() {
        let cli = Cli::try_parse_from(["nac-web", "codex-auth"]).unwrap();
        assert!(matches!(
            cli.command,
            Some(RootCommand::CodexAuth(CodexAuthCli { command: None }))
        ));

        let cli = Cli::try_parse_from(["nac-web", "codex-auth", "status"]).unwrap();
        assert!(matches!(
            cli.command,
            Some(RootCommand::CodexAuth(CodexAuthCli {
                command: Some(CodexAuthCommand::Status)
            }))
        ));

        let cli = Cli::try_parse_from(["nac-web", "arcee-auth"]).unwrap();
        assert!(matches!(
            cli.command,
            Some(RootCommand::ArceeAuth(ArceeAuthCli { command: None }))
        ));

        let cli = Cli::try_parse_from(["nac-web", "arcee-auth", "login"]).unwrap();
        assert!(matches!(
            cli.command,
            Some(RootCommand::ArceeAuth(ArceeAuthCli {
                command: Some(ArceeAuthCommand::Login)
            }))
        ));
    }

    #[test]
    fn upgrade_command_parses_arguments() {
        let cli = Cli::try_parse_from(["nac-web", "upgrade"]).unwrap();
        let Some(RootCommand::Upgrade(upgrade)) = cli.command else {
            panic!("expected upgrade command");
        };
        assert!(upgrade.install_dir.is_none());
        assert!(!upgrade.pre_release);
        assert!(!upgrade.yes);

        let cli = Cli::try_parse_from([
            "nac-web",
            "upgrade",
            "--install-dir",
            "/tmp/test",
            "--pre-release",
            "-y",
        ])
        .unwrap();
        let Some(RootCommand::Upgrade(upgrade)) = cli.command else {
            panic!("expected upgrade command");
        };
        assert_eq!(
            upgrade.install_dir.as_deref(),
            Some(std::path::Path::new("/tmp/test"))
        );
        assert!(upgrade.pre_release);
        assert!(upgrade.yes);

        let error = Cli::try_parse_from(["nac-web", "upgrade", "--yes"])
            .err()
            .expect("--yes without --pre-release must fail");
        assert_eq!(
            error.kind(),
            clap::error::ErrorKind::MissingRequiredArgument
        );
    }

    #[test]
    fn upgrade_help_marks_prerelease_compatibility_as_unsupported() {
        let help = rendered_help(&["nac-web", "upgrade", "--help"]);
        assert!(help.contains("Deprecated compatibility flag"), "{help}");
        assert!(
            help.contains("prerelease upgrades are unsupported"),
            "{help}"
        );
    }

    #[tokio::test]
    async fn prerelease_upgrade_fails_before_resolution_or_installation() {
        let cli = Cli::try_parse_from(["nac-web", "upgrade", "--pre-release", "--yes"]).unwrap();
        let Some(RootCommand::Upgrade(upgrade)) = cli.command else {
            panic!("expected upgrade command");
        };
        let error = run_upgrade_cli(upgrade, "nac-web")
            .await
            .unwrap_err()
            .to_string();
        assert!(
            error.contains("no RC, nightly, or preview channel"),
            "{error}"
        );
    }

    #[tokio::test]
    async fn dev_upgrade_fails_before_resolution_download_or_installation() {
        assert_eq!(env!("NAC_BUILD_TRACK"), "dev");
        let cli = Cli::try_parse_from(["nac-my-branch", "upgrade"]).unwrap();
        let Some(RootCommand::Upgrade(upgrade)) = cli.command else {
            panic!("expected upgrade command");
        };
        let error = run_upgrade_cli(upgrade, "nac-my-branch")
            .await
            .unwrap_err()
            .to_string();
        assert!(
            error.contains("nac-my-branch is a dev source build"),
            "{error}"
        );
        assert!(error.contains("make install-dev"), "{error}");
    }

    #[test]
    fn server_cli_resolves_bind_address() {
        let cases: &[(&[&str], &str)] = &[
            (&["nac-web"], "127.0.0.1:3210"),
            (&["nac-web", "--port", "4321"], "127.0.0.1:4321"),
            (&["nac-web", "--bind", "[::1]:4322"], "[::1]:4322"),
        ];

        for (args, expected) in cases {
            assert_eq!(parse_server(args).bind_addr(), expected.parse().unwrap());
        }
    }

    #[test]
    fn managed_configuration_is_explicit_and_ordinary_server_cli_remains_unmanaged() {
        let ordinary = parse_server(&["nac-web"]);
        assert!(ordinary.managed_config.is_none());

        let managed = parse_server(&["nac-web", "--managed-config", "/etc/nac/managed.toml"]);
        assert_eq!(
            managed.managed_config.as_deref(),
            Some(std::path::Path::new("/etc/nac/managed.toml"))
        );
    }

    #[tokio::test]
    async fn github_credential_helper_is_https_github_scoped_and_returns_the_current_token() {
        let root = std::env::temp_dir().join(format!(
            "nac-github-helper-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let auth = nac_managed::ManagedGitHubAuth::new(&root, "Iv1.test").unwrap();
        auth.store_test_authorization("helper-access-canary", "helper-refresh-canary", u64::MAX)
            .unwrap();
        let cli = GitHubCredentialCli {
            state_root: root.clone(),
            client_id: "Iv1.test".to_string(),
            operation: "get".to_string(),
        };

        let token = resolve_github_credential(
            &cli,
            "protocol=https\nhost=github.com\npath=arcee-ai/repo.git\n\n",
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(token.secret(), "helper-access-canary");
        assert!(resolve_github_credential(
            &cli,
            "protocol=https\nhost=example.com\npath=arcee-ai/repo.git\n\n"
        )
        .await
        .unwrap()
        .is_none());
        assert!(
            resolve_github_credential(&cli, "protocol=http\nhost=github.com\n\n")
                .await
                .unwrap()
                .is_none()
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn remote_binding_requires_explicit_acknowledgement() {
        let guarded = parse_server(&["nac-web", "--bind", "0.0.0.0:3210"]);
        assert_eq!(guarded.bind_policy(), BindPolicy::LoopbackOnly);

        let allowed = parse_server(&["nac-web", "--bind", "192.168.1.20:3210", "--allow-remote"]);
        assert_eq!(allowed.bind_policy(), BindPolicy::AllowRemote);
    }

    #[test]
    fn callback_origin_ignores_blank_cli_and_environment_values() {
        assert_eq!(configured_mcp_oauth_callback_origin(None, None), None);
        assert_eq!(
            configured_mcp_oauth_callback_origin(Some(" \t "), Some(" \n ".into())),
            None
        );
        assert_eq!(
            configured_mcp_oauth_callback_origin(
                Some(" \t "),
                Some(" https://nac.example.test \n".into())
            )
            .as_deref(),
            Some("https://nac.example.test")
        );
        assert_eq!(
            configured_mcp_oauth_callback_origin(
                Some(" https://cli.example.test "),
                Some("https://environment.example.test".into())
            )
            .as_deref(),
            Some("https://cli.example.test")
        );
    }

    #[test]
    fn server_cli_rejects_bind_with_port() {
        let error = Cli::try_parse_from(["nac-web", "--bind", "127.0.0.1:4321", "--port", "4322"])
            .err()
            .expect("explicit --bind and --port must conflict");
        assert_eq!(error.kind(), clap::error::ErrorKind::ArgumentConflict);
    }

    #[test]
    fn server_cli_rejects_ports_outside_supported_range() {
        for port in ["0", "65536"] {
            let error = Cli::try_parse_from(["nac-web", "--port", port])
                .err()
                .expect("out-of-range port must be rejected");
            assert_eq!(error.kind(), clap::error::ErrorKind::ValueValidation);
        }
    }

    #[test]
    fn server_options_cannot_be_mixed_with_commands() {
        for args in [
            &["nac-web", "--no-open", "codex-auth"][..],
            &["nac-web", "codex-auth", "--no-open"],
            &["nac-web", "--no-open", "arcee-auth"],
            &["nac-web", "arcee-auth", "--no-open"],
            &["nac-web", "--no-open", "upgrade"],
            &["nac-web", "upgrade", "--no-open"],
            &["nac-web", "--no-open", "__worker"],
            &["nac-web", "__worker", "--no-open"],
        ] {
            assert!(
                Cli::try_parse_from(args.iter().copied()).is_err(),
                "{args:?}"
            );
        }
    }

    #[test]
    fn root_help_and_version_take_precedence_over_following_commands() {
        let help = Cli::try_parse_from(["nac-web", "--help", "upgrade"])
            .err()
            .expect("--help must short-circuit parsing");
        assert_eq!(help.kind(), clap::error::ErrorKind::DisplayHelp);

        let version = Cli::try_parse_from(["nac-web", "--version", "upgrade"])
            .err()
            .expect("--version must short-circuit parsing");
        assert_eq!(version.kind(), clap::error::ErrorKind::DisplayVersion);
    }

    #[test]
    fn public_version_flags_preserve_build_identity() {
        for prefix in [
            &["nac-web"][..],
            &["nac-web", "codex-auth"],
            &["nac-web", "arcee-auth"],
            &["nac-web", "upgrade"],
        ] {
            let mut long_args = prefix.to_vec();
            long_args.push("--version");
            let error = Cli::try_parse_from(long_args)
                .err()
                .expect("--version must short-circuit parsing");
            assert_eq!(error.kind(), clap::error::ErrorKind::DisplayVersion);
            let rendered = error.to_string();
            assert!(rendered.contains(RELEASE_VERSION), "{rendered}");
            assert!(rendered.contains(env!("NAC_BUILD_REVISION")), "{rendered}");

            let mut short_args = prefix.to_vec();
            short_args.push("-V");
            let short = Cli::try_parse_from(short_args)
                .err()
                .expect("-V must short-circuit parsing");
            assert_eq!(short.kind(), clap::error::ErrorKind::DisplayVersion);
            let short_rendered = short.to_string();
            assert!(short_rendered.contains(RELEASE_VERSION), "{short_rendered}");
            assert!(!short_rendered.contains('('), "{short_rendered}");
        }
    }

    #[test]
    fn version_flags_are_not_added_to_actions_or_internal_worker() {
        for args in [
            &["nac-web", "codex-auth", "login", "--version"][..],
            &["nac-web", "arcee-auth", "status", "--version"],
            &["nac-web", "__worker", "--version"],
        ] {
            let error = Cli::try_parse_from(args.iter().copied())
                .err()
                .expect("version must remain unsupported");
            assert_ne!(error.kind(), clap::error::ErrorKind::DisplayVersion);
        }
    }

    #[test]
    fn root_help_documents_public_command_and_server_contracts() {
        let help = rendered_help(&["nac-web", "--help"]);
        for expected in [
            "With no command, this executable serves the selected project",
            "codex-auth",
            "Manage ChatGPT credentials used by Codex models",
            "arcee-auth",
            "Manage Arcee account credentials",
            "upgrade",
            "Download and reinstall the latest stable NAC release",
            "-p, --port <PORT>",
            "127.0.0.1",
            "1-65535",
            "default: 3210",
            "Cannot be used with --bind",
            "--allow-remote",
            "equivalent to the local user",
        ] {
            assert!(help.contains(expected), "missing {expected:?}:\n{help}");
        }
        for hidden in ["__worker", "--session-id"] {
            assert!(!help.contains(hidden), "unexpected {hidden:?}:\n{help}");
        }
        assert!(help.contains("\n  help "));

        for args in [&["nac-web", "help"][..], &["nac-web", "help", "upgrade"]] {
            let generated_help = Cli::try_parse_from(args.iter().copied())
                .err()
                .expect("generated root help command must be available");
            assert_eq!(generated_help.kind(), clap::error::ErrorKind::DisplayHelp);
        }
    }

    #[test]
    fn help_and_actionable_hints_use_the_exact_invocation_name() {
        let error = cli_command("nac-my-branch")
            .try_get_matches_from(["ignored", "codex-auth", "login", "--help"])
            .unwrap_err();
        assert_eq!(error.kind(), clap::error::ErrorKind::DisplayHelp);
        let help = error.to_string();
        assert!(
            help.contains("Usage: nac-my-branch codex-auth login"),
            "{help}"
        );
        assert!(!help.contains("Usage: nac-web"), "{help}");
        assert_eq!(
            login_complete_message("nac-my-branch"),
            "Login complete. Run `nac-my-branch` to start the dashboard."
        );
    }

    #[test]
    fn auth_group_help_lists_every_action() {
        for (group, credential) in [
            ("codex-auth", "ChatGPT credentials"),
            ("arcee-auth", "Arcee account credentials"),
        ] {
            let help = rendered_help(&["nac-web", group, "--help"]);
            for expected in ["login", "status", "logout", "help", credential] {
                assert!(help.contains(expected), "missing {expected:?}:\n{help}");
            }

            for args in [
                &["nac-web", group, "help"][..],
                &["nac-web", group, "help", "login"],
            ] {
                let generated_help = Cli::try_parse_from(args.iter().copied())
                    .err()
                    .expect("generated auth help command must be available");
                assert_eq!(generated_help.kind(), clap::error::ErrorKind::DisplayHelp);
            }
        }
    }

    #[test]
    fn auth_action_help_explains_all_six_actions() {
        for (group, action, summary) in [
            (
                "codex-auth",
                "login",
                "Sign in to ChatGPT using device code authorization",
            ),
            (
                "codex-auth",
                "status",
                "Show stored ChatGPT credential status",
            ),
            ("codex-auth", "logout", "Remove stored ChatGPT credentials"),
            (
                "arcee-auth",
                "login",
                "Sign in to Arcee using device code authorization",
            ),
            (
                "arcee-auth",
                "status",
                "Show stored Arcee credential status",
            ),
            ("arcee-auth", "logout", "Remove stored Arcee credentials"),
        ] {
            let help = rendered_help(&["nac-web", group, action, "--help"]);
            let usage = format!("Usage: nac-web {group} {action}");
            assert!(help.contains(&usage), "missing {usage:?}:\n{help}");
            assert!(help.contains(summary), "missing {summary:?}:\n{help}");
        }
    }

    #[test]
    fn upgrade_help_documents_reinstall_and_install_directory() {
        let help = rendered_help(&["nac-web", "upgrade", "--help"]);
        for expected in [
            "Download and reinstall the latest stable NAC release",
            "--install-dir <INSTALL_DIR>",
            "$INSTALL_DIR",
            "current executable directory",
        ] {
            assert!(help.contains(expected), "missing {expected:?}:\n{help}");
        }
    }
}
