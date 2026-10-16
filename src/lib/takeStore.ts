import { supabase } from "./supabase";
import { limiter, withRetry } from "./concurrency";
import type { Take } from "./types";

const cache = new Map<string, Promise<Blob>>();
const queue = limiter(6);

export function rememberTake(path: string, blob: Blob) {
  cache.set(path, Promise.resolve(blob));
}

export function fetchTake(path: string) {
  const cached = cache.get(path);
  if (cached) return cached;
  const pending = queue(() =>
    withRetry(async () => {
      const { data, error } = await supabase.storage.from("takes").download(path);
      if (error || !data) throw new Error("Não consegui baixar uma das gravações. Verifique a conexão e tente de novo.");
      return data;
    }),
  );
  cache.set(path, pending);
  pending.catch(() => cache.delete(path));
  return pending;
}

export function prefetchTakes(takes: Take[]) {
  const current = new Set(takes.map((t) => t.path));
  const roomPrefix = takes[0] ? `${takes[0].room_id}/` : null;
  for (const path of cache.keys()) if (roomPrefix && path.startsWith(roomPrefix) && !current.has(path)) cache.delete(path);
  for (const path of current) fetchTake(path).catch(() => undefined);
}
