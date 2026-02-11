import type { Transport } from "./types.js"

/**
 * Polls the daemon's `stats` endpoint on a configurable interval
 * and emits change events when the data changes. At most one poll
 * request is in flight at any time; interval ticks that fire while
 * a poll is running are skipped to prevent overlapping requests and
 * out-of-order `lastHash` updates.
 */
export class ChangePoller {
  private transport: Transport
  private intervalId: NodeJS.Timeout | null = null
  private callbacks: Array<() => void> = []
  private lastHash: string = ""
  private polling: boolean = false

  constructor(
    /** Transport to poll through */
    transport: Transport,
  ) {
    this.transport = transport
  }

  /** Start polling for changes. */
  start(
    /** Poll interval in ms (default: 2000) */
    intervalMs: number = 2000,
  ): void {
    if (this.intervalId) return
    this.intervalId = setInterval(() => this.poll(), intervalMs)
    // Run immediately
    this.poll()
  }

  /** Stop polling. */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  /** Register a change callback. Returns an unsubscribe function. */
  onChange(
    /** Callback invoked when changes are detected */
    callback: () => void,
  ): () => void {
    this.callbacks.push(callback)
    return () => {
      const idx = this.callbacks.indexOf(callback)
      if (idx >= 0) this.callbacks.splice(idx, 1)
    }
  }

  /** Check for changes by comparing stats hashes. Skips if a poll is already in flight. */
  private async poll(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      const stats = await this.transport.send("stats", {})
      const hash = JSON.stringify(stats)
      if (this.lastHash && hash !== this.lastHash) {
        for (const cb of this.callbacks) cb()
      }
      this.lastHash = hash
    } catch {
      // Daemon might be temporarily unavailable; skip this cycle
    } finally {
      this.polling = false
    }
  }
}
