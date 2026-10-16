import { SUPABASE_KEY, SUPABASE_URL, accessToken, supabase } from "./supabase";
import { sha256 } from "./pack";
import { mapLimit, withRetry } from "./concurrency";

const DB_NAME = "cat-voice";
const STORE = "packs";
const MAX_CACHED = 4;
const RANGE_PART = 8 * 1024 * 1024;
const RANGE_CONNECTIONS = 4;
const CLOUD_CONNECTIONS = 3;
const UPLOAD_CONNECTIONS = 2;
export const CHUNK_SIZE = 45 * 1024 * 1024;

type CachedPack = { key: string; name: string; blob: Blob; savedAt: number };
export type Progress = (loaded: number, total: number) => void;

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "key" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = run(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function getCachedPack(key: string) {
  try {
    return (await tx<CachedPack | undefined>("readonly", (s) => s.get(key))) ?? null;
  } catch {
    return null;
  }
}

export async function cachePack(key: string, name: string, blob: Blob) {
  try {
    const all = await tx<CachedPack[]>("readonly", (s) => s.getAll());
    const stale = all.filter((p) => p.key !== key).sort((a, b) => b.savedAt - a.savedAt).slice(MAX_CACHED - 1);
    for (const p of stale) await tx("readwrite", (s) => s.delete(p.key));
    await tx("readwrite", (s) => s.put({ key, name, blob, savedAt: Date.now() }));
    navigator.storage?.persist?.().catch(() => undefined);
  } catch {
    return;
  }
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY };
}

async function readBody(res: Response, onBytes: (bytes: number) => void) {
  if (!res.body) {
    const blob = await res.blob();
    onBytes(blob.size);
    return blob;
  }
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    onBytes(value.byteLength);
  }
  return new Blob(parts as BlobPart[]);
}

async function failure(res: Response) {
  const body = await res.json().catch(() => null);
  return new Error(body?.error ?? body?.message ?? `Falha no download (${res.status})`);
}

async function fetchWithProgress(url: string, headers: Record<string, string>, onProgress?: Progress, expected = 0) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw await failure(res);
  const total = Number(res.headers.get("content-length")) || expected;
  let loaded = 0;
  const blob = await readBody(res, (bytes) => {
    loaded += bytes;
    onProgress?.(loaded, total);
  });
  return { blob, res };
}

function progressTracker(total: number, onProgress?: Progress) {
  let loaded = 0;
  return (bytes: number) => {
    loaded += bytes;
    onProgress?.(Math.max(0, loaded), total);
  };
}

async function downloadRanges(url: string, size: number, onProgress?: Progress) {
  const controller = new AbortController();
  const report = progressTracker(size, onProgress);
  const ranges = Array.from({ length: Math.ceil(size / RANGE_PART) }, (_, i) => [i * RANGE_PART, Math.min(size, (i + 1) * RANGE_PART) - 1] as const);
  try {
    const parts = await mapLimit(ranges, RANGE_CONNECTIONS, ([start, end]) =>
      withRetry(
        async () => {
          let received = 0;
          try {
            const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal: controller.signal });
            if (res.status !== 206) {
              controller.abort();
              throw new Error("O servidor não aceitou download em partes");
            }
            const blob = await readBody(res, (bytes) => {
              received += bytes;
              report(bytes);
            });
            if (blob.size !== end - start + 1) throw new Error("Uma parte do pack veio incompleta");
            return blob;
          } catch (err) {
            report(-received);
            throw err;
          }
        },
        3,
        controller.signal,
      ),
    );
    return new Blob(parts);
  } catch (err) {
    controller.abort();
    throw err;
  }
}

function safeJson(text: string): { message?: string } | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function uploadChunk(path: string, blob: Blob, token: string, onProgress: (loaded: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${SUPABASE_URL}/storage/v1/object/packs/${path}`);
    const headers = authHeaders(token);
    xhr.setRequestHeader("Authorization", headers.Authorization);
    xhr.setRequestHeader("apikey", headers.apikey);
    xhr.setRequestHeader("x-upsert", "true");
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(safeJson(xhr.responseText)?.message ?? `Falha ao enviar parte do pack (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Conexão perdida ao enviar o pack"));
    xhr.send(blob);
  });
}

export async function uploadCloudPack(key: string, blob: Blob, onProgress?: Progress) {
  const chunks = Math.ceil(blob.size / CHUNK_SIZE);
  const report = progressTracker(blob.size, onProgress);
  await mapLimit(Array.from({ length: chunks }, (_, i) => i), UPLOAD_CONNECTIONS, async (i) => {
    const part = blob.slice(i * CHUNK_SIZE, Math.min(blob.size, (i + 1) * CHUNK_SIZE));
    await withRetry(async () => {
      const token = await accessToken();
      let sent = 0;
      try {
        await uploadChunk(`${key}/${i}.part`, part, token, (loaded) => {
          report(loaded - sent);
          sent = loaded;
        });
        report(part.size - sent);
      } catch (err) {
        report(-sent);
        throw err;
      }
    });
  });
  return chunks;
}

export async function downloadCloudPack(key: string, chunks: number, size: number, onProgress?: Progress) {
  const token = await accessToken();
  const report = progressTracker(size, onProgress);
  const parts = await mapLimit(Array.from({ length: chunks }, (_, i) => i), CLOUD_CONNECTIONS, (i) =>
    withRetry(async () => {
      let received = 0;
      try {
        const { blob } = await fetchWithProgress(`${SUPABASE_URL}/storage/v1/object/authenticated/packs/${key}/${i}.part`, authHeaders(token), (loaded) => {
          report(loaded - received);
          received = loaded;
        });
        return blob;
      } catch (err) {
        report(-received);
        throw err;
      }
    }),
  );
  const full = new Blob(parts);
  if ((await sha256(full)) !== key) throw new Error("O pack baixado não confere com o original (hash diferente).");
  return full;
}

export async function deleteCloudPack(key: string, chunks: number) {
  const { data } = await supabase.rpc("pack_refcount", { p_key: key });
  if ((data ?? 0) > 1) return;
  const paths = Array.from({ length: chunks }, (_, i) => `${key}/${i}.part`);
  if (paths.length) await supabase.storage.from("packs").remove(paths);
}

export type GameBananaMod = {
  id: string;
  name: string;
  author: string;
  game: string;
  url: string;
  image: string | null;
  files: { id: string; name: string; size: number; description: string }[];
};

const GAMEBANANA_PAGE = /^https:\/\/(www\.)?gamebanana\.com\/[A-Za-z0-9/_-]*$/;
const GAMEBANANA_FILE = /^https:\/\/([a-z0-9-]+\.)*gamebanana\.com\//;

export function safeGameBananaUrl(url: string | null | undefined) {
  return url && GAMEBANANA_PAGE.test(url) ? url : null;
}

export function parseGameBananaUrl(input: string) {
  const match = input.trim().match(/gamebanana\.com\/(?:mods|dl)\/(\d+)/i) ?? input.trim().match(/^(\d{3,10})$/);
  return match ? match[1] : null;
}

export async function fetchGameBananaMod(modId: string) {
  const token = await accessToken();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/gamebanana?mod=${modId}`, { headers: authHeaders(token) });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Não foi possível ler o mod");
  return body as GameBananaMod;
}

async function resolveGameBanana(fileId: string, token: string) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/gamebanana?resolve=${fileId}`, { headers: authHeaders(token) });
  if (!res.ok) return null;
  const info = (await res.json()) as { url: string; size: number; name: string; cors: boolean };
  return info.cors && GAMEBANANA_FILE.test(info.url) ? info : null;
}

async function downloadDirect(url: string, size: number, exact: boolean, onProgress?: Progress) {
  if (exact && size > RANGE_PART * 2) {
    try {
      return await downloadRanges(url, size, onProgress);
    } catch {
      onProgress?.(0, size);
    }
  }
  return (await fetchWithProgress(url, {}, onProgress, size)).blob;
}

export async function downloadGameBanana(fileId: string, expected: number, onProgress?: Progress) {
  const token = await accessToken();
  const direct = await resolveGameBanana(fileId, token).catch(() => null);
  if (direct) {
    const size = direct.size || expected;
    try {
      const blob = await downloadDirect(direct.url, size, direct.size > 0, onProgress);
      if (!size || blob.size === size) return { blob, name: direct.name };
    } catch {
      onProgress?.(0, expected);
    }
  }
  const { blob, res } = await fetchWithProgress(`${SUPABASE_URL}/functions/v1/gamebanana?file=${fileId}`, authHeaders(token), onProgress, expected);
  const name = decodeURIComponent(res.headers.get("x-file-name") ?? `${fileId}.zip`);
  return { blob, name };
}
