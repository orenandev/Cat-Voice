import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

const CORE = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm";
const CORE_MT = "https://unpkg.com/@ffmpeg/core-mt@0.12.10/dist/esm";
let instance: Promise<FFmpeg> | null = null;

export const multiThreaded = () => typeof SharedArrayBuffer !== "undefined" && self.crossOriginIsolated === true;

function getFfmpeg() {
  if (!instance) {
    instance = (async () => {
      const ffmpeg = new FFmpeg();
      if (multiThreaded()) {
        await ffmpeg.load({
          coreURL: await toBlobURL(`${CORE_MT}/ffmpeg-core.js`, "text/javascript"),
          wasmURL: await toBlobURL(`${CORE_MT}/ffmpeg-core.wasm`, "application/wasm"),
          workerURL: await toBlobURL(`${CORE_MT}/ffmpeg-core.worker.js`, "text/javascript"),
        });
      } else {
        await ffmpeg.load({
          coreURL: await toBlobURL(`${CORE}/ffmpeg-core.js`, "text/javascript"),
          wasmURL: await toBlobURL(`${CORE}/ffmpeg-core.wasm`, "application/wasm"),
        });
      }
      return ffmpeg;
    })().catch((err) => {
      instance = null;
      throw err;
    });
  }
  return instance;
}

export type ExportStage = "loading" | "encoding" | "done";

export async function exportDubVideo(
  video: File,
  audio: Blob,
  onProgress: (stage: ExportStage, ratio: number) => void,
) {
  onProgress("loading", 0);
  const ffmpeg = await getFfmpeg();
  const inputName = `input.${video.name.split(".").pop()?.toLowerCase() ?? "ogv"}`;
  const listener = ({ progress }: { progress: number }) => onProgress("encoding", Math.max(0, Math.min(1, progress)));
  ffmpeg.on("progress", listener);
  try {
    await ffmpeg.writeFile(inputName, await fetchFile(video));
    await ffmpeg.writeFile("mix.wav", await fetchFile(audio));
    onProgress("encoding", 0);
    const copyVideo = inputName.endsWith(".mp4") || inputName.endsWith(".m4v") || inputName.endsWith(".mov");
    const args = [
      "-i", inputName,
      "-i", "mix.wav",
      "-map", "0:v:0",
      "-map", "1:a:0",
      ...(copyVideo
        ? ["-c:v", "copy"]
        : ["-c:v", "libx264", "-preset", "ultrafast", "-tune", "fastdecode", "-crf", "24", "-pix_fmt", "yuv420p", "-vf", "scale='min(1280,iw)':-2", "-threads", "0"]),
      "-c:a", "aac",
      "-b:a", "192k",
      "-shortest",
      "-movflags", "+faststart",
      "output.mp4",
    ];
    const code = await ffmpeg.exec(args);
    if (code !== 0) throw new Error("O ffmpeg não conseguiu gerar o vídeo");
    const data = await ffmpeg.readFile("output.mp4");
    onProgress("done", 1);
    return new Blob([data as Uint8Array<ArrayBuffer>], { type: "video/mp4" });
  } finally {
    ffmpeg.off("progress", listener);
    await Promise.all(["output.mp4", "mix.wav", inputName].map((f) => ffmpeg.deleteFile(f).catch(() => undefined)));
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || "dublagem";
}
