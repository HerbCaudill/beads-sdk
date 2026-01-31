# @herbcaudill/beads-sdk

Typed TypeScript SDK for the [beads](https://github.com/HerbCaudill/beads) issue tracker. Zero runtime dependencies.

## Install

```bash
pnpm add @herbcaudill/beads-sdk
```

Requires the `bd` CLI to be installed and available on PATH.

## Usage

```ts
import { BeadsClient } from "@herbcaudill/beads-sdk"

const client = new BeadsClient()

// List open issues
const issues = await client.list({ status: "open" })

// Create an issue
const issue = await client.create({
  title: "Fix login bug",
  priority: 1,
  type: "bug",
})

// Update an issue
await client.update(issue.id, { status: "in_progress" })

// Close an issue
await client.close(issue.id)
```

### Filtering

```ts
// Filter by status, priority, type, assignee, or parent
const bugs = await client.list({ type: "bug", status: "open" })

// Get only ready issues (open and unblocked)
const ready = await client.list({ ready: true })

// Get blocked issues
const blocked = await client.blocked()

// Get issues enriched with parent and dependency info
const enriched = await client.listWithParents({ status: "open" })
```

### Search and ready work

```ts
// Text search with filters
const results = await client.search({
  query: "authentication",
  status: "open",
  sort: "priority",
  limit: 10,
})

// Show ready work (open, unblocked)
const ready = await client.ready({ assignee: "herb", limit: 5 })

// Count issues, optionally grouped
const total = await client.count({ status: "open" })
const byType = await client.count({ byType: true })
```

### Reopen and children

```ts
// Reopen a closed issue
await client.reopen("beads-001", "Not actually fixed")

// List children of a parent/epic
const children = await client.children("beads-000")
```

### Labels and dependencies

```ts
await client.addLabel(issue.id, "frontend")
await client.removeLabel(issue.id, "frontend")
const labels = await client.getLabels(issue.id)

// issue B is blocked by issue A
await client.addBlocker(issueB.id, issueA.id)
await client.removeBlocker(issueB.id, issueA.id)

// List dependencies or dependents
const blockers = await client.listDeps(issue.id) // what blocks this issue
const dependents = await client.listDeps(issue.id, { direction: "up" }) // what this issue blocks
```

### Comments

```ts
await client.addComment(issue.id, "Started working on this")
const comments = await client.getComments(issue.id)
```

### Sync and epics

```ts
// Sync database with git
await client.sync()
await client.sync({ status: true }) // check sync state
await client.sync({ full: true }) // full pull/merge/export/commit/push

// Epic management
const epics = await client.epicStatus()
const eligible = await client.epicStatus(true) // only closeable epics
await client.epicCloseEligible() // close all completed epics
```

### Watching for changes

The SDK can connect to the beads daemon for real-time mutation events:

```ts
const stop = client.watchMutations(event => {
  console.log(`${event.Type} on ${event.IssueID}: ${event.Title}`)
})

// Later, stop watching
stop()
```

### Custom configuration

```ts
const client = new BeadsClient({
  cwd: "/path/to/repo", // Working directory (default: process.cwd())
  command: "bd", // CLI command (default: "bd")
  timeout: 30_000, // Subprocess timeout in ms (default: 30000)
  connectTimeout: 2000, // Daemon socket connect timeout (default: 2000)
  requestTimeout: 5000, // Daemon socket request timeout (default: 5000)
})
```

### Low-level access

For direct daemon communication without the client:

```ts
import { DaemonSocket, watchMutations } from "@herbcaudill/beads-sdk"

const socket = new DaemonSocket({ cwd: "/path/to/repo" })
if (await socket.connect()) {
  const mutations = await socket.getMutations(Date.now() - 60_000)
  const ready = await socket.getReady()
  socket.close()
}
```

## License

MIT
