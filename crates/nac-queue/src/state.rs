use std::collections::HashMap;
use std::sync::Arc;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, RwLock};

use super::types::{
    PlannerResult, PlannerTask, PipelineStatus, QueueType, StateEvent, Task, TaskStatus,
};

/// The full state of the pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineState {
    pub goal: String,
    pub cwd: String,
    pub concurrent_agents: usize,
    pub status: PipelineStatus,
    pub planner_session_id: Option<String>,
    pub planner_iteration: u32,
    pub max_iterations: u32,
    pub impl_queue: Vec<Task>,
    pub verify_queue: Vec<Task>,
    pub merge_queue: Vec<Task>,
    pub all_tasks: HashMap<String, Task>,
    pub active_impl_count: usize,
    pub merge_in_progress: bool,
    pub last_planner_result: Option<PlannerResult>,
}

impl Default for PipelineState {
    fn default() -> Self {
        Self {
            goal: String::new(),
            cwd: String::new(),
            concurrent_agents: 1,
            status: PipelineStatus::default(),
            planner_session_id: None,
            planner_iteration: 0,
            max_iterations: 10,
            impl_queue: Vec::new(),
            verify_queue: Vec::new(),
            merge_queue: Vec::new(),
            all_tasks: HashMap::new(),
            active_impl_count: 0,
            merge_in_progress: false,
            last_planner_result: None,
        }
    }
}

/// Handle to shared pipeline state with broadcast event channel.
#[derive(Clone)]
pub struct PipelineStateHandle {
    state: Arc<RwLock<PipelineState>>,
    event_tx: broadcast::Sender<StateEvent>,
}

impl PipelineStateHandle {
    /// Create a new handle with empty/idle state and a broadcast channel (capacity 256).
    pub fn new() -> Self {
        let (event_tx, _) = broadcast::channel::<StateEvent>(256);
        Self {
            state: Arc::new(RwLock::new(PipelineState::default())),
            event_tx,
        }
    }

    /// Subscribe to state change events.
    pub fn subscribe(&self) -> broadcast::Receiver<StateEvent> {
        self.event_tx.subscribe()
    }

    /// Emit an event through the broadcast channel.
    /// Errors (no receivers) are silently ignored.
    fn emit(&self, event: StateEvent) {
        let _ = self.event_tx.send(event);
    }

    /// Start the pipeline: set status to Planning and emit PipelineStarted.
    pub async fn start(&self, goal: String, cwd: String, concurrent_agents: usize) {
        {
            let mut s = self.state.write().await;
            s.goal = goal.clone();
            s.cwd = cwd.clone();
            s.concurrent_agents = concurrent_agents;
            s.status = PipelineStatus::Planning;
            s.planner_iteration = 0;
            s.impl_queue.clear();
            s.verify_queue.clear();
            s.merge_queue.clear();
            s.all_tasks.clear();
            s.active_impl_count = 0;
            s.merge_in_progress = false;
            s.last_planner_result = None;
        }
        self.emit(StateEvent::PipelineStarted {
            goal,
            cwd,
            concurrent_agents,
        });
    }

    /// Get a snapshot of the current pipeline state.
    pub async fn get_snapshot(&self) -> PipelineState {
        self.state.read().await.clone()
    }

    /// Add planner tasks to the implementation queue.
    pub async fn add_tasks(&self, tasks: Vec<PlannerTask>) {
        for pt in tasks {
            let task = Task::new(pt.title, pt.description, QueueType::Implementation);
            let event = StateEvent::TaskAdded { task: task.clone() };
            {
                let mut s = self.state.write().await;
                s.impl_queue.push(task.clone());
                s.all_tasks.insert(task.id.clone(), task);
            }
            self.emit(event);
        }
    }

    /// Pop the next queued implementation task, mark it InProgress, and return it.
    pub async fn pop_next_impl_task(&self) -> Option<Task> {
        let mut s = self.state.write().await;
        let idx = s
            .impl_queue
            .iter()
            .position(|t| t.status == TaskStatus::Queued)?;
        let now = Utc::now();
        s.impl_queue[idx].status = TaskStatus::InProgress;
        s.impl_queue[idx].updated_at = now;
        let task = s.impl_queue[idx].clone();
        s.all_tasks.insert(task.id.clone(), task.clone());
        s.active_impl_count += 1;
        Some(task)
    }

    /// Pop the next queued verification task, mark it InProgress, and return it.
    pub async fn pop_next_verify_task(&self) -> Option<Task> {
        let mut s = self.state.write().await;
        let idx = s
            .verify_queue
            .iter()
            .position(|t| t.status == TaskStatus::Queued)?;
        let now = Utc::now();
        s.verify_queue[idx].status = TaskStatus::InProgress;
        s.verify_queue[idx].updated_at = now;
        let task = s.verify_queue[idx].clone();
        s.all_tasks.insert(task.id.clone(), task.clone());
        Some(task)
    }

    /// Pop the next queued merge task, mark it InProgress, set merge_in_progress, and return it.
    pub async fn pop_next_merge_task(&self) -> Option<Task> {
        let mut s = self.state.write().await;
        let idx = s
            .merge_queue
            .iter()
            .position(|t| t.status == TaskStatus::Queued)?;
        let now = Utc::now();
        s.merge_queue[idx].status = TaskStatus::InProgress;
        s.merge_queue[idx].updated_at = now;
        s.merge_in_progress = true;
        let task = s.merge_queue[idx].clone();
        s.all_tasks.insert(task.id.clone(), task.clone());
        Some(task)
    }

    /// Mark a task completed and move it to the next queue (impl→verify, verify→merge).
    pub async fn complete_task(&self, task_id: &str, result: &str) {
        let (completed_event, moved_event) = {
            let mut s = self.state.write().await;
            let now = Utc::now();

            // Find the task in all_tasks to determine its queue.
            let task = match s.all_tasks.get_mut(task_id) {
                Some(t) => t,
                None => return,
            };
            let from_queue = task.queue.clone();
            task.status = TaskStatus::Completed;
            task.result = Some(result.to_string());
            task.updated_at = now;

            let to_queue = match from_queue {
                QueueType::Implementation => QueueType::Verification,
                QueueType::Verification => QueueType::Merge,
                QueueType::Merge => {
                    // Merge completion is handled by set_merge_completed.
                    let completed = StateEvent::TaskCompleted {
                        task_id: task_id.to_string(),
                        queue: from_queue.clone(),
                        result: result.to_string(),
                    };
                    return self.emit(completed);
                }
            };

            // Update the task's queue for the moved copy.
            task.queue = to_queue.clone();
            task.status = TaskStatus::Queued;
            let moved_task = task.clone();

            // Remove from source queue, add to destination queue.
            match &from_queue {
                QueueType::Implementation => {
                    s.impl_queue.retain(|t| t.id != task_id);
                    s.active_impl_count = s
                        .impl_queue
                        .iter()
                        .filter(|t| t.status == TaskStatus::InProgress)
                        .count();
                }
                QueueType::Verification => {
                    s.verify_queue.retain(|t| t.id != task_id);
                }
                QueueType::Merge => {
                    s.merge_queue.retain(|t| t.id != task_id);
                }
            }
            match &to_queue {
                QueueType::Implementation => s.impl_queue.push(moved_task),
                QueueType::Verification => s.verify_queue.push(moved_task),
                QueueType::Merge => s.merge_queue.push(moved_task),
            }

            let completed = StateEvent::TaskCompleted {
                task_id: task_id.to_string(),
                queue: from_queue.clone(),
                result: result.to_string(),
            };
            let moved = StateEvent::TaskMoved {
                task_id: task_id.to_string(),
                from_queue,
                to_queue,
            };
            (completed, moved)
        };
        self.emit(completed_event);
        self.emit(moved_event);
    }

    /// Mark a task failed. If it was in verification, send it back to impl with failure_notes.
    pub async fn fail_task(&self, task_id: &str, reason: &str) {
        let event = {
            let mut s = self.state.write().await;
            let now = Utc::now();
            let task = match s.all_tasks.get_mut(task_id) {
                Some(t) => t,
                None => return,
            };
            let queue = task.queue.clone();
            task.status = TaskStatus::Failed;
            task.failure_reason = Some(reason.to_string());
            task.updated_at = now;

            // If the task was in verification, send it back to impl.
            if queue == QueueType::Verification {
                task.queue = QueueType::Implementation;
                task.status = TaskStatus::Queued;
                task.retry_count += 1;
                task.failure_notes = Some(reason.to_string());
                task.failure_reason = None;
                task.nac_session_id = None;
                let moved_task = task.clone();

                s.verify_queue.retain(|t| t.id != task_id);
                s.impl_queue.push(moved_task);
            } else if queue == QueueType::Implementation {
                s.active_impl_count = s
                    .impl_queue
                    .iter()
                    .filter(|t| t.status == TaskStatus::InProgress)
                    .count();
            }

            StateEvent::TaskFailed {
                task_id: task_id.to_string(),
                queue,
                reason: reason.to_string(),
            }
        };
        self.emit(event);
    }

    /// Set the planner session ID, increment the iteration counter, and emit PlannerStarted.
    pub async fn set_planner_session(&self, session_id: String) {
        {
            let mut s = self.state.write().await;
            s.planner_session_id = Some(session_id.clone());
            s.planner_iteration += 1;
        }
        self.emit(StateEvent::PlannerStarted { session_id });
    }

    /// Update a task's session/worktree metadata and emit TaskStarted.
    ///
    /// Called after a nac session has been created for a task. Updates
    /// `nac_session_id` and optionally `worktree_path` / `branch_name`
    /// (pass `None` to leave them unchanged).
    pub async fn set_task_started(
        &self,
        task_id: &str,
        session_id: &str,
        worktree_path: Option<&str>,
        branch_name: Option<&str>,
    ) {
        let queue = {
            let mut s = self.state.write().await;
            let task = match s.all_tasks.get_mut(task_id) {
                Some(t) => t,
                None => return,
            };
            task.nac_session_id = Some(session_id.to_string());
            if let Some(wt) = worktree_path {
                task.worktree_path = Some(wt.to_string());
            }
            if let Some(br) = branch_name {
                task.branch_name = Some(br.to_string());
            }
            task.updated_at = Utc::now();
            task.queue.clone()
        };
        self.emit(StateEvent::TaskStarted {
            task_id: task_id.to_string(),
            session_id: session_id.to_string(),
            queue,
        });
    }

    /// Set the planner result and emit PlannerCompleted.
    pub async fn set_planner_result(&self, result: PlannerResult) {
        {
            let mut s = self.state.write().await;
            s.last_planner_result = Some(result.clone());
            s.status = PipelineStatus::Running;
        }
        self.emit(StateEvent::PlannerCompleted { result });
    }

    /// Emit PlannerFailed.
    pub async fn set_planner_failed(&self, message: String) {
        self.emit(StateEvent::PlannerFailed { message });
    }

    /// Emit MergeStarted.
    pub async fn set_merge_started(&self, task_id: String, session_id: String) {
        self.emit(StateEvent::MergeStarted { task_id, session_id });
    }

    /// Mark merge done, set merge_in_progress=false, emit MergeCompleted.
    pub async fn set_merge_completed(&self, task_id: &str) {
        {
            let mut s = self.state.write().await;
            let now = Utc::now();
            if let Some(task) = s.all_tasks.get_mut(task_id) {
                task.status = TaskStatus::Completed;
                task.updated_at = now;
            }
            s.merge_queue.retain(|t| t.id != task_id);
            s.merge_in_progress = false;
        }
        self.emit(StateEvent::MergeCompleted {
            task_id: task_id.to_string(),
        });
    }

    /// Set merge_in_progress=false and emit MergeFailed.
    pub async fn set_merge_failed(&self, task_id: &str, reason: &str) {
        {
            let mut s = self.state.write().await;
            s.merge_in_progress = false;
            if let Some(task) = s.all_tasks.get_mut(task_id) {
                task.status = TaskStatus::Failed;
                task.failure_reason = Some(reason.to_string());
                task.updated_at = Utc::now();
            }
        }
        self.emit(StateEvent::MergeFailed {
            task_id: task_id.to_string(),
            reason: reason.to_string(),
        });
    }

    /// Set status to Completed and emit PipelineCompleted.
    pub async fn complete_pipeline(&self, summary: String) {
        {
            let mut s = self.state.write().await;
            s.status = PipelineStatus::Completed;
        }
        self.emit(StateEvent::PipelineCompleted { summary });
    }

    /// Set status to Failed and emit PipelineFailed.
    pub async fn fail_pipeline(&self, message: String) {
        {
            let mut s = self.state.write().await;
            s.status = PipelineStatus::Failed;
        }
        self.emit(StateEvent::PipelineFailed { message });
    }

    /// Set status to Stopping and emit PipelineStopped.
    pub async fn stop(&self) {
        {
            let mut s = self.state.write().await;
            s.status = PipelineStatus::Stopping;
        }
        self.emit(StateEvent::PipelineStopped);
    }

    /// Count InProgress tasks in the implementation queue.
    pub async fn active_impl_count(&self) -> usize {
        let s = self.state.read().await;
        s.impl_queue
            .iter()
            .filter(|t| t.status == TaskStatus::InProgress)
            .count()
    }

    /// Are there any Queued tasks in the implementation queue?
    pub async fn has_impl_tasks(&self) -> bool {
        let s = self.state.read().await;
        s.impl_queue.iter().any(|t| t.status == TaskStatus::Queued)
    }

    /// Are there any Queued tasks in the verification queue?
    pub async fn has_verify_tasks(&self) -> bool {
        let s = self.state.read().await;
        s.verify_queue
            .iter()
            .any(|t| t.status == TaskStatus::Queued)
    }

    /// Are there any Queued tasks in the merge queue?
    pub async fn has_merge_tasks(&self) -> bool {
        let s = self.state.read().await;
        s.merge_queue
            .iter()
            .any(|t| t.status == TaskStatus::Queued)
    }

    /// Can a merge be started? (has queued merge tasks AND no merge in progress)
    pub async fn can_start_merge(&self) -> bool {
        let s = self.state.read().await;
        !s.merge_in_progress
            && s.merge_queue.iter().any(|t| t.status == TaskStatus::Queued)
    }
}

impl Default for PipelineStateHandle {
    fn default() -> Self {
        Self::new()
    }
}