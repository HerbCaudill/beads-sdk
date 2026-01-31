import { describe, it, expect, vi } from "vitest"
import { resolveExecOptions, exec, type ResolvedExecOptions, type SpawnFn } from "./exec.js"
import { EventEmitter } from "node:events"
import type { ChildProcess } from "node:child_process"

/** Create a mock child process with controllable stdout, stderr, and lifecycle events. */
function createMockProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: ReturnType<typeof vi.fn>
  }
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.kill = vi.fn()
  return proc
}

/** Create a mock spawn function that returns the given mock process. */
function createMockSpawn(proc: ReturnType<typeof createMockProcess>): SpawnFn {
  return vi.fn(() => proc as unknown as ChildProcess)
}

describe("resolveExecOptions", () => {
  it("applies defaults when called with no arguments", () => {
    const result = resolveExecOptions()
    expect(result.command).toBe("bd")
    expect(result.cwd).toBe(process.cwd())
    expect(result.env).toEqual({})
    expect(result.timeout).toBe(30_000)
    expect(typeof result.spawn).toBe("function")
  })

  it("uses provided values over defaults", () => {
    const customSpawn = vi.fn() as unknown as SpawnFn
    const result = resolveExecOptions({
      command: "custom-bd",
      cwd: "/tmp/test",
      env: { FOO: "bar" },
      spawn: customSpawn,
      timeout: 5000,
    })
    expect(result.command).toBe("custom-bd")
    expect(result.cwd).toBe("/tmp/test")
    expect(result.env).toEqual({ FOO: "bar" })
    expect(result.spawn).toBe(customSpawn)
    expect(result.timeout).toBe(5000)
  })

  it("allows partial overrides", () => {
    const result = resolveExecOptions({ command: "my-bd", timeout: 10_000 })
    expect(result.command).toBe("my-bd")
    expect(result.timeout).toBe(10_000)
    expect(result.cwd).toBe(process.cwd())
    expect(result.env).toEqual({})
  })
})

describe("exec", () => {
  /** Build resolved options using a mock spawn. */
  function makeOptions(proc: ReturnType<typeof createMockProcess>): ResolvedExecOptions {
    return {
      command: "bd",
      cwd: "/test",
      env: {},
      spawn: createMockSpawn(proc),
      timeout: 5000,
    }
  }

  it("resolves with stdout on exit code 0", async () => {
    const proc = createMockProcess()
    const options = makeOptions(proc)

    const promise = exec(["list", "--json"], options)
    proc.stdout.emit("data", Buffer.from('[{"id":"1"}]'))
    proc.emit("close", 0)

    const result = await promise
    expect(result).toBe('[{"id":"1"}]')
  })

  it("concatenates multiple stdout chunks", async () => {
    const proc = createMockProcess()
    const options = makeOptions(proc)

    const promise = exec(["show", "abc"], options)
    proc.stdout.emit("data", Buffer.from('{"id":'))
    proc.stdout.emit("data", Buffer.from('"abc"}'))
    proc.emit("close", 0)

    const result = await promise
    expect(result).toBe('{"id":"abc"}')
  })

  it("rejects with stderr on non-zero exit code", async () => {
    const proc = createMockProcess()
    const options = makeOptions(proc)

    const promise = exec(["show", "bad-id"], options)
    proc.stderr.emit("data", Buffer.from("issue not found"))
    proc.emit("close", 1)

    await expect(promise).rejects.toThrow("bd exited with code 1: issue not found")
  })

  it("falls back to stdout in error message when stderr is empty", async () => {
    const proc = createMockProcess()
    const options = makeOptions(proc)

    const promise = exec(["fail"], options)
    proc.stdout.emit("data", Buffer.from("some stdout output"))
    proc.emit("close", 2)

    await expect(promise).rejects.toThrow("bd exited with code 2: some stdout output")
  })

  it("rejects on process error", async () => {
    const proc = createMockProcess()
    const options = makeOptions(proc)

    const promise = exec(["list"], options)
    proc.emit("error", new Error("spawn ENOENT"))

    await expect(promise).rejects.toThrow("spawn ENOENT")
  })

  it("rejects on timeout and kills the process", async () => {
    vi.useFakeTimers()
    const proc = createMockProcess()
    const options: ResolvedExecOptions = {
      command: "bd",
      cwd: "/test",
      env: {},
      spawn: createMockSpawn(proc),
      timeout: 100,
    }

    const promise = exec(["slow-command"], options)

    // Advance timers and immediately await the rejection in the same microtask chain
    const advancePromise = vi.advanceTimersByTimeAsync(100)
    await expect(promise).rejects.toThrow("bd command timed out after 100ms")
    await advancePromise

    expect(proc.kill).toHaveBeenCalledWith("SIGKILL")
    vi.useRealTimers()
  })

  it("passes correct arguments to spawn", async () => {
    const proc = createMockProcess()
    const mockSpawn = createMockSpawn(proc)
    const options: ResolvedExecOptions = {
      command: "custom-bd",
      cwd: "/my/project",
      env: { MY_VAR: "value" },
      spawn: mockSpawn,
      timeout: 5000,
    }

    const promise = exec(["create", "--json", "My issue"], options)
    proc.emit("close", 0)
    await promise

    expect(mockSpawn).toHaveBeenCalledWith(
      "custom-bd",
      ["create", "--json", "My issue"],
      expect.objectContaining({
        cwd: "/my/project",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    )

    // Verify env merging
    const callEnv = (mockSpawn as ReturnType<typeof vi.fn>).mock.calls[0][2].env
    expect(callEnv.MY_VAR).toBe("value")
    expect(callEnv.PATH).toBeDefined() // process.env merged in
  })

  it("clears timeout on successful close", async () => {
    vi.useFakeTimers()
    const proc = createMockProcess()
    const options: ResolvedExecOptions = {
      command: "bd",
      cwd: "/test",
      env: {},
      spawn: createMockSpawn(proc),
      timeout: 5000,
    }

    const promise = exec(["list"], options)
    proc.stdout.emit("data", Buffer.from("ok"))
    proc.emit("close", 0)
    await promise

    // If timeout wasn't cleared, advancing time would cause issues
    await vi.advanceTimersByTimeAsync(10_000)
    vi.useRealTimers()
  })

  it("clears timeout on process error", async () => {
    vi.useFakeTimers()
    const proc = createMockProcess()
    const options: ResolvedExecOptions = {
      command: "bd",
      cwd: "/test",
      env: {},
      spawn: createMockSpawn(proc),
      timeout: 5000,
    }

    const promise = exec(["list"], options)
    proc.emit("error", new Error("ENOENT"))
    await expect(promise).rejects.toThrow()

    // No timeout rejection after error
    await vi.advanceTimersByTimeAsync(10_000)
    vi.useRealTimers()
  })
})
