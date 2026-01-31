# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Typed TypeScript SDK for the [beads](https://github.com/HerbCaudill/beads) issue tracker. Zero runtime
dependencies. Requires `bd` CLI to be installed and available on PATH.

## Commands

```bash
pnpm build          # Compile TypeScript to dist/
pnpm dev            # Watch mode compilation
pnpm typecheck      # Type-check without emitting
pnpm test           # Run tests (vitest)
pnpm test:watch     # Run tests in watch mode
pnpm format         # Format with Prettier
```

## Architecture

Three layers, all ESM:

- **`exec.ts`** — Spawns `bd` CLI as a subprocess. All CRUD operations go through here.
- **`socket.ts`** — Connects to the beads daemon via Unix socket (`.beads/bd.sock`) for real-time
  mutation watching. JSON-RPC over newline-delimited messages.
- **`BeadsClient.ts`** — High-level API combining both. CRUD methods shell out to `bd --json`;
  `watchMutations` polls the daemon socket.

`types.ts` holds all shared type definitions. `index.ts` is the barrel export.

The daemon socket uses PascalCase keys (`Timestamp`, `Type`, `IssueID`) — this matches the Go
daemon's JSON output and is intentional.

## Testing

Tests use Vitest. The `exec.ts` module accepts a custom `spawn` function via `ExecOptions` to
enable testing without a real `bd` installation.

## Issue tracking

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

```bash
bd ready                                     # Find available work
bd show <id>                                 # View issue details
bd update <id> --status in_progress          # Claim work
bd close <id>                                # Complete work
bd sync                                      # Sync with git
```
