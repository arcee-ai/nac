//! Native-first registration and dynamic model dispatch for NAC tools.
//!
//! The kernel deliberately keeps model JSON at the boundary. Native callers
//! retain a typed handle, while model calls are decoded into a prepared call
//! before authorization or execution. Permission policy and durable settlement
//! are owned by higher layers; this module supplies the stable seam they use.

use std::any::{Any, TypeId};
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::sync::Arc;

use futures_util::future::BoxFuture;
use serde_json::Value;

use crate::model::ModelClient;
use crate::types::ToolDefinition;

use super::{ToolResult, ToolRuntime};

/// Scheduling admission declared by a tool implementation.
///
/// Existing orchestrator workers retain their established scheduler. Direct
/// sessions use this metadata when their execution loop is introduced.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolAdmission {
    Parallel,
    Exclusive,
}

/// Canonical semantic target produced only after model input is validated.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PermissionResource {
    pub action: String,
    pub resource: String,
    /// Human-readable form for approval surfaces. Policy always matches the
    /// canonical `resource`, never this presentation string.
    pub display: String,
    /// Harness-derived narrow resource that an `always` reply may persist.
    /// `None` means this invocation is eligible for one-time approval only.
    pub save_resource: Option<String>,
    /// A non-configurable denial produced by the native operation. Neither a
    /// configured allow nor a remembered grant may override it.
    pub hard_denial: Option<String>,
    /// Path substituted into a prepared shell command after authorization.
    /// This is internal execution metadata: policy continues to match
    /// `resource`, which is the resolved semantic target.
    pub(crate) shell_binding: Option<String>,
    /// Preserve the final path component when producing `shell_binding`.
    /// Deletion commands must remove a final symlink itself rather than the
    /// symlink target that policy conservatively authorized.
    pub(crate) preserve_final_component: bool,
}

impl PermissionResource {
    pub fn new(action: impl Into<String>, resource: impl Into<String>) -> Self {
        let resource = resource.into();
        Self {
            action: action.into(),
            display: resource.clone(),
            resource,
            save_resource: None,
            hard_denial: None,
            shell_binding: None,
            preserve_final_component: false,
        }
    }

    pub fn with_display(mut self, display: impl Into<String>) -> Self {
        self.display = display.into();
        self
    }

    pub fn with_save_resource(mut self, resource: impl Into<String>) -> Self {
        self.save_resource = Some(resource.into());
        self
    }

    pub fn with_hard_denial(mut self, reason: impl Into<String>) -> Self {
        self.hard_denial = Some(reason.into());
        self
    }

    pub(crate) fn with_shell_binding(
        mut self,
        path: impl Into<String>,
        preserve_final_component: bool,
    ) -> Self {
        self.shell_binding = Some(path.into());
        self.preserve_final_component = preserve_final_component;
        self
    }
}

/// Thin identity and progress context for one model-visible call.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ToolCallContext {
    pub call_id: Option<String>,
    pub thread_name: Option<String>,
}

/// Runtime services are separate from per-call identity so native operations
/// do not need to deserialize or rediscover NAC's execution environment.
#[derive(Clone, Copy)]
pub struct ToolServices<'a> {
    pub runtime: &'a ToolRuntime,
    pub client: &'a ModelClient,
}

/// One complete native tool: exposure, boundary decoding, policy projection,
/// scheduling metadata, and executable behavior.
pub trait NativeTool: Send + Sync + 'static {
    type Input: Send + 'static;

    fn definition(&self) -> ToolDefinition;

    fn admission(&self) -> ToolAdmission;

    fn decode(&self, input: Value) -> Result<Self::Input, ToolResult>;

    fn permission_resources(
        &self,
        input: &Self::Input,
        services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult>;

    /// Bind canonical targets approved by policy into the decoded invocation.
    /// Path-bearing tools override this so execution cannot re-follow a
    /// different symlink spelling after an approval wait.
    fn bind_authorized_resources(
        &self,
        _input: &mut Self::Input,
        _resources: &[PermissionResource],
        _services: ToolServices<'_>,
    ) -> Result<(), ToolResult> {
        Ok(())
    }

    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: ToolServices<'a>,
        context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult>;
}

#[derive(Clone, Debug)]
pub struct ToolDescriptor {
    pub definition: ToolDefinition,
    pub admission: ToolAdmission,
}

impl ToolDescriptor {
    pub fn name(&self) -> &str {
        &self.definition.function.name
    }
}

trait PreparedInvocation: Send {
    fn permission_resources(&self) -> &[PermissionResource];

    fn bind_authorized_resources(
        &mut self,
        resources: &[PermissionResource],
        services: ToolServices<'_>,
    ) -> Result<(), ToolResult>;

    fn invoke<'a>(
        self: Box<Self>,
        services: ToolServices<'a>,
        context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult>;
}

trait ErasedTool: Send + Sync {
    fn descriptor(&self) -> ToolDescriptor;

    fn prepare(
        &self,
        input: Value,
        services: ToolServices<'_>,
    ) -> Result<Box<dyn PreparedInvocation>, ToolResult>;
}

struct NativeEntry<T: NativeTool> {
    tool: Arc<T>,
    descriptor: ToolDescriptor,
}

impl<T: NativeTool> ErasedTool for NativeEntry<T> {
    fn descriptor(&self) -> ToolDescriptor {
        self.descriptor.clone()
    }

    fn prepare(
        &self,
        input: Value,
        services: ToolServices<'_>,
    ) -> Result<Box<dyn PreparedInvocation>, ToolResult> {
        let input = self.tool.decode(input)?;
        let resources = self.tool.permission_resources(&input, services)?;
        Ok(Box::new(PreparedNative {
            tool: Arc::clone(&self.tool),
            input,
            resources,
        }))
    }
}

struct PreparedNative<T: NativeTool> {
    tool: Arc<T>,
    input: T::Input,
    resources: Vec<PermissionResource>,
}

impl<T: NativeTool> PreparedInvocation for PreparedNative<T> {
    fn permission_resources(&self) -> &[PermissionResource] {
        &self.resources
    }

    fn bind_authorized_resources(
        &mut self,
        resources: &[PermissionResource],
        services: ToolServices<'_>,
    ) -> Result<(), ToolResult> {
        self.tool
            .bind_authorized_resources(&mut self.input, resources, services)
    }

    fn invoke<'a>(
        self: Box<Self>,
        services: ToolServices<'a>,
        context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        let Self {
            tool,
            input,
            resources: _,
        } = *self;
        Box::pin(async move { tool.execute(input, services, context).await })
    }
}

/// A validated call waiting for leaf authorization and execution.
pub struct PreparedToolCall {
    descriptor: ToolDescriptor,
    invocation: Box<dyn PreparedInvocation>,
}

impl PreparedToolCall {
    pub fn descriptor(&self) -> &ToolDescriptor {
        &self.descriptor
    }

    pub fn permission_resources(&self) -> &[PermissionResource] {
        self.invocation.permission_resources()
    }

    pub fn bind_authorized_resources(
        &mut self,
        resources: &[PermissionResource],
        services: ToolServices<'_>,
    ) -> Result<(), ToolResult> {
        self.invocation
            .bind_authorized_resources(resources, services)
    }

    pub fn invoke<'a>(
        self,
        services: ToolServices<'a>,
        context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        self.invocation.invoke(services, context)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ToolRegistryError {
    DuplicateName(String),
    DuplicateNativeType(&'static str),
    DuplicateCapability(String),
    UnknownCapability(String),
}

impl fmt::Display for ToolRegistryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DuplicateName(name) => write!(formatter, "duplicate tool name '{name}'"),
            Self::DuplicateNativeType(name) => {
                write!(
                    formatter,
                    "native tool type '{name}' was registered more than once"
                )
            }
            Self::DuplicateCapability(name) => {
                write!(formatter, "capability '{name}' was selected more than once")
            }
            Self::UnknownCapability(name) => write!(formatter, "unknown capability '{name}'"),
        }
    }
}

impl std::error::Error for ToolRegistryError {}

/// Immutable registry. Registration order is retained for prompt-cache and
/// provider-definition stability.
pub struct ToolRegistry {
    entries: Vec<Arc<dyn ErasedTool>>,
    by_name: HashMap<String, usize>,
    native: HashMap<TypeId, Arc<dyn Any + Send + Sync>>,
}

impl ToolRegistry {
    pub fn builder() -> ToolRegistryBuilder {
        ToolRegistryBuilder::default()
    }

    /// Select an explicit capability set. Missing or duplicate names are
    /// errors rather than silent omissions or ambiguous overrides.
    pub fn snapshot<'a>(
        &self,
        names: impl IntoIterator<Item = &'a str>,
    ) -> Result<ToolSnapshot, ToolRegistryError> {
        let mut selected = Vec::new();
        let mut seen = HashSet::new();
        for name in names {
            if !seen.insert(name) {
                return Err(ToolRegistryError::DuplicateCapability(name.to_string()));
            }
            let index = self
                .by_name
                .get(name)
                .copied()
                .ok_or_else(|| ToolRegistryError::UnknownCapability(name.to_string()))?;
            selected.push(Arc::clone(&self.entries[index]));
        }
        Ok(ToolSnapshot { entries: selected })
    }

    /// Build a per-request permission/capability view without mutating the
    /// process registry.
    pub fn snapshot_where(&self, mut visible: impl FnMut(&ToolDescriptor) -> bool) -> ToolSnapshot {
        ToolSnapshot {
            entries: self
                .entries
                .iter()
                .filter(|entry| visible(&entry.descriptor()))
                .cloned()
                .collect(),
        }
    }

    /// Retain and call the concrete registered instance with native input.
    pub fn native_handle<T: NativeTool>(&self) -> Result<NativeToolHandle<T>, ToolRegistryError> {
        let tool = self
            .native
            .get(&TypeId::of::<T>())
            .cloned()
            .ok_or(ToolRegistryError::UnknownCapability(
                std::any::type_name::<T>().to_string(),
            ))?
            .downcast::<T>()
            .map_err(|_| ToolRegistryError::UnknownCapability(std::any::type_name::<T>().into()))?;
        Ok(NativeToolHandle { tool })
    }
}

#[derive(Default)]
pub struct ToolRegistryBuilder {
    entries: Vec<Arc<dyn ErasedTool>>,
    names: HashSet<String>,
    native: HashMap<TypeId, Arc<dyn Any + Send + Sync>>,
    error: Option<ToolRegistryError>,
}

impl ToolRegistryBuilder {
    #[must_use]
    pub fn register<T: NativeTool>(mut self, tool: T) -> Self {
        if self.error.is_some() {
            return self;
        }
        let tool = Arc::new(tool);
        let descriptor = ToolDescriptor {
            definition: tool.definition(),
            admission: tool.admission(),
        };
        let name = descriptor.definition.function.name.clone();
        if !self.names.insert(name.clone()) {
            self.error = Some(ToolRegistryError::DuplicateName(name));
            return self;
        }
        let type_id = TypeId::of::<T>();
        if self.native.contains_key(&type_id) {
            self.error = Some(ToolRegistryError::DuplicateNativeType(
                std::any::type_name::<T>(),
            ));
            return self;
        }
        self.native.insert(type_id, tool.clone());
        self.entries
            .push(Arc::new(NativeEntry { tool, descriptor }));
        self
    }

    pub fn finish(self) -> Result<ToolRegistry, ToolRegistryError> {
        if let Some(error) = self.error {
            return Err(error);
        }
        let by_name = self
            .entries
            .iter()
            .enumerate()
            .map(|(index, entry)| (entry.descriptor().definition.function.name, index))
            .collect();
        Ok(ToolRegistry {
            entries: self.entries,
            by_name,
            native: self.native,
        })
    }
}

pub struct NativeToolHandle<T: NativeTool> {
    tool: Arc<T>,
}

impl<T: NativeTool> Clone for NativeToolHandle<T> {
    fn clone(&self) -> Self {
        Self {
            tool: Arc::clone(&self.tool),
        }
    }
}

impl<T: NativeTool> NativeToolHandle<T> {
    #[allow(
        dead_code,
        reason = "native service callers consume typed tool handles"
    )]
    pub fn invoke<'a>(
        &'a self,
        input: T::Input,
        services: ToolServices<'a>,
        context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        self.tool.execute(input, services, context)
    }
}

/// Ordered, immutable view used for one model request.
pub struct ToolSnapshot {
    entries: Vec<Arc<dyn ErasedTool>>,
}

impl ToolSnapshot {
    pub fn definitions(&self) -> Vec<ToolDefinition> {
        self.entries
            .iter()
            .map(|entry| entry.descriptor().definition)
            .collect()
    }

    #[cfg(test)]
    pub(crate) fn descriptors_for_test(&self) -> Vec<ToolDescriptor> {
        self.entries
            .iter()
            .map(|entry| entry.descriptor())
            .collect()
    }

    pub fn contains(&self, name: &str) -> bool {
        self.entries
            .iter()
            .any(|entry| entry.descriptor().name() == name)
    }

    pub fn admission(&self, name: &str) -> Option<ToolAdmission> {
        self.entries
            .iter()
            .find(|entry| entry.descriptor().name() == name)
            .map(|entry| entry.descriptor().admission)
    }

    /// Decode and validate before permission policy is evaluated. Invocation
    /// remains a separate operation so authorization can happen immediately
    /// before side effects.
    pub fn prepare(
        &self,
        name: &str,
        input: Value,
        services: ToolServices<'_>,
    ) -> Result<PreparedToolCall, ToolResult> {
        let Some(entry) = self
            .entries
            .iter()
            .find(|entry| entry.descriptor().name() == name)
        else {
            return Err(ToolResult::text(
                format!("Error: unknown tool '{name}'"),
                true,
            ));
        };
        let descriptor = entry.descriptor();
        let invocation = entry.prepare(input, services)?;
        Ok(PreparedToolCall {
            descriptor,
            invocation,
        })
    }

    pub async fn invoke(
        &self,
        name: &str,
        input: Value,
        services: ToolServices<'_>,
        context: &ToolCallContext,
    ) -> ToolResult {
        match self.prepare(name, input, services) {
            Ok(mut prepared) => {
                let _admission = prepared.descriptor().admission;
                if let Some(reason) = prepared
                    .permission_resources()
                    .iter()
                    .find_map(|resource| resource.hard_denial.as_deref())
                {
                    return ToolResult::text(
                        format!("Error: permission denied for {name}: {reason}"),
                        true,
                    );
                }
                if let Some(broker) = &services.runtime.permission_broker {
                    let resources = match crate::permissions::canonicalize_authorization_resources(
                        prepared.permission_resources(),
                        services.runtime.backend.as_ref(),
                        &services.runtime.store_path,
                    )
                    .await
                    {
                        Ok(resources) => resources,
                        Err(error) => {
                            return ToolResult::text(
                                format!(
                                    "Error: permission target resolution failed for {name}: {error:#}"
                                ),
                                true,
                            );
                        }
                    };
                    match broker
                        .authorize(
                            name,
                            &resources,
                            context,
                            &services.runtime.command_cancellation,
                        )
                        .await
                    {
                        crate::permissions::AuthorizationOutcome::Allowed => {}
                        crate::permissions::AuthorizationOutcome::Denied(reason) => {
                            return ToolResult::text(
                                format!("Error: permission denied for {name}: {reason}"),
                                true,
                            );
                        }
                    }
                    let current = match crate::permissions::canonicalize_authorization_resources(
                        prepared.permission_resources(),
                        services.runtime.backend.as_ref(),
                        &services.runtime.store_path,
                    )
                    .await
                    {
                        Ok(current) => current,
                        Err(error) => {
                            return ToolResult::text(
                                format!(
                                    "Error: permission target revalidation failed for {name}: {error:#}"
                                ),
                                true,
                            );
                        }
                    };
                    if current != resources {
                        return ToolResult::text(
                            format!(
                                "Error: permission target changed while {name} awaited authorization; retry the tool call"
                            ),
                            true,
                        );
                    }
                    if let Err(error) = prepared.bind_authorized_resources(&resources, services) {
                        return error;
                    }
                }
                prepared.invoke(services, context).await
            }
            Err(error) => error,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use serde::Deserialize;
    use serde_json::json;

    use super::*;
    use crate::types::{FunctionDef, ToolContent};

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct CountInput {
        amount: usize,
    }

    struct CountTool {
        calls: Arc<AtomicUsize>,
        name: &'static str,
    }

    impl NativeTool for CountTool {
        type Input = CountInput;

        fn definition(&self) -> ToolDefinition {
            ToolDefinition {
                def_type: "function".into(),
                function: FunctionDef {
                    name: self.name.into(),
                    description: "count".into(),
                    parameters: json!({"type":"object"}),
                },
            }
        }

        fn admission(&self) -> ToolAdmission {
            ToolAdmission::Parallel
        }

        fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
            serde_json::from_value(input)
                .map_err(|error| ToolResult::text(format!("invalid input: {error}"), true))
        }

        fn permission_resources(
            &self,
            input: &Self::Input,
            _services: ToolServices<'_>,
        ) -> Result<Vec<PermissionResource>, ToolResult> {
            let resource = PermissionResource::new("count", input.amount.to_string());
            Ok(vec![if input.amount == usize::MAX {
                resource.with_hard_denial("native count denial")
            } else {
                resource
            }])
        }

        fn execute<'a>(
            &'a self,
            input: Self::Input,
            _services: ToolServices<'a>,
            context: &'a ToolCallContext,
        ) -> BoxFuture<'a, ToolResult> {
            Box::pin(async move {
                assert_eq!(context.call_id.as_deref(), Some("call-1"));
                self.calls.fetch_add(input.amount, Ordering::SeqCst);
                ToolResult {
                    content: ToolContent::text("counted"),
                    is_error: false,
                }
            })
        }
    }

    #[test]
    fn rejects_duplicate_names_and_native_types() {
        let calls = Arc::new(AtomicUsize::new(0));
        let duplicate_name = ToolRegistry::builder()
            .register(CountTool {
                calls: Arc::clone(&calls),
                name: "same",
            })
            .register(CountTool {
                calls: Arc::clone(&calls),
                name: "same",
            })
            .finish()
            .err()
            .expect("duplicate name");
        assert_eq!(
            duplicate_name,
            ToolRegistryError::DuplicateName("same".into())
        );

        let duplicate_type = ToolRegistry::builder()
            .register(CountTool {
                calls: Arc::clone(&calls),
                name: "first",
            })
            .register(CountTool {
                calls,
                name: "second",
            })
            .finish()
            .err()
            .expect("duplicate native type");
        assert!(matches!(
            duplicate_type,
            ToolRegistryError::DuplicateNativeType(_)
        ));
    }

    #[test]
    fn capability_selection_is_ordered_strict_and_filterable() {
        struct OtherTool(CountTool);
        impl NativeTool for OtherTool {
            type Input = CountInput;
            fn definition(&self) -> ToolDefinition {
                self.0.definition()
            }
            fn admission(&self) -> ToolAdmission {
                ToolAdmission::Exclusive
            }
            fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
                self.0.decode(input)
            }
            fn permission_resources(
                &self,
                input: &Self::Input,
                services: ToolServices<'_>,
            ) -> Result<Vec<PermissionResource>, ToolResult> {
                self.0.permission_resources(input, services)
            }
            fn execute<'a>(
                &'a self,
                input: Self::Input,
                services: ToolServices<'a>,
                context: &'a ToolCallContext,
            ) -> BoxFuture<'a, ToolResult> {
                self.0.execute(input, services, context)
            }
        }

        let calls = Arc::new(AtomicUsize::new(0));
        let registry = ToolRegistry::builder()
            .register(CountTool {
                calls: Arc::clone(&calls),
                name: "parallel",
            })
            .register(OtherTool(CountTool {
                calls,
                name: "exclusive",
            }))
            .finish()
            .unwrap();

        let ordered = registry.snapshot(["exclusive", "parallel"]).unwrap();
        assert_eq!(
            ordered
                .definitions()
                .into_iter()
                .map(|definition| definition.function.name)
                .collect::<Vec<_>>(),
            ["exclusive", "parallel"]
        );
        assert!(matches!(
            registry.snapshot(["parallel", "parallel"]),
            Err(ToolRegistryError::DuplicateCapability(name)) if name == "parallel"
        ));
        assert!(matches!(
            registry.snapshot(["missing"]),
            Err(ToolRegistryError::UnknownCapability(name)) if name == "missing"
        ));
        let visible =
            registry.snapshot_where(|descriptor| descriptor.admission == ToolAdmission::Parallel);
        assert_eq!(visible.definitions().len(), 1);
        assert_eq!(visible.definitions()[0].function.name, "parallel");
    }

    #[tokio::test]
    async fn prepared_calls_validate_before_invocation_and_keep_identity() {
        let calls = Arc::new(AtomicUsize::new(0));
        let registry = ToolRegistry::builder()
            .register(CountTool {
                calls: Arc::clone(&calls),
                name: "count",
            })
            .finish()
            .unwrap();
        let snapshot = registry.snapshot(["count"]).unwrap();

        let runtime = crate::tools::test_runtime();
        let client = crate::model::ModelClient::new_for_test();
        let services = ToolServices {
            runtime: &runtime,
            client: &client,
        };
        let invalid = snapshot
            .prepare("count", json!({"amount": 1, "extra": true}), services)
            .err()
            .expect("invalid input");
        assert!(invalid.is_error);
        assert_eq!(calls.load(Ordering::SeqCst), 0);

        let prepared = snapshot
            .prepare("count", json!({"amount": 2}), services)
            .unwrap();
        assert_eq!(
            prepared.permission_resources(),
            &[PermissionResource::new("count", "2")]
        );
        let result = prepared
            .invoke(
                services,
                &ToolCallContext {
                    call_id: Some("call-1".into()),
                    thread_name: None,
                },
            )
            .await;
        assert!(!result.is_error);
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn native_hard_denial_blocks_brokerless_model_invocation() {
        let calls = Arc::new(AtomicUsize::new(0));
        let registry = ToolRegistry::builder()
            .register(CountTool {
                calls: Arc::clone(&calls),
                name: "count",
            })
            .finish()
            .unwrap();
        let snapshot = registry.snapshot(["count"]).unwrap();
        let runtime = crate::tools::test_runtime();
        assert!(runtime.permission_broker.is_none());
        let client = crate::model::ModelClient::new_for_test();
        let result = snapshot
            .invoke(
                "count",
                json!({"amount": usize::MAX}),
                ToolServices {
                    runtime: &runtime,
                    client: &client,
                },
                &ToolCallContext {
                    call_id: Some("call-1".into()),
                    thread_name: Some("worker".into()),
                },
            )
            .await;

        assert!(result.is_error);
        assert!(result.content.to_string().contains("native count denial"));
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn direct_broker_authorizes_between_prepare_and_side_effects() {
        let calls = Arc::new(AtomicUsize::new(0));
        let registry = ToolRegistry::builder()
            .register(CountTool {
                calls: Arc::clone(&calls),
                name: "count",
            })
            .finish()
            .unwrap();
        let snapshot = registry.snapshot(["count"]).unwrap();
        let directory =
            std::env::temp_dir().join(format!("nac-kernel-permission-{}", uuid::Uuid::new_v4()));
        let store_path = directory.join("store.db");
        crate::store::initialize(&store_path).unwrap();
        crate::store::insert_test_session(&store_path, "session-a");
        let broker = Arc::new(crate::permissions::PermissionBroker::new(
            store_path.clone(),
            "session-a".to_string(),
            crate::permissions::PermissionBackend::Local,
            0,
            [crate::permissions::PermissionRule::new(
                "count",
                "*",
                crate::permissions::PermissionEffect::Ask,
            )],
        ));
        let mut runtime = crate::tools::test_runtime();
        runtime.store_path = store_path;
        runtime.session_id = Some("session-a".to_string());
        runtime.permission_broker = Some(Arc::clone(&broker));
        let client = crate::model::ModelClient::new_for_test();
        let services = ToolServices {
            runtime: &runtime,
            client: &client,
        };
        let context = ToolCallContext {
            call_id: Some("call-1".to_string()),
            thread_name: None,
        };

        let headless = snapshot
            .invoke("count", json!({"amount": 2}), services, &context)
            .await;
        assert!(headless.is_error);
        assert_eq!(calls.load(Ordering::SeqCst), 0);

        let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
        let _interactive = bus.subscribe_assistant_deltas();
        broker.attach_event_bus(bus);
        let invoke = snapshot.invoke("count", json!({"amount": 2}), services, &context);
        let reply = async {
            loop {
                if let Some(request) = broker.pending().pop() {
                    broker
                        .reply(&request.id, crate::permissions::PermissionReply::Once)
                        .unwrap();
                    break;
                }
                tokio::task::yield_now().await;
            }
        };
        let (approved, ()) = tokio::join!(invoke, reply);
        assert!(!approved.is_error, "{}", approved.content);
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        let _ = std::fs::remove_dir_all(directory);
    }
}
