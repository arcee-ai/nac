CREATE TABLE threads (
             name TEXT NOT NULL,
             session_id TEXT NOT NULL,
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL,
             PRIMARY KEY (name, session_id)
         );
CREATE TABLE episodes (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             thread_name TEXT NOT NULL,
             session_id TEXT NOT NULL,
             action TEXT NOT NULL,
             content TEXT NOT NULL,
             created_at TEXT NOT NULL,
             status TEXT NOT NULL DEFAULT 'ok'
                 CHECK (status IN ('ok', 'error', 'timed_out', 'cancelled')),
             FOREIGN KEY (thread_name, session_id) REFERENCES threads(name, session_id)
         );
CREATE TABLE worksets (
             id TEXT NOT NULL,
             session_id TEXT NOT NULL,
             kind TEXT NOT NULL,
             instruction TEXT NOT NULL,
             status TEXT NOT NULL,
             summary TEXT NOT NULL,
             verification_recipe TEXT,
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL,
             PRIMARY KEY (id, session_id)
         );
CREATE TABLE workset_items (
             workset_id TEXT NOT NULL,
             session_id TEXT NOT NULL,
             position INTEGER NOT NULL,
             title TEXT NOT NULL,
             thread_name TEXT NOT NULL,
             scope TEXT NOT NULL,
             description TEXT NOT NULL,
             item_kind TEXT NOT NULL,
             status TEXT NOT NULL,
             source_threads_json TEXT NOT NULL,
             last_summary TEXT,
             acceptance TEXT NOT NULL DEFAULT '',
             updated_at TEXT NOT NULL,
             PRIMARY KEY (workset_id, session_id, position),
             FOREIGN KEY (workset_id, session_id) REFERENCES worksets(id, session_id)
         );
CREATE TABLE sessions (
             session_id TEXT PRIMARY KEY,
             behavior TEXT NOT NULL DEFAULT 'orchestrator'
                 CHECK (behavior IN ('orchestrator', 'direct', 'direct-with-orchestrator')),
             permission_approval_mode TEXT NOT NULL DEFAULT 'manual'
                 CHECK (permission_approval_mode IN ('manual', 'auto_approve')),
             permission_auto_approve_generation INTEGER NOT NULL DEFAULT 0
                 CHECK (permission_auto_approve_generation >= 0),
             permission_approval_revision INTEGER NOT NULL DEFAULT 0
                 CHECK (permission_approval_revision >= 0),
             cwd TEXT NOT NULL,
             store_path TEXT NOT NULL,
             model TEXT NOT NULL,
             base_url TEXT NOT NULL,
             allow_insecure_http INTEGER NOT NULL DEFAULT 0 CHECK (allow_insecure_http IN (0, 1)),
             backend TEXT,
             reasoning_effort TEXT,
             sandbox_json TEXT,
             messages_json TEXT NOT NULL,
             visible_message_count INTEGER NOT NULL DEFAULT 0
                 CHECK (visible_message_count >= 0),
             last_user_prompt TEXT,
             last_response_duration_ms INTEGER,
             previous_response_duration_ms INTEGER,
             response_durations_ms_json TEXT,
             api_key_env TEXT,
             extra_headers_json TEXT,
             token_usages_json TEXT,
             config_version INTEGER NOT NULL DEFAULT 0 CHECK (config_version >= 0),
             run_count INTEGER NOT NULL DEFAULT 0 CHECK (run_count >= 0),
             orchestrator_compaction_threshold INTEGER
                 CHECK (orchestrator_compaction_threshold IS NULL OR
                        (typeof(orchestrator_compaction_threshold) = 'integer' AND
                         orchestrator_compaction_threshold > 0 AND
                         orchestrator_compaction_threshold <= 9007199254740991)),
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL
         , host_id TEXT, ssh_port INTEGER CHECK (ssh_port IS NULL OR (ssh_port > 0 AND ssh_port <= 65535)), ssh_identity_file TEXT, light_model_json TEXT);
CREATE TABLE session_presentations (
             session_id TEXT PRIMARY KEY
                 REFERENCES sessions(session_id) ON DELETE CASCADE,
             title TEXT,
             pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
             sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
             version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0)
         );
CREATE TABLE thread_steering (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             session_id TEXT NOT NULL
                 REFERENCES sessions(session_id) ON DELETE CASCADE,
             thread_name TEXT NOT NULL,
             dispatch_id TEXT NOT NULL CHECK (length(trim(dispatch_id)) > 0),
             instruction TEXT NOT NULL,
             status TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued', 'claimed', 'delivered', 'expired')),
             created_at TEXT NOT NULL,
             claimed_at TEXT,
             delivered_at TEXT,
             expired_at TEXT,
             CHECK (
                 (status = 'queued' AND claimed_at IS NULL
                     AND delivered_at IS NULL AND expired_at IS NULL)
                 OR (status = 'claimed' AND claimed_at IS NOT NULL
                     AND delivered_at IS NULL AND expired_at IS NULL)
                 OR (status = 'delivered' AND claimed_at IS NOT NULL
                     AND delivered_at IS NOT NULL AND expired_at IS NULL)
                 OR (status = 'expired' AND delivered_at IS NULL
                     AND expired_at IS NOT NULL)
             )
         );
CREATE TABLE thread_events (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             session_id TEXT NOT NULL
                 REFERENCES sessions(session_id) ON DELETE CASCADE,
             thread_name TEXT NOT NULL,
             event_json TEXT NOT NULL,
             created_at TEXT NOT NULL
         );
CREATE TABLE orchestrator_compaction_checkpoints (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             session_id TEXT NOT NULL
                 REFERENCES sessions(session_id) ON DELETE CASCADE,
             previous_checkpoint_id INTEGER,
             summary TEXT NOT NULL CHECK (length(trim(summary)) > 0),
             tail_start_message_index INTEGER NOT NULL
                 CHECK (tail_start_message_index >= 0),
             source_prefix_sha256 BLOB NOT NULL
                 CHECK (length(source_prefix_sha256) = 32),
             system_policy_sha256 BLOB NOT NULL
                 CHECK (length(system_policy_sha256) = 32),
             prompt_policy_version INTEGER NOT NULL
                 CHECK (prompt_policy_version > 0
                        AND prompt_policy_version <= 4294967295),
             old_context_estimate INTEGER NOT NULL
                 CHECK (old_context_estimate >= 0
                        AND old_context_estimate <= 9007199254740991),
             summary_prompt_tokens INTEGER
                 CHECK (summary_prompt_tokens IS NULL OR
                        (summary_prompt_tokens >= 0
                         AND summary_prompt_tokens <= 9007199254740991)),
             summary_completion_tokens INTEGER
                 CHECK (summary_completion_tokens IS NULL OR
                        (summary_completion_tokens >= 0
                         AND summary_completion_tokens <= 9007199254740991)),
             new_context_estimate INTEGER NOT NULL
                 CHECK (new_context_estimate >= 0
                        AND new_context_estimate <= 9007199254740991),
             created_at TEXT NOT NULL,
             UNIQUE (session_id, id),
             FOREIGN KEY (session_id, previous_checkpoint_id)
                 REFERENCES orchestrator_compaction_checkpoints(session_id, id)
                 ON DELETE CASCADE
         );
CREATE TABLE workspace_revisions (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             session_id TEXT NOT NULL
                 REFERENCES sessions(session_id) ON DELETE CASCADE,
             run_id TEXT NOT NULL,
             commit_sha TEXT NOT NULL CHECK (length(trim(commit_sha)) > 0),
             base_sha TEXT,
             branch TEXT,
             label TEXT NOT NULL,
             additions INTEGER NOT NULL DEFAULT 0 CHECK (additions >= 0),
             deletions INTEGER NOT NULL DEFAULT 0 CHECK (deletions >= 0),
             changed_files INTEGER NOT NULL DEFAULT 0 CHECK (changed_files >= 0),
             created_at TEXT NOT NULL,
             transcript_len INTEGER CHECK (transcript_len IS NULL OR transcript_len >= 0),
             UNIQUE (session_id, run_id)
         );
CREATE TABLE model_configurations (
             config_id TEXT PRIMARY KEY,
             name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
             backend TEXT NOT NULL CHECK (length(trim(backend)) > 0),
             model TEXT NOT NULL CHECK (length(trim(model)) > 0),
             base_url TEXT NOT NULL CHECK (length(trim(base_url)) > 0),
             allow_insecure_http INTEGER NOT NULL DEFAULT 0 CHECK (allow_insecure_http IN (0, 1)),
             api_key_env TEXT,
             reasoning_effort TEXT,
             extra_headers_json TEXT NOT NULL DEFAULT '{}',
             orchestrator_compaction_threshold INTEGER CHECK (orchestrator_compaction_threshold IS NULL OR (typeof(orchestrator_compaction_threshold) = 'integer' AND orchestrator_compaction_threshold > 0 AND orchestrator_compaction_threshold <= 9007199254740991)),
             initial_prompt TEXT,
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL
         , light_model_json TEXT);
CREATE TABLE projects (
             project_id TEXT PRIMARY KEY,
             name TEXT NOT NULL CHECK (length(trim(name)) > 0),
             description TEXT,
             cwd TEXT NOT NULL CHECK (length(trim(cwd)) > 0),
             ssh_host TEXT,
             ssh_port INTEGER CHECK (ssh_port IS NULL OR (ssh_port > 0 AND ssh_port <= 65535)),
             ssh_identity_file TEXT,
             default_model_config_id TEXT
                 REFERENCES model_configurations(config_id) ON DELETE RESTRICT,
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)), sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0), presentation_version INTEGER NOT NULL DEFAULT 0 CHECK (presentation_version >= 0),
             CHECK (
                 (ssh_host IS NULL AND ssh_port IS NULL AND ssh_identity_file IS NULL)
                 OR (ssh_host IS NOT NULL AND length(trim(ssh_host)) > 0)
             )
         );
CREATE TABLE session_projects (
             session_id TEXT PRIMARY KEY
                 REFERENCES sessions(session_id) ON DELETE CASCADE,
             project_id TEXT NOT NULL
                 REFERENCES projects(project_id) ON DELETE RESTRICT
         );
CREATE TABLE ssh_configurations (
             config_id TEXT PRIMARY KEY,
             name TEXT NOT NULL UNIQUE,
             ssh_host TEXT NOT NULL,
             ssh_port INTEGER CHECK (ssh_port IS NULL OR (ssh_port > 0 AND ssh_port <= 65535)),
             ssh_identity_file TEXT,
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL
         );
CREATE TABLE session_run_recovery (
             session_id TEXT PRIMARY KEY
                 REFERENCES sessions(session_id) ON DELETE CASCADE,
             run_id TEXT NOT NULL CHECK (length(trim(run_id)) > 0),
             submitted_message_id INTEGER NOT NULL
                 REFERENCES thread_events(id) ON DELETE CASCADE,
             status TEXT NOT NULL CHECK (status IN ('active', 'interrupted', 'failed')),
             terminal_disposition TEXT
                 CHECK (terminal_disposition IN ('completed', 'cancelled')),
             failure_json TEXT
         );
CREATE TABLE session_inbox (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             session_id TEXT NOT NULL
                 REFERENCES sessions(session_id) ON DELETE CASCADE,
             delivery TEXT NOT NULL CHECK (delivery IN ('steer', 'queue')),
             status TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'delivered', 'cancelled')),
             content TEXT NOT NULL CHECK (length(trim(content)) > 0),
             target_run_id TEXT,
             client_id TEXT,
             delivered_run_id TEXT,
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL,
             delivered_at TEXT,
             cancelled_at TEXT,
             version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
             CHECK (delivery = 'steer' OR target_run_id IS NULL),
             CHECK (
                 (status = 'pending' AND delivered_run_id IS NULL AND delivered_at IS NULL AND cancelled_at IS NULL)
                 OR (status = 'delivered' AND delivered_run_id IS NOT NULL AND delivered_at IS NOT NULL AND cancelled_at IS NULL)
                 OR (status = 'cancelled' AND delivered_run_id IS NULL AND delivered_at IS NULL AND cancelled_at IS NOT NULL)
             )
         );
CREATE TABLE permission_grants (
             id TEXT PRIMARY KEY,
             session_id TEXT NOT NULL
                 REFERENCES sessions(session_id) ON DELETE CASCADE,
             action TEXT NOT NULL CHECK (length(trim(action)) > 0),
             resource TEXT NOT NULL CHECK (length(trim(resource)) > 0),
             backend TEXT NOT NULL CHECK (backend IN ('local', 'podman', 'ssh')),
             session_config_version INTEGER NOT NULL
                 CHECK (session_config_version >= 0),
             created_at TEXT NOT NULL,
             UNIQUE (session_id, action, resource, backend, session_config_version)
         );
CREATE TABLE session_goals (
             session_id TEXT PRIMARY KEY
                 REFERENCES sessions(session_id) ON DELETE CASCADE,
             goal_id TEXT NOT NULL UNIQUE CHECK (length(trim(goal_id)) > 0),
             objective TEXT NOT NULL CHECK (length(trim(objective)) > 0),
             status TEXT NOT NULL
                 CHECK (status IN ('active', 'paused', 'blocked', 'usage_limited', 'budget_limited', 'complete')),
             token_budget INTEGER
                 CHECK (token_budget IS NULL OR token_budget > 0),
             tokens_used INTEGER NOT NULL DEFAULT 0 CHECK (tokens_used >= 0),
             time_used_ms INTEGER NOT NULL DEFAULT 0 CHECK (time_used_ms >= 0),
             accounting_run_id TEXT,
             accounting_token_baseline INTEGER
                 CHECK (accounting_token_baseline IS NULL OR accounting_token_baseline >= 0),
             accounting_started_at_epoch_ms INTEGER
                 CHECK (accounting_started_at_epoch_ms IS NULL OR accounting_started_at_epoch_ms >= 0),
             continuation_run_id TEXT,
             consecutive_transient_failures INTEGER NOT NULL DEFAULT 0
                 CHECK (consecutive_transient_failures >= 0),
             next_attempt_at_epoch_ms INTEGER
                 CHECK (next_attempt_at_epoch_ms IS NULL OR next_attempt_at_epoch_ms >= 0),
             last_failure_json TEXT,
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL,
             version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
             CHECK (
                 (accounting_run_id IS NULL AND accounting_token_baseline IS NULL
                  AND accounting_started_at_epoch_ms IS NULL AND continuation_run_id IS NULL)
                 OR
                 (accounting_run_id IS NOT NULL AND accounting_token_baseline IS NOT NULL
                  AND accounting_started_at_epoch_ms IS NOT NULL
                  AND (continuation_run_id IS NULL OR continuation_run_id = accounting_run_id))
             )
         );
CREATE TABLE traditional_children (
             child_session_id TEXT PRIMARY KEY
                 REFERENCES sessions(session_id) ON DELETE CASCADE,
             parent_session_id TEXT NOT NULL
                 REFERENCES sessions(session_id) ON DELETE CASCADE,
             root_session_id TEXT NOT NULL
                 REFERENCES sessions(session_id) ON DELETE CASCADE,
             profile TEXT NOT NULL CHECK (profile IN ('general')),
             description TEXT NOT NULL CHECK (
                 length(trim(description)) > 0 AND length(description) <= 120
             ),
             nesting_depth INTEGER NOT NULL CHECK (nesting_depth = 1),
             status TEXT NOT NULL DEFAULT 'idle'
                 CHECK (status IN ('idle', 'running', 'completed', 'failed', 'cancelled', 'interrupted')),
             generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
             run_id TEXT,
             execution_mode TEXT CHECK (execution_mode IN ('foreground', 'background')),
             report TEXT,
             failure TEXT,
             change_summary TEXT,
             verification_summary TEXT,
             completion_inbox_id INTEGER
                 REFERENCES session_inbox(id) ON DELETE SET NULL,
             completion_suppressed INTEGER NOT NULL DEFAULT 0
                 CHECK (completion_suppressed IN (0, 1)),
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL,
             version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
             CHECK (child_session_id <> parent_session_id),
             CHECK (
                 (status = 'idle' AND generation = 0 AND run_id IS NULL
                  AND execution_mode IS NULL AND report IS NULL AND failure IS NULL
                  AND change_summary IS NULL AND verification_summary IS NULL
                  AND completion_inbox_id IS NULL)
                 OR
                 (status = 'running' AND generation > 0 AND run_id IS NOT NULL
                  AND execution_mode IS NOT NULL AND report IS NULL AND failure IS NULL
                  AND change_summary IS NULL AND verification_summary IS NULL
                  AND completion_inbox_id IS NULL)
                 OR
                 (status IN ('completed', 'failed', 'cancelled', 'interrupted')
                  AND generation > 0 AND run_id IS NOT NULL
                  AND execution_mode IS NOT NULL)
             )
         );
CREATE TABLE managed_orchestrators (
             orchestrator_session_id TEXT PRIMARY KEY
                 REFERENCES sessions(session_id) ON DELETE CASCADE,
             parent_session_id TEXT NOT NULL
                 REFERENCES sessions(session_id) ON DELETE CASCADE,
             root_session_id TEXT NOT NULL
                 REFERENCES sessions(session_id) ON DELETE CASCADE,
             description TEXT NOT NULL CHECK (
                 length(trim(description)) > 0 AND length(description) <= 120
             ),
             status TEXT NOT NULL DEFAULT 'idle'
                 CHECK (status IN ('idle', 'running', 'completed', 'failed', 'cancelled', 'interrupted')),
             generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
             run_id TEXT,
             execution_mode TEXT CHECK (execution_mode IN ('foreground', 'background')),
             report TEXT,
             failure TEXT,
             completion_inbox_id INTEGER
                 REFERENCES session_inbox(id) ON DELETE SET NULL,
             completion_suppressed INTEGER NOT NULL DEFAULT 0
                 CHECK (completion_suppressed IN (0, 1)),
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL,
             version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
             CHECK (orchestrator_session_id <> parent_session_id),
             CHECK (
                 (status = 'idle' AND generation = 0 AND run_id IS NULL
                  AND execution_mode IS NULL AND report IS NULL AND failure IS NULL
                  AND completion_inbox_id IS NULL)
                 OR
                 (status = 'running' AND generation > 0 AND run_id IS NOT NULL
                  AND execution_mode IS NOT NULL AND report IS NULL AND failure IS NULL
                  AND completion_inbox_id IS NULL)
                 OR
                 (status IN ('completed', 'failed', 'cancelled', 'interrupted')
                  AND generation > 0 AND run_id IS NOT NULL
                  AND execution_mode IS NOT NULL)
             )
         );
CREATE TABLE session_forks (
             source_session_id TEXT NOT NULL,
             fork_session_id TEXT NOT NULL,
             source_message_idx INTEGER NOT NULL
                 CHECK (source_message_idx >= 0),
             created_at TEXT NOT NULL,
             source_title TEXT,
             PRIMARY KEY (source_session_id, fork_session_id)
         );
CREATE TABLE managed_host_maintenance (
             singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
             state TEXT NOT NULL CHECK (state IN ('serving', 'maintenance')),
             operation_id TEXT,
             target_json TEXT,
             accepted_identity_json TEXT,
             prepared_at TEXT,
             version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
             CHECK (
                 (state = 'serving' AND operation_id IS NULL AND target_json IS NULL AND prepared_at IS NULL)
                 OR
                 (state = 'maintenance' AND operation_id IS NOT NULL AND target_json IS NOT NULL AND prepared_at IS NOT NULL)
             )
         );
CREATE TABLE managed_control_operations (
             operation_id TEXT PRIMARY KEY,
             binding_json TEXT NOT NULL,
             latest_outcome_json TEXT NOT NULL,
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL,
             version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0)
         );
CREATE TABLE managed_control_attempts (
             jti TEXT PRIMARY KEY,
             operation_id TEXT NOT NULL,
             binding_json TEXT NOT NULL,
             outcome_json TEXT,
             expires_at INTEGER NOT NULL,
             created_at TEXT NOT NULL,
             FOREIGN KEY (operation_id) REFERENCES managed_control_operations(operation_id)
                 ON DELETE RESTRICT
         );
CREATE TABLE terminal_remote_cleanups (
             session_id TEXT NOT NULL,
             pidfile TEXT NOT NULL,
             created_at TEXT NOT NULL,
             PRIMARY KEY (session_id, pidfile),
             FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE RESTRICT
         );
CREATE INDEX idx_episodes_thread_session_created
             ON episodes(thread_name, session_id, id);
CREATE INDEX idx_worksets_session_updated
             ON worksets(session_id, updated_at DESC);
CREATE INDEX idx_workset_items_workset_position
             ON workset_items(workset_id, session_id, position);
CREATE INDEX idx_sessions_updated_at
             ON sessions(updated_at DESC);
CREATE INDEX idx_thread_steering_target_pending
             ON thread_steering(session_id, dispatch_id, status, id);
CREATE INDEX idx_thread_steering_session_thread
             ON thread_steering(session_id, thread_name, id);
CREATE INDEX idx_thread_events_session_thread_id
             ON thread_events(session_id, thread_name, id DESC);
CREATE INDEX idx_orchestrator_compaction_checkpoints_latest
             ON orchestrator_compaction_checkpoints(session_id, id DESC);
CREATE INDEX idx_workspace_revisions_session
             ON workspace_revisions(session_id, id DESC);
CREATE INDEX idx_model_configurations_name
             ON model_configurations(name);
CREATE UNIQUE INDEX idx_projects_location
             ON projects (
                 cwd,
                 COALESCE(ssh_host, ''),
                 COALESCE(ssh_port, 0),
                 COALESCE(ssh_identity_file, '')
             );
CREATE INDEX idx_projects_default_model_config
             ON projects(default_model_config_id)
             WHERE default_model_config_id IS NOT NULL;
CREATE INDEX idx_session_projects_project
             ON session_projects(project_id, session_id);
CREATE INDEX idx_ssh_configurations_name ON ssh_configurations(name);
CREATE INDEX idx_session_inbox_pending
             ON session_inbox(session_id, status, id);
CREATE INDEX idx_session_inbox_target
             ON session_inbox(session_id, target_run_id, status, id);
CREATE INDEX idx_permission_grants_session
             ON permission_grants(session_id, backend, session_config_version, created_at, id);
CREATE INDEX idx_session_goals_status
             ON session_goals(status, updated_at, session_id);
CREATE INDEX idx_traditional_children_parent
             ON traditional_children(parent_session_id, created_at, child_session_id);
CREATE INDEX idx_traditional_children_root_running
             ON traditional_children(root_session_id, status, updated_at, child_session_id);
CREATE INDEX idx_managed_orchestrators_parent
             ON managed_orchestrators(parent_session_id, created_at, orchestrator_session_id);
CREATE INDEX idx_managed_orchestrators_root_running
             ON managed_orchestrators(root_session_id, status, updated_at, orchestrator_session_id);
CREATE INDEX idx_session_forks_source
             ON session_forks(source_session_id, source_message_idx);
CREATE UNIQUE INDEX idx_session_forks_fork
             ON session_forks(fork_session_id);
CREATE INDEX idx_managed_control_attempts_operation
             ON managed_control_attempts(operation_id);
PRAGMA user_version=29;
