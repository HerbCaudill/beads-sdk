export type {
  Status,
  Priority,
  IssueType,
  DepType,
  Issue,
  LinkedIssue,
  BlockedIssue,
  StatsSummary,
  RecentActivity,
  Stats,
  HealthStatus,
  ListFilter,
  ReadyFilter,
  BlockedFilter,
  CreateInput,
  UpdateInput,
  Transport,
  RawJsonlDependency,
  RawJsonlIssue,
  Comment,
  LabelResult,
  DepResult,
  Info,
  MutationType,
  MutationEvent,
  RegistryEntry,
  WorkspaceInfo,
} from "./types.js"

export { BeadsClient, watchMutations } from "./client.js"
export type { BeadsClientOptions } from "./client.js"

export { DaemonTransport } from "./transport/daemon.js"
export type { DaemonTransportOptions } from "./transport/daemon.js"

export { JsonlTransport } from "./transport/jsonl.js"

export { findSocketPath, findJsonlPath, findBeadsDir } from "./transport/discovery.js"

export { ChangePoller } from "./poller.js"

export { MutationPoller } from "./mutation-poller.js"
export type { WatchMutationsOptions } from "./mutation-poller.js"

export { batched, MAX_CONCURRENT_REQUESTS } from "./batch.js"

export {
  getRegistryPath,
  readRegistry,
  getAvailableWorkspaces,
  isProcessRunning,
  getAliveWorkspaces,
} from "./registry.js"
