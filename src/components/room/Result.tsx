import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Captions, Check, Crown, Download, FileAudio, Film, LogOut, Maximize, Pause, Play, RotateCcw, Volume2 } from "lucide-react";
import { VideoStage, playMedia, type StageVideo } from "../VideoStage";
import { Avatar, Progress, Spinner } from "../ui";
import { useToast } from "../Toast";
import { decode, encodeWav, recordedWindows, unlockAudio, renderDuckedBacking, renderFinalMix, renderVoices } from "../../lib/audio";
import { downloadBlob, exportDubVideo, safeFileName } from "../../lib/exportVideo";
import { errorMessage, supabase } from "../../lib/supabase";
import { formatTime, packFile, type LoadedPack } from "../../lib/pack";
import { mapLimit } from "../../lib/concurrency";
import { fetchTake } from "../../lib/takeStore";
import type { Playback, RoomData } from "../../lib/useRoom";
import type { Room, Take } from "../../lib/types";

type Built = { voices: AudioBuffer; voicesUrl: string; backing: AudioBuffer | null; backingUrl: string | null };
type Job = { label: string; value: number } | null;

const VOL_KEY = "cvs:volumes";
const DRIFT = 0.4;

function loadVolumes() {
  try {
    return { voices: 1, master: 1, ...JSON.parse(localStorage.getItem(VOL_KEY) ?? "{}") } as { voices: number; master: number };
  } catch {
    return { voices: 1, master: 1 };
  }
}

export function Result({ room, pack, data, userId, onExit, leaving }: { room: Room; pack: LoadedPack; data: RoomData; userId: string; onExit: () => void; leaving: boolean }) {
  const toast = useToast();
  const { takes, claims, members, online, setWatchReady, sendPlayback, onPlayback } = data;
  const manifest = room.manifest;
  const isOwner = room.owner_id === userId;
  const free = !!room.settings?.watched;
  const controls = isOwner || free;
  const [video, setVideo] = useState<StageVideo | null>(null);
  const [built, setBuilt] = useState<Built | null>(null);
  const [job, setJob] = useState<Job>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const active = ready;
  const [volumes, setVolumes] = useState(loadVolumes);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [captions, setCaptions] = useState(true);
  const [ended, setEnded] = useState(false);
  const [startIn, setStartIn] = useState(0);
  const autoStarted = useRef(false);
  const voicesEl = useRef<HTMLAudioElement>(null);
  const backingEl = useRef<HTMLAudioElement>(null);
  const stageWrap = useRef<HTMLDivElement>(null);
  const pending = useRef<Playback | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(VOL_KEY, JSON.stringify(volumes));
    } catch {
      return;
    }
  }, [volumes]);

  const build = useCallback(async () => {
    if (!video) return;
    const label = "Juntando as vozes de todo mundo…";
    setFailure(null);
    setJob({ label, value: 0 });
    try {
      const clipIds = new Set(manifest.clips.map((c) => c.id));
      const relevant = takes.filter((t) => clipIds.has(t.clip_id));
      const recordedIds = new Set(relevant.map((t) => t.clip_id));
      const missing = manifest.clips.filter((c) => !recordedIds.has(c.id));
      const total = missing.length + relevant.length + 1;
      let done = 0;
      const step = () => setJob({ label, value: ++done / total });
      const [originalEntries, recordedEntries] = await Promise.all([
        mapLimit(missing, 4, async (clip) => {
          const file = packFile(pack, clip.audio);
          const buffer = file ? await decode(file).catch(() => null) : null;
          step();
          return [clip.id, buffer] as const;
        }),
        mapLimit(relevant, 6, async (take) => {
          const buffer = await decode(await fetchTake(take.path)).catch((err: unknown) => {
            throw err instanceof DOMException ? new Error("Uma das gravações está corrompida e não pôde ser lida.") : err;
          });
          step();
          return [take.clip_id, { buffer, take }] as const;
        }),
      ]);
      const originals = new Map<string, AudioBuffer>();
      for (const [id, buffer] of originalEntries) if (buffer) originals.set(id, buffer);
      const recorded = new Map<string, { buffer: AudioBuffer; take: Take }>(recordedEntries);
      const backingFile = packFile(pack, manifest.backing);
      const rawBacking = backingFile ? await decode(backingFile).catch(() => null) : null;
      const backing = rawBacking ? await renderDuckedBacking(rawBacking, recordedWindows(manifest, recorded)) : null;
      const length = Math.max(video.duration || 0, backing?.duration ?? 0, ...manifest.clips.map((c) => c.timestamps[c.timestamps.length - 1] + 8));
      setJob({ label: "Mixando a dublagem…", value: 0.98 });
      const voices = await renderVoices({ manifest, duration: length, originals, takes: recorded, useOriginalForMissing: true });
      setBuilt({
        voices,
        backing,
        voicesUrl: URL.createObjectURL(encodeWav(voices)),
        backingUrl: backing ? URL.createObjectURL(encodeWav(backing)) : null,
      });
    } catch (err) {
      setFailure(errorMessage(err));
    } finally {
      setJob(null);
    }
  }, [video, manifest, takes, pack]);

  useEffect(() => {
    if (video && !built && !job) void build();
  }, [video]);

  useEffect(() => {
    if (!built) return;
    const urls = [built.voicesUrl, built.backingUrl];
    return () => urls.forEach((u) => u && URL.revokeObjectURL(u));
  }, [built]);

  const syncAudio = useCallback(
    (force = false) => {
      if (!video) return;
      for (const el of [voicesEl.current, backingEl.current]) {
        if (!el || !el.src) continue;
        if (force || Math.abs(el.currentTime - video.currentTime) > 0.12) el.currentTime = video.currentTime;
        if (!video.paused && el.paused && video.currentTime < (el.duration || Infinity)) void el.play().catch(() => undefined);
        if (video.paused && !el.paused) el.pause();
      }
    },
    [video],
  );

  const apply = useCallback(
    (state: Playback) => {
      if (!video) return;
      const target = state.time + (state.playing ? 0.15 : 0);
      if (Math.abs(video.currentTime - target) > DRIFT) video.currentTime = target;
      if (state.playing && video.paused) void playMedia(video);
      if (!state.playing && !video.paused) video.pause();
    },
    [video],
  );

  useEffect(() => {
    if (isOwner || free) return;
    onPlayback((state) => {
      if (ready) apply(state);
      else pending.current = state;
    });
    return () => onPlayback(null);
  }, [isOwner, free, ready, apply, onPlayback]);

  const broadcast = useCallback(() => {
    if (isOwner && !free && video) sendPlayback({ playing: !video.paused, time: video.currentTime });
  }, [isOwner, free, video, sendPlayback]);

  const markWatched = useCallback(() => {
    if (!isOwner || free) return;
    void supabase
      .from("rooms")
      .update({ settings: { ...room.settings, watched: true } })
      .eq("id", room.id)
      .then(({ error }) => !error && data.notify());
  }, [isOwner, free, room.id, room.settings, data]);

  useEffect(() => {
    if (!video) return;
    video.muted = true;
    setDuration(video.duration || 0);
    const onTime = () => setTime(video.currentTime);
    const onEnded = () => {
      setEnded(true);
      markWatched();
      onPause();
    };
    const onPlay = () => {
      setEnded(false);
      setPlaying(true);
      syncAudio(true);
      broadcast();
    };
    const onPause = () => {
      setPlaying(false);
      voicesEl.current?.pause();
      backingEl.current?.pause();
      broadcast();
    };
    const onSeeked = () => {
      syncAudio(true);
      broadcast();
    };
    const onDuration = () => setDuration(video.duration || 0);
    const events: [string, () => void][] = [
      ["timeupdate", onTime],
      ["play", onPlay],
      ["playing", onPlay],
      ["pause", onPause],
      ["ended", onEnded],
      ["seeked", onSeeked],
      ["durationchange", onDuration],
    ];
    events.forEach(([e, fn]) => video.addEventListener(e, fn));
    const audioTimer = setInterval(() => syncAudio(false), 400);
    const beat = setInterval(broadcast, 1500);
    return () => {
      clearInterval(audioTimer);
      clearInterval(beat);
      events.forEach(([e, fn]) => video.removeEventListener(e, fn));
    };
  }, [video, syncAudio, broadcast, markWatched]);

  useEffect(() => {
    if (voicesEl.current) voicesEl.current.volume = Math.min(1, volumes.voices * volumes.master);
    if (backingEl.current) backingEl.current.volume = Math.min(1, volumes.master);
  }, [volumes, built]);

  useEffect(() => {
    void setWatchReady(ready && !!built);
  }, [setWatchReady, ready, built]);

  const joinSession = async () => {
    unlockAudio();
    for (const el of [voicesEl.current, backingEl.current]) {
      if (!el) continue;
      el.muted = true;
      await el.play().catch(() => undefined);
      el.pause();
      el.muted = false;
    }
    setReady(true);
    if (free && video) {
      if (video.ended || video.currentTime >= (video.duration || Infinity) - 0.2) video.currentTime = 0;
      void playMedia(video);
      return;
    }
    if (pending.current) {
      apply(pending.current);
      pending.current = null;
    }
  };

  const viewers = online.size ? members.filter((m) => online.has(m.user_id) || m.watch_ready) : members;
  const waiting = viewers.filter((m) => !m.watch_ready);
  const everyoneReady = waiting.length === 0;

  useEffect(() => {
    if (free || !isOwner || !ready || !built || !video || !everyoneReady || playing || ended || autoStarted.current || video.currentTime > 0.2) return;
    autoStarted.current = true;
    let n = 3;
    setStartIn(n);
    const timer = setInterval(() => {
      n -= 1;
      if (n > 0) return setStartIn(n);
      clearInterval(timer);
      setStartIn(0);
      void playMedia(video);
    }, 900);
    return () => {
      clearInterval(timer);
      setStartIn(0);
      autoStarted.current = false;
    };
  }, [free, isOwner, ready, built, video, everyoneReady, playing, ended]);

  const replay = () => {
    if (!video || !controls) return;
    setEnded(false);
    video.currentTime = 0;
    void playMedia(video);
  };

  const toggle = () => {
    if (!video || !controls) return;
    if (video.paused) void playMedia(video);
    else video.pause();
  };

  const seek = (t: number) => {
    if (!video || !controls) return;
    video.currentTime = t;
    setTime(t);
  };

  const fullscreen = () => {
    const el = stageWrap.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  const finalMix = async () => {
    if (!built) throw new Error("A dublagem ainda está sendo montada.");
    return encodeWav(await renderFinalMix(built.voices, built.backing, volumes.voices, 1));
  };

  const downloadAudio = async () => {
    try {
      setJob({ label: "Gerando o áudio final…", value: 0.5 });
      downloadBlob(await finalMix(), `${safeFileName(room.name)} - dublagem.wav`);
    } catch (err) {
      toast(errorMessage(err), true);
    } finally {
      setJob(null);
    }
  };

  const downloadVideo = async () => {
    const file = packFile(pack, manifest.video);
    if (!file) return;
    try {
      setJob({ label: "Gerando o áudio final…", value: 0 });
      const mix = await finalMix();
      const out = await exportDubVideo(file, mix, (stage, ratio) =>
        setJob({ label: stage === "loading" ? "Carregando o conversor de vídeo (~30 MB, só na primeira vez)…" : `Renderizando o vídeo… ${Math.round(ratio * 100)}%`, value: stage === "loading" ? 0 : ratio }),
      );
      downloadBlob(out, `${safeFileName(room.name)} - dublagem.mp4`);
      toast("Vídeo pronto!");
    } catch (err) {
      toast(errorMessage(err), true);
    } finally {
      setJob(null);
    }
  };

  const currentLine = useMemo(() => {
    if (!captions) return null;
    for (const clip of manifest.clips) {
      for (const at of clip.timestamps) if (time >= at && time <= at + 3.2) return clip;
    }
    return null;
  }, [captions, time, manifest.clips]);

  const owner = members.find((m) => m.user_id === room.owner_id);

  return (
    <div className="stack" style={{ gap: 16, maxWidth: 1100, margin: "0 auto" }}>
      <div className="card" style={{ overflow: "hidden" }} ref={stageWrap}>
        <VideoStage src={pack.url(manifest.video)} path={manifest.video} onReady={setVideo}>
          {currentLine?.caption && !job && active && (
            <div className="caption-box">
              <small>{currentLine.characters.join(" · ")}</small>
              {currentLine.caption}
            </div>
          )}
          {failure && !job && !built && (
            <div className="countdown" style={{ fontSize: 15, fontWeight: 500, pointerEvents: "auto" }}>
              <div className="stack" style={{ alignItems: "center", textAlign: "center", maxWidth: 380 }}>
                <AlertTriangle size={24} />
                <span>{failure}</span>
                <button className="btn primary" onClick={() => void build()}>
                  <RotateCcw size={15} /> Tentar de novo
                </button>
              </div>
            </div>
          )}
          {(job || !built) && !(failure && !job) && (
            <div className="countdown" style={{ fontSize: 15, fontWeight: 500 }}>
              <div className="stack" style={{ alignItems: "center", width: "min(360px, 80%)" }}>
                <Spinner size={22} />
                <span>{job?.label ?? "Carregando o vídeo…"}</span>
                {job && (
                  <div style={{ width: "100%" }}>
                    <Progress value={job.value} />
                  </div>
                )}
              </div>
            </div>
          )}
          {built && !job && !active && (
            <div className="countdown" style={{ fontSize: 15, fontWeight: 500, pointerEvents: "auto" }}>
              <div className="stack" style={{ alignItems: "center", textAlign: "center", maxWidth: 380 }}>
                <strong style={{ fontSize: 22 }}>{free ? "Assistir a dublagem" : "A dublagem está pronta"}</strong>
                <span className="muted">{free ? "Agora cada um assiste no seu ritmo." : "Vocês vão assistir juntos. O vídeo começa sozinho quando todos estiverem prontos."}</span>
                <button className="btn primary lg" onClick={joinSession}>
                  {free ? <Play size={17} /> : <Check size={17} />} {free ? "Assistir" : "Estou pronto"}
                </button>
              </div>
            </div>
          )}
          {ended && active && !job && (
            <div className="countdown" style={{ fontSize: 15, fontWeight: 500, pointerEvents: "auto" }}>
              <div className="stack" style={{ alignItems: "center", textAlign: "center", maxWidth: 380 }}>
                <strong style={{ fontSize: 26 }}>Fim!</strong>
                <span className="muted">Valeu pela dublagem. Dá para baixar o vídeo aqui embaixo antes de sair.</span>
                <div className="row wrap" style={{ justifyContent: "center" }}>
                  {controls && (
                    <button className="btn lg" onClick={replay}>
                      <RotateCcw size={16} /> Assistir de novo
                    </button>
                  )}
                  <button className={`btn lg${isOwner ? "" : " primary"}`} onClick={onExit} disabled={leaving}>
                    {leaving ? <Spinner /> : <LogOut size={16} />} {isOwner ? "Encerrar sala" : "Sair da sala"}
                  </button>
                </div>
              </div>
            </div>
          )}
          {startIn > 0 && !job && <div className="countdown">{startIn}</div>}
          {ready && !free && !playing && !job && startIn === 0 && time < 0.2 && (
            <div className="countdown" style={{ fontSize: 15, fontWeight: 500 }}>
              <span className="muted">{everyoneReady ? "Começando…" : (waiting.length === 1 ? "Esperando 1 pessoa ficar pronta…" : `Esperando ${waiting.length} pessoas ficarem prontas…`)}</span>
            </div>
          )}
        </VideoStage>
        <div className="controls">
          {controls ? (
            <button
              className="btn primary icon"
              onClick={toggle}
              disabled={!active || !built || (!free && !playing && time < 0.2 && !everyoneReady)}
              aria-label={playing ? "Pausar" : "Reproduzir para todos"}
            >
              {playing ? <Pause size={17} /> : <Play size={17} />}
            </button>
          ) : (
            <span className="pill" title="O dono controla a reprodução">
              <Crown size={12} className="gold" /> {owner?.profile?.display_name ?? "Dono"}
            </span>
          )}
          <span className="mono muted" style={{ fontSize: 12 }}>
            {formatTime(time)} / {formatTime(duration)}
          </span>
          {controls ? (
            <input className="seek" type="range" min={0} max={duration || 0} step={0.05} value={time} onChange={(e) => seek(Number(e.target.value))} disabled={!active} />
          ) : (
            <div className="seek">
              <Progress value={duration ? time / duration : 0} thin />
            </div>
          )}
          <div className="vol hide-sm">
            <Volume2 size={15} className="muted" />
            <input type="range" min={0} max={1} step={0.01} value={volumes.master} onChange={(e) => setVolumes((v) => ({ ...v, master: Number(e.target.value) }))} aria-label="Volume geral" style={{ width: 90 }} />
          </div>
          <button className={`btn icon sm${captions ? "" : " ghost"}`} onClick={() => setCaptions((c) => !c)} title="Legendas" aria-label="Legendas">
            <Captions size={15} />
          </button>
          <button className="btn icon sm ghost" onClick={fullscreen} title="Tela cheia" aria-label="Tela cheia">
            <Maximize size={15} />
          </button>
        </div>
        {built?.backingUrl && <audio ref={backingEl} src={built.backingUrl} preload="auto" />}
        {built && <audio ref={voicesEl} src={built.voicesUrl} preload="auto" />}
      </div>

      <div className="row wrap" style={{ gap: 12, alignItems: "stretch" }}>
        <div className="card pad grow" style={{ minWidth: 260 }}>
          <div className="row" style={{ marginBottom: 12 }}>
            <strong style={{ fontSize: 13 }}>Assistindo</strong>
            <span className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>
              {viewers.length - waiting.length}/{viewers.length} prontos
            </span>
          </div>
          <div className="row wrap" style={{ gap: 14 }}>
            {members.map((m) => {
              const chars = claims.filter((c) => c.user_id === m.user_id).map((c) => c.character);
              const isReady = m.watch_ready;
              return (
                <div key={m.user_id} className="row" style={{ gap: 8, opacity: online.has(m.user_id) ? 1 : 0.45 }}>
                  <Avatar profile={m.profile} online={online.has(m.user_id)} />
                  <div>
                    <div className="row" style={{ gap: 5, fontSize: 13, fontWeight: 600 }}>
                      {m.profile?.display_name ?? "Jogador"} {isReady && <Check size={13} />}
                    </div>
                    <div className="muted" style={{ fontSize: 11.5 }}>{chars.join(", ") || "Plateia"}</div>
                  </div>
                </div>
              );
            })}
          </div>
          {free ? (
            <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>Vocês já assistiram juntos. Agora cada um assiste no seu ritmo.</div>
          ) : null}
          {isOwner && !free && !everyoneReady && ready && (
            <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
              Esperando: {waiting.map((m) => m.profile?.display_name ?? "Jogador").join(", ")}
            </div>
          )}
        </div>

        <div className="card pad stack" style={{ gap: 10, minWidth: 240 }}>
          <div className="vol">
            <label>Vozes</label>
            <input type="range" min={0} max={1.5} step={0.01} value={volumes.voices} onChange={(e) => setVolumes((v) => ({ ...v, voices: Number(e.target.value) }))} />
            <span className="val">{Math.round(volumes.voices * 100)}</span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary sm grow" onClick={downloadVideo} disabled={!!job || !built}>
              <Film size={14} /> Baixar MP4
            </button>
            <button className="btn sm" onClick={downloadAudio} disabled={!!job || !built} title="Baixar só o áudio">
              <FileAudio size={14} /> WAV
            </button>
          </div>
          <span className="muted row" style={{ fontSize: 11.5, gap: 6 }}>
            <Download size={12} /> Trilha sonora sempre incluída
          </span>
        </div>
      </div>
    </div>
  );
}
