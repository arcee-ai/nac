use std::{
    ffi::OsString,
    io::{self, IsTerminal, Write},
    net::SocketAddr,
    path::PathBuf,
};

use anyhow::{Context, Result};
use clap::Parser;

use super::config::ShareAllowlistOverride;

#[derive(clap::Args, Clone)]
struct ShareRootArgs {
    /// Server root directory for default config and relative store paths.
    #[arg(short = 'C', long)]
    directory: Option<PathBuf>,
}

#[derive(clap::Args, Clone)]
struct ShareBindArgs {
    /// Address to bind nac-web to. Share mode requires loopback unless --insecure-bind is set.
    #[arg(long, default_value = "127.0.0.1:3210")]
    bind: SocketAddr,

    /// Allow share mode to bind a non-loopback address. Unsafe without another network boundary.
    #[arg(long)]
    insecure_bind: bool,
}

#[derive(clap::Args, Clone)]
struct ShareRunServerArgs {
    #[command(flatten)]
    root: ShareRootArgs,

    #[command(flatten)]
    bind: ShareBindArgs,

    /// Override the server SQLite store path.
    #[arg(long)]
    store_path: Option<PathBuf>,

    /// Worker executable for managed worker dispatch. Defaults to this nac-web binary.
    #[arg(long)]
    worker_executable: Option<PathBuf>,
}

#[derive(clap::Args, Clone, Copy, Default)]
struct ShareAuthArgs {
    /// Require ngrok OAuth protection, overriding saved auth_required = false.
    #[arg(long, visible_alias = "auth-required", conflicts_with = "no_auth")]
    auth: bool,

    /// Disable ngrok OAuth protection. In configure mode this persists after confirmation.
    #[arg(long, conflicts_with = "auth")]
    no_auth: bool,
}

#[derive(Parser)]
#[command(
    name = "nac-web share",
    about = "Share nac-web through ngrok (run-only; does not persist config or secrets)",
    after_help = "Commands:\n  configure   Persist ngrok share setup\n  doctor      Check ngrok share setup\n  status      Show saved ngrok share config"
)]
pub(crate) struct ShareRunCli {
    #[command(flatten)]
    server: ShareRunServerArgs,

    /// Reserved ngrok domain for paid/custom-domain accounts. Ephemeral for this run.
    #[arg(long)]
    domain: Option<String>,

    /// Environment variable that contains the ngrok authtoken. Ephemeral for this run.
    #[arg(long)]
    authtoken_env: Option<String>,

    /// Google account email allowed through ngrok OAuth. Can be repeated. Ephemeral for this run. Re-enables auth unless --no-auth is also set.
    #[arg(long = "allow-email")]
    allow_emails: Vec<String>,

    /// Google Workspace/email domain allowed through ngrok OAuth. Can be repeated. Ephemeral for this run. Re-enables auth unless --no-auth is also set.
    #[arg(long = "allow-domain")]
    allow_domains: Vec<String>,

    #[command(flatten)]
    auth: ShareAuthArgs,
}

#[derive(Parser)]
#[command(
    name = "nac-web share configure",
    about = "Persist ngrok share configuration and optional local secret"
)]
pub(crate) struct ShareConfigureCli {
    #[command(flatten)]
    root: ShareRootArgs,

    #[command(flatten)]
    bind: ShareBindArgs,

    /// Reserved ngrok domain for paid/custom-domain accounts.
    #[arg(long)]
    domain: Option<String>,

    /// Environment variable that contains the ngrok authtoken.
    #[arg(long)]
    authtoken_env: Option<String>,

    /// OAuth provider to request at the ngrok edge.
    #[arg(long)]
    oauth_provider: Option<String>,

    /// Google account email allowed through ngrok OAuth. Can be repeated. Replaces any saved allowlist when provided and re-enables auth unless --no-auth is also set.
    #[arg(long = "allow-email")]
    allow_emails: Vec<String>,

    /// Google Workspace/email domain allowed through ngrok OAuth. Can be repeated. Replaces any saved allowlist when provided and re-enables auth unless --no-auth is also set.
    #[arg(long = "allow-domain")]
    allow_domains: Vec<String>,

    #[command(flatten)]
    auth: ShareAuthArgs,

    /// Do not save a prompted ngrok authtoken to NAC_HOME/secrets.toml.
    #[arg(long)]
    no_save_token: bool,

    /// Accept dangerous confirmations non-interactively.
    #[arg(long)]
    yes: bool,
}

#[derive(Parser)]
#[command(
    name = "nac-web share doctor",
    about = "Check ngrok share configuration and local health"
)]
pub(crate) struct ShareDoctorCli {
    #[command(flatten)]
    root: ShareRootArgs,

    #[command(flatten)]
    bind: ShareBindArgs,

    /// Reserved ngrok domain override.
    #[arg(long)]
    domain: Option<String>,

    /// Environment variable that contains the ngrok authtoken.
    #[arg(long)]
    authtoken_env: Option<String>,

    /// Google account email allowed through ngrok OAuth. Can be repeated. Replaces any saved allowlist for this check when provided and re-enables auth unless --no-auth is also set.
    #[arg(long = "allow-email")]
    allow_emails: Vec<String>,

    /// Google Workspace/email domain allowed through ngrok OAuth. Can be repeated. Replaces any saved allowlist for this check when provided and re-enables auth unless --no-auth is also set.
    #[arg(long = "allow-domain")]
    allow_domains: Vec<String>,

    #[command(flatten)]
    auth: ShareAuthArgs,

    /// Skip the local /health check.
    #[arg(long)]
    skip_health: bool,
}

#[derive(Parser)]
#[command(name = "nac-web share status", about = "Show saved ngrok share config")]
pub(crate) struct ShareStatusCli {
    #[command(flatten)]
    root: ShareRootArgs,

    /// Reserved ngrok domain override.
    #[arg(long)]
    domain: Option<String>,

    /// Environment variable that contains the ngrok authtoken.
    #[arg(long)]
    authtoken_env: Option<String>,
}

pub(crate) enum ShareCli {
    Run(ShareRunCli),
    Configure(ShareConfigureCli),
    Doctor(ShareDoctorCli),
    Status(ShareStatusCli),
}

pub(crate) fn parse_from(args: Vec<OsString>) -> ShareCli {
    match args.get(2).and_then(|value| value.to_str()) {
        Some("configure") => ShareCli::Configure(ShareConfigureCli::parse_from(
            nested_subcommand_args(args, "nac-web share configure", 3),
        )),
        Some("doctor") => ShareCli::Doctor(ShareDoctorCli::parse_from(nested_subcommand_args(
            args,
            "nac-web share doctor",
            3,
        ))),
        Some("status") => ShareCli::Status(ShareStatusCli::parse_from(nested_subcommand_args(
            args,
            "nac-web share status",
            3,
        ))),
        _ => ShareCli::Run(ShareRunCli::parse_from(subcommand_args(
            args,
            "nac-web share",
        ))),
    }
}

pub(crate) async fn run(cli: ShareCli) -> Result<()> {
    match cli {
        ShareCli::Run(cli) => run_share(cli).await,
        ShareCli::Configure(cli) => run_share_configure(cli).await,
        ShareCli::Doctor(cli) => run_share_doctor(cli).await,
        ShareCli::Status(cli) => run_share_status(cli).await,
    }
}

fn subcommand_args(args: Vec<OsString>, name: &str) -> Vec<OsString> {
    nested_subcommand_args(args, name, 2)
}

fn nested_subcommand_args(args: Vec<OsString>, name: &str, skip: usize) -> Vec<OsString> {
    let mut parsed = Vec::with_capacity(args.len().saturating_sub(1));
    parsed.push(OsString::from(name));
    parsed.extend(args.into_iter().skip(skip));
    parsed
}

async fn run_share(cli: ShareRunCli) -> Result<()> {
    let launch_cwd = std::env::current_dir()?;
    let root_cwd = crate::resolve_cli_cwd(&launch_cwd, cli.server.root.directory.as_deref())?;
    let overrides = share_overrides(
        cli.authtoken_env,
        None,
        cli.domain,
        cli.allow_emails,
        cli.allow_domains,
        cli.auth,
    )?;
    super::run_share(super::ShareRunOptions {
        root_cwd,
        bind: cli.server.bind.bind,
        store_path: cli.server.store_path,
        worker_executable: cli.server.worker_executable,
        overrides,
        authtoken: None,
        insecure_bind: cli.server.bind.insecure_bind,
    })
    .await
}

async fn run_share_configure(cli: ShareConfigureCli) -> Result<()> {
    let launch_cwd = std::env::current_dir()?;
    let root_cwd = crate::resolve_cli_cwd(&launch_cwd, cli.root.directory.as_deref())?;
    super::validate_share_bind(cli.bind.bind, cli.bind.insecure_bind)?;

    let overrides = share_overrides(
        cli.authtoken_env,
        cli.oauth_provider,
        cli.domain,
        cli.allow_emails,
        cli.allow_domains,
        cli.auth,
    )?;
    let saved = super::load_saved_share_config(&root_cwd)?;
    let mut ngrok = super::effective_share_config(&saved, &overrides);
    if !ngrok.auth_required && !cli.yes {
        eprintln!(
            "WARNING: this will persist auth_required = false. Anyone with the public URL may reach nac-web."
        );
        let confirmation = prompt_required("Type DISABLE to persist disabled ngrok auth", None)?;
        if confirmation != "DISABLE" {
            anyhow::bail!("refusing to persist disabled ngrok auth without confirmation");
        }
    }
    let normalized_for_token = super::normalize_share_config(&ngrok)?;
    let mut prompted_token = None;

    if super::try_resolve_authtoken(&root_cwd, &normalized_for_token, None)?.is_none() {
        println!(
            "Create or copy an ngrok authtoken from https://dashboard.ngrok.com/get-started/your-authtoken"
        );
        let token = prompt_secret_required("ngrok authtoken")?;
        if cli.no_save_token {
            println!(
                "authtoken not saved; future `nac-web share` runs must set {} or save a token in {}",
                normalized_for_token.authtoken_env,
                super::secrets_path_from_cwd(&root_cwd)?.display()
            );
            prompted_token = Some(token);
        } else {
            let path = super::save_authtoken_secret(&root_cwd, &token)?;
            println!("saved authtoken: {}", path.display());
        }
    }

    if ngrok.auth_required && ngrok.allow_emails.is_empty() && ngrok.allow_domains.is_empty() {
        let value = prompt_required("Allowed Google email or domain", None)?;
        super::add_allowlist_entry(&mut ngrok, &value);
    }

    let ngrok = super::normalize_share_config(&ngrok)?;
    let config_path = super::save_configured_share_config(&root_cwd, &ngrok)?;
    println!("saved config: {}", config_path.display());

    if prompted_token.is_some() {
        println!("doctor check below uses the prompted authtoken for this invocation only");
    }
    let doctor = super::run_doctor(super::DoctorOptions {
        root_cwd: root_cwd.clone(),
        bind: cli.bind.bind,
        overrides: super::ShareConfigOverrides::default(),
        authtoken: prompted_token,
        check_health: false,
        insecure_bind: cli.bind.insecure_bind,
    })
    .await;
    print!("{}", super::format_doctor_report(&doctor));
    if !doctor.ok() {
        anyhow::bail!(
            "share configure found {} failing check(s)",
            doctor.failure_count()
        );
    }
    Ok(())
}

async fn run_share_doctor(cli: ShareDoctorCli) -> Result<()> {
    let launch_cwd = std::env::current_dir()?;
    let root_cwd = crate::resolve_cli_cwd(&launch_cwd, cli.root.directory.as_deref())?;
    let overrides = share_overrides(
        cli.authtoken_env,
        None,
        cli.domain,
        cli.allow_emails,
        cli.allow_domains,
        cli.auth,
    )?;
    let report = super::run_doctor(super::DoctorOptions {
        root_cwd,
        bind: cli.bind.bind,
        overrides,
        authtoken: None,
        check_health: !cli.skip_health,
        insecure_bind: cli.bind.insecure_bind,
    })
    .await;
    print!("{}", super::format_doctor_report(&report));
    if report.ok() {
        Ok(())
    } else {
        anyhow::bail!(
            "share doctor found {} failing check(s)",
            report.failure_count()
        )
    }
}

async fn run_share_status(cli: ShareStatusCli) -> Result<()> {
    let launch_cwd = std::env::current_dir()?;
    let root_cwd = crate::resolve_cli_cwd(&launch_cwd, cli.root.directory.as_deref())?;
    let saved = super::load_saved_share_config(&root_cwd)?;
    let ngrok = super::effective_share_config(
        &saved,
        &super::ShareConfigOverrides {
            authtoken_env: cli.authtoken_env,
            domain: cli.domain,
            ..super::ShareConfigOverrides::default()
        },
    );

    println!("public URL: generated by ngrok at launch");
    println!(
        "custom domain: {}",
        ngrok.domain.as_deref().unwrap_or("<none>")
    );
    println!("authtoken env: {}", ngrok.authtoken_env);
    println!(
        "authtoken: {}",
        match super::try_resolve_authtoken(&root_cwd, &ngrok, None)? {
            Some(token) => format!("resolved from {}", token.source),
            None => "missing".to_string(),
        }
    );
    println!("oauth provider: {}", ngrok.oauth_provider);
    println!("allowed emails: {}", display_list(&ngrok.allow_emails));
    println!("allowed domains: {}", display_list(&ngrok.allow_domains));
    println!(
        "auth required: {}",
        if ngrok.auth_required { "yes" } else { "no" }
    );
    println!(
        "secrets: {}",
        super::secrets_path_from_cwd(&root_cwd)?.display()
    );
    Ok(())
}

fn share_overrides(
    authtoken_env: Option<String>,
    oauth_provider: Option<String>,
    domain: Option<String>,
    allow_emails: Vec<String>,
    allow_domains: Vec<String>,
    auth: ShareAuthArgs,
) -> Result<super::ShareConfigOverrides> {
    let allowlist =
        (!allow_emails.is_empty() || !allow_domains.is_empty()).then_some(ShareAllowlistOverride {
            emails: allow_emails,
            domains: allow_domains,
        });
    Ok(super::ShareConfigOverrides {
        authtoken_env,
        oauth_provider,
        allowlist,
        domain,
        auth_required: auth_required_override(auth)?,
    })
}

fn auth_required_override(auth: ShareAuthArgs) -> Result<Option<bool>> {
    if auth.auth && auth.no_auth {
        anyhow::bail!("--auth and --no-auth cannot be used together");
    }
    if auth.no_auth {
        Ok(Some(false))
    } else if auth.auth {
        Ok(Some(true))
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::error::ErrorKind;

    fn saved_no_auth_config() -> crate::share::config::NgrokConfig {
        crate::share::config::NgrokConfig {
            auth_required: false,
            ..crate::share::config::NgrokConfig::default()
        }
    }

    #[test]
    fn configure_allowlist_reenables_saved_no_auth() {
        let cli = ShareConfigureCli::try_parse_from([
            "nac-web share configure",
            "--allow-email",
            "user@example.com",
        ])
        .expect("parse configure args");

        let overrides = share_overrides(
            cli.authtoken_env,
            cli.oauth_provider,
            cli.domain,
            cli.allow_emails,
            cli.allow_domains,
            cli.auth,
        )
        .expect("share overrides");
        let effective = crate::share::effective_share_config(&saved_no_auth_config(), &overrides);

        assert_eq!(effective.allow_emails, vec!["user@example.com"]);
        assert!(effective.auth_required);
    }

    #[test]
    fn run_allowlist_reenables_saved_no_auth() {
        let cli = ShareRunCli::try_parse_from(["nac-web share", "--allow-domain", "example.com"])
            .expect("parse run args");

        let overrides = share_overrides(
            cli.authtoken_env,
            None,
            cli.domain,
            cli.allow_emails,
            cli.allow_domains,
            cli.auth,
        )
        .expect("share overrides");
        let effective = crate::share::effective_share_config(&saved_no_auth_config(), &overrides);

        assert_eq!(effective.allow_domains, vec!["example.com"]);
        assert!(effective.auth_required);
    }

    #[test]
    fn explicit_auth_reenables_saved_no_auth() {
        let cli = ShareConfigureCli::try_parse_from(["nac-web share configure", "--auth"])
            .expect("parse configure args");

        let overrides = share_overrides(
            cli.authtoken_env,
            cli.oauth_provider,
            cli.domain,
            cli.allow_emails,
            cli.allow_domains,
            cli.auth,
        )
        .expect("share overrides");
        let effective = crate::share::effective_share_config(&saved_no_auth_config(), &overrides);

        assert!(effective.auth_required);
    }

    #[test]
    fn explicit_no_auth_can_override_allowlist_reenable() {
        let cli = ShareConfigureCli::try_parse_from([
            "nac-web share configure",
            "--allow-email",
            "user@example.com",
            "--no-auth",
            "--yes",
        ])
        .expect("parse configure args");

        let overrides = share_overrides(
            cli.authtoken_env,
            cli.oauth_provider,
            cli.domain,
            cli.allow_emails,
            cli.allow_domains,
            cli.auth,
        )
        .expect("share overrides");
        let effective = crate::share::effective_share_config(&saved_no_auth_config(), &overrides);

        assert!(!effective.auth_required);
    }

    #[test]
    fn auth_flags_conflict() {
        let error = ShareRunCli::try_parse_from(["nac-web share", "--auth", "--no-auth"])
            .err()
            .expect("auth flags should conflict");

        assert_eq!(error.kind(), ErrorKind::ArgumentConflict);
    }

    #[test]
    fn configure_and_doctor_reject_run_only_server_args() {
        let configure_error = ShareConfigureCli::try_parse_from([
            "nac-web share configure",
            "--store-path",
            "store.db",
        ])
        .err()
        .expect("configure should reject --store-path");
        let doctor_error = ShareDoctorCli::try_parse_from([
            "nac-web share doctor",
            "--worker-executable",
            "nac-web",
        ])
        .err()
        .expect("doctor should reject --worker-executable");

        assert_eq!(configure_error.kind(), ErrorKind::UnknownArgument);
        assert_eq!(doctor_error.kind(), ErrorKind::UnknownArgument);
    }
}

fn display_list(values: &[String]) -> String {
    if values.is_empty() {
        "<none>".to_string()
    } else {
        values.join(", ")
    }
}

fn prompt_required(label: &str, default: Option<&str>) -> Result<String> {
    loop {
        match default {
            Some(default) => print!("{label} [{default}]: "),
            None => print!("{label}: "),
        }
        io::stdout().flush()?;
        let input = read_stdin_line(label)?;
        let value = input.trim();
        if !value.is_empty() {
            return Ok(value.to_string());
        }
        if let Some(default) = default {
            return Ok(default.to_string());
        }
    }
}

fn prompt_secret_required(label: &str) -> Result<String> {
    loop {
        print!("{label}: ");
        io::stdout().flush()?;
        let input = read_secret_stdin_line(label)?;
        let value = input.trim();
        if !value.is_empty() {
            return Ok(value.to_string());
        }
    }
}

fn read_stdin_line(label: &str) -> Result<String> {
    let mut input = String::new();
    if io::stdin().read_line(&mut input)? == 0 {
        anyhow::bail!("no input provided for {label}");
    }
    Ok(input)
}

#[cfg(unix)]
fn read_secret_stdin_line(label: &str) -> Result<String> {
    let stdin = io::stdin();
    if !stdin.is_terminal() {
        return read_stdin_line(label);
    }
    read_secret_stdin_line_no_echo(label)
}

#[cfg(unix)]
fn read_secret_stdin_line_no_echo(label: &str) -> Result<String> {
    use std::{mem::MaybeUninit, os::fd::AsRawFd};

    struct EchoGuard {
        fd: libc::c_int,
        original: libc::termios,
    }

    impl Drop for EchoGuard {
        fn drop(&mut self) {
            // Best-effort restoration. The read path reports the original terminal-operation error.
            unsafe {
                let _ = libc::tcsetattr(self.fd, libc::TCSANOW, &self.original);
            }
        }
    }

    let stdin = io::stdin();
    let fd = stdin.as_raw_fd();
    let mut original = MaybeUninit::<libc::termios>::uninit();
    if unsafe { libc::tcgetattr(fd, original.as_mut_ptr()) } != 0 {
        return Err(std::io::Error::last_os_error())
            .with_context(|| format!("failed to disable echo for {label}"));
    }
    let original = unsafe { original.assume_init() };
    let mut no_echo = original;
    no_echo.c_lflag &= !libc::ECHO;
    if unsafe { libc::tcsetattr(fd, libc::TCSAFLUSH, &no_echo) } != 0 {
        return Err(std::io::Error::last_os_error())
            .with_context(|| format!("failed to disable echo for {label}"));
    }
    let guard = EchoGuard { fd, original };

    let mut input = String::new();
    let read_result = stdin.read_line(&mut input);
    drop(guard);
    println!();
    if read_result? == 0 {
        anyhow::bail!("no input provided for {label}");
    }
    Ok(input)
}

#[cfg(not(unix))]
fn read_secret_stdin_line(label: &str) -> Result<String> {
    if io::stdin().is_terminal() {
        anyhow::bail!(
            "non-echo secret prompt is not supported on this platform; set the token with an environment variable or pipe it on stdin"
        );
    }
    read_stdin_line(label)
}
