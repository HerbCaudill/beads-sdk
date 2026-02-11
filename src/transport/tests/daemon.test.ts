import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createServer, Server, Socket } from "node:net"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { DaemonTransport } from "../daemon.js"

/**
 * Create a Unix socket server that responds according to the provided handler.
 * The handler receives the parsed request and the client socket.
 */
function createMockDaemon(
  /** Path for the Unix socket */
  socketPath: string,
  /** Handler that receives the client socket and raw data */
  handler: (socket: Socket, data: string) => void,
): Server {
  const server = createServer(socket => {
    let buffer = ""
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString()
      if (buffer.includes("\n")) {
        handler(socket, buffer.trim())
        buffer = ""
      }
    })
  })
  server.listen(socketPath)
  return server
}

describe("DaemonTransport response framing", () => {
  let tempDir: string
  let beadsDir: string
  let socketPath: string
  let server: Server | null = null

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "beads-daemon-test-"))
    beadsDir = join(tempDir, ".beads")
    mkdirSync(beadsDir)
    socketPath = join(beadsDir, "bd.sock")
  })

  afterEach(async () => {
    if (server) {
      await new Promise<void>(resolve => server!.close(() => resolve()))
      server = null
    }
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("parses a newline-terminated response", async () => {
    server = createMockDaemon(socketPath, (socket, _data) => {
      const response = JSON.stringify({ success: true, data: { id: "bd-1" } })
      socket.write(response + "\n")
      socket.end()
    })

    const transport = new DaemonTransport(tempDir, { requestTimeout: 2000 })
    const result = (await transport.send("show", { id: "bd-1" })) as { id: string }
    expect(result.id).toBe("bd-1")
  })

  it("parses an EOF-terminated response (no trailing newline)", async () => {
    server = createMockDaemon(socketPath, (socket, _data) => {
      const response = JSON.stringify({ success: true, data: { count: 42 } })
      // Write without trailing newline and close the socket
      socket.end(response)
    })

    const transport = new DaemonTransport(tempDir, { requestTimeout: 2000 })
    const result = (await transport.send("stats", {})) as { count: number }
    expect(result.count).toBe(42)
  })

  it("rejects with daemon error for unsuccessful response", async () => {
    server = createMockDaemon(socketPath, (socket, _data) => {
      const response = JSON.stringify({ success: false, error: "Issue not found" })
      socket.end(response + "\n")
    })

    const transport = new DaemonTransport(tempDir, { requestTimeout: 2000 })
    await expect(transport.send("show", { id: "bd-nope" })).rejects.toThrow("Issue not found")
  })

  it("rejects with framing error when socket closes with incomplete JSON", async () => {
    server = createMockDaemon(socketPath, (socket, _data) => {
      // Send truncated JSON and close
      socket.end('{"success": true, "data":')
    })

    const transport = new DaemonTransport(tempDir, { requestTimeout: 2000 })
    await expect(transport.send("list", {})).rejects.toThrow(/parse|framing/i)
  })

  it("rejects with framing error when socket closes with empty response", async () => {
    server = createMockDaemon(socketPath, (socket, _data) => {
      // Close immediately without sending any data
      socket.end()
    })

    const transport = new DaemonTransport(tempDir, { requestTimeout: 2000 })
    await expect(transport.send("ping", {})).rejects.toThrow(/empty|EOF|framing/i)
  })

  it("parses response sent in multiple chunks with trailing newline", async () => {
    server = createMockDaemon(socketPath, (socket, _data) => {
      const response = JSON.stringify({ success: true, data: { chunked: true } })
      // Send in two chunks
      const mid = Math.floor(response.length / 2)
      socket.write(response.slice(0, mid))
      setTimeout(() => {
        socket.write(response.slice(mid) + "\n")
        socket.end()
      }, 10)
    })

    const transport = new DaemonTransport(tempDir, { requestTimeout: 2000 })
    const result = (await transport.send("list", {})) as { chunked: boolean }
    expect(result.chunked).toBe(true)
  })

  it("parses response sent in multiple chunks without trailing newline", async () => {
    server = createMockDaemon(socketPath, (socket, _data) => {
      const response = JSON.stringify({ success: true, data: { chunked: true } })
      // Send in two chunks, no newline
      const mid = Math.floor(response.length / 2)
      socket.write(response.slice(0, mid))
      setTimeout(() => {
        socket.end(response.slice(mid))
      }, 10)
    })

    const transport = new DaemonTransport(tempDir, { requestTimeout: 2000 })
    const result = (await transport.send("list", {})) as { chunked: boolean }
    expect(result.chunked).toBe(true)
  })

  it("does not time out for EOF-terminated responses", async () => {
    server = createMockDaemon(socketPath, (socket, _data) => {
      const response = JSON.stringify({ success: true, data: "ok" })
      // Small delay then close without newline
      setTimeout(() => {
        socket.end(response)
      }, 50)
    })

    const transport = new DaemonTransport(tempDir, { requestTimeout: 500 })
    const start = Date.now()
    const result = await transport.send("ping", {})
    const elapsed = Date.now() - start
    expect(result).toBe("ok")
    // Should resolve well before the timeout
    expect(elapsed).toBeLessThan(400)
  })
})
