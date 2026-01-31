import { exec, resolveExecOptions, type ExecOptions, type ResolvedExecOptions } from "./exec.js"
import { watchMutations, type WatchMutationsOptions } from "./socket.js"
import type {
  BdComment,
  BdCountOptions,
  BdCountResult,
  BdCreateOptions,
  BdDepListOptions,
  BdDepResult,
  BdEpicStatus,
  BdInfo,
  BdIssue,
  BdLabelResult,
  BdListOptions,
  BdReadyOptions,
  BdSearchOptions,
  BdSyncOptions,
  BdSyncResult,
  BdUpdateOptions,
  MutationEvent,
} from "./types.js"

/**
 * Typed client for the beads issue tracker.
 * CRUD operations spawn `bd` subprocess. Mutation watching uses the daemon socket.
 */
export class BeadsClient {
  private execOptions: ResolvedExecOptions

  constructor(options: BeadsClientOptions = {}) {
    this.execOptions = resolveExecOptions(options)
  }

  /** List issues with optional filters. */
  async list(
    /** Filter options */
    options: BdListOptions = {},
  ): Promise<BdIssue[]> {
    const args = ["list", "--json"]

    if (options.limit !== undefined) args.push("--limit", String(options.limit))
    if (options.status) args.push("--status", options.status)
    if (options.priority !== undefined) args.push("--priority", String(options.priority))
    if (options.type) args.push("--type", options.type)
    if (options.assignee) args.push("--assignee", options.assignee)
    if (options.parent) args.push("--parent", options.parent)
    if (options.ready) args.push("--ready")
    if (options.all) args.push("--all")

    const result = await this.exec(args)
    return JSON.parse(result) as BdIssue[]
  }

  /**
   * List blocked issues.
   * Includes both issues with status="blocked" AND open issues that have
   * unsatisfied blocking dependencies.
   */
  async blocked(
    /** Optional parent to filter descendants */
    parent?: string,
  ): Promise<BdIssue[]> {
    const args = ["blocked", "--json"]

    if (parent) args.push("--parent", parent)

    const result = await this.exec(args)
    return JSON.parse(result) as BdIssue[]
  }

  /** Show details for one or more issues. */
  async show(
    /** Issue ID or array of IDs */
    ids: string | string[],
  ): Promise<BdIssue[]> {
    const idList = Array.isArray(ids) ? ids : [ids]
    const args = ["show", "--json", ...idList]

    const result = await this.exec(args)
    return JSON.parse(result) as BdIssue[]
  }

  /**
   * List issues enriched with parent and dependency fields from detailed data.
   * Fetches all matching issues, then enriches them with `parent`, `dependencies`,
   * and blocking relationship information from `bd show`.
   */
  async listWithParents(
    /** Filter options */
    options: BdListOptions = {},
  ): Promise<BdIssue[]> {
    const issues = await this.list(options)
    if (issues.length === 0) return issues
    const ids = issues.map(issue => issue.id)
    const detailedIssues = await this.show(ids)
    const detailsMap = new Map<string, BdIssue>()
    for (const issue of detailedIssues) detailsMap.set(issue.id, issue)

    return issues.map(issue => {
      const details = detailsMap.get(issue.id)
      if (!details) return issue
      const enriched = { ...issue }
      if (details.parent) enriched.parent = details.parent
      if (details.dependencies) {
        enriched.dependencies = details.dependencies

        const blockers = details.dependencies.filter(
          dep => dep.dependency_type === "blocks" && dep.status !== "closed",
        )
        if (blockers.length > 0) {
          enriched.blocked_by_count = blockers.length
          enriched.blocked_by = blockers.map(b => b.id)
          if (enriched.status === "open") {
            enriched.status = "blocked"
          }
        }
      }
      return enriched
    })
  }

  /** Create a new issue. */
  async create(
    /** Create options */
    options: BdCreateOptions,
  ): Promise<BdIssue> {
    const args = ["create", "--json", options.title]

    if (options.description) args.push("--description", options.description)
    if (options.priority !== undefined) args.push("--priority", String(options.priority))
    if (options.type) args.push("--type", options.type)
    if (options.assignee) args.push("--assignee", options.assignee)
    if (options.parent) args.push("--parent", options.parent)
    if (options.labels && options.labels.length > 0) args.push("--labels", options.labels.join(","))

    const result = await this.exec(args)
    const parsed = JSON.parse(result)
    const issue: BdIssue = Array.isArray(parsed) ? parsed[0] : parsed
    if (!issue || !issue.id) throw new Error("bd create did not return an issue")
    return issue
  }

  /** Update one or more issues. */
  async update(
    /** Issue ID(s) to update */
    ids: string | string[],
    /** Fields to update */
    options: BdUpdateOptions,
  ): Promise<BdIssue[]> {
    const idList = Array.isArray(ids) ? ids : [ids]
    const args = ["update", "--json", ...idList]

    if (options.title) args.push("--title", options.title)
    if (options.description) args.push("--description", options.description)
    if (options.priority !== undefined) args.push("--priority", String(options.priority))
    if (options.status) args.push("--status", options.status)
    if (options.type) args.push("--type", options.type)
    if (options.assignee) args.push("--assignee", options.assignee)
    if (options.parent !== undefined) args.push("--parent", options.parent)
    if (options.addLabels && options.addLabels.length > 0)
      for (const label of options.addLabels) args.push("--add-label", label)
    if (options.removeLabels && options.removeLabels.length > 0)
      for (const label of options.removeLabels) args.push("--remove-label", label)

    const result = await this.exec(args)
    return JSON.parse(result) as BdIssue[]
  }

  /** Close one or more issues. */
  async close(
    /** Issue ID(s) to close */
    ids: string | string[],
  ): Promise<BdIssue[]> {
    const idList = Array.isArray(ids) ? ids : [ids]
    const args = ["close", "--json", ...idList]
    const result = await this.exec(args)
    return JSON.parse(result) as BdIssue[]
  }

  /** Delete one or more issues. */
  async delete(
    /** Issue ID(s) to delete */
    ids: string | string[],
  ): Promise<void> {
    const idList = Array.isArray(ids) ? ids : [ids]
    const args = ["delete", "--force", ...idList]
    await this.exec(args)
  }

  /** Add a comment to an issue. */
  async addComment(
    /** Issue ID to add comment to */
    id: string,
    /** The comment text */
    comment: string,
    /** Optional author name (defaults to git user) */
    author?: string,
  ): Promise<void> {
    const args = ["comments", "add", id, comment]
    if (author) args.push("--author", author)
    await this.exec(args)
  }

  /** Get comments for an issue. */
  async getComments(
    /** Issue ID to get comments for */
    id: string,
  ): Promise<BdComment[]> {
    const args = ["comments", id, "--json"]
    const result = await this.exec(args)
    return JSON.parse(result) as BdComment[]
  }

  /** Get database info. */
  async getInfo(): Promise<BdInfo> {
    const args = ["info", "--json"]
    const result = await this.exec(args)
    return JSON.parse(result) as BdInfo
  }

  /** Get labels for an issue. */
  async getLabels(
    /** Issue ID to get labels for */
    id: string,
  ): Promise<string[]> {
    const args = ["label", "list", id, "--json"]
    const result = await this.exec(args)
    return JSON.parse(result) as string[]
  }

  /** Add a label to an issue. */
  async addLabel(
    /** Issue ID to add label to */
    id: string,
    /** Label to add */
    label: string,
  ): Promise<BdLabelResult> {
    const args = ["label", "add", id, label, "--json"]
    const result = await this.exec(args)
    const results = JSON.parse(result) as BdLabelResult[]
    return results[0]
  }

  /** Remove a label from an issue. */
  async removeLabel(
    /** Issue ID to remove label from */
    id: string,
    /** Label to remove */
    label: string,
  ): Promise<BdLabelResult> {
    const args = ["label", "remove", id, label, "--json"]
    const result = await this.exec(args)
    const results = JSON.parse(result) as BdLabelResult[]
    return results[0]
  }

  /** List all unique labels in the database. */
  async listAllLabels(): Promise<string[]> {
    const args = ["label", "list-all", "--json"]
    const result = await this.exec(args)
    return JSON.parse(result) as string[]
  }

  /** Add a blocking dependency between two issues. */
  async addBlocker(
    /** Issue ID that will be blocked */
    blockedId: string,
    /** Issue ID that blocks the first issue */
    blockerId: string,
  ): Promise<BdDepResult> {
    const args = ["dep", "add", blockedId, blockerId, "--json"]
    const result = await this.exec(args)
    return JSON.parse(result) as BdDepResult
  }

  /** Remove a blocking dependency between two issues. */
  async removeBlocker(
    /** Issue ID that was blocked */
    blockedId: string,
    /** Issue ID that was blocking */
    blockerId: string,
  ): Promise<BdDepResult> {
    const args = ["dep", "remove", blockedId, blockerId, "--json"]
    const result = await this.exec(args)
    return JSON.parse(result) as BdDepResult
  }

  /** Reopen one or more closed issues. */
  async reopen(
    /** Issue ID(s) to reopen */
    ids: string | string[],
    /** Optional reason for reopening */
    reason?: string,
  ): Promise<BdIssue[]> {
    const idList = Array.isArray(ids) ? ids : [ids]
    const args = ["reopen", "--json", ...idList]
    if (reason) args.push("--reason", reason)
    const result = await this.exec(args)
    return JSON.parse(result) as BdIssue[]
  }

  /** Search issues by text query. */
  async search(
    /** Search options including query text and filters */
    options: BdSearchOptions,
  ): Promise<BdIssue[]> {
    const args = ["search", "--json", options.query]

    if (options.status) args.push("--status", options.status)
    if (options.type) args.push("--type", options.type)
    if (options.assignee) args.push("--assignee", options.assignee)
    if (options.labels) for (const l of options.labels) args.push("--label", l)
    if (options.labelAny) for (const l of options.labelAny) args.push("--label-any", l)
    if (options.limit !== undefined) args.push("--limit", String(options.limit))
    if (options.sort) args.push("--sort", options.sort)
    if (options.reverse) args.push("--reverse")
    if (options.priorityMin !== undefined) args.push("--priority-min", String(options.priorityMin))
    if (options.priorityMax !== undefined) args.push("--priority-max", String(options.priorityMax))
    if (options.createdAfter) args.push("--created-after", options.createdAfter)
    if (options.createdBefore) args.push("--created-before", options.createdBefore)
    if (options.updatedAfter) args.push("--updated-after", options.updatedAfter)
    if (options.updatedBefore) args.push("--updated-before", options.updatedBefore)

    const result = await this.exec(args)
    return JSON.parse(result) as BdIssue[]
  }

  /** Show ready work (issues with no blockers that are open or in_progress). */
  async ready(
    /** Filter options */
    options: BdReadyOptions = {},
  ): Promise<BdIssue[]> {
    const args = ["ready", "--json"]

    if (options.assignee) args.push("--assignee", options.assignee)
    if (options.labels) for (const l of options.labels) args.push("--label", l)
    if (options.labelAny) for (const l of options.labelAny) args.push("--label-any", l)
    if (options.limit !== undefined) args.push("--limit", String(options.limit))
    if (options.priority !== undefined) args.push("--priority", String(options.priority))
    if (options.type) args.push("--type", options.type)
    if (options.unassigned) args.push("--unassigned")
    if (options.sort) args.push("--sort", options.sort)
    if (options.parent) args.push("--parent", options.parent)

    const result = await this.exec(args)
    return JSON.parse(result) as BdIssue[]
  }

  /** Count issues matching filters, optionally grouped by an attribute. */
  async count(
    /** Count options */
    options: BdCountOptions = {},
  ): Promise<BdCountResult> {
    const args = ["count", "--json"]

    if (options.status) args.push("--status", options.status)
    if (options.type) args.push("--type", options.type)
    if (options.assignee) args.push("--assignee", options.assignee)
    if (options.priority !== undefined) args.push("--priority", String(options.priority))
    if (options.labels) for (const l of options.labels) args.push("--label", l)
    if (options.byStatus) args.push("--by-status")
    if (options.byPriority) args.push("--by-priority")
    if (options.byType) args.push("--by-type")
    if (options.byAssignee) args.push("--by-assignee")
    if (options.byLabel) args.push("--by-label")

    const result = await this.exec(args)
    return JSON.parse(result) as BdCountResult
  }

  /** List children of a parent issue. */
  async children(
    /** Parent issue ID */
    parentId: string,
  ): Promise<BdIssue[]> {
    const args = ["children", "--json", parentId]
    const result = await this.exec(args)
    return JSON.parse(result) as BdIssue[]
  }

  /** List dependencies or dependents of an issue. */
  async listDeps(
    /** Issue ID */
    id: string,
    /** List options */
    options: BdDepListOptions = {},
  ): Promise<BdIssue[]> {
    const args = ["dep", "list", "--json", id]
    if (options.direction) args.push("--direction", options.direction)
    if (options.type) args.push("--type", options.type)
    const result = await this.exec(args)
    return JSON.parse(result) as BdIssue[]
  }

  /** Sync beads database with git. */
  async sync(
    /** Sync options */
    options: BdSyncOptions = {},
  ): Promise<BdSyncResult> {
    const args = ["sync", "--json"]

    if (options.status) args.push("--status")
    if (options.force) args.push("--force")
    if (options.import) args.push("--import")
    if (options.dryRun) args.push("--dry-run")
    if (options.noPush) args.push("--no-push")
    if (options.noPull) args.push("--no-pull")
    if (options.full) args.push("--full")

    const result = await this.exec(args)
    return JSON.parse(result) as BdSyncResult
  }

  /** Show epic completion status. */
  async epicStatus(
    /** Only show epics eligible for closure */
    eligibleOnly?: boolean,
  ): Promise<BdEpicStatus[]> {
    const args = ["epic", "status", "--json"]
    if (eligibleOnly) args.push("--eligible-only")
    const result = await this.exec(args)
    return JSON.parse(result) as BdEpicStatus[]
  }

  /** Close epics where all children are complete. */
  async epicCloseEligible(
    /** Preview without making changes */
    dryRun?: boolean,
  ): Promise<BdIssue[]> {
    const args = ["epic", "close-eligible", "--json"]
    if (dryRun) args.push("--dry-run")
    const result = await this.exec(args)
    return JSON.parse(result) as BdIssue[]
  }

  /**
   * Watch for mutation events from the beads daemon.
   * Polls the daemon for new mutations and calls the callback for each event.
   * Returns a cleanup function to stop watching.
   */
  watchMutations(
    /** Callback for each mutation event */
    onMutation: (event: MutationEvent) => void,
    /** Watch options (cwd defaults to client's cwd) */
    options: Omit<WatchMutationsOptions, "cwd"> = {},
  ): () => void {
    return watchMutations(onMutation, {
      cwd: this.execOptions.cwd,
      ...options,
    })
  }

  /** Execute a bd command and return stdout. */
  private exec(
    /** Command arguments */
    args: string[],
  ): Promise<string> {
    return exec(args, this.execOptions)
  }
}

/** Options for creating a BeadsClient. */
export interface BeadsClientOptions extends ExecOptions {
  /** Connection timeout for daemon socket in ms (default: 2000) */
  connectTimeout?: number
  /** Request timeout for daemon socket in ms (default: 5000) */
  requestTimeout?: number
}
