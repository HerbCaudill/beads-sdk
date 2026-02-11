import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { findSocketPath, findJsonlPath, findBeadsDir } from "../discovery.js"

describe("discovery", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "beads-test-"))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe("findSocketPath", () => {
    it("finds socket in the workspace root", () => {
      const beadsDir = join(tempDir, ".beads")
      mkdirSync(beadsDir)
      const socketPath = join(beadsDir, "bd.sock")
      writeFileSync(socketPath, "")

      expect(findSocketPath(tempDir)).toBe(socketPath)
    })

    it("finds socket in a parent directory", () => {
      const beadsDir = join(tempDir, ".beads")
      mkdirSync(beadsDir)
      const socketPath = join(beadsDir, "bd.sock")
      writeFileSync(socketPath, "")

      const nested = join(tempDir, "a", "b", "c")
      mkdirSync(nested, { recursive: true })

      expect(findSocketPath(nested)).toBe(socketPath)
    })

    it("returns null when no socket exists", () => {
      expect(findSocketPath(tempDir)).toBeNull()
    })
  })

  describe("findJsonlPath", () => {
    it("finds JSONL file in the workspace root", () => {
      const beadsDir = join(tempDir, ".beads")
      mkdirSync(beadsDir)
      const jsonlPath = join(beadsDir, "issues.jsonl")
      writeFileSync(jsonlPath, "")

      expect(findJsonlPath(tempDir)).toBe(jsonlPath)
    })

    it("finds JSONL file in a parent directory", () => {
      const beadsDir = join(tempDir, ".beads")
      mkdirSync(beadsDir)
      const jsonlPath = join(beadsDir, "issues.jsonl")
      writeFileSync(jsonlPath, "")

      const nested = join(tempDir, "sub")
      mkdirSync(nested)

      expect(findJsonlPath(nested)).toBe(jsonlPath)
    })

    it("returns null when no JSONL file exists", () => {
      expect(findJsonlPath(tempDir)).toBeNull()
    })
  })

  describe("findBeadsDir", () => {
    it("finds .beads directory", () => {
      const beadsDir = join(tempDir, ".beads")
      mkdirSync(beadsDir)

      expect(findBeadsDir(tempDir)).toBe(beadsDir)
    })

    it("finds .beads directory in parent", () => {
      const beadsDir = join(tempDir, ".beads")
      mkdirSync(beadsDir)

      const nested = join(tempDir, "a", "b")
      mkdirSync(nested, { recursive: true })

      expect(findBeadsDir(nested)).toBe(beadsDir)
    })

    it("returns null when no .beads directory exists", () => {
      expect(findBeadsDir(tempDir)).toBeNull()
    })
  })
})
