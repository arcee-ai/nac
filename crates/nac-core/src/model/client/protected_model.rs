//! Trusted model construction from the SAME actual imported private key owner.
//! No ambient selector, mounted file, stored login or provider discovery fallback.
use super::*;
use crate::{
    model::InitialHostKeyCustody,
    runtime::{ProtectedExecutionContext, ProtectedExecutionStage},
};
use std::sync::Arc;

pub(super) struct HostKeyModelGuard {
    custody: Arc<InitialHostKeyCustody>,
    completion: Arc<crate::runtime::CompletedInitialImport>,
    context: Arc<ProtectedExecutionContext>,
}
impl HostKeyModelGuard {
    pub(super) fn context(&self) -> &ProtectedExecutionContext {
        &self.context
    }
    pub(super) async fn check_current_async(self: &Arc<Self>) -> Result<()> {
        // A credential writer may hold its cross-process lock. Keep that wait
        // off Tokio and retain THIS owner in accepted work if observation is
        // canceled; the independent runtime guard still observes its cutoff.
        let original = Arc::clone(self);
        tokio::task::spawn_blocking(move || original.check_current())
            .await
            .map_err(|_| anyhow!("protected model authority unavailable"))?
    }
    pub(super) fn check_current(&self) -> Result<()> {
        let current = || self.context.check_stage(ProtectedExecutionStage::Effect);
        current()?;
        self.completion.check_custody_association(&self.custody)?;
        self.custody.check_model_current(current)?;
        current()
    }
}
impl ModelClient {
    pub(crate) fn belongs_to_protected_context(
        &self,
        context: &Arc<ProtectedExecutionContext>,
    ) -> bool {
        self.protected_host_key
            .as_ref()
            .is_some_and(|guard| Arc::ptr_eq(&guard.context, context))
    }
    /// Private genuine builder entry. The custody and runtime boundary are
    /// independently non-reconstructable original owners. Import alone is not
    /// Ready/current user eligibility or execution authority; the genuine
    /// factory must retain and validate those owners before this call.
    pub(crate) fn from_protected_host_key(
        settings: EffectiveModelSettings,
        custody: Arc<InitialHostKeyCustody>,
        completion: Arc<crate::runtime::CompletedInitialImport>,
        context: Arc<ProtectedExecutionContext>,
    ) -> Result<Self> {
        let create = (|| {
            anyhow::ensure!(
                settings.backend == BackendKind::ArceeApi
                    && settings.api_key_env.is_none()
                    && settings.trusted_api_key_file.is_none()
                    && !settings.allow_insecure_http
                    && settings.resolved.api == catalog::ApiKind::OpenAiCompletions,
                "protected model selection differs"
            );
            let settings = settings.validate_captured()?;
            validate_extra_headers(&settings.extra_headers)?;
            let endpoint = arcee::validate_approved_base_url(&settings.base_url)?;
            let binding = custody.binding();
            let identity = context.identity();
            anyhow::ensure!(
                endpoint.origin().ascii_serialization() == binding.inference_origin
                    && identity.trusted_key_owner_id.to_string() == binding.local_key_id
                    && identity.key_generation == binding.key_generation,
                "protected model owner differs"
            );
            let guard = Arc::new(HostKeyModelGuard {
                custody,
                completion,
                context,
            });
            guard.check_current()?;
            let api_key = guard
                .custody
                .model_key(|| guard.context.check_stage(ProtectedExecutionStage::Effect))?;
            guard.check_current()?;
            let client = no_redirect_model_client()?;
            Ok(Self {
                client,
                base_url: settings.base_url,
                api_key,
                protected_host_key: Some(guard),
                model: settings.model,
                backend: settings.backend,
                reasoning_effort: settings.reasoning_effort,
                api_key_env: None,
                trusted_api_key_file: None,
                extra_headers: settings.extra_headers,
                allow_insecure_http: false,
                arcee_credential_source: Some(ArceeCredentialSource::ApiKey),
                cache_ttl: None,
                prompt_cache_key: None,
                resolved_model: settings.resolved,
            })
        })();
        create.map_err(|_: anyhow::Error| anyhow!("protected model construction unavailable"))
    }
}

#[cfg(test)]
#[path = "protected_model_tests.rs"]
mod tests;
