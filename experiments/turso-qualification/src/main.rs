use anyhow::{bail, Context, Result};
use serde_json::json;
use std::path::Path;
use std::time::Instant;
mod crash;
mod engine;
mod resources;
mod workload;

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("crash-child") => {
            crash::child(
                args.get(2).context("mode")?,
                Path::new(args.get(3).context("path")?),
                args.get(4).context("session")?,
            )
            .await?;
        }
        Some("workload") => {
            let mode = args.get(2).context("workload mode")?;
            let path = Path::new(args.get(3).context("workload disposable path")?);
            let count = args.get(4).context("workload 1/2/4")?.parse()?;
            println!("{}", workload::run(mode, path, count).await?);
        }
        Some("schema") => {
            let path = Path::new(args.get(2).context("schema requires a new store path")?);
            if path.exists() {
                bail!("refusing to overwrite a store");
            }
            let source = args
                .get(3)
                .context("schema requires a copied current-schema fixture")?;
            let conn = rusqlite::Connection::open_with_flags(
                source,
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
            )?;
            let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
            let mut stmt = conn.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type='index', rowid")?;
            let ddl = stmt
                .query_map([], |r| r.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let sql = format!("{};\nPRAGMA user_version={version};\n", ddl.join(";\n"));
            let fresh = rusqlite::Connection::open(path)?;
            fresh.execute_batch(&sql)?;
            std::fs::write(path.with_extension("sql"), sql)?;
            println!(
                "{}",
                json!({"schema_version":version,"statements":ddl.len()})
            );
        }
        Some("probe") => {
            let mode = args
                .get(2)
                .context("probe requires syscall or mvcc or uring")?;
            if !["syscall", "mvcc", "uring"].contains(&mode.as_str()) {
                bail!("unknown probe mode {mode}");
            }
            let path = args
                .get(3)
                .context("probe requires disposable store path")?;
            let ddl = args.get(4);
            let started = Instant::now();
            let builder = turso::Builder::new_local(path).with_io("syscall");
            #[cfg(all(target_os = "linux", feature = "uring"))]
            let builder = if mode == "uring" {
                builder.with_io_impl(std::sync::Arc::new(turso_core::UringIO::new()?))
            } else {
                builder
            };
            if mode == "uring" {
                #[cfg(not(all(target_os = "linux", feature = "uring")))]
                bail!("io_uring unavailable: requires Linux build with uring feature");
            }
            let db = builder.build().await?;
            let conn = db.connect()?;
            conn.execute("PRAGMA foreign_keys=ON", ()).await?;
            if mode == "mvcc" {
                let mut mode_rows = conn.query("PRAGMA journal_mode='mvcc'", ()).await?;
                while mode_rows.next().await?.is_some() {}
            }
            let mut failures = Vec::new();
            if let Some(ddl) = ddl {
                conn.execute_batch(std::fs::read_to_string(ddl)?)
                    .await
                    .context("current schema DDL must succeed before measurement")?;
            }
            let mut checks = serde_json::Map::new();
            for sql in [
                "PRAGMA user_version",
                "PRAGMA journal_mode",
                "PRAGMA synchronous",
                "PRAGMA foreign_keys",
                "PRAGMA quick_check",
                "PRAGMA foreign_key_check",
                "SELECT COUNT(*) FROM pragma_foreign_key_check",
                "SELECT COUNT(*) FROM sessions",
                "SELECT COUNT(*) FROM thread_events",
                "PRAGMA wal_checkpoint(TRUNCATE)",
            ] {
                match conn.query(sql, ()).await {
                    Ok(mut rows) => {
                        let mut result = Vec::new();
                        loop {
                            match rows.next().await {
                                Ok(Some(row)) => {
                                    let value = row.get_value(0)?;
                                    result.push(format!("{value:?}"));
                                }
                                Ok(None) => break,
                                Err(e) => {
                                    failures.push(format!("{sql}: {e}"));
                                    break;
                                }
                            }
                        }
                        checks.insert(sql.into(), json!(result));
                    }
                    Err(e) => failures.push(format!("{sql}: {e}")),
                }
            }
            println!(
                "{}",
                json!({"candidate":"turso=0.8.1","mode":mode,"path":path,"elapsed_ms":started.elapsed().as_millis(),"checks":checks,"failures":failures})
            );
        }
        _ => bail!("usage: schema NEW_DB | probe MODE DISPOSABLE_DB [DDL]"),
    }
    Ok(())
}
