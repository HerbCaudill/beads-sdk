import { DaemonTransport, type DaemonTransportOptions } from "./transport/daemon.js"
import { JsonlTransport } from "./transport/jsonl.js"
import { ChangePoller } from "./poller.js"
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

/** Options for creating a BeadsClient. */
export interface BeadsClientOptions {
  /** Timeout per daemon RPC request in ms (default: 5000) */
  requestTimeout?: number
  /** Actor name sent with daemon requests (default: "sdk") */
  actor?: string
  /** Change polling interval in ms (default: 2000) */
  pollInterval?: number
}
