//! Fixed production launcher over the original Core plan/holds and Native
//! bootstrap. Files/identity inputs alone grant no CREATE or execution.
use super::*;
use nac_core::runtime::{
    CreateFactoryOwner, CreatePublicationCustody, NativeCreateConstruction,
    PreparationResourceCustody,
};
use std::{io::Read, os::fd::AsRawFd, sync::atomic::AtomicBool};

/// Resource-only owner captured before Core verification. Its Core view owns
/// no factory/construction/manager: the separate launch owner avoids a cycle.
#[derive(PartialEq, Eq)]
struct ExecutableIdentity {
    device: u64,
    inode: u64,
    length: u64,
    mode: u32,
    uid: u32,
    gid: u32,
    changed: (i64, i64),
    modified: (i64, i64),
}
impl ExecutableIdentity {
    fn observe(m: &std::fs::Metadata) -> Self {
        Self {
            device: m.dev(),
            inode: m.ino(),
            length: m.len(),
            mode: m.mode(),
            uid: m.uid(),
            gid: m.gid(),
            changed: (m.ctime(), m.ctime_nsec()),
            modified: (m.mtime(), m.mtime_nsec()),
        }
    }
}
pub struct NativeCreateResources {
    executable: File,
    executable_identity: ExecutableIdentity,
    executable_path: PathBuf,
    runtime: File,
    runtime_path: PathBuf,
    uid: u32,
    gid: u32,
    denied: AtomicBool,
    stop: Mutex<Option<Arc<IssuerRunnerCustody>>>,
}
impl NativeCreateResources {
    /// Explicit trusted installation inputs; no PATH/config/environment
    /// discovery or arbitrary command/program/argument/credential RPC.
    pub fn retain(executable: &Path, runtime: &Path, uid: u32, gid: u32) -> Result<Arc<Self>> {
        // SAFETY: geteuid observes the issuer's current privilege only.
        let issuer_uid = unsafe { libc::geteuid() };
        ensure!(
            issuer_uid == 0 && uid != 0 && gid != 0,
            "Native fixed launcher requires privileged issuer and nonroot target"
        );
        ensure!(
            executable.is_absolute(),
            "fixed runner executable must be absolute"
        );
        let mut executable_file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK)
            .open(executable)?;
        let executable_identity = ExecutableIdentity::observe(&executable_file.metadata()?);
        let mut magic = [0; 4];
        executable_file.read_exact(&mut magic)?;
        ensure!(
            &magic == b"\x7fELF",
            "fixed runner must be an ELF executable"
        );
        let value = Arc::new(Self {
            executable: executable_file,
            executable_identity,
            executable_path: executable.to_owned(),
            runtime: directory(runtime)?,
            runtime_path: runtime.to_owned(),
            uid,
            gid,
            denied: AtomicBool::new(false),
            stop: Mutex::new(None),
        });
        value.check_outside_store()?;
        Ok(value)
    }
    fn command(&self, data: String) -> Result<Command> {
        self.check_outside_store()?;
        // The held, no-follow ELF descriptor remains live through exec; the
        // existing NativePipe close_range marks it CLOEXEC rather than closing
        // it before the kernel resolves this procfs descriptor path.
        let mut command = Command::new(format!("/proc/self/fd/{}", self.executable.as_raw_fd()));
        command
            .env_clear()
            .env(super::super::super::issuer_child_storage::INPUT_ENV, data)
            .current_dir("/");
        let (uid, gid) = (self.uid, self.gid);
        // SAFETY: only async-signal-safe kernel operations run in the forked
        // child. No Rust allocation, environment mutation, file discovery or
        // locks run here; all saved IDs and supplementary groups are dropped.
        unsafe {
            command.pre_exec(move || {
                if libc::prctl(libc::PR_SET_KEEPCAPS, 0, 0, 0, 0) != 0
                    || libc::setgroups(0, std::ptr::null()) != 0
                    || libc::setresgid(gid, gid, gid) != 0
                    || libc::setresuid(uid, uid, uid) != 0
                    || libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0
                {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        Ok(command)
    }
    fn register(&self, owner: &Arc<IssuerRunnerCustody>) -> Result<()> {
        let mut retained = self
            .stop
            .lock()
            .map_err(|_| anyhow::anyhow!("Native resource custody poisoned"))?;
        ensure!(
            retained.is_none(),
            "Native resource launch already retained"
        );
        *retained = Some(Arc::clone(owner));
        if self.denied.load(Ordering::Acquire) {
            owner.request_stop(owner.original_cutoff());
        }
        drop(retained);
        self.check_denial()
    }
}
impl PreparationResourceCustody for NativeCreateResources {
    fn check_outside_store(&self) -> Result<()> {
        let result = (|| {
            self.check_denial()?;
            let held = self.executable.metadata()?;
            let current = fs::symlink_metadata(&self.executable_path)?;
            ensure!(
                ExecutableIdentity::observe(&held) == self.executable_identity,
                "original fixed runner contents or metadata changed"
            );
            ensure!(
                held.is_file()
                    && current.is_file()
                    && held.uid() == 0
                    && held.mode() & 0o6222 == 0
                    && held.mode() & 0o111 != 0
                    && (held.dev(), held.ino(), held.len(), held.mode())
                        == (current.dev(), current.ino(), current.len(), current.mode()),
                "original fixed runner file changed or is mutable"
            );
            ensure!(
                matches(&self.runtime, &self.runtime_path)?,
                "original Native runtime directory changed"
            );
            self.check_denial()
        })();
        if result.is_err() {
            self.deny();
        }
        result
    }
    fn check_denial(&self) -> Result<()> {
        ensure!(
            !self.denied.load(Ordering::Acquire),
            "original Native resources denied"
        );
        Ok(())
    }
    fn deny(&self) {
        self.denied.store(true, Ordering::Release);
        if let Some(owner) = self
            .stop
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref()
        {
            owner.request_stop(owner.original_cutoff());
        }
    }
}
impl Drop for NativeCreateResources {
    fn drop(&mut self) {
        self.deny();
    }
}

/// Original supervisor stores this allocation BEFORE begin/connect. Core's
/// resource view retains only NativeCreateResources, never this back-reference.
pub struct NativeCreateLaunch {
    resources: Arc<NativeCreateResources>,
    attempted: bool,
    construction: Option<NativeCreateConstruction>,
    plan: Option<ResourcePlan>,
    bootstrap: Option<RunnerBootstrap>,
    joined: Option<NativeCreateJoin>,
    failure: Option<NativeCreateFailure>,
    boot: Uuid,
}
impl NativeCreateLaunch {
    pub fn retain(resources: Arc<NativeCreateResources>) -> Self {
        Self {
            resources,
            attempted: false,
            construction: None,
            plan: None,
            bootstrap: None,
            joined: None,
            failure: None,
            boot: Uuid::new_v4(),
        }
    }
    /// Runs off the reactor; Core alone reserves the SAME host/session bank
    /// and local source. Both original holds enter issuer custody before spawn.
    pub fn begin(&mut self, factory: &Arc<CreateFactoryOwner>) -> Result<()> {
        ensure!(
            !std::mem::replace(&mut self.attempted, true),
            "Native launch already attempted"
        );
        let result = self.begin_once(factory);
        if result.is_err() {
            self.resources.deny();
        }
        result
    }
    fn begin_once(&mut self, factory: &Arc<CreateFactoryOwner>) -> Result<()> {
        self.resources.check_outside_store()?;
        let plan = ResourcePlan::from_policy(factory.policy_source()?)?;
        self.construction = Some(factory.prepare_protected_create(plan.declaration())?);
        let construction = self
            .construction
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("original construction absent"))?;
        construction.check_current()?;
        let cutoff = plan.policy_cutoff(construction.currentness().runtime_cutoff()?);
        let data = super::super::super::issuer_child_storage::RunnerInput::encode(
            &plan, self.boot, cutoff,
        )?;
        let command = self.resources.command(data)?;
        let [client, runner] = construction.take_storage()?;
        let custody = IssuerRunnerCustody::prepare(plan.clone(), client, runner, cutoff);
        // Register before the first listener or process effect. Concurrent
        // denial stops this exact allocation, including a never-started child.
        self.resources.register(&custody)?;
        self.plan = Some(plan);
        let started = RunnerBootstrap::spawn_owned(
            command,
            custody,
            &self.resources.runtime_path,
            ExecutionPeerExpectation {
                uid: self.resources.uid,
                gid: self.resources.gid,
            },
        );
        match started {
            Ok(original) => {
                self.bootstrap = Some(original);
                Ok(())
            }
            Err(failure) => {
                self.failure = Some(failure.into_create_failure());
                anyhow::bail!("original Native spawn failed; cleanup retained")
            }
        }
    }
    pub async fn connect(&mut self) -> Result<()> {
        self.resources.check_outside_store()?;
        let cutoff = self
            .construction
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("original construction absent"))?
            .currentness()
            .create_cutoff()?;
        let original = self
            .bootstrap
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("original Native bootstrap absent"))?;
        let result = tokio::time::timeout_at(cutoff.into(), original.connect(self.boot)).await;
        let result = match result {
            Ok(result) => result,
            Err(_) => {
                self.resources.deny();
                anyhow::bail!("original CREATE connection cutoff expired; cleanup retained")
            }
        };
        match result {
            Ok(connected) => {
                let construction = self
                    .construction
                    .take()
                    .ok_or_else(|| anyhow::anyhow!("original construction moved"))?;
                let plan = self
                    .plan
                    .take()
                    .ok_or_else(|| anyhow::anyhow!("original Native plan moved"))?;
                self.joined = Some(connected.retain_core_join(construction, plan));
                Ok(())
            }
            Err(failure) => {
                self.failure = Some(failure.into_create_failure());
                self.resources.deny();
                anyhow::bail!("original Native connection failed; cleanup retained")
            }
        }
    }
    pub fn try_finish(&mut self) -> Result<CreatePublicationCustody> {
        self.resources.check_outside_store()?;
        self.joined
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("original Native join absent"))?
            .try_finish()
    }
    pub async fn close_and_reap(&mut self, cutoff: Instant) -> Result<()> {
        self.resources.deny();
        let custody = self
            .resources
            .stop
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref()
            .map(Arc::clone);
        // Tighten the SAME physical child owner before the first await. Root
        // cancellation of a later join must not lose this shorter drain bound.
        if let Some(custody) = &custody {
            custody.request_stop(cutoff);
        }
        // All partial original owners are attempted, even after one failure.
        let mut first = None;
        if let Some(join) = &mut self.joined {
            if let Err(error) = join.close_and_reap().await {
                first = Some(error);
            }
        }
        if let Some(failure) = &mut self.failure {
            if let Err(error) = failure.close_and_reap(cutoff).await {
                first.get_or_insert(error);
            }
        }
        if let Some(custody) = custody {
            if let Err(error) = custody.wait_for_reap(cutoff).await {
                first.get_or_insert(error);
            }
        }
        match first {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
}
