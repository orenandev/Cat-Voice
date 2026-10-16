import type { PackManifest, Take } from "./types";

let sharedContext: AudioContext | null = null;

export function audioContext() {
  if (!sharedContext || sharedContext.state === "closed") sharedContext = new AudioContext({ sampleRate: 48000 });
  return sharedContext;
}

export function unlockAudio() {
  const ctx = audioContext();
  if (ctx.state !== "running") void ctx.resume().catch(() => undefined);
}

export function installAudioUnlock() {
  for (const event of ["pointerdown", "keydown", "touchend"]) window.addEventListener(event, unlockAudio, { capture: true, passive: true });
}

export async function decode(data: Blob | ArrayBuffer) {
  const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
  return audioContext().decodeAudioData(buffer.slice(0));
}

export function encodeWav(buffer: AudioBuffer) {
  const channels = buffer.numberOfChannels;
  const length = buffer.length * channels * 2;
  const out = new DataView(new ArrayBuffer(44 + length));
  const write = (offset: number, text: string) => [...text].forEach((c, i) => out.setUint8(offset + i, c.charCodeAt(0)));
  write(0, "RIFF");
  out.setUint32(4, 36 + length, true);
  write(8, "WAVE");
  write(12, "fmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, channels, true);
  out.setUint32(24, buffer.sampleRate, true);
  out.setUint32(28, buffer.sampleRate * channels * 2, true);
  out.setUint16(32, channels * 2, true);
  out.setUint16(34, 16, true);
  write(36, "data");
  out.setUint32(40, length, true);
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      out.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([out.buffer], { type: "audio/wav" });
}

export type MixSources = {
  manifest: PackManifest;
  duration: number;
  originals: Map<string, AudioBuffer>;
  takes: Map<string, { buffer: AudioBuffer; take: Take }>;
  useOriginalForMissing: boolean;
};

export async function renderVoices({ manifest, duration, originals, takes, useOriginalForMissing }: MixSources) {
  const rate = 48000;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * rate)), rate);
  for (const clip of manifest.clips) {
    const recorded = takes.get(clip.id);
    const buffer = recorded?.buffer ?? (useOriginalForMissing ? originals.get(clip.id) : undefined);
    if (!buffer) continue;
    const skip = recorded ? Math.max(0, recorded.take.offset_ms / 1000) : 0;
    for (const at of clip.timestamps) {
      if (at >= duration) continue;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const gain = ctx.createGain();
      const length = Math.min(buffer.duration - skip, duration - at);
      if (length <= 0) continue;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(1, at + 0.015);
      gain.gain.setValueAtTime(1, Math.max(at + 0.015, at + length - 0.04));
      gain.gain.linearRampToValueAtTime(0, at + length);
      src.connect(gain).connect(ctx.destination);
      src.start(at, skip, length);
    }
  }
  return ctx.startRendering();
}

export function recordedWindows(manifest: PackManifest, takes: Map<string, { buffer: AudioBuffer; take: Take }>) {
  const windows: [number, number][] = [];
  for (const clip of manifest.clips) {
    const recorded = takes.get(clip.id);
    if (!recorded) continue;
    const skip = Math.max(0, recorded.take.offset_ms / 1000);
    const length = Math.max(0.3, recorded.buffer.duration - skip - 0.5);
    for (const at of clip.timestamps) windows.push([at, at + length]);
  }
  windows.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    if (last && w[0] <= last[1] + 0.25) last[1] = Math.max(last[1], w[1]);
    else merged.push([...w]);
  }
  return merged;
}

export async function renderDuckedBacking(backing: AudioBuffer, windows: [number, number][], duck = 0.12) {
  const ctx = new OfflineAudioContext(backing.numberOfChannels, backing.length, backing.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = backing;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(1, 0);
  for (const [start, end] of windows) {
    const from = Math.max(0, start - 0.08);
    gain.gain.setValueAtTime(1, from);
    gain.gain.linearRampToValueAtTime(duck, start);
    gain.gain.setValueAtTime(duck, end);
    gain.gain.linearRampToValueAtTime(1, end + 0.15);
  }
  src.connect(gain).connect(ctx.destination);
  src.start(0);
  return ctx.startRendering();
}

export async function renderFinalMix(voices: AudioBuffer, backing: AudioBuffer | null, voiceVolume: number, backingVolume: number) {
  const rate = voices.sampleRate;
  const ctx = new OfflineAudioContext(2, voices.length, rate);
  const add = (buffer: AudioBuffer, volume: number) => {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(ctx.destination);
    src.start(0);
  };
  add(voices, voiceVolume);
  if (backing) add(backing, backingVolume);
  const rendered = await ctx.startRendering();
  let peak = 0;
  for (let c = 0; c < rendered.numberOfChannels; c++) {
    const data = rendered.getChannelData(c);
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  }
  if (peak > 0.99) {
    const k = 0.98 / peak;
    for (let c = 0; c < rendered.numberOfChannels; c++) {
      const data = rendered.getChannelData(c);
      for (let i = 0; i < data.length; i++) data[i] *= k;
    }
  }
  return rendered;
}

export function pickRecorderMime() {
  const options = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"];
  return options.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) ?? "";
}

export function extensionForMime(mime: string) {
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4")) return "m4a";
  return "webm";
}

export function baseMime(mime: string) {
  return mime.split(";")[0] || "audio/webm";
}

export function mediaDuration(url: string) {
  return new Promise<number>((resolve) => {
    const audio = new Audio();
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      if (Number.isFinite(audio.duration)) resolve(audio.duration);
      else {
        audio.currentTime = 1e9;
        audio.ontimeupdate = () => {
          audio.ontimeupdate = null;
          resolve(audio.duration);
        };
      }
    };
    audio.onerror = () => resolve(0);
    audio.src = url;
  });
}
