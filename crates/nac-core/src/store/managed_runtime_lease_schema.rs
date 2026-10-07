//! Additive native lease state; opaque fingerprints are not transport schemas.
use super::*;

pub(super) fn create_managed_runtime_leases_table(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS managed_runtime_leases (
            operation_id TEXT PRIMARY KEY NOT NULL REFERENCES managed_runtime_operations(operation_id),
            reservation_id TEXT NOT NULL UNIQUE,
            assignment_sha256 TEXT NOT NULL CHECK(length(assignment_sha256) = 64 AND assignment_sha256 NOT GLOB '*[^0-9a-f]*'),
            serving_lifetime_id TEXT NOT NULL,
            original_expires_ms INTEGER NOT NULL CHECK(original_expires_ms > 0),
            last_wall_ms INTEGER NOT NULL CHECK(last_wall_ms >= 0),
            phase TEXT NOT NULL CHECK(phase IN ('reserved', 'challenged', 'active', 'terminal')),
            challenge_sha256 TEXT CHECK(challenge_sha256 IS NULL OR (length(challenge_sha256) = 64 AND challenge_sha256 NOT GLOB '*[^0-9a-f]*')),
            channel_id TEXT,
            challenge_expires_ms INTEGER,
            lease_id TEXT,
            lease_sequence INTEGER,
            lease_expires_ms INTEGER,
            CHECK(CASE WHEN challenge_sha256 IS NULL THEN channel_id IS NULL AND challenge_expires_ms IS NULL
                  ELSE channel_id IS NOT NULL AND challenge_expires_ms IS NOT NULL AND challenge_expires_ms > 0 END),
            CHECK(CASE WHEN lease_id IS NULL THEN lease_sequence IS NULL AND lease_expires_ms IS NULL
                  ELSE lease_sequence IS NOT NULL AND lease_expires_ms IS NOT NULL AND lease_sequence > 0 AND lease_expires_ms > 0 END),
            CHECK(phase != 'reserved' OR (challenge_sha256 IS NULL AND lease_id IS NULL)),
            CHECK(phase != 'challenged' OR (challenge_sha256 IS NOT NULL AND lease_id IS NULL)),
            CHECK(phase != 'active' OR lease_id IS NOT NULL),
            CHECK(phase != 'terminal' OR challenge_sha256 IS NULL)
        );
        CREATE TRIGGER IF NOT EXISTS managed_runtime_leases_no_delete
        BEFORE DELETE ON managed_runtime_leases
        BEGIN SELECT RAISE(ABORT, 'runtime lease history is retained'); END;
        CREATE TRIGGER IF NOT EXISTS managed_runtime_leases_fenced
        BEFORE UPDATE ON managed_runtime_leases
        WHEN NEW.operation_id IS NOT OLD.operation_id OR NEW.reservation_id IS NOT OLD.reservation_id OR
             NEW.assignment_sha256 IS NOT OLD.assignment_sha256 OR
             NEW.serving_lifetime_id IS NOT OLD.serving_lifetime_id OR
             NEW.original_expires_ms IS NOT OLD.original_expires_ms OR
             NEW.last_wall_ms < OLD.last_wall_ms OR OLD.phase = 'terminal' OR
             (OLD.lease_id IS NOT NULL AND NEW.lease_id IS NOT OLD.lease_id) OR
             (OLD.lease_sequence IS NOT NULL AND (NEW.lease_sequence IS NULL OR NEW.lease_sequence < OLD.lease_sequence)) OR
             (OLD.lease_sequence IS NEW.lease_sequence AND NEW.lease_expires_ms IS NOT OLD.lease_expires_ms) OR
             (OLD.phase = 'active' AND NEW.phase NOT IN ('active', 'terminal')) OR
             (OLD.phase = 'challenged' AND NEW.phase = 'reserved')
        BEGIN SELECT RAISE(ABORT, 'runtime lease cannot rewind'); END;",
    )?;
    Ok(())
}
