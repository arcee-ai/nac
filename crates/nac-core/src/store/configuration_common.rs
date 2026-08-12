macro_rules! configuration_store_error {
    ($name:ident) => {
        #[derive(Debug)]
        pub enum $name {
            InvalidInput(String),
            DuplicateName(String),
            NotFound(String),
            Store(anyhow::Error),
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                match self {
                    Self::InvalidInput(message) => formatter.write_str(message),
                    Self::DuplicateName(name) => {
                        write!(formatter, "a configuration named '{name}' already exists")
                    }
                    Self::NotFound(id) => write!(formatter, "configuration '{id}' was not found"),
                    Self::Store(error) => write!(formatter, "{error}"),
                }
            }
        }

        impl std::error::Error for $name {}

        impl From<anyhow::Error> for $name {
            fn from(error: anyhow::Error) -> Self {
                Self::Store(error)
            }
        }
    };
}

pub(super) const MAX_NAME_LEN: usize = 120;

pub(super) fn nonblank<E>(
    value: &str,
    field: &str,
    invalid: impl FnOnce(String) -> E,
) -> Result<String, E> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(invalid(format!("{field} must not be blank")));
    }
    Ok(trimmed.to_string())
}

pub(super) fn validate_name<E>(name: &str, invalid: impl Fn(String) -> E) -> Result<String, E> {
    let name = nonblank(name, "configuration name", &invalid)?;
    if name.chars().count() > MAX_NAME_LEN {
        return Err(invalid(format!(
            "configuration name must be at most {MAX_NAME_LEN} characters"
        )));
    }
    Ok(name)
}

/// Configuration tables translate any SQLite constraint failure to their
/// public duplicate-name error, matching their established broad semantics.
pub(super) fn is_constraint_violation(error: &rusqlite::Error) -> bool {
    matches!(
        error.sqlite_error_code(),
        Some(rusqlite::ErrorCode::ConstraintViolation)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, PartialEq)]
    struct Invalid(String);

    #[test]
    fn nonblank_trims_and_identifies_blank_fields() {
        assert_eq!(nonblank("  value  ", "field", Invalid), Ok("value".into()));
        assert_eq!(
            nonblank(" \t ", "field", Invalid),
            Err(Invalid("field must not be blank".into()))
        );
    }

    #[test]
    fn names_are_limited_by_character_count() {
        assert_eq!(
            validate_name(&"ą".repeat(MAX_NAME_LEN), Invalid).unwrap(),
            "ą".repeat(MAX_NAME_LEN)
        );
        assert_eq!(
            validate_name(&"ą".repeat(MAX_NAME_LEN + 1), Invalid),
            Err(Invalid(format!(
                "configuration name must be at most {MAX_NAME_LEN} characters"
            )))
        );
    }

    #[test]
    fn constraint_predicate_remains_broad() {
        let constraint = rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT_CHECK),
            None,
        );
        let busy = rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_BUSY),
            None,
        );
        assert!(is_constraint_violation(&constraint));
        assert!(!is_constraint_violation(&busy));
    }
}
