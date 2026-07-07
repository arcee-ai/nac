use std::{net::SocketAddr, time::Duration};

use anyhow::{anyhow, bail, Context, Result};
use tokio::time::{sleep, timeout};

const LOCAL_HEALTH_ATTEMPTS: usize = 50;
const LOCAL_HEALTH_INTERVAL: Duration = Duration::from_millis(100);
const LOCAL_HEALTH_TIMEOUT: Duration = Duration::from_secs(2);

pub fn local_service_url(bind: SocketAddr) -> String {
    let host = if bind.ip().is_unspecified() {
        "127.0.0.1".to_string()
    } else if bind.ip().is_ipv6() {
        format!("[{}]", bind.ip())
    } else {
        bind.ip().to_string()
    };
    format!("http://{}:{}", host, bind.port())
}

pub async fn check_local_health(bind: SocketAddr) -> Result<()> {
    let url = format!("{}/health", local_service_url(bind));
    let client = reqwest::Client::builder()
        .timeout(LOCAL_HEALTH_TIMEOUT)
        .build()
        .context("failed to build health check HTTP client")?;
    let response = client
        .get(&url)
        .send()
        .await
        .with_context(|| format!("failed to reach local nac-web health check at {url}"))?;
    if !response.status().is_success() {
        bail!("local nac-web health check returned {}", response.status());
    }
    Ok(())
}

pub async fn wait_for_local_health(bind: SocketAddr) -> Result<()> {
    let mut last_error = None;
    for _ in 0..LOCAL_HEALTH_ATTEMPTS {
        match timeout(LOCAL_HEALTH_TIMEOUT, check_local_health(bind)).await {
            Ok(Ok(())) => return Ok(()),
            Ok(Err(error)) => last_error = Some(error),
            Err(error) => last_error = Some(anyhow!("local health check timed out: {error}")),
        }
        sleep(LOCAL_HEALTH_INTERVAL).await;
    }
    match last_error {
        Some(error) => Err(error).context("local nac-web did not become healthy"),
        None => bail!("local nac-web did not become healthy"),
    }
}
