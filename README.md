# @herbcaudill/beads-sdk

Typed TypeScript SDK for the [beads](https://github.com/HerbCaudill/beads) issue tracker. Zero
runtime dependencies.

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

### Labels and dependencies

```ts
await client.addLabel(issue.id, "frontend")
await client.removeLabel(issue.id, "frontend")
const labels = await client.getLabels(issue.id)

// issue B is blocked by issue A
await client.addBlocker(issueB.id, issueA.id)
await client.removeBlocker(issueB.id, issueA.id)
```

### Comments

```ts
await client.addComment(issue.id, "Started working on this")
const comments = await client.getComments(issue.id)
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
