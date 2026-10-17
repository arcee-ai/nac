//! Credential-free identity for the embedded browser's presentation lifetime.
//!
//! Unmanaged NAC has no organization/profile identity service. A serving-router
//! nonce partitions those axes and rotates on replacement, including when the
//! browser origin, executable path and durable session IDs are retained.
use std::sync::Arc;

use serde::Serialize;
use uuid::Uuid;

#[derive(Clone)]
pub(super) struct PresentationDocument(pub(super) Arc<str>);

#[derive(Clone, Serialize)]
struct Binding {
    owner: String,
    profile: &'static str,
    organization: String,
    host: String,
    incarnation: String,
    release: String,
}

impl Binding {
    fn capture() -> Self {
        let incarnation = Uuid::new_v4().to_string();
        let build = crate::build_identity::current();
        Self {
            owner: incarnation.clone(),
            profile: "standalone",
            organization: incarnation.clone(),
            host: incarnation.clone(),
            incarnation,
            release: serde_json::json!([
                build.product_version,
                build.build_id,
                build.track,
                build.source_revision,
            ])
            .to_string(),
        }
    }

    fn document(&self, html: &str) -> PresentationDocument {
        let data = serde_json::json!({ "version": 1, "scope": self }).to_string();
        // JSON is inert script data, but '<' must not terminate its HTML element.
        let data = data.replace('<', "\\u003c").replace('&', "\\u0026");
        let bootstrap = format!(
            "<script id=\"nac-presentation-binding\" type=\"application/json\">{data}</script></head>"
        );
        PresentationDocument(html.replacen("</head>", &bootstrap, 1).into())
    }
}

impl PresentationDocument {
    pub(super) fn capture() -> Self {
        Binding::capture().document(include_str!("../../assets/dist/index.html"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embeds_actual_build_and_one_stable_serving_lifetime() {
        let binding = Binding::capture();
        let document = binding.document("<html><head></head><body></body></html>");
        assert_eq!(
            document.0,
            binding
                .document("<html><head></head><body></body></html>")
                .0
        );
        assert_eq!(binding.owner, binding.incarnation);
        assert_eq!(binding.host, binding.incarnation);
        let release: Vec<String> = serde_json::from_str(&binding.release).unwrap();
        let build = crate::build_identity::current();
        assert_eq!(
            release,
            [
                build.product_version,
                build.build_id,
                build.track,
                build.source_revision
            ]
        );
        let replacement = Binding::capture();
        assert_ne!(binding.incarnation, replacement.incarnation);
        assert_ne!(
            document.0,
            replacement
                .document("<html><head></head><body></body></html>")
                .0
        );
    }

    #[test]
    fn embeds_only_opaque_scope_and_escapes_html_in_build_metadata() {
        let mut binding = Binding::capture();
        binding.release = "build</script><img src=x>&".to_string();
        let document = binding.document("<head></head>");
        assert_eq!(binding.host, binding.incarnation);
        assert!(!document.0.contains("<img"));
        assert!(!document.0.contains("build</script>"));
        assert!(document.0.contains("build\\u003c/script>"));
        assert_eq!(document.0.matches("</script>").count(), 1);
    }
}
