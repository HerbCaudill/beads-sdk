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

// Delete an issue
await client.delete(issue.id)

// Clean up
await client.disconnect()
```

### Filtering

```ts
// Filter by status, priority, type, assignee, or labels
const bugs = await client.list({ issue_type: "bug", status: "open" })
const labeled = await client.list({ labels: ["frontend", "urgent"] }) // all required
const any = await client.list({ labels_any: ["frontend", "backend"] }) // any match

// Text search across title and description
const results = await client.list({ query: "login" })

// Get only ready issues (open and unblocked)
const ready = await client.ready({ assignee: "herb", limit: 5 })

// Get blocked issues
const blocked = await client.blocked()

// Get database statistics
const stats = await client.stats()
```

### Batch operations

```ts
// Show details for multiple issues (bounded concurrency)
const issues = await client.showMany(["abc", "def", "ghi"])

// Update multiple issues at once
await client.updateMany(["abc", "def"], { status: "in_progress" })

// Delete multiple issues
await client.deleteMany(["abc", "def"])
```

### Comments

```ts
// Add a comment
await client.addComment(issueId, "Looks good to me", "herb")

// Get all comments for an issue
const comments = await client.getComments(issueId)
```

### Labels

```ts
// Get labels for an issue
const labels = await client.getLabels(issueId)

// Add/remove labels
await client.addLabel(issueId, "frontend")
await client.removeLabel(issueId, "backend")

// List all labels in the database
const allLabels = await client.listAllLabels()
```

### Dependencies

```ts
// Add a dependency with explicit type
await client.addDependency(childId, parentId, "blocks")

// Convenience methods for blocking dependencies
await client.addBlocker(blockedId, blockerId)
await client.removeBlocker(blockedId, blockerId)
```

### Diagnostics

```ts
// Check connection status
client.isConnected()

// Ping the daemon
const pong = await client.ping()

// Get daemon health info
const health = await client.health()

// Get database info
const info = await client.info()
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

For detailed mutation events (create, update, delete, status changes):

```ts
import { watchMutations } from "@herbcaudill/beads-sdk"

const stop = watchMutations(event => console.log(event.Type, event.IssueID), {
  workspacePath: "/path/to/repo",
  interval: 1000,
})

// Later, stop watching
stop()
```

### Registry

Discover available beads workspaces from the global registry:

```ts
import { getAliveWorkspaces } from "@herbcaudill/beads-sdk"

// Get workspaces with live daemon processes
const workspaces = getAliveWorkspaces("/current/repo")
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
  |-- MutationPoller   (polls get_mutations for detailed events)
```

- **DaemonTransport**: Connects to the beads daemon via Unix socket. Each RPC call opens a fresh connection. Auto-discovers socket by walking up from workspace root. Auto-starts daemon if not running.
- **JsonlTransport**: Read-only fallback. Parses `.beads/issues.jsonl` into memory. Watches the file for changes via `fs.watch()`.
- **ChangePoller**: Polls the daemon's `stats` endpoint and emits change events when data changes.
- **MutationPoller**: Polls the daemon's `get_mutations` endpoint and emits detailed mutation events with type, issue ID, and status changes.

## License

MIT
