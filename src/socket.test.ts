import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { DaemonSocket, watchMutations } from "./socket.js"

describe("DaemonSocket", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe("socketPath", () => {
    it("constructs socket path from cwd", () => {
      const client = new DaemonSocket({ cwd: "/tmp" })
      expect(client["socketPath"]).toBe("/tmp/.beads/bd.sock")
    })
  })

  describe("connect", () => {
    it("returns false if socket does not exist", async () => {
      const client = new DaemonSocket({ cwd: "/nonexistent/path/12345" })
      const result = await client.connect()
      expect(result).toBe(false)
    })
  })

  describe("isConnected", () => {
    it("returns false initially", () => {
      const client = new DaemonSocket({ cwd: "/test" })
      expect(client.isConnected).toBe(false)
    })
  })

  describe("close", () => {
    it("does nothing if not connected", () => {
      const client = new DaemonSocket({ cwd: "/test" })
      client.close()
      expect(client.isConnected).toBe(false)
    })
  })

  describe("getMutations", () => {
    it("returns empty array if not connected", async () => {
      const client = new DaemonSocket({ cwd: "/nonexistent/12345" })
      const mutations = await client.getMutations()
      expect(mutations).toEqual([])
    })
  })

  describe("getReady", () => {
    it("returns empty array if not connected", async () => {
      const client = new DaemonSocket({ cwd: "/nonexistent/12345" })
      const issues = await client.getReady()
      expect(issues).toEqual([])
    })
  })
})

describe("watchMutations", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it("can be stopped immediately", () => {
    const onMutation = vi.fn()
    const cleanup = watchMutations(onMutation, {
      cwd: "/nonexistent/12345",
      interval: 100,
    })

    cleanup()

    expect(onMutation).not.toHaveBeenCalled()
  })

  it("retries connection when socket does not exist", async () => {
    const onMutation = vi.fn()
    const cleanup = watchMutations(onMutation, {
      cwd: "/nonexistent/12345",
      interval: 100,
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(onMutation).not.toHaveBeenCalled()

    cleanup()
  })

  it("uses default polling interval of 1000ms", async () => {
    const onMutation = vi.fn()
    const cleanup = watchMutations(onMutation, {
      cwd: "/nonexistent/12345",
    })

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(500)
    await vi.advanceTimersByTimeAsync(500)

    cleanup()
  })

  it("respects custom polling interval", async () => {
    const onMutation = vi.fn()
    const cleanup = watchMutations(onMutation, {
      cwd: "/nonexistent/12345",
      interval: 2000,
    })

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)

    cleanup()
  })

  it("stops polling after cleanup is called", async () => {
    const onMutation = vi.fn()
    const cleanup = watchMutations(onMutation, {
      cwd: "/nonexistent/12345",
      interval: 100,
    })

    await vi.advanceTimersByTimeAsync(0)

    cleanup()

    await vi.advanceTimersByTimeAsync(1000)

    expect(onMutation).not.toHaveBeenCalled()
  })

  it("initializes with current timestamp by default", () => {
    vi.setSystemTime(new Date("2024-01-15T12:00:00.000Z"))

    const onMutation = vi.fn()
    const cleanup = watchMutations(onMutation, {
      cwd: "/nonexistent/12345",
      interval: 100,
    })

    cleanup()
  })

  it("respects custom since timestamp", () => {
    const onMutation = vi.fn()
    const cleanup = watchMutations(onMutation, {
      cwd: "/nonexistent/12345",
      interval: 100,
      since: 1600000000000,
    })

    cleanup()
  })

  it("cleanup is idempotent", () => {
    const onMutation = vi.fn()
    const cleanup = watchMutations(onMutation, {
      cwd: "/nonexistent/12345",
      interval: 100,
    })

    cleanup()
    cleanup()
    cleanup()

    expect(onMutation).not.toHaveBeenCalled()
  })
})
