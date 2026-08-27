pub(crate) mod projects;
pub(crate) mod ssh_configurations;

/// Application-level tri-state update semantics. Delivery adapters map their
/// wire representation into this type before invoking a use case.
pub(crate) enum Field<T> {
    Unchanged,
    Clear,
    Set(T),
}
