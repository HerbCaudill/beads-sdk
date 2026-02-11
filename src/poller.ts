import type { Transport } from "./types.js"

/**
 * Polls the daemon's `stats` endpoint on a configurable interval
 * and emits change events when the data changes.
 */
export class ChangePoller {
  private transport: Transport
  private intervalId: NodeJS.Timeout | null = null
  private callbacks: Array<() => void> = []
  private lastHash: string = ""

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

  /** Check for changes by comparing stats hashes. */
  private async poll(): Promise<void> {
    try {
      const stats = await this.transport.send("stats", {})
      const hash = JSON.stringify(stats)
      if (this.lastHash && hash !== this.lastHash) {
        for (const cb of this.callbacks) cb()
      }
      this.lastHash = hash
    } catch {
      // Daemon might be temporarily unavailable; skip this cycle
    }
  }
}
