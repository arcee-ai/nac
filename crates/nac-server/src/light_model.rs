use anyhow::Result;
use nac_core::{
    light_model::LightModelSettings,
    model::{provider_for_model, BackendKind},
    runtime::CredentialDestinationPolicy,
};

use crate::{enforce_trusted_base_url, nonblank_request_string};

/// A top-level generated credential the light model may inherit. During
/// rotation, `previous` identifies references that should follow the new
/// destination; `name` is absent when managed auth clears the selector.
#[derive(Clone, Copy)]
pub(crate) struct InheritedCredential<'a> {
    pub backend: BackendKind,
    pub name: Option<&'a str>,
    pub previous: Option<&'a str>,
}

/// Normalize and destination-check the light model before persistence or
/// launch.
pub(crate) fn normalize(
    light: LightModelSettings,
    policy: &CredentialDestinationPolicy,
    inherited: Option<InheritedCredential<'_>>,
) -> Result<LightModelSettings> {
    let mut light = LightModelSettings {
        model: nonblank_request_string(light.model, "light_model.model")?,
        base_url: light
            .base_url
            .map(|value| nonblank_request_string(value, "light_model.base_url"))
            .transpose()?,
        ..light
    };
    enforce_trusted_base_url(
        light.backend.or_else(|| provider_for_model(&light.model)),
        light.base_url.as_deref(),
        policy,
    )?;
    if let Some(credential) = inherited {
        rotate_inherited_credential(&mut light, credential);
    }
    Ok(light)
}

/// Rotate an inherited light-model reference when the top-level credential
/// destination changes. Only a light model on the same backend follows the
/// destination, and never one holding an unrelated explicit selector.
pub(crate) fn rotate_inherited_credential(
    light: &mut LightModelSettings,
    credential: InheritedCredential<'_>,
) {
    let light_backend = light
        .backend
        .or_else(|| provider_for_model(light.model.as_str()));
    if light_backend == Some(credential.backend)
        && (light.api_key_env.is_none() || light.api_key_env.as_deref() == credential.previous)
    {
        light.api_key_env = credential.name.map(str::to_string);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn light_settings(
        backend: Option<BackendKind>,
        api_key_env: Option<&str>,
    ) -> LightModelSettings {
        LightModelSettings {
            model: "deepseek/deepseek-v4-flash-latest".to_string(),
            backend,
            base_url: None,
            api_key_env: api_key_env.map(str::to_string),
            reasoning_effort: None,
        }
    }

    #[test]
    fn rotates_inherited_selector_on_primary_key_change() {
        // The key-only PATCH case: the light model references the previous
        // primary selector and must follow it to the new one.
        let mut light = light_settings(Some(BackendKind::ArceeAuth), Some("OLD_KEY"));
        rotate_inherited_credential(
            &mut light,
            InheritedCredential {
                backend: BackendKind::ArceeAuth,
                name: Some("NEW_KEY"),
                previous: Some("OLD_KEY"),
            },
        );
        assert_eq!(light.api_key_env.as_deref(), Some("NEW_KEY"));

        // A light model with no selector inherits too.
        let mut light = light_settings(Some(BackendKind::ArceeAuth), None);
        rotate_inherited_credential(
            &mut light,
            InheritedCredential {
                backend: BackendKind::ArceeAuth,
                name: Some("NEW_KEY"),
                previous: Some("OLD_KEY"),
            },
        );
        assert_eq!(light.api_key_env.as_deref(), Some("NEW_KEY"));

        // Managed auth clears an inherited selector instead of retaining the
        // primary key that the normalized top-level configuration dropped.
        let mut light = light_settings(Some(BackendKind::ArceeAuth), Some("OLD_KEY"));
        rotate_inherited_credential(
            &mut light,
            InheritedCredential {
                backend: BackendKind::ArceeAuth,
                name: None,
                previous: Some("OLD_KEY"),
            },
        );
        assert_eq!(light.api_key_env, None);
    }

    #[test]
    fn keeps_unrelated_or_cross_backend_selectors() {
        // An explicit unrelated selector is not clobbered.
        let mut light = light_settings(Some(BackendKind::ArceeAuth), Some("OTHER_KEY"));
        rotate_inherited_credential(
            &mut light,
            InheritedCredential {
                backend: BackendKind::ArceeAuth,
                name: Some("NEW_KEY"),
                previous: Some("OLD_KEY"),
            },
        );
        assert_eq!(light.api_key_env.as_deref(), Some("OTHER_KEY"));

        // A different backend never follows the primary key.
        let mut light = light_settings(Some(BackendKind::DeepSeekChat), Some("OLD_KEY"));
        rotate_inherited_credential(
            &mut light,
            InheritedCredential {
                backend: BackendKind::ArceeAuth,
                name: Some("NEW_KEY"),
                previous: Some("OLD_KEY"),
            },
        );
        assert_eq!(light.api_key_env.as_deref(), Some("OLD_KEY"));
    }
}
