//! Real sealed leases and owned stdio MCP connections; no provider calls.
use super::*;
use crate::runtime::{ManagedRuntimeLeaseGuard, RuntimeEffectLease, RuntimeEffectLeaseHandle};
use crate::store::{
    self, RuntimeChallengeSpec, RuntimeLeaseBinding, RuntimeLeaseClock,
    RuntimeLeaseReservationOutcome, RuntimeLeaseResponse, RuntimeLeaseSnapshot, StoreCoordinator,
};
use serde_json::json;
use std::fs;
use uuid::Uuid;

const SERVER: &str = r#"
import json, os, sys, time
from pathlib import Path
root = Path(sys.argv[1])
(root / 'pid').write_text(str(os.getpid()))
for line in sys.stdin:
    request = json.loads(line)
    method = request.get('method', '')
    with (root / 'requests').open('a') as log:
        log.write(method + '\n')
    if 'id' not in request:
        continue
    if method == 'initialize':
        result = {'protocolVersion': '2025-11-25', 'capabilities': {'prompts': {}, 'tools': {}},
                  'serverInfo': {'name': 'owned-fixture', 'version': '1'}}
    elif method == 'prompts/list':
        result = {'prompts': [{'name': 'review', 'description': 'Review fixture'}]}
    elif method == 'tools/list':
        result = {'tools': [{'name': 'echo', 'description': 'Echo fixture',
                            'inputSchema': {'type': 'object'}}]}
    elif method in ('prompts/get', 'tools/call'):
        if (root / 'block').exists():
            (root / 'entered').write_text(method)
            time.sleep(20)
        result = ({'messages': [{'role': 'user', 'content': {'type': 'text', 'text': 'remote fixture'}}]}
                  if method == 'prompts/get' else {'content': [{'type': 'text', 'text': 'tool fixture'}]})
    else:
        result = {}
    print(json.dumps({'jsonrpc': '2.0', 'id': request['id'], 'result': result}), flush=True)
"#;

struct Fixture {
    root: PathBuf,
    previous_home: Option<std::ffi::OsString>,
    store: Arc<StoreCoordinator>,
    guard: Arc<ManagedRuntimeLeaseGuard>,
}

pub(crate) fn write_stdio_fixture(root: &Path) {
    fs::write(root.join("server.py"), SERVER).unwrap();
    fs::write(root.join("config.toml"), format!(
        "[mcp_servers.docs]\nrequired = true\napproval = \"allow\"\ntransport = \"stdio\"\ncommand = \"/usr/bin/python3\"\nargs = [{}, {}]\n",
        serde_json::to_string(&root.join("server.py")).unwrap(),
        serde_json::to_string(root).unwrap(),
    )).unwrap();
}

pub(crate) async fn hold_request_connection(
    registry: Arc<McpRegistry>,
    entered: tokio::sync::oneshot::Sender<()>,
    release: tokio::sync::oneshot::Receiver<()>,
) {
    let service = registry.servers["docs"].current_service().await;
    let _lock = service.write().await;
    entered.send(()).unwrap();
    release.await.unwrap();
}

pub(crate) async fn wait_for_owned_child_exit(root: &Path) {
    let pid: i32 = fs::read_to_string(root.join("pid"))
        .unwrap()
        .parse()
        .unwrap();
    timeout(Duration::from_secs(5), async {
        loop {
            if unsafe { libc::kill(pid, 0) } == -1 {
                assert_eq!(
                    std::io::Error::last_os_error().raw_os_error(),
                    Some(libc::ESRCH)
                );
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("owned stdio MCP child must be reaped");
}
impl Fixture {
    async fn new(lifetime_ms: i64) -> Self {
        let root = env::temp_dir().join(format!("nac-mcp-original-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        write_stdio_fixture(&root);
        let previous_home = env::var_os("NAC_HOME");
        unsafe { env::set_var("NAC_HOME", &root) };
        let path = root.join("store.db");
        store::initialize(&path).unwrap();
        let store = StoreCoordinator::acquire(&path).unwrap();
        let clock = RuntimeLeaseClock::capture().unwrap();
        let binding = RuntimeLeaseBinding {
            identity: store::ManagedRuntimeOperationIdentity {
                operation_id: Uuid::new_v4(),
                full_input_sha256: [7; 32],
            },
            assignment_sha256: [8; 32],
            serving_lifetime_id: Uuid::new_v4(),
            original_expires_ms: clock.wall_ms() + 30_000,
        };
        let RuntimeLeaseReservationOutcome::Fresh(fresh) = store
            .reserve_managed_runtime_lease(binding, clock)
            .await
            .unwrap()
        else {
            panic!("fresh")
        };
        let challenge = RuntimeChallengeSpec {
            channel_id: Uuid::new_v4(),
            challenge_sha256: [9; 32],
            expires_ms: clock.wall_ms() + 5_000,
        };
        let pending = store
            .challenge_managed_runtime_initial(
                fresh,
                challenge.clone(),
                RuntimeLeaseClock::capture().unwrap(),
            )
            .await
            .unwrap();
        let clock = RuntimeLeaseClock::capture().unwrap();
        let active = store
            .consume_managed_runtime_challenge(
                pending,
                RuntimeLeaseResponse {
                    channel_id: challenge.channel_id,
                    challenge_sha256: challenge.challenge_sha256,
                    lease: RuntimeLeaseSnapshot {
                        lease_id: Uuid::new_v4(),
                        sequence: 1,
                        expires_ms: clock.wall_ms() + lifetime_ms,
                    },
                    observed_ms: clock.wall_ms(),
                },
                clock,
            )
            .await
            .unwrap();
        let guard = ManagedRuntimeLeaseGuard::new(Arc::clone(&store), active)
            .await
            .unwrap();
        Self {
            root,
            previous_home,
            store,
            guard,
        }
    }
    async fn load(&self, protected: bool) -> Arc<McpRegistry> {
        let paths = PathContext::new(&self.root);
        let outcome = if protected {
            McpRegistry::load_reporting_skips_with_effect_lease(
                &self.root,
                None,
                &paths,
                McpTransportPolicy::All,
                McpRootPolicy::None,
                self.guard.clone(),
            )
            .await
        } else {
            McpRegistry::load_reporting_skips(
                &self.root,
                None,
                &paths,
                McpTransportPolicy::All,
                McpRootPolicy::None,
            )
            .await
        }
        .unwrap();
        assert!(outcome.skipped.is_empty());
        outcome.registry.unwrap()
    }
    fn requests(&self, method: &str) -> usize {
        fs::read_to_string(self.root.join("requests"))
            .unwrap_or_default()
            .lines()
            .filter(|line| *line == method)
            .count()
    }
    async fn wait_entered(&self) {
        timeout(Duration::from_secs(5), async {
            while !self.root.join("entered").exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
    }
    #[cfg(unix)]
    async fn wait_reaped(&self) {
        wait_for_owned_child_exit(&self.root).await;
    }
    async fn finish(mut self) {
        self.guard.deny_now();
        self.store.shutdown().await.unwrap();
        unsafe {
            if let Some(previous) = self.previous_home.take() {
                env::set_var("NAC_HOME", previous);
            } else {
                env::remove_var("NAC_HOME");
            }
        }
        fs::remove_dir_all(&self.root).unwrap();
    }
}
fn invocation() -> McpPromptInvocation {
    McpPromptInvocation {
        raw_prompt: "/mcp__docs__review".into(),
        command_name: "mcp__docs__review".into(),
        arguments: Default::default(),
    }
}

#[tokio::test]
async fn runtime_mcp_prompt_and_captured_tool_preserve_live_semantics() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new(20_000).await;
    let registry = fixture.load(true).await;
    let effect: RuntimeEffectLeaseHandle = fixture.guard.clone();
    assert!(registry.matches_runtime_effect(&effect));
    let other = Fixture::new(20_000).await;
    let foreign: RuntimeEffectLeaseHandle = other.guard.clone();
    assert!(!registry.matches_runtime_effect(&foreign));
    other.finish().await;
    let prompt = registry
        .resolve_prompt_invocation(invocation())
        .await
        .unwrap();
    assert!(prompt.agent_prompt.contains("untrusted_remote_prompt_data"));
    assert!(prompt.agent_prompt.contains("remote fixture"));
    let result = registry
        .call_tool("mcp__docs__echo", json!({}), false)
        .await;
    assert!(!result.is_error);
    assert!(result.content.to_string().contains("tool fixture"));
    fixture.guard.deny_now();
    fixture.wait_reaped().await;
    assert!(registry
        .resolve_prompt_invocation(invocation())
        .await
        .is_err());
    assert_eq!(fixture.requests("prompts/get"), 1);
    assert_eq!(fixture.requests("tools/call"), 1);
    drop(registry);
    fixture.finish().await;
}

#[tokio::test]
async fn runtime_mcp_expiry_after_connection_lock_wait_sends_no_prompt() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    for outer in [false, true] {
        let fixture = Fixture::new(1_500).await;
        let registry = fixture.load(true).await;
        let server = registry.servers["docs"].clone();
        let service = server.current_service().await;
        let inner_lock = if outer {
            None
        } else {
            Some(service.write().await)
        };
        let outer_lock = if outer {
            Some(server.service.write().await)
        } else {
            None
        };
        let pending = registry.clone();
        let task =
            tokio::spawn(async move { pending.resolve_prompt_invocation(invocation()).await });
        timeout(Duration::from_secs(4), fixture.guard.wait_for_denial())
            .await
            .unwrap();
        assert!(timeout(Duration::from_secs(1), task)
            .await
            .unwrap()
            .unwrap()
            .is_err());
        assert_eq!(fixture.requests("prompts/get"), 0);
        drop(inner_lock);
        drop(outer_lock);
        fixture.wait_reaped().await;
        drop(registry);
        drop(server);
        drop(service);
        fixture.finish().await;
    }
}

#[tokio::test]
async fn runtime_mcp_expiry_cancels_inflight_prompt_and_owned_transport() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new(1_500).await;
    fs::write(fixture.root.join("block"), "owned").unwrap();
    let registry = fixture.load(true).await;
    let pending = registry.clone();
    let task = tokio::spawn(async move { pending.resolve_prompt_invocation(invocation()).await });
    fixture.wait_entered().await;
    assert!(timeout(Duration::from_secs(4), task)
        .await
        .unwrap()
        .unwrap()
        .is_err());
    fixture.wait_reaped().await;
    assert_eq!(fixture.requests("prompts/get"), 1);
    drop(registry);
    fixture.finish().await;
}

#[tokio::test]
async fn runtime_mcp_capture_retains_original_after_registry_drop() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new(1_500).await;
    fs::write(fixture.root.join("block"), "owned").unwrap();
    let registry = fixture.load(true).await;
    let capture = registry.capture_tool("mcp__docs__echo").unwrap();
    drop(registry);
    let task = tokio::spawn(async move { capture.call(json!({}), false).await });
    fixture.wait_entered().await;
    let result = timeout(Duration::from_secs(4), task)
        .await
        .unwrap()
        .unwrap();
    assert!(result.is_error);
    assert!(!result.content.to_string().contains("tool fixture"));
    fixture.wait_reaped().await;
    assert_eq!(fixture.requests("tools/call"), 1);
    fixture.finish().await;
}

#[tokio::test]
async fn runtime_mcp_denial_keeps_independent_legacy_connection_live() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let selected = Fixture::new(20_000).await;
    let protected = selected.load(true).await;
    let other = Fixture::new(20_000).await;
    let legacy = other.load(false).await;
    let effect: RuntimeEffectLeaseHandle = selected.guard.clone();
    assert!(!legacy.matches_runtime_effect(&effect));
    selected.guard.deny_now();
    selected.wait_reaped().await;
    assert!(protected
        .resolve_prompt_invocation(invocation())
        .await
        .is_err());
    assert!(legacy.resolve_prompt_invocation(invocation()).await.is_ok());
    assert_eq!(other.requests("prompts/get"), 1);
    close_shared_mcp_service(legacy.servers["docs"].current_service().await).await;
    other.wait_reaped().await;
    drop(legacy);
    drop(protected);
    other.finish().await;
    selected.finish().await;
}
