import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Circle, Clapperboard, Flag, Headphones, Mic, MicOff, Play, RotateCcw, Square } from "lucide-react";
import { VideoStage, playMedia, seekTo, type StageVideo } from "../VideoStage";
import { Empty, Progress, Spinner } from "../ui";
import { useToast } from "../Toast";
import { useMic } from "../../lib/useMic";
import { baseMime, extensionForMime, mediaDuration, pickRecorderMime } from "../../lib/audio";
import { errorMessage, supabase } from "../../lib/supabase";
import { mapLimit } from "../../lib/concurrency";
import { fetchTake, rememberTake } from "../../lib/takeStore";
import type { LoadedPack } from "../../lib/pack";
import type { PackClip, Room, Take } from "../../lib/types";

type Mode = "idle" | "scene" | "mine" | "countdown" | "recording" | "uploading";
type Review = { clipId: string; blob: Blob; url: string; type: string; offsetMs: number; length: number };

const TAIL = 0.7;
const MAX_TAKE = 60;

export function Recorder({
  room,
  pack,
  clips,
  takes,
  userId,
  notify,
  refresh,
  goToCast,
}: {
  room: Room;
  pack: LoadedPack;
  clips: PackClip[];
  takes: Take[];
  userId: string;
  notify: () => void;
  refresh: () => Promise<void>;
  goToCast: () => void;
}) {
  const toast = useToast();
  const mic = useMic();
  const [selectedId, setSelectedId] = useState<string | null>(clips[0]?.id ?? null);
  const [mode, setMode] = useState<Mode>("idle");
  const [count, setCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [localTakes, setLocalTakes] = useState<Record<string, string>>({});
  const [review, setReview] = useState<Review | null>(null);
  const videoRef = useRef<StageVideo | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const opRef = useRef(0);
  const remoteUrls = useRef(new Map<string, string>());
  const canRecord = room.status === "recording";

  const selected = clips.find((c) => c.id === selectedId) ?? clips[0];
  const takeOf = useCallback((id: string) => takes.find((t) => t.clip_id === id), [takes]);
  const doneCount = clips.filter((c) => takeOf(c.id)).length;

  useEffect(() => {
    if (!selected && clips[0]) setSelectedId(clips[0].id);
  }, [clips, selected]);

  useEffect(() => {
    let cancelled = false;
    const pending = clips.filter((clip) => durations[clip.id] === undefined);
    void mapLimit(pending, 4, async (clip) => {
      if (cancelled) return;
      const url = pack.url(clip.audio);
      const d = url ? await mediaDuration(url) : 0;
      if (!cancelled) setDurations((prev) => ({ ...prev, [clip.id]: d }));
    });
    return () => {
      cancelled = true;
    };
  }, [clips, pack]);

  useEffect(() => {
    const urls = remoteUrls.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  useEffect(() => {
    navigator.permissions
      ?.query({ name: "microphone" as PermissionName })
      .then((p) => {
        if (p.state === "granted") void mic.start();
      })
      .catch(() => undefined);
  }, []);

  const stopAll = useCallback(() => {
    opRef.current++;
    cancelRef.current?.();
    cancelRef.current = null;
    videoRef.current?.pause();
    audioRef.current?.pause();
    setMode((m) => (m === "uploading" ? m : "idle"));
    setProgress(0);
    setCount(0);
  }, []);

  useEffect(() => stopAll, [stopAll]);

  const clipLength = (clip: PackClip) => Math.min(MAX_TAKE, (durations[clip.id] || 4) + TAIL);

  const runSegment = (end: number, onTick?: (t: number) => void) =>
    new Promise<void>((resolve) => {
      const video = videoRef.current;
      if (!video) return resolve();
      let raf = 0;
      const finish = () => {
        cancelAnimationFrame(raf);
        video.pause();
        resolve();
      };
      const tick = () => {
        onTick?.(video.currentTime);
        if (video.currentTime >= end || video.ended) return finish();
        raf = requestAnimationFrame(tick);
      };
      cancelRef.current = () => {
        cancelAnimationFrame(raf);
        resolve();
      };
      void playMedia(video).then(() => (raf = requestAnimationFrame(tick)));
    });

  const playScene = async (clip: PackClip) => {
    const video = videoRef.current;
    if (!video) return;
    stopAll();
    const op = opRef.current;
    setMode("scene");
    const at = clip.timestamps[0];
    await seekTo(video, at - 1.2);
    if (op !== opRef.current) return;
    video.muted = false;
    video.volume = 1;
    await runSegment(at + clipLength(clip) + 0.3, (t) => setProgress((t - at + 1.2) / (clipLength(clip) + 1.5)));
    if (op !== opRef.current) return;
    setMode("idle");
    setProgress(0);
  };

  const takeUrl = async (clip: PackClip) => {
    if (localTakes[clip.id]) return localTakes[clip.id];
    const take = takeOf(clip.id);
    if (!take) return null;
    const known = remoteUrls.current.get(take.path);
    if (known) return known;
    try {
      const url = URL.createObjectURL(await fetchTake(take.path));
      remoteUrls.current.set(take.path, url);
      return url;
    } catch (err) {
      toast(errorMessage(err), true);
      return null;
    }
  };

  const playMine = async (clip: PackClip, local?: { url: string; offsetMs: number }) => {
    const video = videoRef.current;
    stopAll();
    const op = opRef.current;
    const url = local?.url ?? (await takeUrl(clip));
    if (!video || !url || op !== opRef.current) return;
    setMode("mine");
    const at = clip.timestamps[0];
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.currentTime = Math.max(0, (local?.offsetMs ?? takeOf(clip.id)?.offset_ms ?? 0) / 1000);
    await seekTo(video, at);
    if (op !== opRef.current) return audio.pause();
    video.muted = true;
    void audio.play();
    await runSegment(at + clipLength(clip), (t) => setProgress((t - at) / clipLength(clip)));
    audio.pause();
    if (op !== opRef.current) return;
    setMode("idle");
    setProgress(0);
  };

  const record = async (clip: PackClip) => {
    const video = videoRef.current;
    if (!video || !mic.stream) return;
    if (!canRecord) return toast("A gravação ainda não foi liberada pelo dono da sala.", true);
    stopAll();
    const op = opRef.current;
    const at = clip.timestamps[0];
    const length = clipLength(clip);
    await seekTo(video, at);
    if (op !== opRef.current) return;
    video.muted = true;

    setMode("countdown");
    let aborted = false;
    cancelRef.current = () => {
      aborted = true;
    };
    for (const n of [3, 2, 1]) {
      setCount(n);
      await new Promise((r) => setTimeout(r, 750));
      if (aborted) return;
    }
    setCount(0);

    const mime = pickRecorderMime();
    const recorder = new MediaRecorder(mic.stream, mime ? { mimeType: mime, audioBitsPerSecond: 128000 } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise<void>((r) => (recorder.onstop = () => r()));
    const started = new Promise<void>((r) => (recorder.onstart = () => r()));
    recorder.start();
    await started;
    const t0 = performance.now();
    setMode("recording");
    let offset = 0;
    const segment = new Promise<void>((resolve) => {
      let raf = 0;
      const begin = performance.now();
      const tick = () => {
        const elapsed = (performance.now() - begin) / 1000;
        setProgress(elapsed / length);
        if (elapsed >= length || aborted) {
          video.pause();
          return resolve();
        }
        raf = requestAnimationFrame(tick);
      };
      cancelRef.current = () => {
        aborted = true;
        cancelAnimationFrame(raf);
        video.pause();
        resolve();
      };
      void playMedia(video).then(() => {
        offset = performance.now() - t0;
        raf = requestAnimationFrame(tick);
      });
    });
    await segment;
    recorder.stop();
    await stopped;
    setProgress(0);
    if (aborted) return setMode("idle");

    const type = baseMime(recorder.mimeType || mime);
    const blob = new Blob(chunks, { type });
    if (blob.size === 0) {
      setMode("idle");
      return toast("Nada foi captado. Confira se o microfone está funcionando e tente de novo.", true);
    }
    const url = URL.createObjectURL(blob);
    const offsetMs = Math.min(5000, Math.round(offset));
    setReview((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return { clipId: clip.id, blob, url, type, offsetMs, length };
    });
    setMode("idle");
  };

  const pendingAfter = (clipId: string) => clips.filter((c) => c.id !== clipId && !takeOf(c.id));

  const confirmTake = async () => {
    if (!review) return;
    const clip = clips.find((c) => c.id === review.clipId);
    if (!clip) return;
    stopAll();
    setMode("uploading");
    try {
      const path = `${room.id}/${userId}/${clip.id.replace(/[^\w.-]+/g, "_")}-${Date.now()}.${extensionForMime(review.type)}`;
      const { error: upErr } = await supabase.storage.from("takes").upload(path, review.blob, { contentType: review.type, upsert: true });
      if (upErr) throw upErr;
      rememberTake(path, review.blob);
      const previous = takeOf(clip.id);
      const { error } = await supabase.from("takes").upsert(
        { room_id: room.id, clip_id: clip.id, user_id: userId, path, duration_ms: Math.round(review.length * 1000), offset_ms: review.offsetMs },
        { onConflict: "room_id,clip_id" },
      );
      if (error) {
        await supabase.storage.from("takes").remove([path]);
        throw error.code === "42501" ? new Error("Outra pessoa já gravou essa fala.") : error;
      }
      if (previous && previous.path !== path) await supabase.storage.from("takes").remove([previous.path]);
      remoteUrls.current.set(path, review.url);
      setLocalTakes((prev) => ({ ...prev, [clip.id]: review.url }));
      setReview(null);
      const next = pendingAfter(clip.id)[0];
      notify();
      await refresh();
      if (next) {
        setSelectedId(next.id);
        toast("Fala enviada! Próxima.");
      } else toast("Você terminou todas as suas falas!");
    } catch (err) {
      toast(errorMessage(err), true);
    } finally {
      setMode("idle");
    }
  };

  const busy = mode !== "idle";
  const locked = mode === "uploading" || mode === "recording" || mode === "countdown";

  const selectClip = (id: string) => {
    if (id === selectedId || mode === "recording" || mode === "countdown" || mode === "uploading") return;
    if (review && !confirm("Descartar a gravação que você ainda não enviou?")) return;
    if (review) {
      URL.revokeObjectURL(review.url);
      setReview(null);
    }
    stopAll();
    setSelectedId(id);
    const clip = clips.find((c) => c.id === id);
    if (clip && videoRef.current) void seekTo(videoRef.current, clip.timestamps[0]);
  };
  const clipIndex = useMemo(() => new Map(room.manifest.clips.map((c, i) => [c.id, i + 1])), [room.manifest.clips]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, select, textarea")) return;
      if (!selected) return;
      if (e.key.toLowerCase() === "r" && !locked && mic.stream && canRecord) void record(selected);
      if (e.key === "Enter" && !locked && review?.clipId === selected.id) void confirmTake();
      if (e.key === "Escape") stopAll();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (clips.length === 0)
    return (
      <Empty icon={<Mic size={22} />} title="Você ainda não tem personagem" text="Escolha pelo menos um personagem no elenco para ver as suas falas aqui.">
        <button className="btn primary" onClick={goToCast}>
          Escolher personagem
        </button>
      </Empty>
    );

  const hasTake = selected && (!!takeOf(selected.id) || !!localTakes[selected.id]);
  const reviewing = !!selected && review?.clipId === selected.id;
  const isLast = !!selected && pendingAfter(selected.id).length === 0;

  return (
    <div className="record-layout">
      <div className="stack" style={{ gap: 14 }}>
        <div className="card" style={{ overflow: "hidden" }}>
          <VideoStage src={pack.url(room.manifest.video)} path={room.manifest.video} onReady={(v) => (videoRef.current = v)}>
            {mode === "recording" && (
              <div className="rec-badge">
                <span className="dot" /> GRAVANDO
              </div>
            )}
            {selected && (mode === "recording" || mode === "countdown" || mode === "mine" || mode === "scene") && selected.caption && (
              <div className="caption-box">
                <small>{selected.characters.join(" · ")}</small>
                {selected.caption}
              </div>
            )}
            {mode === "countdown" && count > 0 && <div className="countdown">{count}</div>}
          </VideoStage>
          {(mode === "recording" || mode === "scene" || mode === "mine") && (
            <Progress value={progress} thin />
          )}
          {selected && (
            <div className="card-body stack" style={{ gap: 14 }}>
              <div className="row" style={{ alignItems: "flex-start" }}>
                <div className="grow">
                  <div className="muted" style={{ fontSize: 12 }}>
                    Fala {clipIndex.get(selected.id)} · {selected.characters.join(", ")} · {selected.timestamps[0].toFixed(2)}s
                    {selected.timestamps.length > 1 ? ` (+${selected.timestamps.length - 1} repetições)` : ""}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{selected.caption || <span className="dim">Sem legenda</span>}</div>
                </div>
                {takeOf(selected.id) && (
                  <span className="pill ok">
                    <Check size={13} /> Gravada
                  </span>
                )}
              </div>
              {reviewing && review && mode !== "recording" && mode !== "countdown" ? (
                <div className="notice" style={{ flexDirection: "column", alignItems: "stretch", gap: 12, borderColor: "#fff" }}>
                  <div>
                    <strong>Gravação pronta.</strong> Pode seguir direto, ouvir como ficou ou comparar com o original.
                  </div>
                  <div className="row wrap">
                    <button className="btn primary lg" onClick={confirmTake} disabled={locked} title="Atalho: Enter">
                      {mode === "uploading" ? <Spinner /> : isLast ? <Flag size={17} /> : <ArrowRight size={17} />}
                      {mode === "uploading" ? "Enviando…" : isLast ? "Usar e finalizar" : "Usar e ir para a próxima"}
                    </button>
                    <button
                      className="btn lg"
                      onClick={() => (mode === "mine" ? stopAll() : playMine(selected, { url: review.url, offsetMs: review.offsetMs }))}
                      disabled={locked}
                    >
                      {mode === "mine" ? <Square size={16} /> : <Play size={17} />} Ouvir minha
                    </button>
                    <button className="btn lg" onClick={() => (mode === "scene" ? stopAll() : playScene(selected))} disabled={locked}>
                      {mode === "scene" ? <Square size={16} /> : <Clapperboard size={17} />} Ver original
                    </button>
                    <button className="btn lg" onClick={() => record(selected)} disabled={locked || !mic.stream} title="Atalho: R">
                      <RotateCcw size={17} /> Regravar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="row wrap">
                  {mode === "recording" || mode === "countdown" ? (
                    <button className="btn primary lg" onClick={stopAll}>
                      <Square size={16} /> Cancelar
                    </button>
                  ) : (
                    <button className="btn primary lg" onClick={() => record(selected)} disabled={busy || !mic.stream || !canRecord} title="Atalho: R">
                      {hasTake ? <RotateCcw size={17} /> : <Circle size={17} fill="var(--red)" className="rec-dot" />}
                      {hasTake ? "Regravar" : "Gravar"}
                    </button>
                  )}
                  <button className="btn lg" onClick={() => (mode === "scene" ? stopAll() : playScene(selected))} disabled={busy && mode !== "scene"}>
                    {mode === "scene" ? <Square size={16} /> : <Clapperboard size={17} />} Ver cena
                  </button>
                  {hasTake && (
                    <button className="btn lg" onClick={() => (mode === "mine" ? stopAll() : playMine(selected))} disabled={busy && mode !== "mine"}>
                      {mode === "mine" ? <Square size={16} /> : <Play size={17} />} Minha versão
                    </button>
                  )}
                </div>
              )}
              {!canRecord && (
                <div className="notice">
                  <Headphones size={16} />
                  <span>
                    {room.status === "lobby" ? "O dono ainda não liberou a gravação. Enquanto isso, ensaie com “Ver cena”." : "A sessão foi finalizada. Veja o resultado!"}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="stack sticky" style={{ gap: 14 }}>
        <div className="card">
          <div className="card-head">
            {mic.stream ? <Mic size={16} /> : <MicOff size={16} />}
            <h3>Microfone</h3>
          </div>
          <div className="card-body stack" style={{ gap: 10 }}>
            {mic.stream ? (
              <>
                <select className="input" value={mic.deviceId || mic.stream.getAudioTracks()[0]?.getSettings().deviceId} onChange={(e) => mic.choose(e.target.value)}>
                  {mic.devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || "Microfone"}
                    </option>
                  ))}
                </select>
                <div className="meter">
                  <div style={{ width: `${Math.min(100, mic.level * 140)}%` }} />
                </div>
                <span className="muted" style={{ fontSize: 12 }}>Use fones de ouvido para o som do vídeo não vazar.</span>
              </>
            ) : (
              <button className="btn primary block" onClick={() => mic.start()}>
                <Mic size={15} /> Ativar microfone
              </button>
            )}
            {mic.error && <div className="notice error">{mic.error}</div>}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Suas falas</h3>
            <span className="sub" style={{ marginLeft: "auto" }}>
              {doneCount}/{clips.length}
            </span>
          </div>
          <div style={{ padding: "0 20px 12px" }}>
            <Progress value={clips.length ? doneCount / clips.length : 0} thin />
          </div>
          <div className="clip-list scroll-panel">
            {clips.map((clip) => {
              const done = !!takeOf(clip.id);
              const img = pack.url(clip.image);
              return (
                <div key={clip.id} className={`clip-row${clip.id === selected?.id ? " on" : ""}`} onClick={() => selectClip(clip.id)}>
                  <span className="num">{String(clipIndex.get(clip.id)).padStart(2, "0")}</span>
                  <div className="thumb">{img ? <img src={img} alt="" /> : <Mic size={14} />}</div>
                  <div className="text">
                    <strong>{clip.caption || clip.id}</strong>
                    <span>
                      {clip.characters.join(", ")} · {durations[clip.id] ? `${durations[clip.id].toFixed(1)}s` : "…"}
                    </span>
                  </div>
                  <span className={`status-icon ${done ? "done" : "todo"}`}>{done ? <Check size={13} strokeWidth={3} /> : null}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
