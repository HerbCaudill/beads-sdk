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

  it("does not overlap polls when a request takes longer than the interval", async () => {
    let activeCalls = 0
    let maxConcurrent = 0

    const transport: Transport = {
      send: vi.fn(async () => {
        activeCalls++
        maxConcurrent = Math.max(maxConcurrent, activeCalls)
        // Simulate a slow response that takes 3x the poll interval
        await new Promise(resolve => setTimeout(resolve, 3000))
        activeCalls--
        return { total: 5 }
      }),
      close: vi.fn(),
    }

    const poller = new ChangePoller(transport)
    poller.start(1000)

    // Advance time well past multiple intervals, giving slow polls time to complete
    await vi.advanceTimersByTimeAsync(10000)

    expect(maxConcurrent).toBe(1)
    poller.stop()
  })

  it("does not produce spurious notifications from out-of-order slow responses", async () => {
    // Simulate: poll 1 returns {total:5} slowly, poll 2 returns {total:5} fast,
    // poll 3 returns {total:6}. If poll 1 completes after poll 2, lastHash could
    // flip-flop and produce duplicate/spurious change notifications.
    let callIndex = 0
    const delays = [3000, 100, 100]
    const results = [{ total: 5 }, { total: 5 }, { total: 6 }]

    const transport: Transport = {
      send: vi.fn(async () => {
        const idx = Math.min(callIndex, results.length - 1)
        const delay = delays[Math.min(callIndex, delays.length - 1)]
        callIndex++
        await new Promise(resolve => setTimeout(resolve, delay))
        return results[idx]
      }),
      close: vi.fn(),
    }

    const callback = vi.fn()
    const poller = new ChangePoller(transport)
    poller.onChange(callback)
    poller.start(1000)

    // Run through enough time for all polls to complete
    await vi.advanceTimersByTimeAsync(15000)

    // With sequential (non-overlapping) polls, we expect exactly one change
    // notification: when stats switch from {total:5} to {total:6}.
    expect(callback).toHaveBeenCalledTimes(1)
    poller.stop()
  })

  it("skips poll when previous one is still in flight", async () => {
    let callCount = 0
    const transport: Transport = {
      send: vi.fn(async () => {
        callCount++
        // Each poll takes 2500ms but interval is 1000ms
        await new Promise(resolve => setTimeout(resolve, 2500))
        return { total: callCount }
      }),
      close: vi.fn(),
    }

    const poller = new ChangePoller(transport)
    poller.start(1000)

    // Advance 5 seconds. Without guarding, setInterval would fire 5+ times.
    // With guarding, only polls that start after the previous one finishes should run.
    await vi.advanceTimersByTimeAsync(5000)

    // With 2500ms per poll and 1000ms interval, after 5000ms we should have:
    // - Poll 1 starts at 0, finishes at 2500
    // - Poll 2 starts at 3000 (next interval tick after 2500), finishes at 5500
    // So at most 2 calls should have started by t=5000
    expect(callCount).toBeLessThanOrEqual(2)
    poller.stop()
  })
})
