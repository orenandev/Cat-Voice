export async function mapLimit<T, R>(items: readonly T[], limit: number, run: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return results;
}

export async function withRetry<T>(run: (attempt: number) => Promise<T>, attempts = 3, signal?: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run(attempt);
    } catch (err) {
      if (signal?.aborted || attempt + 1 >= attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
    }
  }
}

export function limiter(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T>(run: () => Promise<T>) => {
    if (active >= concurrency) await new Promise<void>((resolve) => queue.push(resolve));
    else active++;
    try {
      return await run();
    } finally {
      const waiting = queue.shift();
      if (waiting) waiting();
      else active--;
    }
  };
}
