# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Typed TypeScript SDK for the [beads](https://github.com/HerbCaudill/beads) issue tracker. Zero runtime
dependencies. Connects directly to the beads daemon via Unix socket for fast operations (<20ms), with
JSONL file fallback for read-only/offline scenarios.

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

```
React App <-> Backend API (localhost) <-> BeadsClient
                                              |-- DaemonTransport  (Unix socket -> .beads/bd.sock)
                                              |-- JsonlTransport   (fallback: parse .beads/issues.jsonl)
```

Four layers, all ESM:

- **`transport/daemon.ts`** — Sends JSON-RPC requests to the beads daemon via Unix socket. Each call
  opens a fresh connection (matches the daemon's protocol). Auto-discovers socket by walking up from
  workspace root. Auto-starts daemon if socket not found.
- **`transport/jsonl.ts`** — Parses `.beads/issues.jsonl` into an in-memory `Map<string, Issue>`.
  Supports read-only operations (list, show, ready, blocked, stats). Watches file via `fs.watch()`
  and reloads on change. Used as fallback when daemon is unavailable.
- **`transport/discovery.ts`** — Discovers `.beads/bd.sock` and `.beads/issues.jsonl` by walking up
  the directory tree from the workspace root.
- **`client.ts`** — High-level `BeadsClient` combining DaemonTransport + JsonlTransport. CRUD via
  daemon; reads fall back to JSONL. Change detection via `ChangePoller` (polls daemon stats endpoint).
- **`poller.ts`** — `ChangePoller` polls the daemon's `stats` endpoint on a configurable interval
  and emits change events to subscribers.

`types.ts` holds all shared type definitions. `index.ts` is the barrel export.

## Daemon Protocol

Transport: Unix domain socket at `.beads/bd.sock`. Wire format: newline-delimited JSON. One request,
one response, then socket closes.

Operations: `ping`, `health`, `list`, `show`, `ready`, `blocked`, `stats`, `create`, `update`,
`close`, `dep_add`.

## Testing

Tests use Vitest. Tests for the JSONL transport and discovery module use temporary directories with
real files. Tests for the poller use mock transports and fake timers. Client tests use the JSONL
fallback path (no daemon required).

## Issue tracking

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

```bash
bd ready                                     # Find available work
bd show <id>                                 # View issue details
bd update <id> --status in_progress          # Claim work
bd close <id>                                # Complete work
bd sync                                      # Sync with git
```
