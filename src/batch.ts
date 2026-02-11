/** Maximum concurrent daemon socket connections to avoid EPIPE from socket exhaustion. */
export const MAX_CONCURRENT_REQUESTS = 10

/**
 * Execute an async function for each item with bounded concurrency.
 * Processes items in batches to avoid overwhelming the daemon socket.
 */
export async function batched<T, R>(
  /** Items to process. */
  items: T[],
  /** Maximum number of concurrent operations. */
  concurrency: number,
  /** Async function to apply to each item. */
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency)
    const batchResults = await Promise.all(batch.map(fn))
    results.push(...batchResults)
  }
  return results
}
