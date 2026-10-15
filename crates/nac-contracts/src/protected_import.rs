//! Distinct nonsecret check identities at the protected import boundary.
//!
//! A digest is an observation, never eligibility, custody or execution authority.
//! The three source checks use different schemas and hash inputs. Neither their
//! common width nor an identical byte value permits substituting their types.
//!
//! ```compile_fail
//! use nac_contracts::{NativeImportedCheckSha256, SourceBootstrapCheckSha256};
//! fn imported_check(_: NativeImportedCheckSha256) {}
//! let source = SourceBootstrapCheckSha256::try_from([1; 32]).unwrap();
//! imported_check(source);
//! ```

macro_rules! check_identity {
    ($(#[$doc:meta])* $name:ident) => {
        $(#[$doc])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
        #[serde(try_from = "[u8; 32]", into = "[u8; 32]")]
        pub struct $name([u8; 32]);

        impl TryFrom<[u8; 32]> for $name {
            type Error = anyhow::Error;

            fn try_from(bytes: [u8; 32]) -> Result<Self, Self::Error> {
                anyhow::ensure!(bytes != [0; 32], "protected import check digest is unavailable");
                Ok(Self(bytes))
            }
        }

        impl From<$name> for [u8; 32] {
            fn from(digest: $name) -> Self { digest.0 }
        }

        impl $name {
            pub fn as_bytes(&self) -> &[u8; 32] { &self.0 }
        }
    };
}

check_identity! {
    /// The retained flat lifecycle SQL audit check, hashed with its established
    /// `arcee.managed.lifecycle.check.v1\n` domain separator.
    LifecycleAuditCheckSha256
}
check_identity! {
    /// The source eligibility verifier's nested stage/intent/binding Check.
    /// This is not the retained flat SQL lifecycle audit's digest.
    SourceBootstrapCheckSha256
}
check_identity! {
    /// The private Imported carrier's exact Go action/current/desired Check.
    /// Its original bytes remain owned by the controller's existing serializer.
    NativeImportedCheckSha256
}

/// Bounded authority-channel stages. No stage represents Ready or execution.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProtectedImportPhase {
    Issue,
    Consume,
    PreImport,
    PostImport,
    BeforeInitialImported,
    AfterInitialImported,
    BeforeFreshImported,
    AfterFreshImported,
}

/// Required proof role, not evidence that any issuer transaction committed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportProofKind {
    Issued,
    Consumed,
    Current,
}

impl ProtectedImportPhase {
    pub fn sequence(self) -> u8 {
        match self {
            Self::Issue => 0,
            Self::Consume => 1,
            Self::PreImport => 2,
            Self::PostImport => 3,
            Self::BeforeInitialImported => 4,
            Self::AfterInitialImported => 5,
            Self::BeforeFreshImported => 6,
            Self::AfterFreshImported => 7,
        }
    }

    pub fn required_proof_kind(self) -> ImportProofKind {
        match self {
            Self::Issue => ImportProofKind::Issued,
            Self::Consume => ImportProofKind::Consumed,
            _ => ImportProofKind::Current,
        }
    }
}
