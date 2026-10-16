import { useCallback, useEffect, useRef, useState } from "react";
import { createLoadedPack, extractArchive, sha256, type LoadedPack } from "./pack";
import { cachePack, downloadCloudPack, downloadGameBanana, getCachedPack } from "./packStore";
import type { Room } from "./types";

export type PackState =
  | { phase: "idle" }
  | { phase: "waiting"; message: string }
  | { phase: "needs-file" }
  | { phase: "downloading"; loaded: number; total: number }
  | { phase: "extracting" }
  | { phase: "ready"; pack: LoadedPack }
  | { phase: "error"; message: string };

let current: { key: string; pack: LoadedPack } | null = null;

export function rememberLoadedPack(key: string, pack: LoadedPack) {
  if (current && current.key !== key) current.pack.dispose();
  current = { key, pack };
}

export function usePack(room: Room | null) {
  const [state, setState] = useState<PackState>({ phase: "idle" });
  const key = room?.pack_key;
  const ready = room?.pack_ready;

  const run = useRef(0);

  const open = useCallback(
    async (blob: Blob, name: string, id: number) => {
      if (!room) return;
      if (run.current === id) setState({ phase: "extracting" });
      const files = await extractArchive(blob, name);
      if (!files.has(room.manifest.root + room.manifest.video)) throw new Error("O arquivo não contém o vídeo deste pack.");
      const pack = createLoadedPack(room.manifest, files);
      rememberLoadedPack(room.pack_key, pack);
      if (run.current === id) setState({ phase: "ready", pack });
    },
    [room],
  );

  const load = useCallback(async () => {
    if (!room) return;
    const id = ++run.current;
    const set = (next: PackState) => run.current === id && setState(next);
    if (current?.key === room.pack_key) {
      setState({ phase: "ready", pack: current.pack });
      return;
    }
    try {
      const cached = await getCachedPack(room.pack_key);
      if (cached) return await open(cached.blob, cached.name, id);
      if (room.pack_source === "local") return set({ phase: "needs-file" });
      if (room.pack_source === "cloud" && !room.pack_ready) return set({ phase: "waiting", message: "O dono da sala ainda está enviando o pack para a nuvem…" });
      set({ phase: "downloading", loaded: 0, total: room.pack_size ?? 0 });
      let lastPaint = 0;
      const onProgress = (loaded: number, total: number) => {
        const now = performance.now();
        if (now - lastPaint < 200 && loaded < total) return;
        lastPaint = now;
        set({ phase: "downloading", loaded, total: total || room.pack_size || 0 });
      };
      const blob =
        room.pack_source === "cloud"
          ? await downloadCloudPack(room.pack_key, room.pack_chunks, room.pack_size ?? 0, onProgress)
          : (await downloadGameBanana(room.pack_key.replace(/^gb-/, ""), room.pack_size ?? 0, onProgress)).blob;
      const name = room.pack_name ?? "pack.zip";
      await cachePack(room.pack_key, name, blob);
      await open(blob, name, id);
    } catch (err) {
      set({ phase: "error", message: (err as Error).message });
    }
  }, [room, open]);

  const provideFile = useCallback(
    async (file: File) => {
      if (!room) return;
      const id = ++run.current;
      try {
        setState({ phase: "extracting" });
        if ((await sha256(file)) !== room.pack_key) throw new Error("Esse arquivo é diferente do pack da sala. Use exatamente o mesmo arquivo do dono.");
        await cachePack(room.pack_key, file.name, file);
        await open(file, file.name, id);
      } catch (err) {
        if (run.current === id) setState({ phase: "error", message: (err as Error).message });
      }
    },
    [room, open],
  );

  useEffect(() => {
    if (key) void load();
  }, [key, ready]);

  return { state, retry: load, provideFile };
}
