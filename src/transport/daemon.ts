import { createConnection } from "node:net"
import { exec as cpExec } from "node:child_process"
import { join } from "node:path"
import { findSocketPath, findBeadsDir } from "./discovery.js"
import type { Transport } from "../types.js"

/**
 * Transport that communicates with the beads daemon via Unix socket.
 * Each RPC call opens a fresh connection (the daemon closes after one response).
 */
export class DaemonTransport implements Transport {
  private workspaceRoot: string
  private requestTimeout: number
  private actor: string
  private socketPath: string | null = null

  constructor(
    /** Workspace root directory */
    workspaceRoot: string,
    /** Transport options */
    options: DaemonTransportOptions = {},
  ) {
    this.workspaceRoot = workspaceRoot
    this.requestTimeout = options.requestTimeout ?? 5000
    this.actor = options.actor ?? "sdk"
  }

  /** Send an RPC request to the daemon and return the response data. */
  async send(
    /** Operation name */
    operation: string,
    /** Operation arguments */
    args: Record<string, unknown> = {},
  ): Promise<unknown> {
    const socketPath = await this.ensureRunning()
    if (!socketPath) {
      throw new Error("Daemon is not available and could not be started")
    }

    return new Promise((resolve, reject) => {
      const socket = createConnection(socketPath)
      let responseData = ""
      let settled = false

      /** Settle the promise exactly once and clean up the timeout. */
      const settle = (fn: typeof resolve | typeof reject, value: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        fn(value)
      }

      /** Parse a complete response string and settle the promise. */
      const handleResponse = (raw: string) => {
        const trimmed = raw.trim()
        if (!trimmed) {
          settle(
            reject,
            new Error("Daemon closed connection with empty response (EOF framing error)"),
          )
          return
        }
        try {
          const response = JSON.parse(trimmed) as DaemonResponse
          if (response.success) {
            settle(resolve, response.data)
          } else {
            settle(reject, new Error(response.error ?? "Unknown daemon error"))
          }
        } catch {
          settle(reject, new Error(`Failed to parse daemon response (framing error): ${trimmed}`))
        }
      }

      const timeout = setTimeout(() => {
        socket.destroy()
        settle(reject, new Error(`Daemon request timed out after ${this.requestTimeout}ms`))
      }, this.requestTimeout)

      socket.on("connect", () => {
        const request = {
          operation,
          args,
          cwd: this.workspaceRoot,
          actor: this.actor,
        }
        socket.write(JSON.stringify(request) + "\n")
      })

      socket.on("data", (chunk: Buffer) => {
        responseData += chunk.toString()
        // Parse eagerly when a newline delimiter arrives
        if (responseData.includes("\n")) {
          socket.destroy()
          handleResponse(responseData)
        }
      })

      socket.on("end", () => {
        // Socket closed; parse any buffered data that arrived without a newline
        if (!settled && responseData.length > 0) {
          handleResponse(responseData)
        } else if (!settled) {
          settle(
            reject,
            new Error("Daemon closed connection with empty response (EOF framing error)"),
          )
        }
      })

      socket.on("error", (err: Error) => {
        this.socketPath = null
        settle(reject, new Error(`Daemon connection error: ${err.message}`))
      })
    })
  }

  /** No-op; each call opens its own connection. */
  close(): void {
    this.socketPath = null
  }

  /**
   * Ensure the daemon is running. Discovers the socket path, and if not found,
   * attempts to start the daemon.
   */
  private async ensureRunning(): Promise<string | null> {
    if (this.socketPath) {
      return this.socketPath
    }

    const found = findSocketPath(this.workspaceRoot)
    if (found) {
      this.socketPath = found
      return found
    }

    await this.startDaemon()
    return this.socketPath
  }

  /** Start the beads daemon and wait for the socket to appear. */
  private async startDaemon(): Promise<void> {
    const beadsDir = findBeadsDir(this.workspaceRoot)
    if (!beadsDir) {
      throw new Error("No .beads directory found; is this a beads workspace?")
    }

    await new Promise<void>((resolve, reject) => {
      cpExec("bd daemon start", { cwd: this.workspaceRoot }, error => {
        if (error) {
          reject(new Error(`Failed to start daemon: ${error.message}`))
        } else {
          resolve()
        }
      })
    })

    const expectedPath = join(beadsDir, "bd.sock")
    await this.waitForSocket(expectedPath, 5000)
  }

  /** Poll until the socket file appears or timeout is reached. */
  private async waitForSocket(
    /** Expected socket path */
    socketPath: string,
    /** Maximum time to wait in ms */
    timeoutMs: number,
  ): Promise<void> {
    const { existsSync } = await import("node:fs")
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (existsSync(socketPath)) {
        this.socketPath = socketPath
        return
      }
      await new Promise(r => setTimeout(r, 100))
    }
    throw new Error(`Daemon socket did not appear within ${timeoutMs}ms`)
  }
}

/** Options for DaemonTransport. */
export interface DaemonTransportOptions {
  /** Timeout per RPC request in ms (default: 5000) */
  requestTimeout?: number
  /** Actor name sent with each request (default: "sdk") */
  actor?: string
}

/** Raw daemon RPC response. */
interface DaemonResponse {
  success: boolean
  data?: unknown
  error?: string
}
