import { DaemonTransport, type DaemonTransportOptions } from "./transport/daemon.js"
import { JsonlTransport } from "./transport/jsonl.js"
import { ChangePoller } from "./poller.js"
import { MutationPoller, type WatchMutationsOptions } from "./mutation-poller.js"
import { batched, MAX_CONCURRENT_REQUESTS } from "./batch.js"
import type {
  Transport,
  Issue,
  BlockedIssue,
  Stats,
  HealthStatus,
  ListFilter,
  ReadyFilter,
  BlockedFilter,
  CreateInput,
  UpdateInput,
  DepType,
  Comment,
  LabelResult,
  DepResult,
  Info,
  MutationEvent,
} from "./types.js"

/**
 * High-level client for the beads issue tracker.
 * Connects to the daemon via Unix socket, with JSONL fallback for reads.
 */
export class BeadsClient {
  private daemon: DaemonTransport | null = null
  private jsonl: JsonlTransport | null = null
  private transport: Transport | null = null
  private poller: ChangePoller | null = null
  private changeCallbacks: Array<() => void> = []
  private jsonlUnsubscribe: (() => void) | null = null
  private connected = false
  private workspaceRoot: string | null = null
  private options: BeadsClientOptions

  constructor(
    /** Client options */
    options: BeadsClientOptions = {},
  ) {
    this.options = options
  }

  /**
   * Connect to the daemon at the given workspace root.
   * Tries the daemon first; falls back to JSONL for read-only access.
   */
  async connect(
    /** Path to the workspace root (directory containing or above `.beads/`) */
    workspaceRoot: string,
  ): Promise<void> {
    this.workspaceRoot = workspaceRoot

    // Try daemon first
    const daemon = new DaemonTransport(workspaceRoot, {
      requestTimeout: this.options.requestTimeout,
      actor: this.options.actor,
    })

    try {
      await daemon.send("ping", {})
      this.daemon = daemon
      this.transport = daemon
      this.connected = true

      // Start change polling
      this.poller = new ChangePoller(daemon)
      this.poller.onChange(() => this.notifyChange())
      this.poller.start(this.options.pollInterval ?? 2000)
      return
    } catch {
      // Daemon not available; try JSONL fallback
    }

    // Fall back to JSONL
    const jsonl = new JsonlTransport(workspaceRoot)
    const loaded = jsonl.load()
    if (!loaded) {
      throw new Error(
        "Could not connect to daemon or find JSONL file. " +
          "Make sure the beads daemon is running or .beads/issues.jsonl exists.",
      )
    }

    this.jsonl = jsonl
    this.transport = jsonl
    this.connected = true

    // Watch JSONL for changes
    jsonl.startWatching()
    this.jsonlUnsubscribe = jsonl.onChange(() => this.notifyChange())
  }

  /** Disconnect and clean up all resources. */
  async disconnect(): Promise<void> {
    this.poller?.stop()
    this.poller = null
    this.jsonlUnsubscribe?.()
    this.jsonlUnsubscribe = null
    this.daemon?.close()
    this.daemon = null
    this.jsonl?.close()
    this.jsonl = null
    this.transport = null
    this.connected = false
    this.changeCallbacks = []
  }

  /** Check if the client is connected. */
  isConnected(): boolean {
    return this.connected
  }

  /**
   * Subscribe to data changes (driven by polling + JSONL file watching).
   * Returns an unsubscribe function.
   */
  onChange(
    /** Callback invoked when data changes */
    callback: () => void,
  ): () => void {
    this.changeCallbacks.push(callback)
    return () => {
      const idx = this.changeCallbacks.indexOf(callback)
      if (idx >= 0) this.changeCallbacks.splice(idx, 1)
    }
  }

  // ── Read operations ──────────────────────────────────────────────

  /** List issues with optional filters. */
  async list(
    /** Filter options */
    filter: ListFilter = {},
  ): Promise<Issue[]> {
    return (await this.send("list", { ...filter })) as Issue[]
  }

  /** Show a single issue by ID (with full dependencies/dependents). */
  async show(
    /** Issue ID */
    id: string,
  ): Promise<Issue> {
    return (await this.send("show", { id })) as Issue
  }

  /** Show details for multiple issues, with bounded concurrency. */
  async showMany(
    /** Issue IDs */
    ids: string[],
  ): Promise<Issue[]> {
    this.requireDaemon("show (batched)")
    return batched(ids, MAX_CONCURRENT_REQUESTS, id => this.show(id))
  }

  /** Show ready work (open issues with no blockers). */
  async ready(
    /** Filter options */
    filter: ReadyFilter = {},
  ): Promise<Issue[]> {
    return (await this.send("ready", { ...filter })) as Issue[]
  }

  /** Show blocked issues. */
  async blocked(
    /** Filter options */
    filter: BlockedFilter = {},
  ): Promise<BlockedIssue[]> {
    return (await this.send("blocked", { ...filter })) as BlockedIssue[]
  }

  /** Get database statistics. */
  async stats(): Promise<Stats> {
    return (await this.send("stats", {})) as Stats
  }

  /** Ping the daemon. */
  async ping(): Promise<{ message: string; version: string }> {
    return (await this.send("ping", {})) as { message: string; version: string }
  }

  /** Get daemon health status. */
  async health(): Promise<HealthStatus> {
    return (await this.send("health", {})) as HealthStatus
  }

  /** Get database info. Requires daemon connection. */
  async info(): Promise<Info> {
    this.requireDaemon("info")
    return (await this.send("info", {})) as Info
  }

  /** Get mutations since a given timestamp. Requires daemon connection. */
  async getMutations(
    /** Unix timestamp in ms to get mutations since */
    since: number = 0,
  ): Promise<MutationEvent[]> {
    this.requireDaemon("get_mutations")
    const result = (await this.send("get_mutations", { since })) as MutationEvent[]
    return result ?? []
  }

  // ── Write operations ─────────────────────────────────────────────

  /** Create a new issue. Requires daemon connection (not JSONL fallback). */
  async create(
    /** Issue creation input */
    input: CreateInput,
  ): Promise<Issue> {
    this.requireDaemon("create")
    return (await this.send("create", input as unknown as Record<string, unknown>)) as Issue
  }

  /** Update an existing issue. Requires daemon connection. */
  async update(
    /** Issue ID */
    id: string,
    /** Fields to update */
    changes: UpdateInput,
  ): Promise<Issue> {
    this.requireDaemon("update")
    return (await this.send("update", {
      id,
      ...changes,
    })) as Issue
  }

  /** Update multiple issues with the same changes, with bounded concurrency. */
  async updateMany(
    /** Issue IDs to update */
    ids: string[],
    /** Fields to update */
    changes: UpdateInput,
  ): Promise<Issue[]> {
    this.requireDaemon("update (batched)")
    return batched(ids, MAX_CONCURRENT_REQUESTS, id => this.update(id, changes))
  }

  /** Close an issue. Requires daemon connection. */
  async close(
    /** Issue ID */
    id: string,
    /** Optional close reason */
    reason?: string,
  ): Promise<Issue> {
    this.requireDaemon("close")
    const args: Record<string, unknown> = { id }
    if (reason) args.reason = reason
    return (await this.send("close", args)) as Issue
  }

  /** Delete an issue. Requires daemon connection. */
  async delete(
    /** Issue ID */
    id: string,
  ): Promise<void> {
    this.requireDaemon("delete")
    await this.send("delete", { id, force: true })
  }

  /** Delete multiple issues, with bounded concurrency. */
  async deleteMany(
    /** Issue IDs to delete */
    ids: string[],
  ): Promise<void> {
    this.requireDaemon("delete (batched)")
    await batched(ids, MAX_CONCURRENT_REQUESTS, id => this.delete(id))
  }

  // ── Comments ─────────────────────────────────────────────────────

  /** Add a comment to an issue. Requires daemon connection. */
  async addComment(
    /** Issue ID */
    id: string,
    /** Comment text */
    text: string,
    /** Optional comment author */
    author?: string,
  ): Promise<void> {
    this.requireDaemon("comment_add")
    const args: Record<string, unknown> = { id, text }
    if (author) args.author = author
    await this.send("comment_add", args)
  }

  /** Get comments for an issue. Requires daemon connection. */
  async getComments(
    /** Issue ID */
    id: string,
  ): Promise<Comment[]> {
    this.requireDaemon("comments")
    return (await this.send("comments", { id })) as Comment[]
  }

  // ── Labels ───────────────────────────────────────────────────────

  /** Get labels for an issue. Requires daemon connection. */
  async getLabels(
    /** Issue ID */
    id: string,
  ): Promise<string[]> {
    this.requireDaemon("label_list")
    return (await this.send("label_list", { id })) as string[]
  }

  /** Add a label to an issue. Requires daemon connection. */
  async addLabel(
    /** Issue ID */
    id: string,
    /** Label to add */
    label: string,
  ): Promise<LabelResult> {
    this.requireDaemon("label_add")
    return (await this.send("label_add", { id, label })) as LabelResult
  }

  /** Remove a label from an issue. Requires daemon connection. */
  async removeLabel(
    /** Issue ID */
    id: string,
    /** Label to remove */
    label: string,
  ): Promise<LabelResult> {
    this.requireDaemon("label_remove")
    return (await this.send("label_remove", { id, label })) as LabelResult
  }

  /** List all unique labels in the database. Requires daemon connection. */
  async listAllLabels(): Promise<string[]> {
    this.requireDaemon("label_list_all")
    return (await this.send("label_list_all", {})) as string[]
  }

  // ── Dependencies ─────────────────────────────────────────────────

  /** Add a dependency between two issues. Requires daemon connection. */
  async addDependency(
    /** Source issue ID */
    fromId: string,
    /** Target issue ID */
    toId: string,
    /** Dependency type */
    type: DepType,
  ): Promise<void> {
    this.requireDaemon("dep_add")
    await this.send("dep_add", {
      from_id: fromId,
      to_id: toId,
      dep_type: type,
    })
  }

  /** Add a blocking dependency between two issues. Requires daemon connection. */
  async addBlocker(
    /** ID of the issue being blocked */
    blockedId: string,
    /** ID of the blocking issue */
    blockerId: string,
  ): Promise<DepResult> {
    this.requireDaemon("dep_add")
    return (await this.send("dep_add", {
      from_id: blockedId,
      to_id: blockerId,
    })) as DepResult
  }

  /** Remove a blocking dependency between two issues. Requires daemon connection. */
  async removeBlocker(
    /** ID of the issue being blocked */
    blockedId: string,
    /** ID of the blocking issue */
    blockerId: string,
  ): Promise<DepResult> {
    this.requireDaemon("dep_remove")
    return (await this.send("dep_remove", {
      from_id: blockedId,
      to_id: blockerId,
    })) as DepResult
  }

  // ── Internals ────────────────────────────────────────────────────

  /** Send an operation through the active transport. */
  private async send(
    /** Operation name */
    operation: string,
    /** Operation arguments */
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.transport) {
      throw new Error("Not connected. Call connect() first.")
    }
    return this.transport.send(operation, args)
  }

  /** Throw if not connected to the daemon (JSONL is read-only). */
  private requireDaemon(
    /** Operation name for error message */
    operation: string,
  ): void {
    if (!this.daemon) {
      throw new Error(
        `Operation "${operation}" requires a daemon connection. ` + `JSONL fallback is read-only.`,
      )
    }
  }

  /** Notify all change subscribers. */
  private notifyChange(): void {
    for (const cb of this.changeCallbacks) cb()
  }
}

/**
 * Watch for mutation events from the beads daemon.
 * Polls the daemon periodically for new mutations and calls the callback for each event.
 * Returns a cleanup function to stop watching.
 */
export function watchMutations(
  /** Callback for each mutation event */
  onMutation: (event: MutationEvent) => void,
  /** Watch options */
  options: WatchMutationsOptions = {},
): () => void {
  const { workspacePath, interval = 1000, since } = options

  const cwd = workspacePath ?? process.cwd()
  const daemon = new DaemonTransport(cwd, { actor: "sdk" })
  const poller = new MutationPoller(daemon, since)
  poller.onMutation(onMutation)
  poller.start(interval)

  return () => {
    poller.stop()
    daemon.close()
  }
}

/** Options for creating a BeadsClient. */
export interface BeadsClientOptions {
  /** Timeout per daemon RPC request in ms (default: 5000) */
  requestTimeout?: number
  /** Actor name sent with daemon requests (default: "sdk") */
  actor?: string
  /** Change polling interval in ms (default: 2000) */
  pollInterval?: number
}
