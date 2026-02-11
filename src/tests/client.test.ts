import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { BeadsClient } from "../client.js"
import type { Issue } from "../types.js"

/** Create a minimal JSONL issue record. */
function makeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "bd-test.1",
    title: "Test issue",
    description: "A test issue",
    status: "open",
    priority: 2,
    issue_type: "task",
    labels: [],
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    dependency_count: 0,
    dependent_count: 0,
    ...overrides,
  }
}

describe("BeadsClient", () => {
  let tempDir: string
  let beadsDir: string
  let jsonlPath: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "beads-client-test-"))
    beadsDir = join(tempDir, ".beads")
    mkdirSync(beadsDir)
    jsonlPath = join(beadsDir, "issues.jsonl")
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe("connect", () => {
    it("connects via JSONL fallback when no daemon is available", async () => {
      writeFileSync(jsonlPath, JSON.stringify(makeIssue()))
      const client = new BeadsClient()
      await client.connect(tempDir)

      expect(client.isConnected()).toBe(true)
      await client.disconnect()
    })

    it("throws when neither daemon nor JSONL is available", async () => {
      rmSync(jsonlPath, { force: true })
      const client = new BeadsClient()
      await expect(client.connect(tempDir)).rejects.toThrow()
    })
  })

  describe("disconnect", () => {
    it("marks the client as disconnected", async () => {
      writeFileSync(jsonlPath, JSON.stringify(makeIssue()))
      const client = new BeadsClient()
      await client.connect(tempDir)
      await client.disconnect()

      expect(client.isConnected()).toBe(false)
    })
  })

  describe("list", () => {
    it("lists issues from JSONL fallback", async () => {
      writeFileSync(
        jsonlPath,
        [makeIssue({ id: "bd-1" }), makeIssue({ id: "bd-2" })]
          .map(i => JSON.stringify(i))
          .join("\n"),
      )
      const client = new BeadsClient()
      await client.connect(tempDir)

      const issues = await client.list()
      expect(issues).toHaveLength(2)

      await client.disconnect()
    })

    it("filters by status", async () => {
      writeFileSync(
        jsonlPath,
        [makeIssue({ id: "bd-1", status: "open" }), makeIssue({ id: "bd-2", status: "closed" })]
          .map(i => JSON.stringify(i))
          .join("\n"),
      )
      const client = new BeadsClient()
      await client.connect(tempDir)

      const issues = await client.list({ status: "open" })
      expect(issues).toHaveLength(1)
      expect(issues[0].id).toBe("bd-1")

      await client.disconnect()
    })
  })

  describe("show", () => {
    it("shows a single issue", async () => {
      writeFileSync(jsonlPath, JSON.stringify(makeIssue({ id: "bd-42", title: "Special" })))
      const client = new BeadsClient()
      await client.connect(tempDir)

      const issue = await client.show("bd-42")
      expect(issue.id).toBe("bd-42")
      expect(issue.title).toBe("Special")

      await client.disconnect()
    })
  })

  describe("ready", () => {
    it("returns ready issues", async () => {
      writeFileSync(
        jsonlPath,
        [makeIssue({ id: "bd-1", status: "open" }), makeIssue({ id: "bd-2", status: "closed" })]
          .map(i => JSON.stringify(i))
          .join("\n"),
      )
      const client = new BeadsClient()
      await client.connect(tempDir)

      const issues = await client.ready()
      expect(issues).toHaveLength(1)
      expect(issues[0].id).toBe("bd-1")

      await client.disconnect()
    })
  })

  describe("blocked", () => {
    it("returns blocked issues", async () => {
      writeFileSync(
        jsonlPath,
        [makeIssue({ id: "bd-1", status: "blocked" }), makeIssue({ id: "bd-2", status: "open" })]
          .map(i => JSON.stringify(i))
          .join("\n"),
      )
      const client = new BeadsClient()
      await client.connect(tempDir)

      const issues = await client.blocked()
      expect(issues).toHaveLength(1)
      expect(issues[0].id).toBe("bd-1")

      await client.disconnect()
    })
  })

  describe("stats", () => {
    it("computes statistics", async () => {
      writeFileSync(
        jsonlPath,
        [makeIssue({ id: "bd-1", status: "open" }), makeIssue({ id: "bd-2", status: "closed" })]
          .map(i => JSON.stringify(i))
          .join("\n"),
      )
      const client = new BeadsClient()
      await client.connect(tempDir)

      const stats = await client.stats()
      expect(stats.summary.total_issues).toBe(2)
      expect(stats.summary.open_issues).toBe(1)
      expect(stats.summary.closed_issues).toBe(1)

      await client.disconnect()
    })
  })

  describe("write operations in JSONL mode", () => {
    it("throws for create in JSONL fallback mode", async () => {
      writeFileSync(jsonlPath, JSON.stringify(makeIssue()))
      const client = new BeadsClient()
      await client.connect(tempDir)

      await expect(client.create({ title: "New" })).rejects.toThrow("daemon connection")

      await client.disconnect()
    })

    it("throws for update in JSONL fallback mode", async () => {
      writeFileSync(jsonlPath, JSON.stringify(makeIssue()))
      const client = new BeadsClient()
      await client.connect(tempDir)

      await expect(client.update("bd-1", { title: "Updated" })).rejects.toThrow("daemon connection")

      await client.disconnect()
    })

    it("throws for close in JSONL fallback mode", async () => {
      writeFileSync(jsonlPath, JSON.stringify(makeIssue()))
      const client = new BeadsClient()
      await client.connect(tempDir)

      await expect(client.close("bd-1")).rejects.toThrow("daemon connection")

      await client.disconnect()
    })

    it("throws for addDependency in JSONL fallback mode", async () => {
      writeFileSync(jsonlPath, JSON.stringify(makeIssue()))
      const client = new BeadsClient()
      await client.connect(tempDir)

      await expect(client.addDependency("bd-1", "bd-2", "blocks")).rejects.toThrow(
        "daemon connection",
      )

      await client.disconnect()
    })
  })

  describe("onChange", () => {
    it("subscribes and unsubscribes", async () => {
      writeFileSync(jsonlPath, JSON.stringify(makeIssue()))
      const client = new BeadsClient()
      await client.connect(tempDir)

      const callback = vi.fn()
      const unsub = client.onChange(callback)
      expect(typeof unsub).toBe("function")

      unsub()
      await client.disconnect()
    })
  })

  describe("not connected", () => {
    it("throws when calling methods before connect", async () => {
      const client = new BeadsClient()
      await expect(client.list()).rejects.toThrow("Not connected")
    })
  })
})
