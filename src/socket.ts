import { createConnection, type Socket } from "node:net"
import { join } from "node:path"
import { existsSync } from "node:fs"
import type { MutationEvent } from "./types.js"

/**
 * Client for communicating with the beads daemon via Unix socket.
 * Provides mutation events and ready-issue queries via RPC.
 */
export class DaemonSocket {
  private socket: Socket | null = null
  private connected = false
  private socketPath: string
  private connectTimeout: number
  private requestTimeout: number

  constructor(options: DaemonSocketOptions = {}) {
    const cwd = options.cwd ?? process.cwd()
    this.socketPath = join(cwd, ".beads", "bd.sock")
    this.connectTimeout = options.connectTimeout ?? 2000
    this.requestTimeout = options.requestTimeout ?? 5000
  }

  /** Check if the beads daemon socket file exists. */
  socketExists(): boolean {
    return existsSync(this.socketPath)
  }

  /** Check if connected to the daemon. */
  get isConnected(): boolean {
    return this.connected && this.socket !== null
  }

  /** Connect to the beads daemon. Returns true if connected, false otherwise. */
  async connect(): Promise<boolean> {
    if (!this.socketExists()) return false

    if (this.connected && this.socket) return true

    return new Promise(resolve => {
      this.socket = createConnection(this.socketPath)

      const timeout = setTimeout(() => {
        this.socket?.destroy()
        this.socket = null
        resolve(false)
      }, this.connectTimeout)

      this.socket.on("connect", () => {
        clearTimeout(timeout)
        this.connected = true
        resolve(true)
      })

      this.socket.on("error", () => {
        clearTimeout(timeout)
        this.socket = null
        this.connected = false
        resolve(false)
      })

      this.socket.on("close", () => {
        this.socket = null
        this.connected = false
      })
    })
  }

  /** Send an RPC request and wait for response. */
  private async execute<T>(
    /** RPC operation name */
    operation: string,
    /** RPC arguments */
    args: Record<string, unknown> = {},
  ): Promise<T | null> {
    if (!this.socket || !this.connected) {
      return null
    }

    return new Promise(resolve => {
      const request: RPCRequest = { operation, args }
      const requestLine = JSON.stringify(request) + "\n"

      let responseData = ""

      const onData = (chunk: Buffer) => {
        responseData += chunk.toString()
        if (responseData.includes("\n")) {
          cleanup()
          try {
            const response: RPCResponse = JSON.parse(responseData.trim())
            if (response.success && response.data !== undefined) {
              resolve(response.data as T)
            } else {
              resolve(null)
            }
          } catch {
            resolve(null)
          }
        }
      }

      const onError = () => {
        cleanup()
        resolve(null)
      }

      const timeout = setTimeout(() => {
        cleanup()
        resolve(null)
      }, this.requestTimeout)

      const cleanup = () => {
        clearTimeout(timeout)
        this.socket?.off("data", onData)
        this.socket?.off("error", onError)
      }

      this.socket!.on("data", onData)
      this.socket!.on("error", onError)
      this.socket!.write(requestLine)
    })
  }

  /**
   * Get mutations since a given timestamp.
   * Returns all mutation events that occurred after the specified timestamp.
   */
  async getMutations(
    /** Unix timestamp in milliseconds (0 for all recent) */
    since: number = 0,
  ): Promise<MutationEvent[]> {
    const result = await this.execute<MutationEvent[]>("get_mutations", { since })
    return result ?? []
  }

  /** Get ready issues (open and unblocked). */
  async getReady(): Promise<{ id: string; title: string }[]> {
    const result = await this.execute<{ id: string; title: string }[]>("ready", {})
    return result ?? []
  }

  /** Close the connection to the daemon. */
  close(): void {
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
      this.connected = false
    }
  }
}

/** Options for watching mutations. */
export interface WatchMutationsOptions {
  /** Working directory for socket location */
  cwd?: string
  /** Polling interval in ms (default: 1000) */
  interval?: number
  /** Initial timestamp to start watching from (default: now) */
  since?: number
}

/**
 * Watch for mutation events from the beads daemon.
 * Polls the daemon periodically for new mutations and calls the callback
 * for each event. Returns a cleanup function to stop watching.
 */
export function watchMutations(
  /** Callback for each mutation event */
  onMutation: (event: MutationEvent) => void,
  /** Watch options */
  options: WatchMutationsOptions = {},
): () => void {
  const { cwd, interval = 1000, since } = options

  let lastTimestamp = since ?? Date.now()
  let client: DaemonSocket | null = null
  let timeoutId: NodeJS.Timeout | null = null
  let stopped = false

  const poll = async () => {
    if (stopped) return

    if (!client) {
      client = new DaemonSocket({ cwd })
      const connected = await client.connect()
      if (!connected) {
        if (!stopped) timeoutId = setTimeout(poll, interval)
        return
      }
    }

    try {
      const mutations = await client.getMutations(lastTimestamp)

      for (const mutation of mutations) {
        onMutation(mutation)
        const mutationTime = new Date(mutation.Timestamp).getTime()
        if (mutationTime > lastTimestamp) lastTimestamp = mutationTime
      }
    } catch {
      client?.close()
      client = null
    }

    if (!stopped) timeoutId = setTimeout(poll, interval)
  }

  poll()

  return () => {
    stopped = true
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    client?.close()
    client = null
  }
}

/** RPC request format for beads daemon. */
interface RPCRequest {
  operation: string
  args: Record<string, unknown>
}

/** RPC response format from beads daemon. */
interface RPCResponse {
  success: boolean
  data?: unknown
  error?: string
}

/** Options for the daemon socket connection. */
export interface DaemonSocketOptions {
  /** Workspace directory path (used to locate .beads/bd.sock) */
  cwd?: string
  /** Connection timeout in ms (default: 2000) */
  connectTimeout?: number
  /** Request timeout in ms (default: 5000) */
  requestTimeout?: number
}
