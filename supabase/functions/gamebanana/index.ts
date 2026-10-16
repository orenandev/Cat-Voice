const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Expose-Headers": "content-length, content-disposition, x-file-name",
};

const MAX_BYTES = 600 * 1024 * 1024;
const ARCHIVE_EXT = /\.(zip|rar|7z)$/i;
const GAMEBANANA_HOST = /(^|\.)gamebanana\.com$/;
const ID = /^\d{1,10}$/;
const UPSTREAM_TIMEOUT = 15000;

type Bucket = { tokens: number; updatedAt: number };

const LIMITS = {
  lookup: { capacity: 30, perMinute: 30 },
  proxy: { capacity: 4, perMinute: 1 },
} as const;

const buckets = new Map<string, Bucket>();

function allow(userId: string, kind: keyof typeof LIMITS) {
  const { capacity, perMinute } = LIMITS[kind];
  const key = `${kind}:${userId}`;
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: capacity, updatedAt: now };
  bucket.tokens = Math.min(capacity, bucket.tokens + ((now - bucket.updatedAt) / 60000) * perMinute);
  bucket.updatedAt = now;
  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    return false;
  }
  bucket.tokens -= 1;
  buckets.set(key, bucket);
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) if (now - b.updatedAt > 600000) buckets.delete(k);
  }
  return true;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function fileNameFrom(url: string, fallback: string) {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    return name.replace(/[\u0000-\u001f\\/:*?"<>|]+/g, "").slice(0, 200) || fallback;
  } catch {
    return fallback;
  }
}

function upstream(url: string, init: RequestInit = {}) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT) });
}

async function currentUser(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "" },
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { id?: string };
  return user.id ?? null;
}

async function modInfo(modId: string) {
  const res = await upstream(`https://gamebanana.com/apiv11/Mod/${modId}/ProfilePage`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const files = (data._aFiles ?? [])
    .filter((f: { _sFile: string }) => ARCHIVE_EXT.test(f._sFile))
    .map((f: { _idRow: number; _sFile: string; _nFilesize: number; _sDescription?: string }) => ({
      id: String(f._idRow),
      name: f._sFile,
      size: f._nFilesize,
      description: f._sDescription ?? "",
    }));
  const preview = data._aPreviewMedia?._aImages?.[0];
  return {
    id: String(data._idRow),
    name: data._sName as string,
    author: data._aSubmitter?._sName ?? "",
    game: data._aGame?._sName ?? "",
    url: `https://gamebanana.com/mods/${modId}`,
    image: preview ? `${preview._sBaseUrl}/${preview._sFile530 ?? preview._sFile}` : null,
    files,
  };
}

async function resolveFile(fileId: string) {
  let url = `https://gamebanana.com/dl/${fileId}`;
  for (let hop = 0; hop < 6; hop++) {
    const res = await upstream(url, { method: "HEAD", redirect: "manual" });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      url = new URL(location, url).toString();
      if (!GAMEBANANA_HOST.test(new URL(url).hostname)) return json({ error: "Destino inesperado" }, 502);
      continue;
    }
    if (!res.ok) return json({ error: "Arquivo não encontrado no GameBanana" }, 404);
    const size = Number(res.headers.get("content-length") ?? 0);
    if (size > MAX_BYTES) return json({ error: "Arquivo grande demais (máx. 600 MB)" }, 413);
    const cors = res.headers.get("access-control-allow-origin") === "*";
    return json({ url, size, name: fileNameFrom(url, `${fileId}.zip`), cors });
  }
  return json({ error: "Redirecionamentos demais" }, 502);
}

function capped(body: ReadableStream<Uint8Array>) {
  let sent = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        sent += chunk.byteLength;
        if (sent > MAX_BYTES) controller.error(new Error("Arquivo grande demais"));
        else controller.enqueue(chunk);
      },
    }),
  );
}

async function streamFile(fileId: string) {
  const res = await fetch(`https://gamebanana.com/dl/${fileId}`, { redirect: "follow" });
  if (!res.ok || !res.body || !GAMEBANANA_HOST.test(new URL(res.url).hostname)) {
    await res.body?.cancel();
    return json({ error: "Não foi possível baixar o arquivo do GameBanana" }, 502);
  }
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) {
    await res.body.cancel();
    return json({ error: "Arquivo grande demais (máx. 600 MB)" }, 413);
  }
  const headers: Record<string, string> = {
    ...CORS,
    "Content-Type": "application/octet-stream",
    "X-File-Name": encodeURIComponent(fileNameFrom(res.url, `${fileId}.zip`)),
    "Cache-Control": "private, max-age=3600",
  };
  if (length) headers["Content-Length"] = String(length);
  return new Response(capped(res.body), { headers });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET") return json({ error: "Método não suportado" }, 405);
  const userId = await currentUser(req);
  if (!userId) return json({ error: "Faça login para importar packs" }, 401);

  const params = new URL(req.url).searchParams;
  const mod = params.get("mod");
  const resolve = params.get("resolve");
  const file = params.get("file");

  try {
    if (mod && ID.test(mod)) {
      if (!allow(userId, "lookup")) return json({ error: "Muitas consultas seguidas. Espere um pouco." }, 429);
      const info = await modInfo(mod);
      return info ? json(info) : json({ error: "Mod não encontrado no GameBanana" }, 404);
    }
    if (resolve && ID.test(resolve)) {
      if (!allow(userId, "lookup")) return json({ error: "Muitas consultas seguidas. Espere um pouco." }, 429);
      return await resolveFile(resolve);
    }
    if (file && ID.test(file)) {
      if (!allow(userId, "proxy")) return json({ error: "Muitos downloads seguidos. Espere alguns minutos." }, 429);
      return await streamFile(file);
    }
    return json({ error: "Informe ?mod=<id>, ?resolve=<id> ou ?file=<id>" }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: "O GameBanana não respondeu. Tente de novo em instantes." }, 502);
  }
});
