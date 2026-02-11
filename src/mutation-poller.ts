import type { Transport, MutationEvent } from "./types.js"

/**
 * Polls the daemon's `get_mutations` endpoint and emits detailed mutation events.
 * Unlike ChangePoller (which only detects "something changed"), this provides
 * the actual mutation events with type, issue ID, and status changes.
 */
export class MutationPoller {
  private transport: Transport
  private intervalId: NodeJS.Timeout | null = null
  private callbacks: Array<(event: MutationEvent) => void> = []
  private lastTimestamp: number

  constructor(
    /** Transport to poll through */
    transport: Transport,
    /** Initial timestamp to start watching from (default: now) */
    since?: number,
  ) {
    this.transport = transport
    this.lastTimestamp = since ?? Date.now()
  }

  /** Start polling for mutations. */
  start(
    /** Poll interval in ms (default: 1000) */
    intervalMs: number = 1000,
  ): void {
    if (this.intervalId) return
    this.intervalId = setInterval(() => this.poll(), intervalMs)
    this.poll()
  }

  /** Stop polling. */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  /** Register a mutation callback. Returns an unsubscribe function. */
  onMutation(
    /** Callback invoked for each mutation event */
    callback: (event: MutationEvent) => void,
  ): () => void {
    this.callbacks.push(callback)
    return () => {
      const idx = this.callbacks.indexOf(callback)
      if (idx >= 0) this.callbacks.splice(idx, 1)
    }
  }

  /** Check for new mutations since last poll. */
  private async poll(): Promise<void> {
    try {
      const mutations = (await this.transport.send("get_mutations", {
        since: this.lastTimestamp,
      })) as MutationEvent[]
      if (!mutations || !Array.isArray(mutations)) return
      for (const mutation of mutations) {
        for (const cb of this.callbacks) cb(mutation)
        const mutationTime = new Date(mutation.Timestamp).getTime()
        if (mutationTime > this.lastTimestamp) this.lastTimestamp = mutationTime
      }
    } catch {
      // Daemon might be temporarily unavailable; skip this cycle
    }
  }
}

/** Options for the standalone watchMutations function. */
export interface WatchMutationsOptions {
  /** Working directory for socket location */
  workspacePath?: string
  /** Polling interval in ms (default: 1000) */
  interval?: number
  /** Initial timestamp to start watching from (default: now) */
  since?: number
}
