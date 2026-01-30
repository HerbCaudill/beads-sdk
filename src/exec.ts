import { spawn, type SpawnOptions } from "node:child_process"

/** Function signature for spawning child processes. */
export type SpawnFn = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ReturnType<typeof spawn>

/** Options for the exec helper. */
export interface ExecOptions {
  /** Command to run (default: "bd") */
  command?: string
  /** Working directory for bd commands */
  cwd?: string
  /** Additional environment variables */
  env?: Record<string, string>
  /** Custom spawn function (for testing) */
  spawn?: SpawnFn
  /** Timeout in ms (default: 30000) */
  timeout?: number
}

/** Resolved options with defaults applied. */
export interface ResolvedExecOptions {
  command: string
  cwd: string
  env: Record<string, string>
  spawn: SpawnFn
  timeout: number
}

/** Apply defaults to exec options. */
export function resolveExecOptions(options: ExecOptions = {}): ResolvedExecOptions {
  return {
    command: options.command ?? "bd",
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? {},
    spawn: options.spawn ?? spawn,
    timeout: options.timeout ?? 30_000,
  }
}

/**
 * Execute a bd command and return stdout.
 * Spawns a child process, collects stdout/stderr, and resolves with stdout on exit code 0.
 */
export function exec(
  /** Command arguments to pass to bd */
  args: string[],
  /** Resolved execution options */
  options: ResolvedExecOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = options.spawn(options.command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""

    const timeoutId = setTimeout(() => {
      proc.kill("SIGKILL")
      reject(new Error(`bd command timed out after ${options.timeout}ms`))
    }, options.timeout)

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on("error", err => {
      clearTimeout(timeoutId)
      reject(err)
    })

    proc.on("close", code => {
      clearTimeout(timeoutId)
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error(`bd exited with code ${code}: ${stderr.trim() || stdout.trim()}`))
      }
    })
  })
}
