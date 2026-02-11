/** Built-in statuses. Custom statuses are also allowed (configured via `bd config`). */
export type Status =
  | "open"
  | "in_progress"
  | "blocked"
  | "closed"
  | "resolved"
  | "deferred"
  | (string & {})

/** P0 = critical, P4 = trivial. */
export type Priority = 0 | 1 | 2 | 3 | 4

/** Built-in issue types. Custom types are also allowed. */
export type IssueType = "task" | "bug" | "feature" | "epic" | "chore" | (string & {})

/** Dependency relationship type. */
export type DepType = "blocks" | "parent-child" | "related" | "discovered-from"

/** An issue from the beads database. */
export interface Issue {
  id: string
  title: string
  description: string
  status: Status
  priority: Priority
  issue_type: IssueType
  assignee?: string
  labels: string[]
  created_at: string
  updated_at: string
  closed_at?: string
  design?: string
  acceptance_criteria?: string
  notes?: string
  external_ref?: string
  dependency_count: number
  dependent_count: number
  dependencies: LinkedIssue[]
  dependents: LinkedIssue[]
}

/** A linked issue (dependency or dependent) with relationship metadata. */
export interface LinkedIssue {
  id: string
  title: string
  description: string
  status: Status
  priority: Priority
  issue_type: IssueType
  assignee?: string
  labels: string[]
  created_at: string
  updated_at: string
  closed_at?: string
  dependency_type?: DepType
  dependency_count: number
  dependent_count: number
}

/** A blocked issue, including what blocks it. */
export interface BlockedIssue extends Issue {
  blocked_by: string[]
  blocked_by_count: number
}

/** Summary statistics for the issue database. */
export interface StatsSummary {
  total_issues: number
  open_issues: number
  in_progress_issues: number
  closed_issues: number
  blocked_issues: number
  deferred_issues: number
  ready_issues: number
  average_lead_time_hours: number
}

/** Recent activity window. */
export interface RecentActivity {
  hours_tracked: number
  commit_count: number
  issues_created: number
  issues_closed: number
  issues_updated: number
  issues_reopened: number
  total_changes: number
}

/** Stats response from the daemon. */
export interface Stats {
  summary: StatsSummary
  recent_activity?: RecentActivity
}

/** Health status from the daemon. */
export interface HealthStatus {
  status: string
  version: string
  uptime: number
  db_response_time_ms: number
  active_connections: number
  memory_bytes: number
}

/** Filter for list operations. */
export interface ListFilter {
  status?: Status
  priority?: Priority
  issue_type?: IssueType
  assignee?: string
  labels?: string[]
  labels_any?: string[]
  query?: string
  unassigned?: boolean
  limit?: number
}

/** Filter for ready operations. */
export interface ReadyFilter {
  assignee?: string
  priority?: Priority
  labels?: string[]
  labels_any?: string[]
  unassigned?: boolean
  sort_policy?: "hybrid" | "priority" | "oldest"
  limit?: number
  parent_id?: string
}

/** Filter for blocked operations. */
export interface BlockedFilter {
  parent_id?: string
}

/** Input for creating issues. */
export interface CreateInput {
  title: string
  description?: string
  design?: string
  acceptance_criteria?: string
  priority?: Priority
  issue_type?: IssueType
  assignee?: string
  labels?: string[]
  dependencies?: string[]
  id?: string
}

/** Input for updating issues. */
export interface UpdateInput {
  title?: string
  description?: string
  design?: string
  acceptance_criteria?: string
  notes?: string
  status?: Status
  priority?: Priority
  assignee?: string
}

/** Transport abstraction for communicating with the beads daemon or JSONL store. */
export interface Transport {
  /** Send an operation and return the result. */
  send(
    /** Operation name (e.g. "list", "show", "create") */
    operation: string,
    /** Operation arguments */
    args: Record<string, unknown>,
  ): Promise<unknown>

  /** Clean up resources. */
  close(): void
}

/** Raw dependency record from JSONL file. */
export interface RawJsonlDependency {
  issue_id: string
  depends_on_id: string
  type: string
  created_at: string
  created_by?: string
}

/** Raw issue record from JSONL file (before conversion to Issue). */
export interface RawJsonlIssue {
  id: string
  title: string
  description?: string
  status: string
  priority: number
  issue_type: string
  assignee?: string
  labels?: string[]
  created_at: string
  updated_at: string
  closed_at?: string
  design?: string
  acceptance_criteria?: string
  notes?: string
  external_ref?: string
  estimated_minutes?: number
  due_at?: string
  defer_until?: string
  owner?: string
  metadata?: Record<string, unknown>
  dependencies?: RawJsonlDependency[]
  dependency_count?: number
  dependent_count?: number
}
