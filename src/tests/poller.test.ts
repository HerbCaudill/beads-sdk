import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ChangePoller } from "../poller.js"
import type { Transport } from "../types.js"

/** Create a mock transport that returns stats. */
function mockTransport(statsSequence: unknown[]): Transport {
  let callIndex = 0
  return {
    send: vi.fn(async () => {
      const result = statsSequence[Math.min(callIndex, statsSequence.length - 1)]
      callIndex++
      return result
    }),
    close: vi.fn(),
  }
}

describe("ChangePoller", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("calls stats on start", async () => {
    const transport = mockTransport([{ total: 5 }])
    const poller = new ChangePoller(transport)
    poller.start(1000)

    // Let the initial poll complete
    await vi.advanceTimersByTimeAsync(0)

    expect(transport.send).toHaveBeenCalledWith("stats", {})
    poller.stop()
  })

  it("detects changes when stats differ", async () => {
    const transport = mockTransport([{ total: 5 }, { total: 6 }])
    const callback = vi.fn()

    const poller = new ChangePoller(transport)
    poller.onChange(callback)
    poller.start(1000)

    // First poll (establishes baseline)
    await vi.advanceTimersByTimeAsync(0)
    expect(callback).not.toHaveBeenCalled()

    // Second poll (detects change)
    await vi.advanceTimersByTimeAsync(1000)
    expect(callback).toHaveBeenCalledTimes(1)

    poller.stop()
  })

  it("does not fire when stats are unchanged", async () => {
    const stats = { total: 5 }
    const transport = mockTransport([stats, stats, stats])
    const callback = vi.fn()

    const poller = new ChangePoller(transport)
    poller.onChange(callback)
    poller.start(1000)

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)

    expect(callback).not.toHaveBeenCalled()
    poller.stop()
  })

  it("stops polling when stop() is called", async () => {
    const transport = mockTransport([{ total: 1 }])
    const poller = new ChangePoller(transport)
    poller.start(1000)

    await vi.advanceTimersByTimeAsync(0)
    poller.stop()

    // Advancing timers should not cause more calls
    const callCount = (transport.send as ReturnType<typeof vi.fn>).mock.calls.length
    await vi.advanceTimersByTimeAsync(5000)
    expect((transport.send as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCount)
  })

  it("unsubscribes callbacks", async () => {
    const transport = mockTransport([{ total: 1 }, { total: 2 }])
    const callback = vi.fn()

    const poller = new ChangePoller(transport)
    const unsubscribe = poller.onChange(callback)
    poller.start(1000)

    await vi.advanceTimersByTimeAsync(0)
    unsubscribe()

    await vi.advanceTimersByTimeAsync(1000)
    expect(callback).not.toHaveBeenCalled()
    poller.stop()
  })

  it("survives transport errors", async () => {
    const transport: Transport = {
      send: vi.fn(async () => {
        throw new Error("connection refused")
      }),
      close: vi.fn(),
    }
    const callback = vi.fn()

    const poller = new ChangePoller(transport)
    poller.onChange(callback)
    poller.start(1000)

    // Should not throw
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)

    expect(callback).not.toHaveBeenCalled()
    poller.stop()
  })
})
