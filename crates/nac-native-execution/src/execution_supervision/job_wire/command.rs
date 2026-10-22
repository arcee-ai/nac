//! Bounded binary command payload within the closed v2 fragment records.
use super::super::protocol::{Command, EnvironmentEntry};
use super::{MAX_ARGUMENTS, MAX_COMMAND_BYTES, MAX_ENCODED_COMMAND, MAX_ENVIRONMENT};
use anyhow::{ensure, Context, Result};

pub(in super::super) fn encode_command(command: &Command) -> Result<Vec<u8>> {
    command.validate()?;
    let mut out = Vec::new();
    bytes(&mut out, &command.program)?;
    bytes(&mut out, &command.cwd)?;
    out.extend_from_slice(&u32::try_from(command.args.len())?.to_be_bytes());
    for arg in &command.args {
        bytes(&mut out, arg)?;
    }
    out.extend_from_slice(&u32::try_from(command.environment.len())?.to_be_bytes());
    for entry in &command.environment {
        bytes(&mut out, &entry.name)?;
        bytes(&mut out, &entry.value)?;
    }
    ensure!(
        out.len() <= MAX_ENCODED_COMMAND,
        "encoded command exceeds bound"
    );
    Ok(out)
}

fn bytes(out: &mut Vec<u8>, value: &[u8]) -> Result<()> {
    out.extend_from_slice(&u32::try_from(value.len())?.to_be_bytes());
    out.extend_from_slice(value);
    Ok(())
}

pub(in super::super) fn decode_command(raw: &[u8]) -> Result<Command> {
    ensure!(
        raw.len() <= MAX_ENCODED_COMMAND,
        "encoded command exceeds bound"
    );
    let mut input = Input { raw, logical: 0 };
    let program = input.bytes()?;
    let cwd = input.bytes()?;
    let count = input.count(MAX_ARGUMENTS)?;
    let mut args = Vec::new();
    for _ in 0..count {
        args.push(input.bytes()?);
    }
    let count = input.count(MAX_ENVIRONMENT)?;
    let mut environment = Vec::new();
    for _ in 0..count {
        environment.push(EnvironmentEntry {
            name: input.bytes()?,
            value: input.bytes()?,
        });
    }
    ensure!(input.raw.is_empty(), "trailing command bytes");
    let command = Command {
        program,
        args,
        cwd,
        environment,
    };
    command.validate()?;
    Ok(command)
}

struct Input<'a> {
    raw: &'a [u8],
    logical: usize,
}
impl Input<'_> {
    fn count(&mut self, limit: usize) -> Result<usize> {
        let (len, rest) = self
            .raw
            .split_at_checked(4)
            .context("truncated command length")?;
        let value = u32::from_be_bytes(len.try_into()?) as usize;
        ensure!(value <= limit, "command length/count exceeds bound");
        self.raw = rest;
        Ok(value)
    }
    fn bytes(&mut self) -> Result<Vec<u8>> {
        let len = self.count(MAX_COMMAND_BYTES)?;
        self.logical = self.logical.checked_add(len).context("command overflow")?;
        ensure!(
            self.logical <= MAX_COMMAND_BYTES,
            "command bytes exceed bound"
        );
        let (value, rest) = self
            .raw
            .split_at_checked(len)
            .context("truncated command bytes")?;
        self.raw = rest;
        Ok(value.to_vec())
    }
}
