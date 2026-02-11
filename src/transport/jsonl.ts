import { readFileSync, watch, type FSWatcher } from "node:fs"
import { findJsonlPath } from "./discovery.js"
import type {
  Transport,
  Issue,
  LinkedIssue,
  BlockedIssue,
  RawJsonlIssue,
  RawJsonlDependency,
  Priority,
  Stats,
} from "../types.js"

/**
 * Read-only transport backed by the `.beads/issues.jsonl` file.
 * Used as a fallback when the daemon is unavailable.
 */
export class JsonlTransport implements Transport {
  private workspaceRoot: string
  private issues: Map<string, RawJsonlIssue> = new Map()
  private jsonlPath: string | null = null
  private watcher: FSWatcher | null = null
  private changeCallbacks: Array<() => void> = []

  constructor(
    /** Workspace root directory */
    workspaceRoot: string,
  ) {
    this.workspaceRoot = workspaceRoot
  }

  /** Load (or reload) the JSONL file into memory. */
  load(): boolean {
    this.jsonlPath = this.jsonlPath ?? findJsonlPath(this.workspaceRoot)
    if (!this.jsonlPath) return false

    try {
      const content = readFileSync(this.jsonlPath, "utf-8")
      this.issues.clear()
      for (const line of content.split("\n")) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const raw = JSON.parse(trimmed) as RawJsonlIssue
          if (raw.id) this.issues.set(raw.id, raw)
        } catch {
          // skip malformed lines
        }
      }
      return true
    } catch {
      return false
    }
  }

  /** Start watching the JSONL file for changes. */
  startWatching(): void {
    if (this.watcher || !this.jsonlPath) return
    try {
      this.watcher = watch(this.jsonlPath, () => {
        this.load()
        for (const cb of this.changeCallbacks) cb()
      })
    } catch {
      // fs.watch not available on this platform
    }
  }

  /** Register a callback for JSONL file changes. Returns an unsubscribe function. */
  onChange(
    /** Callback invoked when the JSONL file changes */
    callback: () => void,
  ): () => void {
    this.changeCallbacks.push(callback)
    return () => {
      const idx = this.changeCallbacks.indexOf(callback)
      if (idx >= 0) this.changeCallbacks.splice(idx, 1)
    }
  }

  /** Dispatch an operation, handling it locally from the in-memory JSONL data. */
  async send(
    /** Operation name */
    operation: string,
    /** Operation arguments */
    args: Record<string, unknown> = {},
  ): Promise<unknown> {
    if (this.issues.size === 0) {
      const loaded = this.load()
      if (!loaded) throw new Error("JSONL file not found or unreadable")
    }

    switch (operation) {
      case "list":
        return this.handleList(args)
      case "show":
        return this.handleShow(args)
      case "ready":
        return this.handleReady(args)
      case "blocked":
        return this.handleBlocked(args)
      case "stats":
        return this.handleStats()
      case "ping":
        return { message: "pong (jsonl fallback)", version: "jsonl" }
      case "health":
        return {
          status: "fallback",
          version: "jsonl",
          uptime: 0,
          db_response_time_ms: 0,
          active_connections: 0,
          memory_bytes: 0,
        }
      default:
        throw new Error(
          `Operation "${operation}" is not supported in JSONL fallback mode (read-only)`,
        )
    }
  }

  /** Stop watching and release resources. */
  close(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
    this.changeCallbacks = []
    this.issues.clear()
  }

  /** Handle the `list` operation with in-memory filtering. */
  private handleList(args: Record<string, unknown>): Issue[] {
    let results = Array.from(this.issues.values())

    if (args.status) results = results.filter(i => i.status === args.status)
    if (args.priority !== undefined) results = results.filter(i => i.priority === args.priority)
    if (args.issue_type) results = results.filter(i => i.issue_type === args.issue_type)
    if (args.assignee) results = results.filter(i => i.assignee === args.assignee)
    if (args.unassigned) results = results.filter(i => !i.assignee)
    if (args.query) {
      const q = String(args.query).toLowerCase()
      results = results.filter(
        i => i.title.toLowerCase().includes(q) || (i.description ?? "").toLowerCase().includes(q),
      )
    }
    if (Array.isArray(args.labels)) {
      const required = args.labels as string[]
      results = results.filter(i => {
        const issueLabels = i.labels ?? []
        return required.every(l => issueLabels.includes(l))
      })
    }
    if (Array.isArray(args.labels_any)) {
      const any = args.labels_any as string[]
      results = results.filter(i => {
        const issueLabels = i.labels ?? []
        return any.some(l => issueLabels.includes(l))
      })
    }

    const limit = typeof args.limit === "number" ? args.limit : 50
    return results.slice(0, limit).map(raw => this.toIssue(raw))
  }

  /** Handle the `show` operation. */
  private handleShow(args: Record<string, unknown>): Issue {
    const id = String(args.id)
    const raw = this.issues.get(id)
    if (!raw) throw new Error(`Issue not found: ${id}`)
    return this.toIssue(raw)
  }

  /** Handle the `ready` operation: open issues with no unsatisfied blockers. */
  private handleReady(args: Record<string, unknown>): Issue[] {
    let results = Array.from(this.issues.values()).filter(i => i.status === "open")

    // Exclude issues with open blockers
    results = results.filter(i => {
      const blockers = (i.dependencies ?? []).filter(d => d.type === "blocks")
      return blockers.every(b => {
        const blocker = this.issues.get(b.depends_on_id)
        return !blocker || blocker.status === "closed" || blocker.status === "resolved"
      })
    })

    if (args.assignee) results = results.filter(i => i.assignee === args.assignee)
    if (args.priority !== undefined) results = results.filter(i => i.priority === args.priority)
    if (args.unassigned) results = results.filter(i => !i.assignee)
    if (Array.isArray(args.labels)) {
      const required = args.labels as string[]
      results = results.filter(i => required.every(l => (i.labels ?? []).includes(l)))
    }
    if (Array.isArray(args.labels_any)) {
      const any = args.labels_any as string[]
      results = results.filter(i => any.some(l => (i.labels ?? []).includes(l)))
    }
    if (args.parent_id) {
      results = results.filter(i =>
        (i.dependencies ?? []).some(
          d => d.type === "parent-child" && d.depends_on_id === args.parent_id,
        ),
      )
    }

    const limit = typeof args.limit === "number" ? args.limit : 10
    return results.slice(0, limit).map(raw => this.toIssue(raw))
  }

  /** Handle the `blocked` operation: issues that are blocked. */
  private handleBlocked(args: Record<string, unknown>): BlockedIssue[] {
    let results = Array.from(this.issues.values())

    // Filter to parent's descendants if specified
    if (args.parent_id) {
      results = results.filter(i =>
        (i.dependencies ?? []).some(
          d => d.type === "parent-child" && d.depends_on_id === args.parent_id,
        ),
      )
    }

    const blocked: BlockedIssue[] = []
    for (const raw of results) {
      const blockerDeps = (raw.dependencies ?? []).filter(d => d.type === "blocks")
      const openBlockerIds = blockerDeps
        .filter(b => {
          const blocker = this.issues.get(b.depends_on_id)
          return blocker && blocker.status !== "closed" && blocker.status !== "resolved"
        })
        .map(b => b.depends_on_id)

      if (openBlockerIds.length > 0 || raw.status === "blocked") {
        blocked.push({
          ...this.toIssue(raw),
          blocked_by: openBlockerIds,
          blocked_by_count: openBlockerIds.length,
        })
      }
    }
    return blocked
  }

  /** Handle the `stats` operation: compute summary from in-memory data. */
  private handleStats(): Stats {
    const all = Array.from(this.issues.values())
    const open = all.filter(i => i.status === "open")
    const inProgress = all.filter(i => i.status === "in_progress")
    const closed = all.filter(i => i.status === "closed" || i.status === "resolved")
    const blockedIssues = all.filter(i => i.status === "blocked")
    const deferred = all.filter(i => i.status === "deferred")

    // Compute ready count (open with no unsatisfied blockers)
    const ready = open.filter(i => {
      const blockers = (i.dependencies ?? []).filter(d => d.type === "blocks")
      return blockers.every(b => {
        const blocker = this.issues.get(b.depends_on_id)
        return !blocker || blocker.status === "closed" || blocker.status === "resolved"
      })
    })

    // Compute average lead time for closed issues
    let totalLeadTimeHours = 0
    let closedWithDates = 0
    for (const issue of closed) {
      if (issue.closed_at && issue.created_at) {
        const lead = new Date(issue.closed_at).getTime() - new Date(issue.created_at).getTime()
        totalLeadTimeHours += lead / (1000 * 60 * 60)
        closedWithDates++
      }
    }

    return {
      summary: {
        total_issues: all.length,
        open_issues: open.length,
        in_progress_issues: inProgress.length,
        closed_issues: closed.length,
        blocked_issues: blockedIssues.length,
        deferred_issues: deferred.length,
        ready_issues: ready.length,
        average_lead_time_hours: closedWithDates > 0 ? totalLeadTimeHours / closedWithDates : 0,
      },
    }
  }

  /** Convert a raw JSONL issue to the Issue type. */
  private toIssue(raw: RawJsonlIssue): Issue {
    return {
      id: raw.id,
      title: raw.title,
      description: raw.description ?? "",
      status: raw.status,
      priority: raw.priority as Priority,
      issue_type: raw.issue_type,
      assignee: raw.assignee,
      labels: raw.labels ?? [],
      created_at: raw.created_at,
      updated_at: raw.updated_at,
      closed_at: raw.closed_at,
      design: raw.design,
      acceptance_criteria: raw.acceptance_criteria,
      notes: raw.notes,
      external_ref: raw.external_ref,
      dependency_count: raw.dependency_count ?? (raw.dependencies ?? []).length,
      dependent_count: raw.dependent_count ?? this.countDependents(raw.id),
      dependencies: this.buildLinkedIssues(raw.dependencies ?? []),
      dependents: this.buildDependents(raw.id),
    }
  }

  /** Build LinkedIssue array from raw dependency records. */
  private buildLinkedIssues(deps: RawJsonlDependency[]): LinkedIssue[] {
    const linked: LinkedIssue[] = []
    for (const dep of deps) {
      const target = this.issues.get(dep.depends_on_id)
      if (!target) continue
      linked.push({
        id: target.id,
        title: target.title,
        description: target.description ?? "",
        status: target.status,
        priority: target.priority as Priority,
        issue_type: target.issue_type,
        assignee: target.assignee,
        labels: target.labels ?? [],
        created_at: target.created_at,
        updated_at: target.updated_at,
        closed_at: target.closed_at,
        dependency_type: dep.type as LinkedIssue["dependency_type"],
        dependency_count: target.dependency_count ?? 0,
        dependent_count: target.dependent_count ?? 0,
      })
    }
    return linked
  }

  /** Build the dependents list for an issue (inverse of dependencies). */
  private buildDependents(issueId: string): LinkedIssue[] {
    const dependents: LinkedIssue[] = []
    for (const [, raw] of this.issues) {
      for (const dep of raw.dependencies ?? []) {
        if (dep.depends_on_id === issueId) {
          dependents.push({
            id: raw.id,
            title: raw.title,
            description: raw.description ?? "",
            status: raw.status,
            priority: raw.priority as Priority,
            issue_type: raw.issue_type,
            assignee: raw.assignee,
            labels: raw.labels ?? [],
            created_at: raw.created_at,
            updated_at: raw.updated_at,
            closed_at: raw.closed_at,
            dependency_type: dep.type as LinkedIssue["dependency_type"],
            dependency_count: raw.dependency_count ?? 0,
            dependent_count: raw.dependent_count ?? 0,
          })
        }
      }
    }
    return dependents
  }

  /** Count how many issues depend on the given issue. */
  private countDependents(issueId: string): number {
    let count = 0
    for (const [, raw] of this.issues) {
      if ((raw.dependencies ?? []).some(d => d.depends_on_id === issueId)) {
        count++
      }
    }
    return count
  }
}
