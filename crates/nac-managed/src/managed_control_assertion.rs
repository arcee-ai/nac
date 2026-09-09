//! Strict validation for nac-api minted Managed NAC operation assertions.

use std::path::{Path, PathBuf};
#[cfg(unix)]
use std::{
    fs::OpenOptions,
    io::Read,
    os::unix::fs::{MetadataExt, OpenOptionsExt},
};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use ring::signature::{UnparsedPublicKey, ED25519};
use serde::{Deserialize, Serialize};

const MAX_ASSERTION_BYTES: usize = 16 * 1024;
const MAX_JWKS_BYTES: usize = 64 * 1024;
const MAX_KEYS: usize = 16;
const MAX_LIFETIME_SECONDS: i64 = 60;
const CLOCK_SKEW_SECONDS: i64 = 5;
const EXPECTED_TYPE: &str = "nac-managed-operation+jwt";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ManagedControlAction {
    Status,
    Prepare,
    Retry,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ManagedControlTarget {
    pub release_id: String,
    pub source_sha: String,
    pub product_version: String,
    pub schema_version: i64,
    pub minimum_schema_version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ManagedControlRequest {
    pub managed_host_id: String,
    pub host_incarnation_id: String,
    pub operation_id: String,
    pub target: ManagedControlTarget,
    pub actor: String,
    pub beneficiary: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagedControlAssertion {
    pub jti: String,
    pub expires_at: i64,
    pub action: ManagedControlAction,
    pub request: ManagedControlRequest,
}

#[derive(Debug, Clone)]
pub struct ManagedControlVerifier {
    jwks_path: PathBuf,
    issuer: String,
    managed_host_id: String,
    host_incarnation_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ManagedControlAssertionError {
    Oversized,
    Malformed,
    UnsupportedHeader,
    UnknownKey,
    InvalidSignature,
    InvalidTime,
    BindingMismatch,
    KeySetUnavailable,
}

impl std::fmt::Display for ManagedControlAssertionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Oversized => "managed control assertion exceeds the accepted size",
            Self::Malformed => "managed control assertion is malformed",
            Self::UnsupportedHeader => "managed control assertion header is unsupported",
            Self::UnknownKey => "managed control assertion signing key is unavailable",
            Self::InvalidSignature => "managed control assertion signature is invalid",
            Self::InvalidTime => "managed control assertion time bounds are invalid",
            Self::BindingMismatch => "managed control assertion binding does not match the request",
            Self::KeySetUnavailable => "managed control verification keys are unavailable",
        })
    }
}

impl std::error::Error for ManagedControlAssertionError {}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProtectedHeader {
    alg: String,
    kid: String,
    typ: String,
    v: u32,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Claims {
    iss: String,
    aud: String,
    jti: String,
    action: ManagedControlAction,
    managed_host_id: String,
    host_incarnation_id: String,
    operation_id: String,
    target: ManagedControlTarget,
    actor: String,
    beneficiary: String,
    iat: i64,
    nbf: i64,
    exp: i64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct JwkSet {
    keys: Vec<Ed25519Jwk>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Ed25519Jwk {
    kty: String,
    crv: String,
    #[serde(rename = "use")]
    key_use: String,
    alg: String,
    kid: String,
    x: String,
}

impl ManagedControlVerifier {
    pub fn new(
        jwks_path: impl AsRef<Path>,
        issuer: impl Into<String>,
        managed_host_id: impl Into<String>,
        host_incarnation_id: impl Into<String>,
    ) -> Self {
        Self {
            jwks_path: jwks_path.as_ref().to_path_buf(),
            issuer: issuer.into(),
            managed_host_id: managed_host_id.into(),
            host_incarnation_id: host_incarnation_id.into(),
        }
    }

    pub fn audience(&self) -> String {
        format!(
            "urn:nac:managed-control:{}:{}",
            self.managed_host_id, self.host_incarnation_id
        )
    }

    pub fn verify(
        &self,
        compact: &str,
        expected_action: ManagedControlAction,
        expected_request: &ManagedControlRequest,
        now_unix_seconds: i64,
    ) -> Result<ManagedControlAssertion, ManagedControlAssertionError> {
        if compact.is_empty() || compact.len() > MAX_ASSERTION_BYTES {
            return Err(ManagedControlAssertionError::Oversized);
        }
        let mut segments = compact.split('.');
        let protected_segment = segments
            .next()
            .ok_or(ManagedControlAssertionError::Malformed)?;
        let claims_segment = segments
            .next()
            .ok_or(ManagedControlAssertionError::Malformed)?;
        let signature_segment = segments
            .next()
            .ok_or(ManagedControlAssertionError::Malformed)?;
        if segments.next().is_some()
            || protected_segment.is_empty()
            || claims_segment.is_empty()
            || signature_segment.is_empty()
            || protected_segment.contains('=')
            || claims_segment.contains('=')
            || signature_segment.contains('=')
        {
            return Err(ManagedControlAssertionError::Malformed);
        }
        let protected = decode_segment(protected_segment)?;
        let header: ProtectedHeader = serde_json::from_slice(&protected)
            .map_err(|_| ManagedControlAssertionError::Malformed)?;
        if header.alg != "EdDSA"
            || header.typ != EXPECTED_TYPE
            || header.v != 1
            || !valid_identifier(&header.kid, 128)
        {
            return Err(ManagedControlAssertionError::UnsupportedHeader);
        }
        let claims_raw = decode_segment(claims_segment)?;
        let claims: Claims = serde_json::from_slice(&claims_raw)
            .map_err(|_| ManagedControlAssertionError::Malformed)?;
        validate_claim_shapes(&claims)?;

        let key_set = load_jwks(&self.jwks_path)?;
        let key = key_set
            .keys
            .iter()
            .find(|key| key.kid == header.kid)
            .ok_or(ManagedControlAssertionError::UnknownKey)?;
        if key.kty != "OKP" || key.crv != "Ed25519" || key.key_use != "sig" || key.alg != "EdDSA" {
            return Err(ManagedControlAssertionError::UnsupportedHeader);
        }
        let public_key = URL_SAFE_NO_PAD
            .decode(&key.x)
            .map_err(|_| ManagedControlAssertionError::KeySetUnavailable)?;
        if public_key.len() != 32 {
            return Err(ManagedControlAssertionError::KeySetUnavailable);
        }
        let signature = decode_segment(signature_segment)?;
        if signature.len() != 64 {
            return Err(ManagedControlAssertionError::Malformed);
        }
        let signed = format!("{protected_segment}.{claims_segment}");
        UnparsedPublicKey::new(&ED25519, public_key)
            .verify(signed.as_bytes(), &signature)
            .map_err(|_| ManagedControlAssertionError::InvalidSignature)?;

        if claims.exp <= claims.iat
            || claims.exp - claims.iat > MAX_LIFETIME_SECONDS
            || claims.nbf < claims.iat
            || claims.nbf > claims.exp
            || now_unix_seconds > claims.exp + CLOCK_SKEW_SECONDS
            || now_unix_seconds + CLOCK_SKEW_SECONDS < claims.nbf
            || claims.iat > now_unix_seconds + CLOCK_SKEW_SECONDS
        {
            return Err(ManagedControlAssertionError::InvalidTime);
        }
        let request = ManagedControlRequest {
            managed_host_id: claims.managed_host_id,
            host_incarnation_id: claims.host_incarnation_id,
            operation_id: claims.operation_id,
            target: claims.target,
            actor: claims.actor,
            beneficiary: claims.beneficiary,
        };
        if claims.iss != self.issuer
            || claims.aud != self.audience()
            || claims.action != expected_action
            || request.managed_host_id != self.managed_host_id
            || request.host_incarnation_id != self.host_incarnation_id
            || &request != expected_request
        {
            return Err(ManagedControlAssertionError::BindingMismatch);
        }
        Ok(ManagedControlAssertion {
            jti: claims.jti,
            expires_at: claims.exp,
            action: claims.action,
            request,
        })
    }
}

fn decode_segment(segment: &str) -> Result<Vec<u8>, ManagedControlAssertionError> {
    URL_SAFE_NO_PAD
        .decode(segment)
        .map_err(|_| ManagedControlAssertionError::Malformed)
}

fn load_jwks(path: &Path) -> Result<JwkSet, ManagedControlAssertionError> {
    let raw = read_trusted_jwks(path)?;
    let set: JwkSet = serde_json::from_slice(&raw)
        .map_err(|_| ManagedControlAssertionError::KeySetUnavailable)?;
    if set.keys.is_empty()
        || set.keys.len() > MAX_KEYS
        || set.keys.iter().any(|key| !valid_identifier(&key.kid, 128))
    {
        return Err(ManagedControlAssertionError::KeySetUnavailable);
    }
    let mut kids = std::collections::BTreeSet::new();
    if set.keys.iter().any(|key| !kids.insert(&key.kid)) {
        return Err(ManagedControlAssertionError::KeySetUnavailable);
    }
    Ok(set)
}

#[cfg(unix)]
fn read_trusted_jwks(path: &Path) -> Result<Vec<u8>, ManagedControlAssertionError> {
    let configured = std::fs::symlink_metadata(path)
        .map_err(|_| ManagedControlAssertionError::KeySetUnavailable)?;
    let resolved = if configured.file_type().is_symlink() {
        let target = std::fs::read_link(path)
            .map_err(|_| ManagedControlAssertionError::KeySetUnavailable)?;
        let mut components = target.components();
        if target.is_absolute()
            || components.next().and_then(|part| part.as_os_str().to_str()) != Some("..data")
            || components.any(|part| matches!(part, std::path::Component::ParentDir))
        {
            return Err(ManagedControlAssertionError::KeySetUnavailable);
        }
        path.canonicalize()
            .map_err(|_| ManagedControlAssertionError::KeySetUnavailable)?
    } else if configured.is_file() {
        path.to_path_buf()
    } else {
        return Err(ManagedControlAssertionError::KeySetUnavailable);
    };

    validate_trusted_directory(path.parent())?;
    if resolved.parent() != path.parent() {
        validate_trusted_directory(resolved.parent())?;
    }
    let mut options = OpenOptions::new();
    options
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK);
    let file = options
        .open(&resolved)
        .map_err(|_| ManagedControlAssertionError::KeySetUnavailable)?;
    let metadata = file
        .metadata()
        .map_err(|_| ManagedControlAssertionError::KeySetUnavailable)?;
    if !metadata.is_file()
        || metadata.len() > MAX_JWKS_BYTES as u64
        || metadata.mode() & 0o222 != 0
        || !trusted_owner(&metadata)
    {
        return Err(ManagedControlAssertionError::KeySetUnavailable);
    }
    let mut raw = Vec::new();
    file.take(MAX_JWKS_BYTES as u64 + 1)
        .read_to_end(&mut raw)
        .map_err(|_| ManagedControlAssertionError::KeySetUnavailable)?;
    if raw.len() > MAX_JWKS_BYTES {
        return Err(ManagedControlAssertionError::KeySetUnavailable);
    }
    Ok(raw)
}

#[cfg(unix)]
fn validate_trusted_directory(path: Option<&Path>) -> Result<(), ManagedControlAssertionError> {
    let path = path.ok_or(ManagedControlAssertionError::KeySetUnavailable)?;
    let metadata =
        std::fs::metadata(path).map_err(|_| ManagedControlAssertionError::KeySetUnavailable)?;
    if !metadata.is_dir() || metadata.mode() & 0o022 != 0 || !trusted_owner(&metadata) {
        return Err(ManagedControlAssertionError::KeySetUnavailable);
    }
    Ok(())
}

#[cfg(unix)]
fn trusted_owner(metadata: &std::fs::Metadata) -> bool {
    if metadata.uid() == 0 {
        return true;
    }
    #[cfg(any(test, feature = "test-support"))]
    {
        return metadata.uid() == unsafe { libc::geteuid() } && metadata.mode() & 0o222 == 0;
    }
    #[cfg(not(any(test, feature = "test-support")))]
    false
}

#[cfg(not(unix))]
fn read_trusted_jwks(_path: &Path) -> Result<Vec<u8>, ManagedControlAssertionError> {
    Err(ManagedControlAssertionError::KeySetUnavailable)
}

fn validate_claim_shapes(claims: &Claims) -> Result<(), ManagedControlAssertionError> {
    if !valid_identifier(&claims.jti, 128)
        || !valid_identifier(&claims.managed_host_id, 128)
        || !valid_identifier(&claims.host_incarnation_id, 128)
        || !valid_identifier(&claims.operation_id, 128)
        || !valid_text(&claims.iss, 256)
        || !valid_text(&claims.aud, 512)
        || !valid_text(&claims.actor, 256)
        || !valid_text(&claims.beneficiary, 256)
        || !valid_identifier(&claims.target.release_id, 256)
        || !valid_identifier(&claims.target.product_version, 128)
        || !matches!(claims.target.source_sha.len(), 40 | 64)
        || !claims
            .target
            .source_sha
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        || claims.target.schema_version < 0
        || claims.target.minimum_schema_version < 0
        || claims.target.minimum_schema_version > claims.target.schema_version
    {
        return Err(ManagedControlAssertionError::Malformed);
    }
    Ok(())
}

#[cfg(test)]
#[path = "managed_control_assertion_tests.rs"]
mod tests;

fn valid_identifier(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':' | b'@' | b'/')
        })
}

fn valid_text(value: &str, max: usize) -> bool {
    !value.trim().is_empty()
        && value.len() <= max
        && value.chars().all(|character| !character.is_control())
}
