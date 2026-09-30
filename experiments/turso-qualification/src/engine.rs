use anyhow::{bail, Result};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub enum Backend {
    Sqlite(PathBuf),
    Turso(turso::Database),
}
pub enum Connection {
    Sqlite(rusqlite::Connection),
    Turso(turso::Connection),
}

impl Backend {
    pub async fn open(mode: &str, path: &Path) -> Result<Self> {
        if mode == "sqlite" {
            let conn = rusqlite::Connection::open(path)?;
            conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;")?;
            return Ok(Self::Sqlite(path.into()));
        }
        if !["syscall", "mvcc", "uring"].contains(&mode) {
            bail!("unknown engine mode {mode}");
        }
        let builder = turso::Builder::new_local(path.to_str().unwrap()).with_io("syscall");
        #[cfg(all(target_os = "linux", feature = "uring"))]
        let builder = if mode == "uring" {
            builder.with_io_impl(std::sync::Arc::new(turso_core::UringIO::new()?))
        } else {
            builder
        };
        #[cfg(not(all(target_os = "linux", feature = "uring")))]
        if mode == "uring" {
            bail!("io_uring requires Linux with the uring feature");
        }
        let db = builder.build().await?;
        if mode == "mvcc" {
            Self::Turso(db.clone())
                .connect()?
                .query("PRAGMA journal_mode='mvcc'")
                .await?;
        }
        Ok(Self::Turso(db))
    }

    pub fn connect(&self) -> Result<Connection> {
        Ok(match self {
            Self::Sqlite(path) => {
                let conn = rusqlite::Connection::open(path)?;
                conn.busy_timeout(std::time::Duration::from_secs(5))?;
                conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;")?;
                Connection::Sqlite(conn)
            }
            Self::Turso(db) => Connection::Turso(db.connect()?),
        })
    }
}

impl Connection {
    pub async fn execute(&self, sql: &str) -> Result<u64> {
        Ok(match self {
            Self::Sqlite(conn) => conn.execute(sql, [])? as u64,
            Self::Turso(conn) => conn.execute(sql, ()).await?,
        })
    }

    pub async fn batch(&self, sql: &str) -> Result<()> {
        match self {
            Self::Sqlite(conn) => conn.execute_batch(sql)?,
            Self::Turso(conn) => conn.execute_batch(sql).await?,
        }
        Ok(())
    }

    pub async fn query(&self, sql: &str) -> Result<Vec<Vec<Value>>> {
        let mut result = Vec::new();
        match self {
            Self::Sqlite(conn) => {
                let mut stmt = conn.prepare(sql)?;
                let columns = stmt.column_count();
                let mut rows = stmt.query([])?;
                while let Some(row) = rows.next()? {
                    let mut values = Vec::new();
                    for column in 0..columns {
                        use rusqlite::types::ValueRef;
                        values.push(match row.get_ref(column)? {
                            ValueRef::Null => Value::Null,
                            ValueRef::Integer(i) => json!(i),
                            ValueRef::Real(f) => json!(f),
                            ValueRef::Text(t) => json!(std::str::from_utf8(t)?),
                            ValueRef::Blob(b) => json!(b),
                        });
                    }
                    result.push(values);
                }
            }
            Self::Turso(conn) => {
                let mut rows = conn.query(sql, ()).await?;
                while let Some(row) = rows.next().await? {
                    let mut values = Vec::new();
                    for column in 0..row.column_count() {
                        use turso::Value;
                        values.push(match row.get_value(column)? {
                            Value::Null => serde_json::Value::Null,
                            Value::Integer(i) => json!(i),
                            Value::Real(f) => json!(f),
                            Value::Text(t) => json!(t),
                            Value::Blob(b) => json!(b),
                        });
                    }
                    result.push(values);
                }
            }
        }
        Ok(result)
    }

    pub async fn scalar(&self, sql: &str) -> Result<i64> {
        let rows = self.query(sql).await?;
        rows.first()
            .and_then(|r| r.first())
            .and_then(Value::as_i64)
            .ok_or_else(|| anyhow::anyhow!("expected one integer scalar: {sql}"))
    }
}
