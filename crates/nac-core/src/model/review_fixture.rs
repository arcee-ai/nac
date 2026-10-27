//! Scripted automatic reviewer for production-build browser journeys.
//!
//! Compiled only with the `review-fixture` feature and enabled only by
//! `NAC_REVIEW_FIXTURE`, so ordinary builds and repository configuration can
//! never replace the real reviewer. Credential checks still use NAC's real
//! Arcee resolution, so the mode-selection flow is exercised unchanged.

use futures_util::future::BoxFuture;
use serde::Deserialize;

use crate::permissions::{
    PermissionReviewer, ReviewCategory, ReviewRequest, ReviewUnavailable, ReviewVerdict,
};

const ENVIRONMENT: &str = "NAC_REVIEW_FIXTURE";

/// `{"reject_containing": ["blocked"], "category": "out_of_scope",
/// "approve_authorized_retries": true}`. Requests whose redacted displays
/// contain a listed fragment are rejected; everything else is approved.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScriptedReviewer {
    #[serde(default)]
    reject_containing: Vec<String>,
    #[serde(default = "default_category")]
    category: ReviewCategory,
    #[serde(default)]
    approve_authorized_retries: bool,
}

fn default_category() -> ReviewCategory {
    ReviewCategory::OutOfScope
}

impl ScriptedReviewer {
    /// Reads the fixture script, if one is configured.
    pub fn from_environment() -> Option<Self> {
        let script = std::env::var(ENVIRONMENT).ok()?;
        match serde_json::from_str(&script) {
            Ok(reviewer) => Some(reviewer),
            Err(error) => panic!("{ENVIRONMENT} is not a valid review fixture: {error}"),
        }
    }

    fn verdict(&self, request: &ReviewRequest) -> ReviewVerdict {
        if request.user_authorized_retry && self.approve_authorized_retries {
            return ReviewVerdict::ApproveOnce;
        }
        let rejected = request.resources.iter().any(|resource| {
            self.reject_containing.iter().any(|fragment| {
                resource.display.contains(fragment) || resource.resource.contains(fragment)
            })
        });
        if rejected {
            ReviewVerdict::Reject(self.category)
        } else {
            ReviewVerdict::ApproveOnce
        }
    }
}

impl PermissionReviewer for ScriptedReviewer {
    fn review<'a>(
        &'a self,
        request: &'a ReviewRequest,
    ) -> BoxFuture<'a, Result<ReviewVerdict, ReviewUnavailable>> {
        let verdict = self.verdict(request);
        Box::pin(async move { Ok(verdict) })
    }

    fn check_available(&self) -> Result<(), String> {
        super::JevReviewer::default().check_available()
    }

    fn identity(&self) -> String {
        "fixture:scripted".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::permissions::ReviewResource;

    fn request(display: &str, authorized: bool) -> ReviewRequest {
        ReviewRequest {
            tool: "read".to_string(),
            backend: "local",
            resources: vec![ReviewResource {
                action: "read".to_string(),
                resource: display.to_string(),
                display: display.to_string(),
            }],
            user_intent: Vec::new(),
            user_authorized_retry: authorized,
        }
    }

    #[test]
    fn scripted_verdicts_follow_the_fixture() {
        let reviewer: ScriptedReviewer = serde_json::from_str(
            r#"{"reject_containing":["blocked"],"approve_authorized_retries":true}"#,
        )
        .unwrap();
        assert_eq!(
            reviewer.verdict(&request("/w/allowed.txt", false)),
            ReviewVerdict::ApproveOnce
        );
        assert_eq!(
            reviewer.verdict(&request("/w/blocked.txt", false)),
            ReviewVerdict::Reject(ReviewCategory::OutOfScope)
        );
        assert_eq!(
            reviewer.verdict(&request("/w/blocked.txt", true)),
            ReviewVerdict::ApproveOnce
        );
        assert!(
            serde_json::from_str::<ScriptedReviewer>(r#"{"approve_everything":true}"#).is_err()
        );
    }
}
