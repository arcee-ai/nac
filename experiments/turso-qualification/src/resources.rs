use anyhow::{ensure, Result};

pub struct Usage {
    pub cpu_us: i64,
    pub peak_rss_bytes: i64,
}

#[allow(clippy::useless_conversion)] // timeval microseconds are i32 on macOS, i64 on Linux.
pub fn usage() -> Result<Usage> {
    let mut value = std::mem::MaybeUninit::<libc::rusage>::uninit();
    // SAFETY: getrusage initializes the valid output pointer on success.
    let result = unsafe { libc::getrusage(libc::RUSAGE_SELF, value.as_mut_ptr()) };
    ensure!(result == 0, "getrusage failed");
    // SAFETY: the successful call above initialized the rusage value.
    let value = unsafe { value.assume_init() };
    let cpu_us = (value.ru_utime.tv_sec + value.ru_stime.tv_sec) * 1_000_000
        + i64::from(value.ru_utime.tv_usec)
        + i64::from(value.ru_stime.tv_usec);
    let multiplier = if cfg!(target_os = "macos") { 1 } else { 1024 };
    Ok(Usage {
        cpu_us,
        peak_rss_bytes: value.ru_maxrss * multiplier,
    })
}
