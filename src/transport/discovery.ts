import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"

/**
 * Walk up from a starting directory looking for a `.beads` directory
 * containing the given filename. Falls back to `~/.beads/` for sockets.
 */
function walkUp(
  /** Starting directory */
  startDir: string,
  /** Filename to look for inside `.beads/` */
  filename: string,
  /** Whether to check `~/.beads/` as a global fallback */
  globalFallback: boolean = false,
): string | null {
  let dir = startDir
  while (true) {
    const candidate = join(dir, ".beads", filename)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  if (globalFallback) {
    const globalPath = join(homedir(), ".beads", filename)
    if (existsSync(globalPath)) return globalPath
  }
  return null
}

/** Find the daemon socket path by walking up from the workspace root. */
export function findSocketPath(
  /** Directory to start searching from */
  workspaceRoot: string,
): string | null {
  return walkUp(workspaceRoot, "bd.sock", true)
}

/** Find the JSONL issues file by walking up from the workspace root. */
export function findJsonlPath(
  /** Directory to start searching from */
  workspaceRoot: string,
): string | null {
  return walkUp(workspaceRoot, "issues.jsonl", false)
}

/** Find the `.beads` directory by walking up from the workspace root. */
export function findBeadsDir(
  /** Directory to start searching from */
  workspaceRoot: string,
): string | null {
  let dir = workspaceRoot
  while (true) {
    const candidate = join(dir, ".beads")
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}
