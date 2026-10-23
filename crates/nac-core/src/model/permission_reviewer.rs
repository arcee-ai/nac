//! Construction-time selection of the qualified permission reviewer profile.

use std::ffi::OsStr;
use std::sync::Arc;

use futures_util::future::BoxFuture;

use super::jev::JevReviewer;
use super::reviewer_policy::ReviewProfile;
use crate::permissions::{
    PermissionReviewFailureReason, PermissionReviewer, ReviewRequest, ReviewUnavailable,
    ReviewVerdict,
};

const PROFILE_ENV: &str = "NAC_PERMISSION_REVIEW_PROFILE";
const INVALID_PROFILE: &str = "NAC_PERMISSION_REVIEW_PROFILE must be unset or clef-scope-v6.";

pub(super) fn from_environment() -> Arc<dyn PermissionReviewer> {
    from_selection(std::env::var_os(PROFILE_ENV).as_deref())
}

fn from_selection(selection: Option<&OsStr>) -> Arc<dyn PermissionReviewer> {
    let profile = match selection {
        None => ReviewProfile::ClefScopeV6,
        Some(value) if value == OsStr::new("clef-scope-v6") => ReviewProfile::ClefScopeV6,
        // Do not echo configuration values, which may contain sensitive text.
        // Invalid input never silently switches to another reviewer.
        Some(_) => return Arc::new(InvalidSelection),
    };
    Arc::new(ScopedReviewer {
        profile,
        inner: JevReviewer::for_profile(profile),
    })
}

struct ScopedReviewer {
    profile: ReviewProfile,
    inner: JevReviewer,
}

impl PermissionReviewer for ScopedReviewer {
    fn review<'a>(
        &'a self,
        request: &'a ReviewRequest,
    ) -> BoxFuture<'a, Result<ReviewVerdict, ReviewUnavailable>> {
        Box::pin(async move {
            self.inner
                .review_inner_with_profile(request, self.profile)
                .await
                .map(|(verdict, _)| verdict)
        })
    }

    fn check_available(&self) -> Result<(), String> {
        self.inner.check_available()
    }

    fn identity(&self) -> String {
        self.profile.identity().to_owned()
    }
}

struct InvalidSelection;

impl PermissionReviewer for InvalidSelection {
    fn review<'a>(
        &'a self,
        _request: &'a ReviewRequest,
    ) -> BoxFuture<'a, Result<ReviewVerdict, ReviewUnavailable>> {
        Box::pin(async {
            Err(ReviewUnavailable::new(
                PermissionReviewFailureReason::ModelUnavailable,
                INVALID_PROFILE,
            ))
        })
    }

    fn check_available(&self) -> Result<(), String> {
        Err(INVALID_PROFILE.to_owned())
    }

    fn identity(&self) -> String {
        "decisions:invalid-operator-selection".to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> ReviewRequest {
        ReviewRequest {
            tool: "exec_command".to_owned(),
            backend: "local",
            resources: Vec::new(),
            user_intent: vec!["Synthetic request".to_owned()],
            user_authorized_retry: false,
        }
    }

    #[test]
    fn default_is_qualified_clef_and_profile_selection_is_owned_and_exact() {
        assert_eq!(
            from_selection(None).identity(),
            "decisions:cloudflare/clef:clef-scope-v6"
        );
        {
            let value = "clef-scope-v6";
            let identity = "decisions:cloudflare/clef:clef-scope-v6";
            let mut selected = value.to_owned();
            let reviewer = from_selection(Some(OsStr::new(&selected)));
            selected.clear();
            let _next = from_selection(None);
            assert_eq!(reviewer.identity(), identity);
        }
    }

    #[tokio::test]
    async fn invalid_selection_is_unavailable_without_authentication_or_network() {
        for value in [
            "",
            "jev-legacy",
            "jev-scope-v2",
            "clef-scope-v2",
            "clef",
            "typesafe/jev-1.13",
            "cloudflare/clef",
            "clef-scope-v1",
            "clef-flash-scope-v2",
            " clef-scope-v6",
            "clef-scope-v6 ",
            "untrusted-sensitive-value",
        ] {
            let reviewer = from_selection(Some(OsStr::new(value)));
            assert_eq!(reviewer.check_available(), Err(INVALID_PROFILE.to_owned()));
            let error = reviewer.review(&request()).await.unwrap_err();
            assert_eq!(
                error.reason,
                PermissionReviewFailureReason::ModelUnavailable
            );
            assert_eq!(error.to_string(), INVALID_PROFILE);
        }
    }

    #[cfg(unix)]
    #[test]
    fn non_unicode_configuration_does_not_select_legacy() {
        use std::os::unix::ffi::OsStrExt;
        assert_eq!(
            from_selection(Some(OsStr::from_bytes(&[0xff]))).check_available(),
            Err(INVALID_PROFILE.to_owned())
        );
    }
}
