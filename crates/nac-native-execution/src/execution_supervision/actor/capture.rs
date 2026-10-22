//! Whole-result capture ceilings. Drain both streams beyond their independent caps.
use super::super::{
    job_wire::command::encode_command,
    protocol::{Command, EnvironmentEntry, MAX_ARGUMENTS, MAX_ENVIRONMENT},
};
use anyhow::{ensure, Context, Result};
use nac_core::runtime::{CompartmentCommand, CompartmentReader};
use std::{ffi::OsString, os::unix::ffi::OsStringExt};
use tokio::io::AsyncReadExt;

pub(super) fn owned_input(command: &CompartmentCommand) -> Result<usize> {
    ensure!(
        command.args.len() <= MAX_ARGUMENTS && command.environment.len() <= MAX_ENVIRONMENT,
        "Native command counts exceed bound"
    );
    let mut bytes = command
        .args
        .capacity()
        .checked_mul(std::mem::size_of::<OsString>())
        .context("Native input storage overflow")?;
    for capacity in std::iter::once(command.program.capacity())
        .chain(std::iter::once(command.cwd.capacity()))
        .chain(command.args.iter().map(OsString::capacity))
        .chain(
            command
                .environment
                .iter()
                .flat_map(|(key, value)| [key.capacity(), value.capacity()]),
        )
        .chain(command.stdin.iter().map(Vec::capacity))
    {
        bytes = bytes
            .checked_add(capacity)
            .context("Native input storage overflow")?;
    }
    Ok(bytes)
}
pub(super) fn encode(command: CompartmentCommand) -> Result<(Vec<u8>, Option<Vec<u8>>)> {
    let command_wire = Command {
        program: command.program.into_os_string().into_vec(),
        cwd: command.cwd.into_os_string().into_vec(),
        args: command.args.into_iter().map(OsString::into_vec).collect(),
        environment: command
            .environment
            .into_iter()
            .map(|(name, value)| EnvironmentEntry {
                name: name.into_vec(),
                value: value.into_vec(),
            })
            .collect(),
    };
    Ok((encode_command(&command_wire)?, command.stdin))
}
pub(super) async fn drain(mut input: CompartmentReader, limit: usize) -> Result<(Vec<u8>, bool)> {
    let mut output = Vec::new();
    let mut truncated = false;
    let mut buffer = [0; super::super::protocol::MAX_DATA];
    loop {
        let bytes = input.read(&mut buffer).await?;
        if bytes == 0 {
            return Ok((output, truncated));
        }
        let retain = bytes.min(limit - output.len());
        if retain > 0 {
            output.try_reserve_exact(retain)?;
            ensure!(
                output.capacity() <= limit,
                "Native capture allocation exceeds reserved ceiling"
            );
            output.extend_from_slice(&buffer[..retain]);
        }
        truncated |= retain < bytes;
    }
}
