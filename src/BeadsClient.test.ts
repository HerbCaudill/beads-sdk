import { describe, it, expect, vi, beforeEach } from "vitest"
import { BeadsClient } from "./BeadsClient.js"
import type { BdIssue, MutationEvent } from "./types.js"
import { EventEmitter } from "node:events"
import type { ChildProcess } from "node:child_process"
import type { SpawnFn } from "./exec.js"

/** Create a mock spawn that resolves with the given stdout JSON. */
function mockSpawnWithOutput(output: string): SpawnFn {
  return vi.fn(() => {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      kill: ReturnType<typeof vi.fn>
    }
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.kill = vi.fn()

    // Emit stdout and close on next tick
    queueMicrotask(() => {
      proc.stdout.emit("data", Buffer.from(output))
      proc.emit("close", 0)
    })

    return proc as unknown as ChildProcess
  })
}

/** Create a mock spawn that exits with an error. */
function mockSpawnWithError(stderr: string, code = 1): SpawnFn {
  return vi.fn(() => {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      kill: ReturnType<typeof vi.fn>
    }
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.kill = vi.fn()

    queueMicrotask(() => {
      proc.stderr.emit("data", Buffer.from(stderr))
      proc.emit("close", code)
    })

    return proc as unknown as ChildProcess
  })
}

/** Extract the args passed to bd from a mock spawn call. */
function getSpawnArgs(spawnFn: SpawnFn): string[] {
  return (spawnFn as ReturnType<typeof vi.fn>).mock.calls[0][1]
}

/** Sample issue for test fixtures. */
const sampleIssue: BdIssue = {
  id: "beads-001",
  title: "Test issue",
  status: "open",
  priority: 2,
  issue_type: "task",
  created_at: "2024-01-15T12:00:00Z",
  updated_at: "2024-01-15T12:00:00Z",
}

describe("BeadsClient", () => {
  let spawn: SpawnFn
  let client: BeadsClient

  /** Set up client with a mock spawn that returns the given output. */
  function setup(output: string) {
    spawn = mockSpawnWithOutput(output)
    client = new BeadsClient({ spawn, cwd: "/test" })
  }

  describe("list", () => {
    it("returns parsed issues", async () => {
      setup(JSON.stringify([sampleIssue]))
      const issues = await client.list()
      expect(issues).toEqual([sampleIssue])
      expect(getSpawnArgs(spawn)).toEqual(["list", "--json"])
    })

    it("passes all filter options as arguments", async () => {
      setup("[]")
      await client.list({
        limit: 10,
        status: "open",
        priority: 1,
        type: "bug",
        assignee: "herb",
        parent: "beads-000",
        ready: true,
        all: true,
      })
      const args = getSpawnArgs(spawn)
      expect(args).toContain("--limit")
      expect(args).toContain("10")
      expect(args).toContain("--status")
      expect(args).toContain("open")
      expect(args).toContain("--priority")
      expect(args).toContain("1")
      expect(args).toContain("--type")
      expect(args).toContain("bug")
      expect(args).toContain("--assignee")
      expect(args).toContain("herb")
      expect(args).toContain("--parent")
      expect(args).toContain("beads-000")
      expect(args).toContain("--ready")
      expect(args).toContain("--all")
    })

    it("omits unset filter options", async () => {
      setup("[]")
      await client.list({ status: "open" })
      const args = getSpawnArgs(spawn)
      expect(args).toEqual(["list", "--json", "--status", "open"])
    })
  })

  describe("blocked", () => {
    it("returns parsed blocked issues", async () => {
      setup(JSON.stringify([sampleIssue]))
      const issues = await client.blocked()
      expect(issues).toEqual([sampleIssue])
      expect(getSpawnArgs(spawn)).toEqual(["blocked", "--json"])
    })

    it("passes parent filter", async () => {
      setup("[]")
      await client.blocked("beads-000")
      expect(getSpawnArgs(spawn)).toEqual(["blocked", "--json", "--parent", "beads-000"])
    })
  })

  describe("show", () => {
    it("handles a single ID", async () => {
      setup(JSON.stringify([sampleIssue]))
      const issues = await client.show("beads-001")
      expect(issues).toEqual([sampleIssue])
      expect(getSpawnArgs(spawn)).toEqual(["show", "--json", "beads-001"])
    })

    it("handles multiple IDs", async () => {
      setup(JSON.stringify([sampleIssue, { ...sampleIssue, id: "beads-002" }]))
      const issues = await client.show(["beads-001", "beads-002"])
      expect(issues).toHaveLength(2)
      expect(getSpawnArgs(spawn)).toEqual(["show", "--json", "beads-001", "beads-002"])
    })
  })

  describe("listWithParents", () => {
    it("returns empty array for empty list", async () => {
      setup("[]")
      const issues = await client.listWithParents()
      expect(issues).toEqual([])
    })

    it("enriches issues with parent and dependency info", async () => {
      const listIssue: BdIssue = { ...sampleIssue }
      const detailedIssue: BdIssue = {
        ...sampleIssue,
        parent: "beads-000",
        dependencies: [
          {
            ...sampleIssue,
            id: "beads-010",
            dependency_type: "blocks",
            status: "open",
          },
        ],
      }

      // First call: list, second call: show
      let callCount = 0
      spawn = vi.fn(() => {
        const proc = new EventEmitter() as EventEmitter & {
          stdout: EventEmitter
          stderr: EventEmitter
          kill: ReturnType<typeof vi.fn>
        }
        proc.stdout = new EventEmitter()
        proc.stderr = new EventEmitter()
        proc.kill = vi.fn()

        queueMicrotask(() => {
          const output =
            callCount === 0 ? JSON.stringify([listIssue]) : JSON.stringify([detailedIssue])
          callCount++
          proc.stdout.emit("data", Buffer.from(output))
          proc.emit("close", 0)
        })

        return proc as unknown as ChildProcess
      })

      client = new BeadsClient({ spawn, cwd: "/test" })
      const issues = await client.listWithParents()

      expect(issues).toHaveLength(1)
      expect(issues[0].parent).toBe("beads-000")
      expect(issues[0].blocked_by).toEqual(["beads-010"])
      expect(issues[0].blocked_by_count).toBe(1)
      expect(issues[0].status).toBe("blocked")
    })

    it("does not mark non-open issues as blocked", async () => {
      const listIssue: BdIssue = { ...sampleIssue, status: "in_progress" }
      const detailedIssue: BdIssue = {
        ...listIssue,
        dependencies: [
          {
            ...sampleIssue,
            id: "beads-010",
            dependency_type: "blocks",
            status: "open",
          },
        ],
      }

      let callCount = 0
      spawn = vi.fn(() => {
        const proc = new EventEmitter() as EventEmitter & {
          stdout: EventEmitter
          stderr: EventEmitter
          kill: ReturnType<typeof vi.fn>
        }
        proc.stdout = new EventEmitter()
        proc.stderr = new EventEmitter()
        proc.kill = vi.fn()

        queueMicrotask(() => {
          const output =
            callCount === 0 ? JSON.stringify([listIssue]) : JSON.stringify([detailedIssue])
          callCount++
          proc.stdout.emit("data", Buffer.from(output))
          proc.emit("close", 0)
        })

        return proc as unknown as ChildProcess
      })

      client = new BeadsClient({ spawn, cwd: "/test" })
      const issues = await client.listWithParents()

      expect(issues[0].status).toBe("in_progress") // NOT changed to blocked
      expect(issues[0].blocked_by_count).toBe(1) // but still records blockers
    })

    it("ignores closed dependencies when counting blockers", async () => {
      const listIssue: BdIssue = { ...sampleIssue }
      const detailedIssue: BdIssue = {
        ...listIssue,
        dependencies: [
          {
            ...sampleIssue,
            id: "beads-010",
            dependency_type: "blocks",
            status: "closed",
          },
        ],
      }

      let callCount = 0
      spawn = vi.fn(() => {
        const proc = new EventEmitter() as EventEmitter & {
          stdout: EventEmitter
          stderr: EventEmitter
          kill: ReturnType<typeof vi.fn>
        }
        proc.stdout = new EventEmitter()
        proc.stderr = new EventEmitter()
        proc.kill = vi.fn()

        queueMicrotask(() => {
          const output =
            callCount === 0 ? JSON.stringify([listIssue]) : JSON.stringify([detailedIssue])
          callCount++
          proc.stdout.emit("data", Buffer.from(output))
          proc.emit("close", 0)
        })

        return proc as unknown as ChildProcess
      })

      client = new BeadsClient({ spawn, cwd: "/test" })
      const issues = await client.listWithParents()

      expect(issues[0].blocked_by).toBeUndefined()
      expect(issues[0].blocked_by_count).toBeUndefined()
      expect(issues[0].status).toBe("open")
    })
  })

  describe("create", () => {
    it("creates an issue and returns it", async () => {
      setup(JSON.stringify(sampleIssue))
      const issue = await client.create({ title: "New issue" })
      expect(issue.id).toBe("beads-001")
      expect(getSpawnArgs(spawn)).toEqual(["create", "--json", "New issue"])
    })

    it("handles array response from bd", async () => {
      setup(JSON.stringify([sampleIssue]))
      const issue = await client.create({ title: "New issue" })
      expect(issue.id).toBe("beads-001")
    })

    it("passes all creation options", async () => {
      setup(JSON.stringify(sampleIssue))
      await client.create({
        title: "Bug fix",
        description: "Fix the thing",
        priority: 1,
        type: "bug",
        assignee: "herb",
        parent: "beads-000",
        labels: ["urgent", "frontend"],
      })
      const args = getSpawnArgs(spawn)
      expect(args).toContain("Bug fix")
      expect(args).toContain("--description")
      expect(args).toContain("Fix the thing")
      expect(args).toContain("--priority")
      expect(args).toContain("1")
      expect(args).toContain("--type")
      expect(args).toContain("bug")
      expect(args).toContain("--assignee")
      expect(args).toContain("herb")
      expect(args).toContain("--parent")
      expect(args).toContain("beads-000")
      expect(args).toContain("--labels")
      expect(args).toContain("urgent,frontend")
    })

    it("throws if bd returns no issue", async () => {
      setup("{}")
      await expect(client.create({ title: "Bad" })).rejects.toThrow(
        "bd create did not return an issue",
      )
    })
  })

  describe("update", () => {
    it("updates a single issue", async () => {
      setup(JSON.stringify([sampleIssue]))
      const issues = await client.update("beads-001", { title: "Updated" })
      expect(issues).toEqual([sampleIssue])
      expect(getSpawnArgs(spawn)).toEqual(["update", "--json", "beads-001", "--title", "Updated"])
    })

    it("updates multiple issues", async () => {
      setup(JSON.stringify([sampleIssue, sampleIssue]))
      await client.update(["beads-001", "beads-002"], { status: "in_progress" })
      const args = getSpawnArgs(spawn)
      expect(args).toContain("beads-001")
      expect(args).toContain("beads-002")
      expect(args).toContain("--status")
      expect(args).toContain("in_progress")
    })

    it("passes all update options", async () => {
      setup(JSON.stringify([sampleIssue]))
      await client.update("beads-001", {
        title: "New title",
        description: "New desc",
        priority: 0,
        status: "in_progress",
        type: "feature",
        assignee: "alice",
        parent: "beads-000",
        addLabels: ["urgent", "backend"],
        removeLabels: ["stale"],
      })
      const args = getSpawnArgs(spawn)
      expect(args).toContain("--title")
      expect(args).toContain("--description")
      expect(args).toContain("--priority")
      expect(args).toContain("0")
      expect(args).toContain("--status")
      expect(args).toContain("--type")
      expect(args).toContain("--assignee")
      expect(args).toContain("--parent")
      // addLabels: each label gets its own --add-label flag
      expect(args.filter(a => a === "--add-label")).toHaveLength(2)
      expect(args).toContain("urgent")
      expect(args).toContain("backend")
      // removeLabels: each label gets its own --remove-label flag
      expect(args.filter(a => a === "--remove-label")).toHaveLength(1)
      expect(args).toContain("stale")
    })
  })

  describe("close", () => {
    it("closes a single issue", async () => {
      setup(JSON.stringify([sampleIssue]))
      const issues = await client.close("beads-001")
      expect(issues).toEqual([sampleIssue])
      expect(getSpawnArgs(spawn)).toEqual(["close", "--json", "beads-001"])
    })

    it("closes multiple issues", async () => {
      setup(JSON.stringify([sampleIssue, sampleIssue]))
      await client.close(["beads-001", "beads-002"])
      expect(getSpawnArgs(spawn)).toEqual(["close", "--json", "beads-001", "beads-002"])
    })
  })

  describe("delete", () => {
    it("deletes a single issue", async () => {
      setup("")
      await client.delete("beads-001")
      expect(getSpawnArgs(spawn)).toEqual(["delete", "--force", "beads-001"])
    })

    it("deletes multiple issues", async () => {
      setup("")
      await client.delete(["beads-001", "beads-002"])
      expect(getSpawnArgs(spawn)).toEqual(["delete", "--force", "beads-001", "beads-002"])
    })
  })

  describe("addComment", () => {
    it("adds a comment without author", async () => {
      setup("")
      await client.addComment("beads-001", "This is a comment")
      expect(getSpawnArgs(spawn)).toEqual(["comments", "add", "beads-001", "This is a comment"])
    })

    it("adds a comment with author", async () => {
      setup("")
      await client.addComment("beads-001", "A comment", "herb")
      const args = getSpawnArgs(spawn)
      expect(args).toContain("--author")
      expect(args).toContain("herb")
    })
  })

  describe("getComments", () => {
    it("returns parsed comments", async () => {
      const comments = [
        {
          id: 1,
          issue_id: "beads-001",
          author: "herb",
          text: "Hello",
          created_at: "2024-01-15T12:00:00Z",
        },
      ]
      setup(JSON.stringify(comments))
      const result = await client.getComments("beads-001")
      expect(result).toEqual(comments)
      expect(getSpawnArgs(spawn)).toEqual(["comments", "beads-001", "--json"])
    })
  })

  describe("getInfo", () => {
    it("returns parsed database info", async () => {
      const info = {
        database_path: "/test/.beads/db",
        issue_count: 42,
        mode: "git",
        daemon_connected: true,
      }
      setup(JSON.stringify(info))
      const result = await client.getInfo()
      expect(result).toEqual(info)
      expect(getSpawnArgs(spawn)).toEqual(["info", "--json"])
    })
  })

  describe("getLabels", () => {
    it("returns labels for an issue", async () => {
      setup(JSON.stringify(["bug", "urgent"]))
      const labels = await client.getLabels("beads-001")
      expect(labels).toEqual(["bug", "urgent"])
      expect(getSpawnArgs(spawn)).toEqual(["label", "list", "beads-001", "--json"])
    })
  })

  describe("addLabel", () => {
    it("adds a label and returns the result", async () => {
      const result = { issue_id: "beads-001", label: "bug", status: "added" as const }
      setup(JSON.stringify([result]))
      const label = await client.addLabel("beads-001", "bug")
      expect(label).toEqual(result)
      expect(getSpawnArgs(spawn)).toEqual(["label", "add", "beads-001", "bug", "--json"])
    })
  })

  describe("removeLabel", () => {
    it("removes a label and returns the result", async () => {
      const result = { issue_id: "beads-001", label: "bug", status: "removed" as const }
      setup(JSON.stringify([result]))
      const label = await client.removeLabel("beads-001", "bug")
      expect(label).toEqual(result)
      expect(getSpawnArgs(spawn)).toEqual(["label", "remove", "beads-001", "bug", "--json"])
    })
  })

  describe("listAllLabels", () => {
    it("returns all unique labels", async () => {
      setup(JSON.stringify(["bug", "feature", "urgent"]))
      const labels = await client.listAllLabels()
      expect(labels).toEqual(["bug", "feature", "urgent"])
      expect(getSpawnArgs(spawn)).toEqual(["label", "list-all", "--json"])
    })
  })

  describe("addBlocker", () => {
    it("adds a blocking dependency", async () => {
      const result = {
        issue_id: "beads-001",
        depends_on_id: "beads-002",
        status: "added" as const,
      }
      setup(JSON.stringify(result))
      const dep = await client.addBlocker("beads-001", "beads-002")
      expect(dep).toEqual(result)
      expect(getSpawnArgs(spawn)).toEqual(["dep", "add", "beads-001", "beads-002", "--json"])
    })
  })

  describe("removeBlocker", () => {
    it("removes a blocking dependency", async () => {
      const result = {
        issue_id: "beads-001",
        depends_on_id: "beads-002",
        status: "removed" as const,
      }
      setup(JSON.stringify(result))
      const dep = await client.removeBlocker("beads-001", "beads-002")
      expect(dep).toEqual(result)
      expect(getSpawnArgs(spawn)).toEqual(["dep", "remove", "beads-001", "beads-002", "--json"])
    })
  })

  describe("error handling", () => {
    it("rejects when bd exits with non-zero code", async () => {
      spawn = mockSpawnWithError("something went wrong", 1)
      client = new BeadsClient({ spawn, cwd: "/test" })
      await expect(client.list()).rejects.toThrow("bd exited with code 1: something went wrong")
    })
  })

  describe("watchMutations", () => {
    it("delegates to socket watchMutations with client cwd", () => {
      setup("")
      const onMutation = vi.fn()
      const cleanup = client.watchMutations(onMutation, {
        interval: 500,
        since: 1000,
      })

      // Should return a cleanup function
      expect(typeof cleanup).toBe("function")
      cleanup()
    })
  })
})
