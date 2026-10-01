//! Closed, typed commands beside the transactions they own. This macro keeps
//! the synchronous standalone API and the asynchronous serving port on the
//! same transaction implementation, without accepting closures or raw SQL.
macro_rules! coordinated_command {
    (
        $(#[$attribute:meta])* $visibility:vis fn $name:ident(
            $path:ident: &Path $(, $argument:ident: $borrowed:ty)* $(,)?
        ) -> $result:ty $body:block
        command $command:ident {
            $($field:ident: $owned:ty = $convert:expr),* $(,)?
        }
        call |$values:ident| ($($call:expr),* $(,)?)
        correlation |$metadata:ident| $correlation:expr;
        port $port:ident;
    ) => {
        $(#[$attribute])*
        $visibility fn $name($path: &Path, $($argument: $borrowed),*) -> $result {
            if let Some(owner) = crate::store::coordinator::owner_for($path)? {
                owner.check_blocking_context()?;
                let pending = owner.submit($command { $($field: $convert),* })?;
                return pending.acknowledge_blocking()?;
            }
            $body
        }

        struct $command { $($field: $owned),* }
        impl crate::store::coordinator::PersistenceCommand for $command {
            type Output = $result;
            fn correlation(&self) -> crate::telemetry::Correlation {
                let $metadata = self;
                $correlation
            }
            fn outcome(output: &Self::Output) -> crate::telemetry::TelemetryOutcome {
                if output.is_ok() { crate::telemetry::TelemetryOutcome::Ok }
                else { crate::telemetry::TelemetryOutcome::Error }
            }
            fn error_identity(output: &Self::Output) -> Option<crate::telemetry::StoreErrorIdentity> {
                crate::store::coordinator::CommandOutput::error_identity(output)
            }
            fn execute(self, store: &std::path::Path) -> anyhow::Result<Self::Output> {
                let $values = self;
                Ok($name(store, $($call),*))
            }
        }

        coordinated_port! { $port $visibility fn $name($($field: $owned),*) -> $result, $command }
    };
}
macro_rules! coordinated_port {
    (public $visibility:vis fn $name:ident($($field:ident: $owned:ty),*) -> $result:ty, $command:ident) => {
        impl crate::store::StoreCoordinator {
            $visibility async fn $name(&self, $($field: $owned),*) -> $result {
                self.submit($command { $($field),* })?.acknowledge().await?
            }
        }
    };
    (internal $visibility:vis fn $name:ident($($field:ident: $owned:ty),*) -> $result:ty, $command:ident) => {};
}
pub(crate) use coordinated_command;
pub(crate) use coordinated_port;

// Stateful transcript writers carry their existing append identity, shared
// operation lock, and weak run fence into the command. Never create a fresh
// writer or a fresh replay identity at the queue boundary.
macro_rules! coordinate_writer {
    ($writer:ident, $result:ty, {$($field:ident: $owned:ty = $convert:expr),* $(,)?},
        call |$values:ident| $call:expr, correlation |$metadata:ident| $correlation:expr) => {
        if let Some(owner) = crate::store::coordinator::owner_for(&$writer.store_path)? {
            owner.check_blocking_context()?;
            struct Command {
                writer: crate::store::TranscriptLogWriter,
                $($field: $owned),*
            }
            impl crate::store::coordinator::PersistenceCommand for Command {
                type Output = $result;
                fn correlation(&self) -> crate::telemetry::Correlation {
                    let $metadata = self;
                    $correlation
                }
                fn outcome(output: &Self::Output) -> crate::telemetry::TelemetryOutcome {
                    if output.is_ok() { crate::telemetry::TelemetryOutcome::Ok }
                    else { crate::telemetry::TelemetryOutcome::Error }
                }
                fn error_identity(output: &Self::Output) -> Option<crate::telemetry::StoreErrorIdentity> {
                    crate::store::coordinator::CommandOutput::error_identity(output)
                }
                fn execute(self, path: &std::path::Path) -> anyhow::Result<Self::Output> {
                    let mut $values = self;
                    // Bind the admitted store, even if a caller's alias was
                    // retargeted while this command waited in the queue.
                    $values.writer.store_path = path.to_path_buf();
                    Ok($call)
                }
            }
            return owner.submit(Command { writer: $writer.clone(), $($field: $convert),* })?
                .acknowledge_blocking()?;
        }
    };
}
