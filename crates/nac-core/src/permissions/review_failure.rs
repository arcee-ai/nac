use super::*;

/// Safe failure categories that clients can explain without provider details.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum PermissionReviewFailureReason {
    Authentication,
    AccessDenied,
    ModelUnavailable,
    InsufficientCredits,
    RateLimited,
    Timeout,
    InvalidResponse,
    ServiceUnavailable,
    Cancelled,
}

/// A review that produced no verdict. Details are for server diagnostics only.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReviewUnavailable {
    pub reason: PermissionReviewFailureReason,
    detail: String,
}

impl ReviewUnavailable {
    pub fn new(reason: PermissionReviewFailureReason, detail: impl Into<String>) -> Self {
        Self {
            reason,
            detail: detail.into(),
        }
    }
}

impl std::fmt::Display for ReviewUnavailable {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.detail)
    }
}
