import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { JsonlTransport } from "../jsonl.js"
import type { Issue, BlockedIssue, Stats } from "../../types.js"

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

describe("JsonlTransport", () => {
  let tempDir: string
  let beadsDir: string
  let jsonlPath: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "beads-jsonl-test-"))
    beadsDir = join(tempDir, ".beads")
    mkdirSync(beadsDir)
    jsonlPath = join(beadsDir, "issues.jsonl")
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe("load", () => {
    it("loads issues from a JSONL file", () => {
      const issues = [makeIssue({ id: "bd-1" }), makeIssue({ id: "bd-2", title: "Second" })]
      writeFileSync(jsonlPath, issues.map(i => JSON.stringify(i)).join("\n"))

      const transport = new JsonlTransport(tempDir)
      expect(transport.load()).toBe(true)
    })

    it("returns false when no JSONL file exists", () => {
      rmSync(jsonlPath, { force: true })
      const transport = new JsonlTransport(tempDir)
      expect(transport.load()).toBe(false)
    })

    it("skips malformed lines", () => {
      writeFileSync(jsonlPath, `${JSON.stringify(makeIssue())}\nnot json\n`)
      const transport = new JsonlTransport(tempDir)
      expect(transport.load()).toBe(true)
    })
  })

  describe("list", () => {
    it("returns all issues", async () => {
      writeFileSync(
        jsonlPath,
        [makeIssue({ id: "bd-1" }), makeIssue({ id: "bd-2" })]
          .map(i => JSON.stringify(i))
          .join("\n"),
      )
      const transport = new JsonlTransport(tempDir)
      transport.load()

      const result = (await transport.send("list", {})) as Issue[]
      expect(result).toHaveLength(2)
    })

    it("filters by status", async () => {
      writeFileSync(
        jsonlPath,
        [makeIssue({ id: "bd-1", status: "open" }), makeIssue({ id: "bd-2", status: "closed" })]
          .map(i => JSON.stringify(i))
          .join("\n"),
      )
      const transport = new JsonlTransport(tempDir)
      transport.load()

      const result = (await transport.send("list", { status: "open" })) as Issue[]
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe("bd-1")
    })

    it("filters by priority", async () => {
      writeFileSync(
        jsonlPath,
        [makeIssue({ id: "bd-1", priority: 1 }), makeIssue({ id: "bd-2", priority: 3 })]
          .map(i => JSON.stringify(i))
          .join("\n"),
      )
      const transport = new JsonlTransport(tempDir)
      transport.load()

      const result = (await transport.send("list", { priority: 1 })) as Issue[]
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe("bd-1")
    })

    it("filters by assignee", async () => {
      writeFileSync(
        jsonlPath,
        [makeIssue({ id: "bd-1", assignee: "alice" }), makeIssue({ id: "bd-2", assignee: "bob" })]
          .map(i => JSON.stringify(i))
          .join("\n"),
      )
      const transport = new JsonlTransport(tempDir)
      transport.load()

      const result = (await transport.send("list", { assignee: "alice" })) as Issue[]
      expect(result).toHaveLength(1)
      expect(result[0].assignee).toBe("alice")
    })

    it("filters by labels (AND)", async () => {
      writeFileSync(
        jsonlPath,
        [
          makeIssue({ id: "bd-1", labels: ["bug", "urgent"] }),
          makeIssue({ id: "bd-2", labels: ["bug"] }),
          makeIssue({ id: "bd-3", labels: ["feature"] }),
        ]
          .map(i => JSON.stringify(i))
          .join("\n"),
      )
      const transport = new JsonlTransport(tempDir)
      transport.load()

      const result = (await transport.send("list", { labels: ["bug", "urgent"] })) as Issue[]
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe("bd-1")
    })

    it("filters by labels_any (OR)", async () => {
      writeFileSync(
        jsonlPath,
        [
          makeIssue({ id: "bd-1", labels: ["bug"] }),
          makeIssue({ id: "bd-2", labels: ["feature"] }),
          makeIssue({ id: "bd-3", labels: ["docs"] }),
        ]
          .map(i => JSON.stringify(i))
          .join("\n"),
      )
      const transport = new JsonlTransport(tempDir)
      transport.load()

      const result = (await transport.send("list", { labels_any: ["bug", "feature"] })) as Issue[]
      expect(result).toHaveLength(2)
    })

    it("filters by query text", async () => {
      writeFileSync(
        jsonlPath,
        [
          makeIssue({ id: "bd-1", title: "Fix login bug" }),
          makeIssue({ id: "bd-2", title: "Add dashboard" }),
        ]
          .map(i => JSON.stringify(i))
          .join("\n"),
      )
      const transport = new JsonlTransport(tempDir)
      transport.load()

      const result = (await transport.send("list", { query: "login" })) as Issue[]
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe("bd-1")
    })

    it("respects limit", async () => {
      const issues = Array.from({ length: 10 }, (_, i) => makeIssue({ id: `bd-${i}` }))
      writeFileSync(jsonlPath, issues.map(i => JSON.stringify(i)).join("\n"))
      const transport = new JsonlTransport(tempDir)
      transport.load()

      const result = (await transport.send("list", { limit: 3 })) as Issue[]
      expect(result).toHaveLength(3)
    })
  })

  describe("show", () => {
    it("returns a single issue by ID", async () => {
      writeFileSync(jsonlPath, JSON.stringify(makeIssue({ id: "bd-42", title: "My issue" })))
      const transport = new JsonlTransport(tempDir)
      transport.load()

      const result = (await transport.send("show", { id: "bd-42" })) as Issue
      expect(result.id).toBe("bd-42")
      expect(result.title).toBe("My issue")
    })

    it("throws for unknown ID", async () => {
      writeFileSync(jsonlPath, JSON.stringify(makeIssue()))
      const transport = new JsonlTransport(tempDir)
      transport.load()

      await expect(transport.send("show", { id: "bd-nope" })).rejects.toThrow("Issue not found")
    })
  })

  describe("ready", () => {
    it("returns open issues with no blockers", async () => {
      writeFileSync(
        jsonlPath,
        [
          makeIssue({ id: "bd-1", status: "open" }),
          makeIssue({ id: "bd-2", status: "closed" }),
          makeIssue({ id: "bd-3", status: "in_progress" }),
        ]
          .map(i => JSON.stringify(i))
          .join("\n"),
      )
      const transport = new JsonlTransport(tempDir)
      transport.load()

      const result = (await transport.send("ready", {})) as Issue[]
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe("bd-1")
    })

    it("excludes issues with open blockers", async () => {
      writeFileSync(
        jsonlPath,
        [
          makeIssue({ id: "bd-blocker", status: "open" }),
          makeIssue({
            id: "bd-blocked",
            status: "open",
            dependencies: [
              {
                issue_id: "bd-blocked",
                depends_on_id: "bd-blocker",
                type: "blocks",
                created_at: "2025-01-01T00:00:00Z",
              },
            ],
          }),
          makeIssue({ id: "bd-free", status: "open" }),
        ]
          .map(i => JSON.stringify(i))
          .join("\n"),
      )
      const transport = new JsonlTransport(tempDir)
      transport.load()

      const result = (await transport.send("ready", {})) as Issue[]
      const ids = result.map(i => i.id)
      expect(ids).toContain("bd-blocker")
      expect(ids).toContain("bd-free")
      expect(ids).not.toContain("bd-blocked")
    })
  })

  describe("blocked", () => {
    it("returns issues with open blockers", async () => {
      writeFileSync(
        jsonlPath,
        [
          makeIssue({ id: "bd-blocker", status: "open" }),
          makeIssue({
            id: "bd-blocked",
            status: "open",
            dependencies: [
              {
                issue_id: "bd-blocked",
                depends_on_id: "bd-blocker",
                type: "blocks",
                created_at: "2025-01-01T00:00:00Z",
              },
            ],
          }),
          makeIssue({ id: "bd-free", status: "open" }),
        ]
          .map(i => JSON.stringify(i))
          .join("\n"),
      )
      const transport = new JsonlTransport(tempDir)
      transport.load()

      const result = (await transport.send("blocked", {})) as BlockedIssue[]
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe("bd-blocked")
      expect(result[0].blocked_by).toEqual(["bd-blocker"])
      expect(result[0].blocked_by_count).toBe(1)
    })

    it("includes explicitly blocked status issues", async () => {
      writeFileSync(
        jsonlPath,
        [makeIssue({ id: "bd-1", status: "blocked" }), makeIssue({ id: "bd-2", status: "open" })]
          .map(i => JSON.stringify(i))
          .join("\n"),
      )
      const transport = new JsonlTransport(tempDir)
      transport.load()

      const result = (await transport.send("blocked", {})) as BlockedIssue[]
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe("bd-1")
    })
  })

  describe("stats", () => {
    it("computes summary statistics", async () => {
      writeFileSync(
        jsonlPath,
        [
          makeIssue({ id: "bd-1", status: "open" }),
          makeIssue({ id: "bd-2", status: "open" }),
          makeIssue({ id: "bd-3", status: "in_progress" }),
          makeIssue({
            id: "bd-4",
            status: "closed",
            created_at: "2025-01-01T00:00:00Z",
            closed_at: "2025-01-02T00:00:00Z",
          }),
          makeIssue({ id: "bd-5", status: "blocked" }),
        ]
          .map(i => JSON.stringify(i))
          .join("\n"),
      )
      const transport = new JsonlTransport(tempDir)
      transport.load()

      const result = (await transport.send("stats", {})) as Stats
      expect(result.summary.total_issues).toBe(5)
      expect(result.summary.open_issues).toBe(2)
      expect(result.summary.in_progress_issues).toBe(1)
      expect(result.summary.closed_issues).toBe(1)
      expect(result.summary.blocked_issues).toBe(1)
      expect(result.summary.average_lead_time_hours).toBe(24)
    })
  })

  describe("unsupported operations", () => {
    it("throws for write operations", async () => {
      writeFileSync(jsonlPath, JSON.stringify(makeIssue()))
      const transport = new JsonlTransport(tempDir)
      transport.load()

      await expect(transport.send("create", { title: "x" })).rejects.toThrow("read-only")
      await expect(transport.send("update", { id: "x" })).rejects.toThrow("read-only")
      await expect(transport.send("close", { id: "x" })).rejects.toThrow("read-only")
    })
  })

  describe("dependencies", () => {
    it("builds linked issues from dependency records", async () => {
      writeFileSync(
        jsonlPath,
        [
          makeIssue({ id: "bd-parent", title: "Parent" }),
          makeIssue({
            id: "bd-child",
            title: "Child",
            dependencies: [
              {
                issue_id: "bd-child",
                depends_on_id: "bd-parent",
                type: "parent-child",
                created_at: "2025-01-01T00:00:00Z",
              },
            ],
            dependency_count: 1,
          }),
        ]
          .map(i => JSON.stringify(i))
          .join("\n"),
      )
      const transport = new JsonlTransport(tempDir)
      transport.load()

      const child = (await transport.send("show", { id: "bd-child" })) as Issue
      expect(child.dependencies).toHaveLength(1)
      expect(child.dependencies[0].id).toBe("bd-parent")
      expect(child.dependencies[0].dependency_type).toBe("parent-child")

      const parent = (await transport.send("show", { id: "bd-parent" })) as Issue
      expect(parent.dependents).toHaveLength(1)
      expect(parent.dependents[0].id).toBe("bd-child")
    })

    it("computes fallback dependency_count for linked issues when raw field is missing", async () => {
      // bd-a depends on bd-b and bd-c (two dependencies)
      // bd-b has no explicit dependency_count or dependent_count fields
      writeFileSync(
        jsonlPath,
        [
          makeIssue({
            id: "bd-a",
            title: "A",
            dependencies: [
              {
                issue_id: "bd-a",
                depends_on_id: "bd-b",
                type: "blocks",
                created_at: "2025-01-01T00:00:00Z",
              },
              {
                issue_id: "bd-a",
                depends_on_id: "bd-c",
                type: "blocks",
                created_at: "2025-01-01T00:00:00Z",
              },
            ],
            // omit dependency_count — should fall back to dependencies.length = 2
            dependency_count: undefined,
            dependent_count: undefined,
          }),
          makeIssue({
            id: "bd-b",
            title: "B",
            dependencies: [
              {
                issue_id: "bd-b",
                depends_on_id: "bd-c",
                type: "related",
                created_at: "2025-01-01T00:00:00Z",
              },
            ],
            // omit both counts — should compute fallback
            dependency_count: undefined,
            dependent_count: undefined,
          }),
          makeIssue({
            id: "bd-c",
            title: "C",
            // omit counts
            dependency_count: undefined,
            dependent_count: undefined,
          }),
        ]
          .map(i => JSON.stringify(i))
          .join("\n"),
      )

      const transport = new JsonlTransport(tempDir)
      transport.load()

      // Top-level issue bd-b should compute fallback counts
      const topB = (await transport.send("show", { id: "bd-b" })) as Issue
      expect(topB.dependency_count).toBe(1) // bd-b depends on bd-c
      expect(topB.dependent_count).toBe(1) // bd-a depends on bd-b

      // Now check bd-b as a linked issue (dependency) in bd-a's show response
      const issueA = (await transport.send("show", { id: "bd-a" })) as Issue
      const linkedB = issueA.dependencies.find(d => d.id === "bd-b")!
      expect(linkedB).toBeDefined()
      // Should match the top-level computed counts, not default to 0
      expect(linkedB.dependency_count).toBe(1)
      expect(linkedB.dependent_count).toBe(1)
    })

    it("computes fallback dependent_count for dependent entries when raw field is missing", async () => {
      // bd-child depends on bd-parent — so bd-parent's dependents include bd-child
      // bd-child also depends on bd-other
      writeFileSync(
        jsonlPath,
        [
          makeIssue({
            id: "bd-parent",
            title: "Parent",
            dependency_count: undefined,
            dependent_count: undefined,
          }),
          makeIssue({
            id: "bd-child",
            title: "Child",
            dependencies: [
              {
                issue_id: "bd-child",
                depends_on_id: "bd-parent",
                type: "parent-child",
                created_at: "2025-01-01T00:00:00Z",
              },
              {
                issue_id: "bd-child",
                depends_on_id: "bd-other",
                type: "blocks",
                created_at: "2025-01-01T00:00:00Z",
              },
            ],
            dependency_count: undefined,
            dependent_count: undefined,
          }),
          makeIssue({
            id: "bd-other",
            title: "Other",
            dependency_count: undefined,
            dependent_count: undefined,
          }),
        ]
          .map(i => JSON.stringify(i))
          .join("\n"),
      )

      const transport = new JsonlTransport(tempDir)
      transport.load()

      // Top-level bd-child should have dependency_count=2, dependent_count=0
      const topChild = (await transport.send("show", { id: "bd-child" })) as Issue
      expect(topChild.dependency_count).toBe(2)
      expect(topChild.dependent_count).toBe(0)

      // bd-child as a dependent entry on bd-parent's show response
      const parent = (await transport.send("show", { id: "bd-parent" })) as Issue
      const depChild = parent.dependents.find(d => d.id === "bd-child")!
      expect(depChild).toBeDefined()
      // Should match the top-level computed counts, not default to 0
      expect(depChild.dependency_count).toBe(2)
      expect(depChild.dependent_count).toBe(0)
    })

    it("returns consistent counts between top-level and linked views", async () => {
      // A chain: bd-1 -> bd-2 -> bd-3, all without raw count fields
      writeFileSync(
        jsonlPath,
        [
          makeIssue({
            id: "bd-1",
            title: "First",
            dependencies: [
              {
                issue_id: "bd-1",
                depends_on_id: "bd-2",
                type: "blocks",
                created_at: "2025-01-01T00:00:00Z",
              },
            ],
            dependency_count: undefined,
            dependent_count: undefined,
          }),
          makeIssue({
            id: "bd-2",
            title: "Second",
            dependencies: [
              {
                issue_id: "bd-2",
                depends_on_id: "bd-3",
                type: "blocks",
                created_at: "2025-01-01T00:00:00Z",
              },
            ],
            dependency_count: undefined,
            dependent_count: undefined,
          }),
          makeIssue({
            id: "bd-3",
            title: "Third",
            dependency_count: undefined,
            dependent_count: undefined,
          }),
        ]
          .map(i => JSON.stringify(i))
          .join("\n"),
      )

      const transport = new JsonlTransport(tempDir)
      transport.load()

      // Get top-level views of all three
      const top1 = (await transport.send("show", { id: "bd-1" })) as Issue
      const top2 = (await transport.send("show", { id: "bd-2" })) as Issue
      const top3 = (await transport.send("show", { id: "bd-3" })) as Issue

      // bd-2 as linked in bd-1's dependencies
      const linked2 = top1.dependencies.find(d => d.id === "bd-2")!
      expect(linked2.dependency_count).toBe(top2.dependency_count)
      expect(linked2.dependent_count).toBe(top2.dependent_count)

      // bd-1 as dependent in bd-2's dependents
      const dep1 = top2.dependents.find(d => d.id === "bd-1")!
      expect(dep1.dependency_count).toBe(top1.dependency_count)
      expect(dep1.dependent_count).toBe(top1.dependent_count)

      // bd-2 as dependent in bd-3's dependents
      const dep2 = top3.dependents.find(d => d.id === "bd-2")!
      expect(dep2.dependency_count).toBe(top2.dependency_count)
      expect(dep2.dependent_count).toBe(top2.dependent_count)
    })
  })

  describe("close", () => {
    it("releases resources", () => {
      writeFileSync(jsonlPath, JSON.stringify(makeIssue()))
      const transport = new JsonlTransport(tempDir)
      transport.load()
      transport.close()
      // Should not throw
    })
  })
})
