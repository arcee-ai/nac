//! Explicit NAC-owned embedded IANA data; no system or bundled-Jiff lookup.
use anyhow::{ensure, Context, Result};
use jiff::tz::TimeZone;

use super::DATA_VERSION;
const INDEX: &str = include_str!("data/index.tsv");
const PACK: &[u8] = include_bytes!("data/zones.bin");

pub(super) fn load(name: &str, version: &str) -> Result<TimeZone> {
    ensure!(version == DATA_VERSION, "unsupported timezone data version");
    ensure!(
        !name.is_empty() && name.len() <= 128,
        "invalid IANA timezone name"
    );
    // The finite generated name index includes canonical names and official
    // backward links. No path, environment variable or network lookup occurs.
    for line in INDEX.lines() {
        let mut fields = line.split('\t');
        let id = fields.next().context("invalid embedded timezone index")?;
        if id != name {
            continue;
        }
        let offset: usize = fields.next().context("missing timezone offset")?.parse()?;
        let length: usize = fields.next().context("missing timezone length")?.parse()?;
        ensure!(
            fields.next().is_none(),
            "invalid embedded timezone index entry"
        );
        let end = offset
            .checked_add(length)
            .context("timezone asset range overflow")?;
        let bytes = PACK
            .get(offset..end)
            .context("timezone asset range outside pack")?;
        return TimeZone::tzif(id, bytes).context("invalid embedded timezone TZif");
    }
    anyhow::bail!("unknown or unsupported IANA timezone")
}
