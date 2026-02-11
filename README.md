# @herbcaudill/beads-sdk

Typed TypeScript SDK for the [beads](https://github.com/HerbCaudill/beads) issue tracker. Zero runtime dependencies.

Connects directly to the beads daemon via Unix socket for fast operations (<20ms), with JSONL file fallback for read-only/offline scenarios.

## Install

```bash
pnpm add @herbcaudill/beads-sdk
```

## Usage

```ts
import { BeadsClient } from "@herbcaudill/beads-sdk"

const client = new BeadsClient()
await client.connect("/path/to/repo")

// List open issues
const issues = await client.list({ status: "open" })

// Create an issue (requires daemon)
const issue = await client.create({
  title: "Fix login bug",
  priority: 1,
  issue_type: "bug",
})

// Update an issue
await client.update(issue.id, { status: "in_progress" })

// Close an issue
await client.close(issue.id)

// Clean up
await client.disconnect()
```

### Filtering

```ts
// Filter by status, priority, type, assignee, or labels
const bugs = await client.list({ issue_type: "bug", status: "open" })

// Get only ready issues (open and unblocked)
const ready = await client.ready({ assignee: "herb", limit: 5 })

// Get blocked issues
const blocked = await client.blocked()

// Get database statistics
const stats = await client.stats()
```

### Dependencies

```ts
// Add a blocking dependency
await client.addDependency(childId, parentId, "blocks")
```

### Watching for changes

The SDK polls the daemon for changes and can notify you when data updates:

```ts
const unsub = client.onChange(() => {
  console.log("Data changed, refetch!")
})

// Later, stop watching
unsub()
```

### Configuration

```ts
const client = new BeadsClient({
  requestTimeout: 5000, // Daemon RPC timeout in ms (default: 5000)
  actor: "my-app", // Actor name sent with requests (default: "sdk")
  pollInterval: 2000, // Change polling interval in ms (default: 2000)
})
```

### Low-level access

For direct transport usage:

```ts
import { DaemonTransport, JsonlTransport } from "@herbcaudill/beads-sdk"

// Direct daemon communication
const daemon = new DaemonTransport("/path/to/repo")
const issues = await daemon.send("list", { status: "open" })
daemon.close()

// JSONL file access (read-only)
const jsonl = new JsonlTransport("/path/to/repo")
jsonl.load()
const ready = await jsonl.send("ready", {})
jsonl.close()
```

## Architecture

```
BeadsClient
  |-- DaemonTransport  (Unix socket -> .beads/bd.sock)
  |-- JsonlTransport   (fallback: parse .beads/issues.jsonl)
  |-- ChangePoller     (polls stats for change detection)
```

- **DaemonTransport**: Connects to the beads daemon via Unix socket. Each RPC call opens a fresh connection. Auto-discovers socket by walking up from workspace root. Auto-starts daemon if not running.
- **JsonlTransport**: Read-only fallback. Parses `.beads/issues.jsonl` into memory. Watches the file for changes via `fs.watch()`.
- **ChangePoller**: Polls the daemon's `stats` endpoint and emits change events when data changes.

## License

MIT
