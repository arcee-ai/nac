use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Which queue a task is in.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum QueueType {
    Implementation,
    Verification,
    Merge,
}

/// Status of a task within its queue.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Queued,
    InProgress,
    Completed,
    Failed,
}

/// A single task in the pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub description: String,
    pub queue: QueueType,
    pub status: TaskStatus,
    pub nac_session_id: Option<String>,
    pub worktree_path: Option<String>,
    pub branch_name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub result: Option<String>,
    pub failure_reason: Option<String>,
    pub retry_count: u32,
    pub failure_notes: Option<String>,
}

impl Task {
    pub fn new(title: String, description: String, queue: QueueType) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            title,
            description,
            queue,
            status: TaskStatus::Queued,
            nac_session_id: None,
            worktree_path: None,
            branch_name: None,
            created_at: now,
            updated_at: now,
            result: None,
            failure_reason: None,
            retry_count: 0,
            failure_notes: None,
        }
    }
}

/// Overall pipeline status.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PipelineStatus {
    #[default]
    Idle,
    Planning,
    Running,
    Completed,
    Failed,
    Stopping,
}

/// What the planner returns.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum PlannerResult {
    Complete {
        summary: String,
    },
    Incomplete {
        tasks: Vec<PlannerTask>,
    },
}

/// A task as output by the planner.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlannerTask {
    pub title: String,
    pub description: String,
}

/// State change event for SSE to frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StateEvent {
    PipelineStarted {
        goal: String,
        cwd: String,
        concurrent_agents: usize,
    },
    PlannerStarted {
        session_id: String,
    },
    PlannerCompleted {
        result: PlannerResult,
    },
    PlannerFailed {
        message: String,
    },
    TaskAdded {
        task: Task,
    },
    TaskStarted {
        task_id: String,
        session_id: String,
        queue: QueueType,
    },
    TaskCompleted {
        task_id: String,
        queue: QueueType,
        result: String,
    },
    TaskFailed {
        task_id: String,
        queue: QueueType,
        reason: String,
    },
    TaskMoved {
        task_id: String,
        from_queue: QueueType,
        to_queue: QueueType,
    },
    MergeStarted {
        task_id: String,
        session_id: String,
    },
    MergeCompleted {
        task_id: String,
    },
    MergeFailed {
        task_id: String,
        reason: String,
    },
    PipelineCompleted {
        summary: String,
    },
    PipelineFailed {
        message: String,
    },
    PipelineStopped,
}