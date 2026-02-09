/**  Status of an issue. */
export type IssueStatus = "open" | "in_progress" | "blocked" | "deferred" | "closed"

/**  An issue from the beads database. */
export interface BdIssue {
  id: string
  title: string
  description?: string
  status: IssueStatus
  priority: number
  issue_type: string
  /** Person assigned to work on this issue */
  assignee?: string
  owner?: string
  created_at: string
  created_by?: string
  updated_at: string
  closed_at?: string
  parent?: string
  /** Labels attached to this issue */
  labels?: string[]
  dependency_count?: number
  dependent_count?: number
  dependencies?: BdDependency[]
  dependents?: BdDependency[]
  /** IDs of issues that block this issue (from bd blocked command) */
  blocked_by?: string[]
  /** Number of issues blocking this issue (from bd blocked command) */
  blocked_by_count?: number
}

/**  A dependency relationship between issues. */
export interface BdDependency extends BdIssue {
  dependency_type: string
}

// /**  Options for listing issues. */
export interface BdListOptions {
  /** Maximum number of results (default: 50) */
  limit?: number
  /** Filter by status */
  status?: IssueStatus
  /** Filter by priority (0-4) */
  priority?: number
  /** Filter by type */
  type?: string
  /** Filter by assignee */
  assignee?: string
  /** Filter by parent issue ID */
  parent?: string
  /** Show only ready issues (status=open, unblocked) */
  ready?: boolean
  /** Include closed issues */
  all?: boolean
}

/**  Options for creating a new issue. */
export interface BdCreateOptions {
  title: string
  description?: string
  priority?: number
  type?: string
  assignee?: string
  parent?: string
  labels?: string[]
}

/**  Options for updating an existing issue. */
export interface BdUpdateOptions {
  title?: string
  description?: string
  priority?: number
  status?: IssueStatus
  type?: string
  assignee?: string
  parent?: string
  addLabels?: string[]
  removeLabels?: string[]
}

/**  Information about the beads database. */
export interface BdInfo {
  database_path: string
  issue_count: number
  mode: string
  daemon_connected: boolean
  daemon_status?: string
  daemon_version?: string
  socket_path?: string
  config?: Record<string, string>
}

/**  Result of a label operation. */
export interface BdLabelResult {
  issue_id: string
  label: string
  status: "added" | "removed" | "already_exists" | "not_found"
}

/**  Result of a dependency operation. */
export interface BdDepResult {
  issue_id: string
  depends_on_id: string
  status: "added" | "removed"
  type?: string
}

/** Options for searching issues. */
export interface BdSearchOptions {
  /** Search query text */
  query: string
  /** Filter by status */
  status?: IssueStatus
  /** Filter by type */
  type?: string
  /** Filter by assignee */
  assignee?: string
  /** Filter by labels (AND: must have ALL) */
  labels?: string[]
  /** Filter by labels (OR: must have AT LEAST ONE) */
  labelAny?: string[]
  /** Maximum number of results (default: 50) */
  limit?: number
  /** Sort by field */
  sort?:
    | "priority"
    | "created"
    | "updated"
    | "closed"
    | "status"
    | "id"
    | "title"
    | "type"
    | "assignee"
  /** Reverse sort order */
  reverse?: boolean
  /** Filter by minimum priority (inclusive, 0-4) */
  priorityMin?: number
  /** Filter by maximum priority (inclusive, 0-4) */
  priorityMax?: number
  /** Filter issues created after date (YYYY-MM-DD or RFC3339) */
  createdAfter?: string
  /** Filter issues created before date (YYYY-MM-DD or RFC3339) */
  createdBefore?: string
  /** Filter issues updated after date (YYYY-MM-DD or RFC3339) */
  updatedAfter?: string
  /** Filter issues updated before date (YYYY-MM-DD or RFC3339) */
  updatedBefore?: string
}

/** Options for the ready command. */
export interface BdReadyOptions {
  /** Filter by assignee */
  assignee?: string
  /** Filter by labels (AND: must have ALL) */
  labels?: string[]
  /** Filter by labels (OR: must have AT LEAST ONE) */
  labelAny?: string[]
  /** Maximum issues to show (default: 10) */
  limit?: number
  /** Filter by priority (0-4) */
  priority?: number
  /** Filter by type */
  type?: string
  /** Show only unassigned issues */
  unassigned?: boolean
  /** Sort policy */
  sort?: "hybrid" | "priority" | "oldest"
  /** Filter to descendants of this parent */
  parent?: string
}

/** Options for counting issues. */
export interface BdCountOptions {
  /** Filter by status */
  status?: IssueStatus
  /** Filter by type */
  type?: string
  /** Filter by assignee */
  assignee?: string
  /** Filter by priority (0-4) */
  priority?: number
  /** Filter by labels (AND: must have ALL) */
  labels?: string[]
  /** Group count by status */
  byStatus?: boolean
  /** Group count by priority */
  byPriority?: boolean
  /** Group count by type */
  byType?: boolean
  /** Group count by assignee */
  byAssignee?: boolean
  /** Group count by label */
  byLabel?: boolean
}

/** Result of a count operation (simple or grouped). */
export type BdCountResult = number | Record<string, number>

/** Options for listing dependencies. */
export interface BdDepListOptions {
  /** Direction: 'down' (dependencies) or 'up' (dependents) */
  direction?: "down" | "up"
  /** Filter by dependency type */
  type?: string
}

/** Options for the sync command. */
export interface BdSyncOptions {
  /** Show sync state without syncing */
  status?: boolean
  /** Force full export/import */
  force?: boolean
  /** Import from JSONL */
  import?: boolean
  /** Preview without making changes */
  dryRun?: boolean
  /** Skip pushing to remote */
  noPush?: boolean
  /** Skip pulling from remote */
  noPull?: boolean
  /** Full sync: pull -> merge -> export -> commit -> push */
  full?: boolean
}

/** Result of a sync operation. */
export interface BdSyncResult {
  exported?: number
  imported?: number
  conflicts?: number
  status?: string
  [key: string]: unknown
}

/** Epic completion status. */
export interface BdEpicStatus {
  id: string
  title: string
  total: number
  closed: number
  open: number
  in_progress: number
  completion: number
  eligible_for_close: boolean
}

/**  A comment on an issue. */
export interface BdComment {
  id: number
  issue_id: string
  author: string
  text: string
  created_at: string
}

/**
 * Type of mutation event from the beads daemon.
 * Note: Daemon returns PascalCase JSON keys.
 */
export type MutationType =
  | "create"
  | "update"
  | "delete"
  | "comment"
  | "status"
  | "bonded"
  | "squashed"
  | "burned"

/**
 * A mutation event from the beads daemon.
 * Note: Daemon returns PascalCase JSON keys.
 */
export interface MutationEvent {
  Timestamp: string
  Type: MutationType
  IssueID: string
  Title?: string
  old_status?: string
  new_status?: string
  parent_id?: string
  Actor?: string
}
