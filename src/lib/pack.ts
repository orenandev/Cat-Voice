import { Archive } from "libarchive.js";
import { asNumberArray, asString, asStringArray, flatConfig } from "./godotConfig";
import type { PackCharacter, PackClip, PackManifest } from "./types";

Archive.init({ workerUrl: "/vendor/libarchive/worker-bundle.js" });

const AUDIO_PRIORITY = ["wav", "mp3", "ogg"];
const IMAGE_EXT = ["png", "jpg", "jpeg", "webp"];
const VIDEO_EXT = ["ogv", "mp4", "webm", "mov", "m4v"];
const BACKING_EXT = ["wav", "mp3", "ogg", "aac", "m4a", "opus", "flac"];
export const ACCEPTED_ARCHIVES = ".zip,.rar,.7z,.tar,.gz";
export const DEFAULT_CHARACTER = "Elenco";

export type PackFiles = Map<string, File>;

export type LoadedPack = {
  manifest: PackManifest;
  files: PackFiles;
  url: (path: string | undefined) => string | undefined;
  dispose: () => void;
};

function ext(name: string) {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

function stem(name: string) {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const i = base.lastIndexOf(".");
  return i < 0 ? base : base.slice(0, i);
}

function dirOf(path: string) {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i + 1);
}

export async function extractArchive(file: Blob, name: string, onProgress?: (done: number, total: number) => void) {
  const archive = await Archive.open(file instanceof File ? file : new File([file], name));
  try {
    const total = (await archive.getFilesArray()).length;
    onProgress?.(0, total);
    const tree = await archive.extractFiles();
    onProgress?.(total, total);
    const files: PackFiles = new Map();
    const walk = (node: Record<string, unknown>, prefix: string) => {
      for (const [name, value] of Object.entries(node)) {
        if (value instanceof File) files.set(`${prefix}${name}`, value);
        else if (value && typeof value === "object") walk(value as Record<string, unknown>, `${prefix}${name}/`);
      }
    };
    walk(tree, "");
    return files;
  } finally {
    await archive.close().catch(() => undefined);
  }
}

export function findPackRoots(files: PackFiles) {
  const roots: string[] = [];
  for (const path of files.keys()) {
    const base = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
    if (base.startsWith("dub_video.") && VIDEO_EXT.includes(ext(base))) roots.push(dirOf(path));
  }
  return [...new Set(roots)].sort();
}

async function readText(file: File | undefined) {
  if (!file) return "";
  return (await file.text()).replace(/^﻿/, "");
}

export async function buildManifest(files: PackFiles, root: string): Promise<PackManifest> {
  const inRoot = [...files.keys()].filter((p) => p.startsWith(root) && !p.slice(root.length).includes("/"));
  const byStem = new Map<string, string[]>();
  for (const path of inRoot) {
    const s = stem(path);
    byStem.set(s, [...(byStem.get(s) ?? []), path]);
  }
  const pick = (s: string, exts: string[]) => {
    const candidates = byStem.get(s) ?? [];
    for (const e of exts) {
      const hit = candidates.find((p) => ext(p) === e);
      if (hit) return hit;
    }
    return undefined;
  };
  const findCaseInsensitive = (s: string, exts: string[]) => {
    for (const [key] of byStem) if (key.toLowerCase() === s.toLowerCase()) return pick(key, exts);
    return undefined;
  };

  const video = findCaseInsensitive("dub_video", VIDEO_EXT);
  if (!video) throw new Error("Esse pack não é um Dub Pack: falta o arquivo dub_video (.ogv).");

  const info = flatConfig(await readText(files.get(pick("_pack_info", ["ini", "cfg", "txt"]) ?? "")));
  const resolveImage = (value: string | undefined) => {
    if (!value) return undefined;
    const direct = root + value.replace(/^res:\/\/|^\.\//, "").split("/").pop();
    if (files.has(direct)) return direct;
    return pick(stem(value), IMAGE_EXT);
  };
  const filler = pick("_pack_filler_image", IMAGE_EXT) ?? pick("_icon", IMAGE_EXT);

  const clips: PackClip[] = [];
  const stems = [...byStem.keys()].filter((s) => !s.startsWith("_") && s.toLowerCase() !== "dub_video").sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const s of stems) {
    const audio = pick(s, AUDIO_PRIORITY);
    if (!audio) continue;
    const meta = flatConfig(await readText(files.get(pick(s, ["txt", "cfg", "ini"]) ?? "")));
    const timestamps = asNumberArray(meta.dub_timestamps).sort((a, b) => a - b);
    if (timestamps.length === 0) continue;
    const characters = asStringArray(meta.dub_characters);
    clips.push({
      id: s,
      audio: audio.slice(root.length),
      image: (resolveImage(asString(meta.image)) ?? pick(s, IMAGE_EXT) ?? filler)?.slice(root.length),
      caption: asString(meta.caption),
      timestamps,
      characters: characters.length ? characters : [DEFAULT_CHARACTER],
    });
  }
  if (clips.length === 0) throw new Error("Nenhuma fala com tempo de sincronia (dub_timestamps) foi encontrada no pack.");
  clips.sort((a, b) => a.timestamps[0] - b.timestamps[0]);

  const characters = new Map<string, PackCharacter>();
  for (const clip of clips) {
    for (const name of clip.characters) {
      const current = characters.get(name);
      if (current) current.clips++;
      else characters.set(name, { name, clips: 1, image: clip.image });
    }
  }

  const backing = BACKING_EXT.map((e) => pick("_backing_track", [e])).find(Boolean);
  const authors = asStringArray(info.authors ?? info.author);
  const authorFile = await readText(files.get(pick("_author", ["txt"]) ?? ""));
  const subtitleFile = await readText(files.get(pick("_subtitle", ["txt"]) ?? ""));
  const folderName = root.replace(/\/$/, "").split("/").pop() ?? "";

  return {
    root,
    title: asString(info.title) || folderName || "Dub Pack",
    subtitle: asString(info.subtitle) || subtitleFile.trim() || undefined,
    authors: authors.length ? authors : authorFile.trim() ? [authorFile.trim()] : [],
    icon: resolveImage(asString(info.icon))?.slice(root.length) ?? filler?.slice(root.length),
    video: video.slice(root.length),
    backing: backing?.slice(root.length),
    characters: [...characters.values()],
    clips,
  };
}

export function createLoadedPack(manifest: PackManifest, files: PackFiles): LoadedPack {
  const urls = new Map<string, string>();
  return {
    manifest,
    files,
    url(path) {
      if (!path) return undefined;
      const full = manifest.root + path;
      const cached = urls.get(full);
      if (cached) return cached;
      const file = files.get(full);
      if (!file) return undefined;
      const url = URL.createObjectURL(file);
      urls.set(full, url);
      return url;
    },
    dispose() {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    },
  };
}

export function packFile(pack: LoadedPack, path: string | undefined) {
  return path ? pack.files.get(pack.manifest.root + path) : undefined;
}

export async function sha256(blob: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function formatBytes(bytes: number | null | undefined) {
  if (!bytes) return "0 MB";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function isMediaNativelyPlayable(path: string) {
  const e = ext(path);
  const probe = document.createElement("video");
  if (e === "ogv") return probe.canPlayType('video/ogg; codecs="theora, vorbis"') !== "";
  if (e === "webm") return probe.canPlayType("video/webm") !== "";
  return true;
}

export function videoExt(path: string) {
  return ext(path);
}
