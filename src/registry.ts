import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import type { RegistryEntry, WorkspaceInfo } from "./types.js"

/** Get the path to the global beads registry file. */
export function getRegistryPath(): string {
  return path.join(os.homedir(), ".beads", "registry.json")
}

/**
 * Read and parse the registry file.
 * Returns an array of registry entries, or empty array if file doesn't exist or is invalid.
 */
export function readRegistry(): RegistryEntry[] {
  const registryPath = getRegistryPath()
  try {
    const content = fs.readFileSync(registryPath, "utf8")
    const data = JSON.parse(content) as unknown
    if (Array.isArray(data)) {
      return data as RegistryEntry[]
    }
    return []
  } catch {
    return []
  }
}

/**
 * Get all available workspaces from the registry file.
 * Optionally marks the active workspace (based on currentPath).
 */
export function getAvailableWorkspaces(
  /** Optional current workspace path to mark as active */
  currentPath?: string,
): WorkspaceInfo[] {
  const entries = readRegistry()
  return entries.map((entry: RegistryEntry) => ({
    path: entry.workspace_path,
    name: path.basename(entry.workspace_path),
    database: entry.database_path,
    pid: entry.pid,
    version: entry.version,
    startedAt: entry.started_at,
    isActive:
      currentPath ? path.resolve(currentPath) === path.resolve(entry.workspace_path) : false,
  }))
}

/** Check if a specific process is still running. */
export function isProcessRunning(
  /** The process ID to check */
  pid: number,
): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Get available workspaces, filtering out those with dead daemon processes. */
export function getAliveWorkspaces(
  /** Optional current workspace path to mark as active */
  currentPath?: string,
): WorkspaceInfo[] {
  return getAvailableWorkspaces(currentPath).filter(ws => isProcessRunning(ws.pid))
}
